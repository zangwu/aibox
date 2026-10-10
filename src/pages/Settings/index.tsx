import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, RadioTower, RefreshCw, Rocket } from 'lucide-react';
import { aibox } from '../../lib/ipc';
import type { UpdaterStatus } from '../../lib/ipc';
import { Card } from '../../components/ui';

export default function SettingsPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [portable, setPortable] = useState<{ installed: boolean; version?: string; path?: string }>({
    installed: false,
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [appInfo, setAppInfo] = useState<{ version: string; isPackaged: boolean }>({ version: '-', isPackaged: false });
  const [update, setUpdate] = useState<UpdaterStatus>({ state: 'idle', version: '-' });

  const refresh = useCallback(async () => {
    setLogs(await aibox().getLogs());
    const meta = await aibox().getMeta();
    setPortable(meta.portableNode);
    setAppInfo(await aibox().getAppInfo());
  }, []);

  useEffect(() => {
    void refresh();
    return aibox().onUpdaterStatus(setUpdate);
  }, [refresh]);

  const checkUpdates = async () => {
    setMsg('正在检查更新…');
    const r = await aibox().checkUpdates();
    if (!r.ok) setMsg(r.message);
  };

  const installUpdate = async () => {
    setMsg('即将关闭并安装更新…');
    await aibox().installUpdate();
  };

  const setupPortable = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await aibox().setupPortableNode();
      setMsg(r.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const broadcast = async () => {
    const r = await aibox().broadcastEnvChange();
    setMsg(r.message);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-5 text-lg font-semibold text-slate-800">设置</h1>

      {msg && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="版本与更新"
          extra={
            <div className="flex gap-1.5">
              {update.state === 'downloaded' && (
                <button
                  onClick={() => void installUpdate()}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                >
                  <Rocket size={12} /> 重启安装
                </button>
              )}
              <button
                onClick={() => void checkUpdates()}
                disabled={!appInfo.isPackaged || update.state === 'checking' || update.state === 'downloading'}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              >
                <RefreshCw size={12} className={update.state === 'checking' ? 'animate-spin' : ''} />
                {update.state === 'checking' ? '检查中…' : '检查更新'}
              </button>
            </div>
          }
        >
          <div className="space-y-1.5 text-xs text-slate-600">
            <div>
              当前版本：<span className="font-medium text-slate-800">v{appInfo.version}</span>
              {!appInfo.isPackaged && <span className="ml-2 text-slate-400">（开发模式，自动更新仅在安装版生效）</span>}
            </div>
            {update.state === 'downloading' && (
              <div>
                正在下载新版本… {update.percent ?? 0}%
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${update.percent ?? 0}%` }} />
                </div>
              </div>
            )}
            {update.message && <div className="text-slate-500">{update.message}</div>}
            {update.latestVersion && update.state !== 'downloaded' && (
              <div className="text-blue-600">最新版本：v{update.latestVersion}</div>
            )}
          </div>
        </Card>

        <Card title="便携 Node.js">
          <div className="space-y-2 text-xs text-slate-600">
            <div>
              状态：
              {portable.installed ? (
                <span className="text-emerald-600">
                  已就绪 {portable.version}
                </span>
              ) : (
                <span className="text-slate-400">未安装（未检测到系统 Node 时，CLI 安装会自动使用它兜底）</span>
              )}
            </div>
            {portable.path && <div className="break-all text-slate-400">{portable.path}</div>}
            <button
              disabled={busy || portable.installed}
              onClick={() => void setupPortable()}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              <Download size={12} /> {busy ? '下载中…' : portable.installed ? '已就绪' : '下载便携 Node (LTS)'}
            </button>
          </div>
        </Card>

        <Card
          title="环境变量广播"
          extra={
            <button
              onClick={() => void broadcast()}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            >
              <RadioTower size={12} /> 立即广播
            </button>
          }
        >
          <p className="text-xs leading-relaxed text-slate-500">
            用户级环境变量写入注册表后，已运行的进程读不到。点击「立即广播」向系统发送 WM_SETTINGCHANGE
            提示刷新；不响应广播的程序（如已打开的终端）仍需手动重启。
          </p>
        </Card>
      </div>

      <Card
        className="mt-4"
        title={
          <span className="flex items-center gap-1.5">
            <FileText size={14} /> 运行日志
          </span>
        }
        extra={
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw size={11} /> 刷新
          </button>
        }
      >
        {logs.length === 0 ? (
          <div className="text-xs text-slate-400">暂无日志</div>
        ) : (
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-500">
            {logs.join('\n')}
          </pre>
        )}
      </Card>
    </div>
  );
}
