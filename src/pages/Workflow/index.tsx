import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, FolderOpen, GitBranch, Lock, MessageSquare, Plus, Send, Unlock, Zap } from 'lucide-react';
import { aibox } from '../../lib/ipc';
import type { CommentKind, WorkItem, WorkItemStatus, WorkflowProject } from '../../lib/ipc';
import Modal from '../../components/Modal';

const STATUS_COLS: WorkItemStatus[] = ['open', 'doing', 'review', 'done'];
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  open: '待办',
  doing: '进行中',
  review: '验收',
  done: '完成',
  closed: '已关闭',
  reopened: '返工',
  blocked: '阻塞',
  cancelled: '取消',
};
const PHASE_LABEL: Record<string, string> = {
  discovery: '需求',
  design: '设计',
  dev: '开发',
  verify: '测试',
  release: '发版',
  done: '完成',
};
const TYPE_LABEL: Record<string, string> = {
  feature: '需求',
  task: '任务',
  test: '测试',
  bug: '缺陷',
  suggestion: '建议',
  change: '变更',
};

export default function WorkflowPage() {
  const [projects, setProjects] = useState<WorkflowProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [msg, setMsg] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projPath, setProjPath] = useState('');
  const [draft, setDraft] = useState({
    type: 'feature',
    title: '',
    body: '',
    module: '',
    priority: 'P2',
    phase: 'discovery',
  });
  const [commentText, setCommentText] = useState('');
  const [lock, setLock] = useState<string | 'idle'>('idle');
  const [baselineMd, setBaselineMd] = useState('');
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const project = projects.find((p) => p.id === projectId);

  const refresh = useCallback(async () => {
    const ps = await aibox().workflowListProjects();
    setProjects(ps);
    if (!projectId && ps[0]) setProjectId(ps[0].id);
    const id = projectId || ps[0]?.id;
    if (id) {
      setItems(await aibox().workflowListItems(id));
      setLock(await aibox().workflowGetLock(id));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);


  // 模块列表 = 项目配置 + 工作项里出现过的 module（避免配置缺失导致空白）
  const moduleList = useMemo(() => {
    const base = project?.modules ?? [];
    const seen = new Map(base.map((m) => [m.id, m]));
    for (const it of items) {
      if (!seen.has(it.module)) {
        seen.set(it.module, { id: it.module, title: it.module });
      }
    }
    return seen.size ? [...seen.values()] : [{ id: '默认', title: '默认' }];
  }, [project, items]);

  const byModule = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    for (const it of items) {
      if (phaseFilter !== 'all' && it.phase !== phaseFilter) continue;
      const arr = map.get(it.module) ?? [];
      arr.push(it);
      map.set(it.module, arr);
    }
    return map;
  }, [items, phaseFilter]);

  const submitProject = async () => {
    if (!projName.trim() || !projPath.trim()) {
      setMsg('请填写项目名称和本地目录');
      return;
    }
    setBusy(true);
    try {
      const p = await aibox().workflowCreateProject({
        name: projName.trim(),
        repoPath: projPath.trim(),
      });
      await aibox().workflowUpsertModule(p.id, { title: '默认' });
      setProjectId(p.id);
      setProjOpen(false);
      setProjName('');
      setProjPath('');
      setMsg(`已创建项目目录 ${p.repoPath}`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!draft.title.trim()) return;
    let pid = projectId;
    if (!pid) {
      setMsg('请先新建/选择项目');
      return;
    }
    if (!draft.module.trim()) {
      setMsg('请填写功能模块');
      return;
    }
    await aibox().workflowCreateItem({
      projectId: pid,
      type: draft.type as import('../../lib/ipc').WorkItemType,
      title: draft.title,
      body: draft.body,
      module: draft.module.trim(),
      priority: draft.priority as import('../../lib/ipc').WorkItemPriority,
      phase: draft.phase as import('../../lib/ipc').WorkItemPhase,
    });
    setCreateOpen(false);
    setDraft({ type: 'feature', title: '', body: '', module: '', priority: 'P2', phase: 'discovery' });
    await refresh();
  };

  const doTransition = async (id: string, to: WorkItemStatus) => {
    try {
      await aibox().workflowTransition(id, to as import('../../lib/ipc').WorkItemStatus);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const addComment = async (kind: CommentKind = 'note') => {
    if (!selected || !commentText.trim()) return;
    await aibox().workflowAddComment(selected.id, commentText.trim(), kind, 'human');
    setCommentText('');
    const cur = await aibox().workflowGetItem(selected.id);
    setSelected(cur ?? null);
    await refresh();
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">研发工作流</h1>
          <p className="mt-0.5 text-xs text-slate-500">数据存在项目目录 `.aibox/` · 阶段 × 功能模块</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700"
          >
            <option value="">选择项目…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              const p = projects.find((x) => x.id === projectId);
              if (!p?.repoPath) {
                setMsg('请先选择/新建项目');
                return;
              }
              const r = await aibox().workflowOpenFolder(p.repoPath);
              setMsg(r.message);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            <FolderOpen size={12} /> 打开目录
          </button>
          <button
            onClick={() => setProjOpen(true)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            新建项目
          </button>
          <button
            onClick={() => setBaselineOpen(true)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            确认需求文档
          </button>
          <button
            onClick={() => {
              if (!projectId) {
                setMsg('请先选择项目');
                return;
              }
              setCreateOpen(true);
            }}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-500"
          >
            <Plus size={12} /> 新建工作项
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
          {msg}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {['all', 'discovery', 'design', 'dev', 'verify', 'release', 'done'].map((ph) => (
          <button
            key={ph}
            onClick={() => setPhaseFilter(ph)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              phaseFilter === ph ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-500'
            }`}
          >
            {ph === 'all' ? '全部阶段' : (PHASE_LABEL[ph] ?? ph)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
          {lock === 'idle' ? <Unlock size={11} /> : <Lock size={11} />} 锁：{lock}
        </span>
      </div>

      <div className="space-y-3">
        {moduleList.map((mod) => {
          const rows = byModule.get(mod.id) ?? [];
          return (
            <div key={mod.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800">
                <GitBranch size={14} />
                {mod.title}
                <span className="text-[10px] text-slate-400">{rows.length} 项</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {STATUS_COLS.map((col) => {
                  const colItems = rows.filter((i) => i.status === col || (col === 'done' && i.status === 'closed'));
                  return (
                    <div key={col} className="min-h-[80px] rounded-lg bg-slate-50 p-2">
                      <div className="mb-1.5 text-[10px] font-medium text-slate-500">
                        {STATUS_LABEL[col]} · {colItems.length}
                      </div>
                      <div className="space-y-1.5">
                        {colItems.map((it) => (
                          <button
                            key={it.id}
                            onClick={() => setSelected(it)}
                            className={`block w-full rounded-md border bg-white px-2 py-1.5 text-left text-[11px] ${
                              selected?.id === it.id ? 'border-blue-400 shadow-sm' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="truncate font-medium text-slate-800">
                              {it.id} {it.title}
                            </div>
                            <div className="mt-0.5 text-[9px] text-slate-400">
                              {TYPE_LABEL[it.type]} · {PHASE_LABEL[it.phase]} · {it.priority}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 新建项目 */}
      <Modal title="新建项目" open={projOpen} onClose={() => setProjOpen(false)}>
        <div className="space-y-2">
          <label className="text-[11px] text-slate-500">项目名称</label>
          <input
            value={projName}
            onChange={(e) => setProjName(e.target.value)}
            placeholder="如：小游戏 A"
            className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs"
          />
          <label className="text-[11px] text-slate-500">本地目录（会自动创建，看板数据存这里）</label>
          <div className="flex gap-1">
            <input
              value={projPath}
              onChange={(e) => setProjPath(e.target.value)}
              placeholder="D:\_Lives\_Projects\xxx"
              className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs"
            />
            <button
              onClick={async () => {
                const r = await aibox().pickDirectory();
                if (r.ok && r.path) setProjPath(r.path);
              }}
              className="rounded-lg border border-slate-300 px-2 text-xs text-slate-600"
            >
              浏览…
            </button>
          </div>
          <button
            onClick={() => void submitProject()}
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs text-white disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建项目目录并保存看板'}
          </button>
        </div>
      </Modal>

      {/* 新建工作项 */}
      <Modal title="新建工作项" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="space-y-2">
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs"
          >
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="标题"
            className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="描述 / 验收要点"
            className="h-20 w-full rounded-lg border border-slate-200 p-2 text-xs"
          />
          <input
            value={draft.module}
            onChange={(e) => setDraft({ ...draft, module: e.target.value })}
            placeholder="功能模块，如 背包 / 排行榜"
            className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs"
          />
          <div className="flex gap-2">
            <select
              value={draft.phase}
              onChange={(e) => setDraft({ ...draft, phase: e.target.value })}
              className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs"
            >
              {Object.entries(PHASE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs"
            >
              {['P0', 'P1', 'P2', 'P3'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <button onClick={() => void submitCreate()} className="w-full rounded-lg bg-blue-600 py-2 text-xs text-white">
            创建
          </button>
        </div>
      </Modal>

      {/* 需求基线 */}
      <Modal title="确认需求文档（G1）" open={baselineOpen} onClose={() => setBaselineOpen(false)}>
        <div className="space-y-2">
          <textarea
            value={baselineMd}
            onChange={(e) => setBaselineMd(e.target.value)}
            className="h-48 w-full rounded-lg border border-slate-200 p-2 text-xs font-mono"
            placeholder="# 需求"
          />
          <button
            onClick={async () => {
              if (!projectId) {
                setMsg('请先选择项目');
                return;
              }
              await aibox().workflowConfirmBaseline(projectId, '需求文档', baselineMd);
              setBaselineOpen(false);
              setBaselineMd('');
              setMsg('G1 基线已确认');
            }}
            className="w-full rounded-lg bg-slate-900 py-2 text-xs text-white"
          >
            确认基线
          </button>
        </div>
      </Modal>

      {/* 详情 */}
      <Modal
        title={selected ? `${selected.id} ${selected.title}` : '详情'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5">{TYPE_LABEL[selected.type]}</span>
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{PHASE_LABEL[selected.phase]}</span>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                {STATUS_LABEL[selected.status]}
              </span>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{selected.priority}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5">模块 {selected.module}</span>
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              {selected.body || '（无描述）'}
            </div>
            {selected.acceptance.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-600">验收清单</div>
                {selected.acceptance.map((a) => (
                  <div key={a.id} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                    {a.checked ? (
                      <CheckCircle2 size={12} className="mt-0.5 text-emerald-500" />
                    ) : (
                      <Circle size={12} className="mt-0.5 text-slate-300" />
                    )}
                    {a.text}
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <MessageSquare size={12} /> 评论
              </div>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {selected.comments.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-md px-2 py-1 text-[11px] ${
                      c.kind === 'accept'
                        ? 'bg-emerald-50 text-emerald-800'
                        : c.kind === 'reject'
                          ? 'bg-orange-50 text-orange-800'
                          : c.author === 'ai'
                            ? 'bg-blue-50 text-blue-800'
                            : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="mr-1 text-[9px] opacity-70">
                      {c.author} · {c.kind}
                    </span>
                    {c.body}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="写意见…"
                  className="h-8 flex-1 rounded-lg border border-slate-200 px-2 text-xs"
                />
                <button onClick={() => void addComment('note')} className="rounded-lg bg-slate-800 px-2.5 text-xs text-white">
                  发送
                </button>
                <button
                  onClick={() => void addComment('accept')}
                  className="rounded-lg bg-emerald-600 px-2.5 text-xs text-white"
                >
                  通过
                </button>
                <button
                  onClick={() => void addComment('reject')}
                  className="rounded-lg bg-orange-500 px-2.5 text-xs text-white"
                >
                  不通过
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={async () => {
                  const p = projects.find((x) => x.id === projectId);
                  if (!p?.repoPath) {
                    setMsg('项目未配置目录');
                    return;
                  }
                  try {
                    const file = await aibox().workflowWriteBrief(p.repoPath, selected.id);
                    setMsg('已写入简报 ' + file);
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : String(e));
                  }
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
              >
                生成简报
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMsg('正在发送到 Harness…');
                  try {
                    const r = await aibox().workflowSendHarness(selected.id);
                    setMsg(r.message + (r.autoSent ? '（已模拟粘贴发送）' : ''));
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                <Send size={12} /> 发送到 Harness
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMsg('dsh headless 全自动执行中…');
                  try {
                    const r = await aibox().workflowHarnessHeadless(selected.id);
                    setMsg(r.message);
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex items-center gap-1 rounded-lg border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                title="dsh headless 无人值守执行"
              >
                <Zap size={12} /> 全自动执行
              </button>
              {selected.status === 'open' && (
                <button
                  onClick={() => void doTransition(selected.id, 'doing')}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white"
                >
                  开始
                </button>
              )}
              {selected.status === 'doing' && (
                <button
                  onClick={() => void doTransition(selected.id, 'review')}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white"
                >
                  提交验收
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
