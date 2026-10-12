import { app, BrowserWindow, clipboard, dialog, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import * as path from 'node:path';
import type { Preset, ToolId } from '../shared/types';
import { applyPresetToTools } from './ipc/configWriter';
import { getPortableNodeStatus, installCli, setupPortableNode, uninstallCli } from './ipc/installer';
import { broadcastEnvChange, launchCli, launchDesktop, openStorePage, restartTool } from './ipc/launcher';
import { testPresetKey } from './ipc/tester';
import { agentStart, agentStop } from './ipc/agentRunner';
import * as presets from './ipc/presets';
import { detectCatalog, invalidateDetectCache } from './ipc/tools';
import { loadHeat, refreshHeat } from './ipc/heat';
import { TOOL_CATALOG } from '../shared/toolCatalog';
import { allPresets, appendLog, getToolFavorites, loadChats, loadConfig, readLogs, saveChats, saveConfig, toggleToolFavorite } from './store';
import * as wf from './ipc/workflow';
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
      webviewTag: true, // 内置浏览器页签
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
  ipcMain.handle('tools:detect', (_e, force?: boolean) => {
    if (force) invalidateDetectCache();
    return detectCatalog(loadHeat(), { force: Boolean(force) });
  });
  ipcMain.handle('tools:toggleFavorite', (_e, id: string) => toggleToolFavorite(id));
  ipcMain.handle('workflow:listProjects', () => wf.listProjects());
  ipcMain.handle('workflow:createProject', (_e, input: { name: string; repoPath?: string; harnessWorkspace?: string }) =>
    wf.createProject(input),
  );
  ipcMain.handle('workflow:updateProject', (_e, id: string, patch: Record<string, unknown>) => wf.updateProject(id, patch));
  ipcMain.handle('workflow:upsertModule', (_e, projectId: string, mod: { id?: string; title: string; color?: string }) =>
    wf.upsertModule(projectId, mod),
  );
  ipcMain.handle('workflow:listItems', (_e, projectId?: string) => wf.listItems(projectId));
  ipcMain.handle('workflow:getItem', (_e, id: string) => wf.getItem(id));
  ipcMain.handle('workflow:createItem', (_e, input: Parameters<typeof wf.createItem>[0]) => wf.createItem(input));
  ipcMain.handle('workflow:transition', (_e, id: string, to: string, phase?: string) =>
    wf.transition(id, to as never, { phase: phase as never }),
  );
  ipcMain.handle('workflow:addComment', (_e, id: string, body: string, kind?: string, author?: 'human' | 'ai') =>
    wf.addComment(id, { author: author ?? 'human', body, kind: (kind ?? 'note') as never }),
  );
  ipcMain.handle('workflow:setGate', (_e, id: string, gate: string, ok: boolean, note?: string) =>
    wf.setGate(id, gate as never, { by: 'human', ok, note }),
  );
  ipcMain.handle('workflow:confirmBaseline', (_e, projectId: string, title: string, bodyMd: string) =>
    wf.confirmBaseline({ projectId, title, bodyMd }),
  );
  ipcMain.handle('workflow:listBaselines', (_e, projectId: string) => wf.listBaselines(projectId));
  ipcMain.handle('workflow:acquireLock', (_e, projectId: string, itemId: string) => wf.acquireLock(projectId, itemId));
  ipcMain.handle('workflow:releaseLock', (_e, projectId: string, itemId: string) => wf.releaseLock(projectId, itemId));
  ipcMain.handle('workflow:getLock', (_e, projectId: string) => wf.getLock(projectId));
  ipcMain.handle('workflow:writeBrief', (_e, repoPath: string, itemId: string) => {
    const item = wf.getItem(itemId);
    if (!item) throw new Error('工作项不存在');
    return wf.writeBrief(repoPath, item);
  });
  ipcMain.handle('workflow:launchHarness', async (_e, workspacePath: string) => {
    const fs = await import('node:fs');
    const { execFile } = await import('node:child_process');
    const candidates = [
      `${process.env.LOCALAPPDATA ?? ''}\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe`,
      `D:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe`,
    ];
    const exe = candidates.find((p) => fs.existsSync(p));
    if (!exe) return { ok: false, message: '未找到 DeepSeek Harness 安装路径' };
    try {
      execFile(exe, [], { windowsHide: false, cwd: workspacePath || undefined }, () => {});
      appendLog('launch harness: ' + exe);
      return { ok: true, message: '已启动 DeepSeek Harness 桌面端' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('workflow:openFolder', async (_e, folder: string) => {
    if (!folder) return { ok: false, message: '路径为空' };
    const err = await shell.openPath(folder);
    return err ? { ok: false, message: err } : { ok: true, message: '已打开 ' + folder };
  });
  ipcMain.handle('workflow:harnessHeadless', async (_e, item: string) => {
    const { harnessHeadless } = await import('./ipc/harnessSend');
    return harnessHeadless(item);
  });
  ipcMain.handle('workflow:sendHarness', async (_e, itemId: string) => {
    const { sendToHarness } = await import('./ipc/harnessSend');
    const item = wf.getItem(itemId);
    if (!item) throw new Error('工作项不存在');
    const projects = wf.listProjects();
    const proj = projects.find((p) => p.id === item.projectId);
    const workspace = proj?.harnessWorkspace || proj?.repoPath || '';
    return sendToHarness({
      item,
      workspace,
      clipboard: (text) => {
        clipboard.writeText(text);
      },
      launch: async (ws) => {
        const fs = await import('node:fs');
        const { execFile, exec } = await import('node:child_process');
        // 不强制重启：已有实例则直接 CDP 发送
        const candidates = [
          `${process.env.LOCALAPPDATA ?? ''}\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe`,
          `D:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe`,
        ];
        const exe = candidates.find((p) => fs.existsSync(p));
        if (!exe) return { ok: false, message: '未找到 DeepSeek Harness' };
        execFile(
          exe,
          ['--remote-debugging-port=9333', '--remote-allow-origins=*'],
          { windowsHide: false, cwd: ws || undefined },
          () => {},
        );
        appendLog('send-to-harness launch: ' + exe + ' cwd=' + ws);
        return { ok: true, message: '已启动' };
      },
      tryAutoPaste: true,
    });
  });
  ipcMain.handle('heat:refresh', async () => {
    const r = await refreshHeat(TOOL_CATALOG);
    appendLog(`heat refreshed ok=${r.ok} fail=${r.fail}`);
    return { ...r, presets: allPresets() };
  });

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
  ipcMain.handle('installer:uninstallCli', (_e, tool: string) => uninstallCli(tool));
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
  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = mainWindow;
    if (!win) return { ok: false, path: '', message: '窗口不可用' };
    const r = await dialog.showOpenDialog(win, {
      title: '选择工作区目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) return { ok: false, path: '', message: '' };
    return { ok: true, path: r.filePaths[0], message: '' };
  });
  ipcMain.handle('agent:start', (e, tool: ToolId, prompt: string, cwd: string, hasHistory: boolean) =>
    agentStart(tool, prompt, cwd, hasHistory, (ch, payload) => e.sender.send(ch, payload)),
  );
  ipcMain.handle('agent:stop', (_e, tool: ToolId) => agentStop(tool));
  ipcMain.handle('chats:load', (_e, tool: string) => loadChats(tool));
  ipcMain.handle('chats:save', (_e, tool: string, turns: unknown) => saveChats(tool, turns as never));
  ipcMain.handle('logs:get', () => readLogs());
  ipcMain.handle('meta:get', () => {
    const cfg = loadConfig();
    return {
      lastApply: cfg.lastApply,
      subscriptions: cfg.subscriptions,
      portableNode: getPortableNodeStatus(),
      heat: loadHeat(),
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
