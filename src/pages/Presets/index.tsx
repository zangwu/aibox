import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleHelp,
  Copy,
  ExternalLink,
  Globe,
  Heart,
  KeyRound,
  Link2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { aibox, encodeShareCode } from '../../lib/ipc';
import type { Preset, Subscription, ToolId } from '../../lib/ipc';
import Modal from '../../components/Modal';
import Stars from '../../components/Stars';

const PROTOCOL_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  google: 'Google',
};

const TOOL_LABEL: Record<ToolId, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
};

type Filter = 'all' | 'fav' | 'key' | ToolId;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'fav', label: '★ 已收藏' },
  { id: 'key', label: '已存 key' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini' },
];

export default function Presets({ onShowTutorial }: { onShowTutorial: () => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [subUrl, setSubUrl] = useState('');
  const [draft, setDraft] = useState<Preset>(emptyDraft());

  const refresh = useCallback(async () => {
    const [p, meta] = await Promise.all([aibox().listPresets(), aibox().getMeta()]);
    setPresets(p);
    setSubs(meta.subscriptions);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return presets.filter((p) => {
      if (filter === 'fav' && !p.favorite) return false;
      if (filter === 'key' && !p.savedKey) return false;
      if (filter === 'codex' || filter === 'claude-code' || filter === 'gemini') {
        if (!p.supports.includes(filter)) return false;
      }
      if (q && !`${p.name} ${p.baseUrl} ${p.model}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [presets, filter, search]);

  const save = async (p: Preset) => {
    setPresets(await aibox().savePreset(p));
  };

  /** 验证已存 key 的连通性，通过则打标 */
  const verifyKey = async (p: Preset) => {
    if (!p.savedKey) return;
    setMsg(`正在测试「${p.name}」…`);
    const r = await aibox().testPresetKey(p, p.savedKey);
    if (r.ok) {
      setPresets(await aibox().savePreset({ ...p, keyVerified: true, verifiedAt: Date.now() }));
      setMsg(`「${p.name}」${r.message}`);
    } else {
      setPresets(await aibox().savePreset({ ...p, keyVerified: false }));
      setMsg(`「${p.name}」验证失败：${r.message}`);
    }
  };

  const goWebsite = async (p: Preset) => {
    if (!p.website) {
      setMsg('该预设没有填写官网地址');
      return;
    }
    const r = await aibox().openExternal(p.website);
    if (!r.ok) setMsg(r.message);
  };

  const copyShare = async (p: Preset) => {
    const code = encodeShareCode(p);
    try {
      await navigator.clipboard.writeText(code);
      setMsg(`已复制「${p.name}」的分享码（不含 key）`);
    } catch {
      setMsg(`复制失败，分享码：${code.slice(0, 40)}…`);
    }
  };

  const importShare = async () => {
    try {
      setPresets(await aibox().importShareCode(shareCode));
      setShareOpen(false);
      setShareCode('');
      setMsg('分享码导入成功');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const submitDraft = async () => {
    const err = validateDraft(draft);
    if (err) {
      setMsg(err);
      return;
    }
    // 填了 key：保存前自动做连通性测试，通过才随预设保存
    let finalDraft = { ...draft };
    if (draft.savedKey) {
      setMsg('正在测试 key 连通性…');
      const r = await aibox().testPresetKey(draft, draft.savedKey);
      if (r.ok) {
        finalDraft = { ...finalDraft, keyVerified: true, verifiedAt: Date.now() };
        setMsg(`测试通过：${r.message}`);
      } else {
        finalDraft = { ...finalDraft, savedKey: undefined, keyVerified: false };
        setMsg(`key 测试未通过（${r.message}），预设已保存但未存 key，可稍后重试`);
      }
    }
    setPresets(await aibox().savePreset(finalDraft));
    setCreateOpen(false);
    setDraft(emptyDraft());
  };

  const toggleSupport = (t: Preset['supports'][number]) => {
    setDraft((d) => ({
      ...d,
      supports: d.supports.includes(t) ? d.supports.filter((x) => x !== t) : [...d.supports, t],
    }));
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">预设市场</h1>
          <p className="mt-0.5 text-xs text-slate-500">共 {presets.length} 个预设，当前显示 {filtered.length} 个</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShareOpen(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            导入分享码
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            <Plus size={12} /> 新建预设
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              filter === f.id
                ? 'bg-blue-600 text-white'
                : 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称 / URL / 模型"
            className="w-52 rounded-full border border-slate-300 bg-white py-1 pl-7 pr-3 text-[11px] text-slate-600 focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>

      {msg && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span className="truncate text-[13px] font-semibold text-slate-800">{p.name}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] text-slate-500">
                  {PROTOCOL_LABEL[p.protocol]}
                </span>
                {p.builtin && (
                  <span className="shrink-0 rounded bg-indigo-50 px-1 py-px text-[9px] text-indigo-600">内置</span>
                )}
                {p.savedKey && (
                  <button
                    onClick={() => void verifyKey(p)}
                    className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] ${
                      p.keyVerified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                    }`}
                    title={p.keyVerified ? 'key 已通过连通性测试，点击重新验证' : 'key 未验证，点击测试'}
                  >
                    <KeyRound size={8} /> {p.keyVerified ? '已验证' : '未验证'}
                  </button>
                )}
              </div>
              <button
                onClick={() => void save({ ...p, favorite: !p.favorite })}
                className={p.favorite ? 'shrink-0 text-rose-500' : 'shrink-0 text-slate-300 hover:text-slate-400'}
              >
                <Heart size={13} fill={p.favorite ? 'currentColor' : 'none'} />
              </button>
            </div>

            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
              <Globe size={9} className="shrink-0" />
              <span className="truncate">{p.baseUrl}</span>
              <span className="shrink-0 text-slate-300">·</span>
              <span className="shrink-0">{p.model}</span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
              {p.supports.map((s) => (
                <span key={s} className="rounded bg-slate-100 px-1 py-px text-slate-500">
                  {TOOL_LABEL[s]}
                </span>
              ))}
              {p.note && <span className="ml-1 truncate text-slate-400">· {p.note}</span>}
            </div>

            {p.riskHint && (
              <div
                className="mt-1 truncate text-[10px] text-amber-600"
                title={p.riskHint}
              >
                ⚠ {p.riskHint.replace(/^⚠️\s*/, '')}
              </div>
            )}

            <input
              value={p.userNote ?? ''}
              onChange={(e) => setPresets(presets.map((x) => (x.id === p.id ? { ...x, userNote: e.target.value } : x)))}
              onBlur={() => void save({ ...p })}
              placeholder="本地备注…"
              className="mt-1.5 h-6 w-full rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-600 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />

            <div className="mt-1.5 flex items-center gap-1.5">
              <Stars
                value={p.localRating}
                onChange={(v) => void save({ ...p, localRating: (v || undefined) as Preset['localRating'] })}
              />
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => void goWebsite(p)}
                  disabled={!p.website}
                  title={p.website ? `前往 ${p.website} 购买/获取 key` : '未填写官网'}
                  className="flex items-center gap-0.5 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  <ExternalLink size={9} /> 前往
                </button>
                <button
                  onClick={() => void copyShare(p)}
                  title="复制分享码（不含 key）"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <Copy size={11} />
                </button>
                {!p.builtin && (
                  <button
                    onClick={async () => setPresets(await aibox().removePreset(p.id))}
                    title="删除"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
                <button
                  onClick={() => onShowTutorial()}
                  title="查看使用教程"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <CircleHelp size={11} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-10 text-center text-xs text-slate-400">没有匹配的预设</div>
        )}
      </div>

      {/* 订阅管理 */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800">
          <Link2 size={14} /> 预设订阅
          <span className="text-[10px] text-slate-400">每 6 小时自动拉取，JSON 格式 {"{ \"presets\": [...] }"}</span>
        </div>
        <div className="flex gap-2">
          <input
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
            placeholder="https://example.com/presets.json"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
          />
          <button
            onClick={async () => {
              if (!subUrl.trim()) return;
              await aibox().addSubscription(subUrl);
              const meta = await aibox().getMeta();
              setSubs(meta.subscriptions);
              setSubUrl('');
              setMsg('已添加订阅，正在拉取…');
            }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            添加
          </button>
        </div>
        {subs.map((s) => (
          <div key={s.id} className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => void aibox().toggleSubscription(s.id, e.target.checked).then(refresh)}
            />
            <span className="flex-1 truncate text-slate-600">{s.url}</span>
            <span className="text-slate-400">
              {s.lastFetchedAt ? `上次：${new Date(s.lastFetchedAt).toLocaleString()}` : '未拉取'}
            </span>
            {s.lastError && <span className="max-w-48 truncate text-rose-500">{s.lastError}</span>}
            <button
              onClick={() => void aibox().removeSubscription(s.id).then(refresh)}
              className="text-slate-400 hover:text-rose-500"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* 导入分享码 */}
      <Modal title="导入分享码" open={shareOpen} onClose={() => setShareOpen(false)}>
        <textarea
          value={shareCode}
          onChange={(e) => setShareCode(e.target.value)}
          placeholder="粘贴 aibox1: 开头的分享码"
          rows={4}
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
        />
        <button
          onClick={() => void importShare()}
          className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500"
        >
          导入
        </button>
      </Modal>

      {/* 新建预设 */}
      <Modal title="新建预设" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <Field label="ID（小写字母/数字/-/_）">
            <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} className={inputCls} />
          </Field>
          <Field label="名称">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Base URL（含 /v1）">
            <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} className={inputCls} />
          </Field>
          <Field label="协议">
            <select
              value={draft.protocol}
              onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Preset['protocol'] })}
              className={inputCls}
            >
              <option value="openai-chat">openai-chat</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic">anthropic</option>
              <option value="google">google</option>
            </select>
          </Field>
          <Field label="默认模型">
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className={inputCls} />
          </Field>
          <Field label="官网网址（可选，卡片「前往」按钮跳转，用于购买/续费 key）">
            <input
              value={draft.website ?? ''}
              onChange={(e) => setDraft({ ...draft, website: e.target.value || undefined })}
              placeholder="https://…"
              className={inputCls}
            />
          </Field>
          <Field label="支持工具">
            <div className="flex gap-3">
              {(['codex', 'claude-code', 'gemini'] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs text-slate-600">
                  <input type="checkbox" checked={draft.supports.includes(t)} onChange={() => toggleSupport(t)} />
                  {t}
                </label>
              ))}
            </div>
          </Field>
          <Field label="备注">
            <input value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={inputCls} />
          </Field>
          <Field label="API Key（可选，保存时自动做连通性测试）">
            <input
              type="password"
              value={draft.savedKey ?? ''}
              onChange={(e) => setDraft({ ...draft, savedKey: e.target.value || undefined })}
              placeholder="sk-..."
              className={inputCls}
            />
          </Field>
          <button
            onClick={() => void submitDraft()}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            保存
          </button>
        </div>
      </Modal>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-slate-400">{label}</div>
      {children}
    </label>
  );
}

function emptyDraft(): Preset {
  return {
    id: '',
    name: '',
    baseUrl: 'https://',
    protocol: 'openai-chat',
    model: '',
    supports: ['codex'],
  };
}

function validateDraft(d: Preset): string | undefined {
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(d.id)) return 'ID 格式不正确（小写字母/数字开头，可含 - 和 _）';
  if (!d.name.trim()) return '请填写名称';
  if (!/^https?:\/\/.+/.test(d.baseUrl)) return 'Base URL 需以 http(s):// 开头';
  if (!d.model.trim()) return '请填写默认模型';
  if (d.supports.length === 0) return '请至少勾选一个支持工具';
  if (d.website && !/^https?:\/\/.+/.test(d.website)) return '官网网址需以 http(s):// 开头';
  return undefined;
}
