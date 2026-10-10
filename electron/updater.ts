import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterStatus } from '../shared/types';
import { appendLog } from './store';

/**
 * 自动更新（electron-updater，generic 源 → Gitee Releases）。
 * 固定发布地址：{publish.url}/latest.yml，每次发版替换 latest 标签下的附件。
 */

let cachedStatus: UpdaterStatus = { state: 'idle', version: app.getVersion() };

export function getUpdaterStatus(): UpdaterStatus {
  return cachedStatus;
}

function pushStatus(win: Electron.WebContents | null, patch: Partial<UpdaterStatus>): void {
  cachedStatus = { ...cachedStatus, ...patch };
  win?.send('updater:status', cachedStatus);
}

export function setupAutoUpdater(getWindow: () => Electron.WebContents | null): void {
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoInstallOnAppQuit = false; // 由用户在设置页点「重启安装」

  autoUpdater.on('checking-for-update', () => {
    appendLog('updater: checking');
    pushStatus(getWindow(), { state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    appendLog(`updater: update available ${info.version}`);
    pushStatus(getWindow(), { state: 'available', latestVersion: info.version, message: `发现新版本 ${info.version}，正在下载…` });
  });
  autoUpdater.on('update-not-available', () => {
    appendLog('updater: up to date');
    pushStatus(getWindow(), { state: 'idle', message: '已是最新版本' });
  });
  autoUpdater.on('download-progress', (p) => {
    pushStatus(getWindow(), { state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    appendLog(`updater: downloaded ${info.version}`);
    pushStatus(getWindow(), { state: 'downloaded', latestVersion: info.version, message: `新版本 ${info.version} 已下载` });
  });
  autoUpdater.on('error', (e) => {
    appendLog(`updater: error ${e.message}`);
    pushStatus(getWindow(), { state: 'idle', message: `检查更新失败：${e.message}` });
  });

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      return { ok: false, message: '开发模式不支持自动更新' } as const;
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, message: '' } as const;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushStatus(getWindow(), { state: 'idle', message: `检查更新失败：${msg}` });
      return { ok: false, message: msg } as const;
    }
  });

  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return { ok: false, message: '开发模式不支持' };
    appendLog('updater: quitAndInstall');
    setTimeout(() => autoUpdater.quitAndInstall(), 300);
    return { ok: true, message: '' };
  });

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), isPackaged: app.isPackaged }));

  // 启动 10s 后检查；之后每 4 小时
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => appendLog(`updater: check failed ${e.message}`));
    }, 10_000);
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch((e) => appendLog(`updater: check failed ${e.message}`));
      },
      4 * 60 * 60 * 1000,
    );
  }
}
