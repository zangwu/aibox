import { app, ipcMain } from 'electron';
import { autoUpdater, NsisUpdater } from 'electron-updater';
import type { UpdaterStatus } from '../shared/types';
import { appendLog } from './store';

/**
 * 热更新：generic 多源回退（GitHub → Gitee → 自定义）。
 * 每个源结构：{url}/latest.yml + aibox-setup.exe
 */

const UPDATE_SOURCES = (): string[] => {
  const env = process.env.AIBOX_UPDATE_URL?.trim();
  return [
    env,
    'https://github.com/zangwu/aibox/releases/download/latest',
    'https://gitee.com/zangwu/aibox/releases/download/latest',
  ].filter((x): x is string => Boolean(x));
};

let cachedStatus: UpdaterStatus = { state: 'idle', version: app.getVersion() };

export function getUpdaterStatus(): UpdaterStatus {
  return cachedStatus;
}

function pushStatus(win: Electron.WebContents | null, patch: Partial<UpdaterStatus>): void {
  cachedStatus = { ...cachedStatus, ...patch };
  win?.send('updater:status', cachedStatus);
}

function currentFeed(): string {
  return (autoUpdater as { feedURL?: string }).feedURL ?? '';
}

export function setupAutoUpdater(getWindow: () => Electron.WebContents | null): void {
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    appendLog('updater: checking feed=' + currentFeed());
    pushStatus(getWindow(), { state: 'checking', message: '正在检查更新…' });
  });
  autoUpdater.on('update-available', (info) => {
    appendLog(`updater: update available ${info.version}`);
    pushStatus(getWindow(), {
      state: 'available',
      latestVersion: info.version,
      message: `发现新版本 ${info.version}，正在下载…`,
    });
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
    pushStatus(getWindow(), {
      state: 'downloaded',
      latestVersion: info.version,
      message: `新版本 ${info.version} 已下载`,
    });
  });
  autoUpdater.on('error', (e) => {
    appendLog(`updater: error ${e.message}`);
    pushStatus(getWindow(), { state: 'idle', message: `检查更新失败：${e.message}` });
  });

  async function checkWithFallback(): Promise<{ ok: boolean; message: string; source?: string }> {
    if (!app.isPackaged) return { ok: false, message: '开发模式不支持自动更新' };
    const sources = UPDATE_SOURCES();
    let last = '';
    for (const url of sources) {
      try {
        if (autoUpdater instanceof NsisUpdater || 'setFeedURL' in autoUpdater) {
          (autoUpdater as unknown as { setFeedURL: (o: { provider: string; url: string }) => void }).setFeedURL({
            provider: 'generic',
            url,
          });
        }
        appendLog(`updater: try ${url}`);
        await Promise.race([
          autoUpdater.checkForUpdates(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 8s')), 8000)),
        ]);
        // 有更新或明确无更新都算该源可用
        return { ok: true, message: '', source: url };
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        appendLog(`updater: source fail ${url} ${last}`);
      }
    }
    pushStatus(getWindow(), {
      state: 'idle',
      message: `所有更新源均失败：${last || '网络不可达'}`,
    });
    return { ok: false, message: last || '网络不可达' };
  }

  ipcMain.handle('updater:check', async () => {
    const r = await checkWithFallback();
    return r.ok ? ({ ok: true, message: '' } as const) : ({ ok: false, message: r.message } as const);
  });

  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return { ok: false, message: '开发模式不支持' };
    appendLog('updater: quitAndInstall');
    setTimeout(() => autoUpdater.quitAndInstall(), 300);
    return { ok: true, message: '' };
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    homeDir: app.getPath('home'),
  }));

  if (app.isPackaged) {
    setTimeout(() => {
      checkWithFallback().catch((e) => appendLog(`updater: check failed ${e}`));
    }, 10_000);
    setInterval(
      () => {
        checkWithFallback().catch((e) => appendLog(`updater: check failed ${e}`));
      },
      4 * 60 * 60 * 1000,
    );
  }
}
