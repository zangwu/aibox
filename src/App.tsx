import { useState } from 'react';
import { BookOpen, Box, LayoutDashboard, Settings, Store } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Presets from './pages/Presets';
import SettingsPage from './pages/Settings';
import Tutorial from './pages/Tutorial';

type Page = 'dashboard' | 'presets' | 'tutorial' | 'settings';

const NAV: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '工具面板', icon: LayoutDashboard },
  { id: 'presets', label: '预设市场', icon: Store },
  { id: 'tutorial', label: '教程', icon: BookOpen },
  { id: 'settings', label: '设置', icon: Settings },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

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
        <nav className="flex-1 space-y-1 px-2">
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
        </nav>
        <div className="px-5 py-4 text-[10px] leading-relaxed text-slate-400">
          配置仅写入本机
          <br />
          无后端 · 无账号 · 无代理
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        {page === 'dashboard' && <Dashboard />}
        {page === 'presets' && <Presets onShowTutorial={() => setPage('tutorial')} />}
        {page === 'tutorial' && <Tutorial />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
