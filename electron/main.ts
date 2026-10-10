import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import * as path from 'node:path';
import type { Preset, ToolId } from '../shared/types';
import { applyPresetToTools } from './ipc/configWriter';
import { getPortableNodeStatus, installCli, setupPortableNode } from './ipc/installer';
import { broadcastEnvChange, launchCli, launchDesktop, openStorePage, restartTool } from './ipc/launcher';
import { testPresetKey } from './ipc/tester';
import * as presets from './ipc/presets';
import { detectTools } from './ipc/tools';
import { allPresets, appendLog, loadConfig, readLogs, saveConfig } from './store';
import { setupAutoUpdater } from './updater';

const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/* ------------------------------ 单实例锁 ------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ------------------------------ 窗口 ------------------------------ */

function resolvePreload(): string {
  return path.join(__dirname, 'preload.cjs');
}

function resolveRendererIcon(name: string): string {
  // dev: <root>/build/name；packaged: app.asar/build/name（files 已包含）
  return path.join(__dirname, '..', 'build', name);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    // 低于 1040 三列卡片会挤压换行，限制最小宽度保证排版
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: '#f4f6fb',
    title: 'AI Box',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (isDev) {
    const loadWithRetry = (attempt = 0) => {
      mainWindow!
        .loadURL(DEV_URL)
        .catch(() => {
          if (attempt < 20) setTimeout(() => loadWithRetry(attempt + 1), 500);
        });
    };
    loadWithRetry();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

/* ------------------------------ 托盘 ------------------------------ */

function createTray(): void {
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(resolveRendererIcon('tray.png'));
    if (image.isEmpty()) throw new Error('empty');
  } catch {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('AI Box');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 AI Box', click: () => (mainWindow ? (mainWindow.show(), mainWindow.focus()) : createWindow()) },
      { label: '广播环境变量变更', click: () => void broadcastEnvChange() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

/* ------------------------------ IPC ------------------------------ */

function registerIpc(): void {
  ipcMain.handle('tools:detect', () => detectTools());

  ipcMain.handle('presets:list', () => allPresets());
  ipcMain.handle('presets:save', (_e, preset: Preset) => presets.saveUserPreset(preset));
  ipcMain.handle('presets:remove', (_e, id: string) => presets.removeUserPreset(id));
  ipcMain.handle('presets:importShare', (_e, code: string) => presets.importShare(code));
  ipcMain.handle('presets:testKey', (_e, preset: { baseUrl: string; protocol: Preset['protocol']; model: string }, key: string) =>
    testPresetKey(preset, key),
  );
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: '仅允许 http(s) 链接' };
      await shell.openExternal(u.href);
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('presets:addSubscription', (_e, url: string) => presets.addSubscription(url));
  ipcMain.handle('presets:toggleSubscription', (_e, id: string, enabled: boolean) =>
    presets.toggleSubscription(id, enabled),
  );
  ipcMain.handle('presets:removeSubscription', (_e, id: string) => presets.removeSubscription(id));

  ipcMain.handle('apply:apply', (_e, presetId: string, tools: ToolId[], apiKey: string) => {
    const preset = allPresets().find((p) => p.id === presetId);
    if (!preset) throw new Error(`预设不存在：${presetId}`);
    const report = applyPresetToTools(preset, tools, apiKey);
    const cfg = loadConfig();
    for (const t of tools) cfg.lastApply[t] = report;
    saveConfig(cfg);
    appendLog(`applied preset ${presetId} -> ${tools.join(', ')}`);
    return report;
  });

  ipcMain.handle('installer:installCli', (e, tool: ToolId) =>
    installCli(tool, (p) => e.sender.send('installer:progress', p)),
  );
  ipcMain.handle('installer:portableStatus', () => getPortableNodeStatus());
  ipcMain.handle('installer:setupPortableNode', (e) =>
    setupPortableNode((p) => e.sender.send('installer:progress', { tool: 'codex', ...p })),
  );

  ipcMain.handle('launcher:launch', (_e, tool: ToolId, kind: 'cli' | 'desktop') =>
    kind === 'cli' ? launchCli(tool) : launchDesktop(tool),
  );
  ipcMain.handle('launcher:restart', async (_e, tool: ToolId) => {
    const r = await restartTool(tool);
    if (r.ok) {
      // 重启后写入的环境变量已生效：把该工具报告里的 pending-restart 标记为 ok
      const cfg = loadConfig();
      const rep = cfg.lastApply[tool];
      if (rep) {
        for (const it of rep.items) {
          if (it.tool === tool && it.status === 'pending-restart') {
            it.status = 'ok';
            it.detail = `${it.detail}（已重启生效）`;
          }
        }
        saveConfig(cfg);
      }
    }
    return r;
  });
  ipcMain.handle('launcher:openStorePage', (_e, tool: ToolId) => openStorePage(tool));

  ipcMain.handle('env:broadcast', () => broadcastEnvChange());
  ipcMain.handle('logs:get', () => readLogs());
  ipcMain.handle('meta:get', () => {
    const cfg = loadConfig();
    return {
      lastApply: cfg.lastApply,
      subscriptions: cfg.subscriptions,
      portableNode: getPortableNodeStatus(),
    };
  });
}

/* ------------------------------ 生命周期 ------------------------------ */

app.setAppUserModelId('com.aibox.app');

void app.whenReady().then(() => {
  appendLog('aibox starting');
  createTray();
  createWindow();
  registerIpc();
  presets.startSubscriptionScheduler();
  setupAutoUpdater(() => mainWindow?.webContents ?? null);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // Windows 惯例：关窗即隐藏托盘，不退出（退出走托盘菜单）
});
