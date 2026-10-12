import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { aibox } from '../../lib/ipc';

/** webview 元素的能力子集（Electron 内建 Chromium 标签，React 类型已含该 intrinsic） */
type WebviewTagLike = {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  addEventListener(type: string, listener: (e: { url?: string; title?: string }) => void): void;
  removeEventListener(type: string, listener: (e: { url?: string; title?: string }) => void): void;
};

/** 内置浏览器页签：加载预设官网等外部页面 */
export default function BrowserPanel({ initialUrl }: { initialUrl: string }) {
  const wvRef = useRef<WebviewTagLike | null>(null);
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialUrl);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const onNav = (e: { url?: string }) => {
      if (e.url) setUrl(e.url);
      try {
        setCanBack(wv.canGoBack());
        setCanForward(wv.canGoForward());
      } catch {
        /* ignore */
      }
    };
    const onTitle = (e: { title?: string }) => {
      if (e.title) setTitle(e.title);
    };
    const onNewWindow = (e: { url?: string }) => {
      // 弹窗/新标签请求 → 在同一页签打开
      if (e.url && wvRef.current) void wvRef.current.loadURL(e.url);
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('new-window', onNewWindow);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('new-window', onNewWindow);
    };
  }, []);

  const submitUrl = () => {
    const wv = wvRef.current;
    if (!wv) return;
    let u = url.trim();
    if (!/^https?:\/\//.test(u)) u = `https://${u}`;
    void wv.loadURL(u);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 导航栏 */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
        <Globe size={13} className="shrink-0 text-slate-400" />
        <button
          onClick={() => wvRef.current?.goBack()}
          disabled={!canBack}
          title="后退"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          onClick={() => wvRef.current?.goForward()}
          disabled={!canForward}
          title="前进"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <ArrowRight size={13} />
        </button>
        <button
          onClick={() => wvRef.current?.reload()}
          title="刷新"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          <RotateCw size={13} />
        </button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitUrl();
          }}
          spellCheck={false}
          className="h-6 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 font-mono text-[11px] text-slate-600 focus:border-blue-400 focus:outline-none"
        />
        <button
          onClick={() => void aibox().openExternal(url)}
          title="在系统浏览器中打开"
          className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
        >
          <ExternalLink size={11} className="inline" /> 外部
        </button>
      </div>
      <div className="truncate border-b border-slate-100 bg-white px-3 py-1 text-[10px] text-slate-400" title={title}>
        {title}
      </div>
      {/* 内置浏览器（Chromium 内核，独立标签上下文，不受 X-Frame-Options 限制） */}
      <webview ref={wvRef as unknown as React.RefObject<HTMLElement>} src={initialUrl} allowpopups={true} className="min-h-0 flex-1" />
    </div>
  );
}
