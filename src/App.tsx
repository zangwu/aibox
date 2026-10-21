import { useEffect, useState } from 'react';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import { BookOpen, Box, Globe, LayoutDashboard, Settings, Store, Terminal, X, Workflow } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Presets from './pages/Presets';
import SettingsPage from './pages/Settings';
import Tutorial from './pages/Tutorial';
import WorkflowPage from './pages/Workflow';
import AgentPanel from './pages/Agent';
import BrowserPanel from './pages/Browser';
import { findTool } from '../shared/toolCatalog';
import { aibox } from './lib/ipc';
import type { UpdaterStatus } from './lib/ipc';

type Page = 'dashboard' | 'presets' | 'workflow' | 'tutorial' | 'settings';

const NAV: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '工具面板', icon: LayoutDashboard },
  { id: 'presets', label: '预设市场', icon: Store },
  { id: 'workflow', label: '研发', icon: Workflow },
  { id: 'tutorial', label: '教程', icon: BookOpen },
  { id: 'settings', label: '设置', icon: Settings },
];

const agentLabel = (id: string) => `${findTool(id)?.name ?? id} 会话`;

type Tab =
  | { id: string; kind: 'agent'; tool: string }
  | { id: string; kind: 'browser'; url: string; label: string };

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdaterStatus>({ state: 'idle', version: '-' });
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    const off = aibox().onUpdaterStatus(setUpdate);
    void aibox().checkUpdates().catch(() => {});
    return off;
  }, []);

  const installNow = async () => {
    setUpdateBusy(true);
    try {
      await aibox().installUpdate();
    } finally {
      setUpdateBusy(false);
    }
  };

  const openAgent = (tool: string) => {
    const id = `agent:${tool}`;
    setTabs((ts) => (ts.some((t) => t.id === id) ? ts : [...ts, { id, kind: 'agent', tool }]));
    setActiveTab(id);
    setPage('__tab__' as Page);
  };

  const openBrowser = (url: string, label?: string) => {
    const id = `browser:${url}`;
    setTabs((ts) => (ts.some((t) => t.id === id) ? ts : [...ts, { id, kind: 'browser', url, label: label ?? url }]));
    setActiveTab(id);
    setPage('__tab__' as Page);
  };

  const closeTab = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (activeTab === id) {
        setActiveTab(next[next.length - 1]?.id ?? null);
        if (next.length === 0) setPage('dashboard');
      }
      return next;
    });
  };

  const activateTab = (id: string) => {
    setActiveTab(id);
    setPage('__tab__' as Page);
  };

  const active = tabs.find((t) => t.id === activeTab) ?? null;
  const showTab = active !== null && page === ('__tab__' as Page);
  const agentTabs = tabs.filter((t): t is Extract<Tab, { kind: 'agent' }> => t.kind === 'agent');
  const browserTabs = tabs.filter((t): t is Extract<Tab, { kind: 'browser' }> => t.kind === 'browser');

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 pb-4 pt-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-xs font-bold text-white">
            <Box size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">AI Box</div>
            <div className="text-[10px] text-slate-400">本地 AI 工具盒子</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                page === id
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}

          {agentTabs.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                CLI 会话
              </div>
              {agentTabs.map((t) => (
                <TabRow
                  key={t.id}
                  icon={<Terminal size={16} />}
                  label={agentLabel(t.tool)}
                  active={showTab && activeTab === t.id}
                  onClick={() => activateTab(t.id)}
                  onClose={() => closeTab(t.id)}
                />
              ))}
            </>
          )}

          {browserTabs.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                网页
              </div>
              {browserTabs.map((t) => (
                <TabRow
                  key={t.id}
                  icon={<Globe size={16} />}
                  label={t.label}
                  active={showTab && activeTab === t.id}
                  onClick={() => activateTab(t.id)}
                  onClose={() => closeTab(t.id)}
                />
              ))}
            </>
          )}
        </nav>
        <div className="px-4 py-3">
          {update.state === 'downloaded' || update.state === 'available' ? (
            <button
              onClick={() => void installNow()}
              disabled={updateBusy}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <DownloadCloud size={13} />
              {updateBusy ? '安装中…' : `更新到 v${update.latestVersion ?? ''}`}
            </button>
          ) : update.state === 'downloading' ? (
            <div className="mb-2 rounded-lg bg-slate-100 px-2 py-2 text-[10px] text-slate-600">
              下载中 {update.percent ?? 0}%
            </div>
          ) : update.state === 'checking' ? (
            <div className="mb-2 flex items-center gap-1 text-[10px] text-slate-500">
              <RefreshCw size={11} className="animate-spin" /> 检查更新…
            </div>
          ) : null}
          <div className="text-[10px] leading-relaxed text-slate-400">
            配置仅写入本机
            <br />
            无后端 · 无账号 · 无代理
            {update.latestVersion ? (
              <span className="mt-1 block text-emerald-600">有新版本 v{update.latestVersion}</span>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        {showTab && active ? (
          active.kind === 'agent' ? (
            <AgentPanel key={active.id} tool={active.tool} />
          ) : (
            <BrowserPanel key={active.id} initialUrl={active.url} />
          )
        ) : (
          <>
            {page === 'dashboard' && <Dashboard onOpenAgent={openAgent} onOpenBrowser={openBrowser} />}
            {page === 'presets' && <Presets onShowTutorial={() => setPage('tutorial')} onOpenBrowser={openBrowser} />}
            {page === 'workflow' && <WorkflowPage />}
            {page === 'tutorial' && <Tutorial />}
            {page === 'settings' && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  );
}

function TabRow({
  icon,
  label,
  active,
  onClick,
  onClose,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {icon}
        <span className="truncate">{label}</span>
      </button>
      <button
        onClick={onClose}
        title="关闭页签"
        className="hidden shrink-0 text-slate-400 hover:text-rose-500 group-hover:block"
      >
        <X size={12} />
      </button>
    </div>
  );
}
