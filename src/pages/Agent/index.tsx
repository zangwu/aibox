import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Send, Square, Trash2 } from 'lucide-react';
import { aibox } from '../../lib/ipc';
import { findTool } from '../../../shared/toolCatalog';

const agentName = (id: string) => findTool(id)?.name ?? id;

const AGENT_HINT: Record<string, string> = {
  codex: '多轮上下文模式（codex exec resume --last）：会话历史自动续接并存本机',
  'claude-code': '多轮上下文模式（claude -p --continue）：会话历史自动续接并存本机',
  gemini: 'Gemini 当前为单轮模式：每条消息独立执行',
};

interface Turn {
  role: 'user' | 'agent';
  text: string;
}

/** 内嵌 CLI 会话面板：类 agent 聊天界面 */
export default function AgentPanel({ tool }: { tool: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [workspace, setWorkspace] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);

  // 恢复上次选择的工作区（每个工具各自记忆）
  useEffect(() => {
    void aibox()
      .getAppInfo()
      .then((info) => {
        const saved = localStorage.getItem(`aibox.workspace.${tool}`);
        setWorkspace(saved || info.homeDir || '');
      });
    void aibox()
      .loadChats(tool)
      .then((saved) => setTurns(saved.slice(-100)));
  }, [tool]);

  // 会话历史落盘（防抖；运行中的空尾泡不落盘）
  useEffect(() => {
    if (turns.length === 0) return;
    const last = turns[turns.length - 1];
    if (busy && last.role === 'agent' && last.text === '') return;
    const t = setTimeout(() => void aibox().saveChats(tool, turns), 600);
    return () => clearTimeout(t);
  }, [turns, busy, tool]);

  const pickWorkspace = async () => {
    const r = await aibox().pickDirectory();
    if (r.ok && r.path) {
      setWorkspace(r.path);
      localStorage.setItem(`aibox.workspace.${tool}`, r.path);
    }
  };

  useEffect(() => {
    const offOut = aibox().onAgentOutput((e) => {
      if (e.tool !== tool) return;
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'agent') {
          next[next.length - 1] = { ...last, text: last.text + e.chunk };
        } else {
          next.push({ role: 'agent', text: e.chunk });
        }
        return next.slice(-200);
      });
    });
    const offEnd = aibox().onAgentEnd((e) => {
      if (e.tool !== tool) return;
      setBusy(false);
      if (e.error) {
        setErr(e.error);
      } else if (e.code !== 0) {
        setErr(`进程退出码 ${e.code}`);
      }
    });
    return () => {
      offOut();
      offEnd();
    };
  }, [tool]);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [turns]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setErr('');
    setInput('');
    setTurns((prev) => [...prev.slice(-199), { role: 'user', text: prompt }, { role: 'agent', text: '' }]);
    setBusy(true);
    const hasHistory = turns.some((t) => t.role === 'user');
    const r = await aibox().agentStart(tool, prompt, workspace || undefined, hasHistory);
    if (!r.ok) {
      setBusy(false);
      setErr(r.message);
      setTurns((prev) => prev.slice(0, -1));
    }
  };

  const stop = async () => {
    await aibox().agentStop(tool);
  };

  const clear = async () => {
    setTurns([]);
    await aibox().saveChats(tool, []);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold text-slate-800">{agentName(tool)}</div>
          <div className="text-[10px] text-slate-400">{AGENT_HINT[tool] ?? '单轮执行模式：每条消息独立执行，输出流式显示'}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {busy && (
            <button
              onClick={() => void stop()}
              className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
            >
              <Square size={10} /> 停止
            </button>
          )}
          <button
            onClick={clear}
            title="清空对话（含本机存档）"
            className="rounded-lg border border-slate-300 p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* 工作区行 */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-1.5 text-[11px]">
        <FolderOpen size={12} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-slate-500" title={workspace}>
          工作区：{workspace || '用户主目录'}
        </span>
        <button
          onClick={() => void pickWorkspace()}
          disabled={busy}
          className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          选择…
        </button>
      </div>

      {/* 输出区 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[#fafbfd] p-4">
        {turns.length === 0 && (
          <div className="mt-16 text-center text-xs text-slate-400">
            在下方输入任务，回车发送
            <br />
            例：帮我看看 D:\_Lives\_Projects\aibox 这个项目怎么跑测试
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-blue-600 px-3 py-2 text-xs leading-relaxed text-white">
                {t.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-700 shadow-sm">
                {t.text || (busy ? ' ' : '')}
                {busy && i === turns.length - 1 && <span className="animate-pulse text-blue-500">▋</span>}
              </div>
            </div>
          ),
        )}
        {err && <div className="text-[11px] text-rose-500">{err}</div>}
        <div ref={tailRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={busy ? '正在执行，可点「停止」中断…' : '输入任务，Enter 发送，Shift+Enter 换行'}
            rows={2}
            disabled={busy}
            className="max-h-32 flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
