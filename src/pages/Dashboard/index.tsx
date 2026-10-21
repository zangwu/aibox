import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  ExternalLink,
  Flame,
  Heart,
  Monitor,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Store,
  Terminal,
  Trash2,
} from 'lucide-react';
import { aibox } from '../../lib/ipc';
import type { ApplyReport, InstallProgress, Preset, ToolId } from '../../lib/ipc';
import type { ToolCardInfo } from '../../lib/ipc';
import { Card } from '../../components/ui';
import Modal from '../../components/Modal';

type CardKind = 'desktop' | 'cli';
type PageFilter = 'all' | 'desktop' | 'cli' | 'fav';

const CARD_FILTERS: Array<{ id: PageFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'fav', label: '★ 已收藏' },
  { id: 'desktop', label: '桌面版' },
  { id: 'cli', label: 'CLI' },
];

interface KeyRequest {
  tool: ToolId;
  kind: CardKind;
  preset: Preset;
  apiKey?: string;
  testError?: string;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(n >= 100_000 ? 0 : 1) + 'k';
  return n.toLocaleString();
}

function RawMetrics({ heat }: { heat?: ToolCardInfo['heat'] }) {
  if (!heat || (!heat.stars && !heat.downloads && !heat.vscodeInstalls)) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
        <span title="闭源/无 GitHub·npm·VS Code 公开统计">原始量 无公开数据</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
      {typeof heat.stars === 'number' && (
        <span title="GitHub Stars（api.github.com）">★ {fmtNum(heat.stars)}</span>
      )}
      {typeof heat.downloads === 'number' && (
        <span title="npm 近一周下载（api.npmjs.org）">↓ 周 {fmtNum(heat.downloads)}</span>
      )}
      {typeof heat.vscodeInstalls === 'number' && (
        <span title="VS Code Marketplace 安装量">插件 {fmtNum(heat.vscodeInstalls)}</span>
      )}
    </div>
  );
}

/** 热度 = 公开调用量原始数字（无 100 上限） */
function HeatBadge({ heat }: { heat?: ToolCardInfo['heat'] }) {
  if (!heat || (!heat.stars && !heat.downloads && !heat.vscodeInstalls)) {
    return (
      <span
        className="text-[9px] text-slate-400"
        title="该产品无公开调用量（无 GitHub Stars / npm 下载 / VS Code 安装量可抓），属闭源或未开源统计"
      >
        无公开热度
      </span>
    );
  }
  const label =
    typeof heat.downloads === 'number'
      ? `周${fmtNum(heat.downloads)}`
      : typeof heat.vscodeInstalls === 'number'
        ? `装${fmtNum(heat.vscodeInstalls)}`
        : `★${fmtNum(heat.stars ?? 0)}`;
  const detail = [
    heat.downloads != null ? `npm 周下载 ${heat.downloads.toLocaleString()}` : '',
    heat.vscodeInstalls != null ? `VS Code 安装 ${heat.vscodeInstalls.toLocaleString()}` : '',
    heat.stars != null ? `GitHub Stars ${heat.stars.toLocaleString()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span
      className="flex items-center gap-0.5 text-[9px] text-orange-500"
      title={`热度 = 公开调用量（无上限）\n${detail}`}
    >
      <Flame size={9} /> {label}
    </span>
  );
}

export default function Dashboard({
  onOpenAgent,
  onOpenBrowser,
}: {
  onOpenAgent: (tool: string) => void;
  onOpenBrowser: (url: string, label: string) => void;
}) {
  const [cards, setCards] = useState<ToolCardInfo[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [lastApply, setLastApply] = useState<Record<string, ApplyReport | undefined>>({});
  const [installing, setInstalling] = useState<Record<string, InstallProgress | undefined>>({});
  const [msg, setMsg] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [filter, setFilter] = useState<PageFilter>('all');
  const [switching, setSwitching] = useState<Record<string, boolean>>({});
  const [keyRequest, setKeyRequest] = useState<KeyRequest | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [rememberKey, setRememberKey] = useState(true);
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async (force = false) => {
    setDetecting(true);
    try {
      const [t, p, meta] = await Promise.all([
        aibox().detectTools(force),
        aibox().listPresets(),
        aibox().getMeta(),
      ]);
      setCards(t as unknown as ToolCardInfo[]);
      setPresets(p);
      setLastApply(meta.lastApply as Record<string, ApplyReport | undefined>);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = aibox().onInstallProgress((p) => {
      // 安装进度只挂 CLI 卡，避免桌面卡跟着动
      setInstalling((prev) => ({ ...prev, [`${p.tool}-cli`]: p }));
      if (p.stage === 'done' || p.stage === 'error') void refresh(true);
    });
    return off;
  }, [refresh]);

  const forceApply = useCallback(
    async (tool: ToolId, kind: CardKind, preset: Preset, apiKey?: string) => {
      const key = apiKey ?? preset.savedKey;
      if (!key) return;
      const cardKey = `${tool}-${kind}`;
      setSwitching((s) => ({ ...s, [cardKey]: true }));
      setMsg('');
      try {
        const r = await aibox().applyPreset(preset.id, [tool], key.trim());
        const errs = r.items.filter((i) => i.tool === tool && i.status === 'error');
        if (errs.length > 0) {
          setMsg(`应用失败：${errs[0].detail}`);
          return;
        }
        if (apiKey && rememberKey) {
          setPresets(await aibox().savePreset({ ...preset, savedKey: apiKey.trim(), keyVerified: false }));
        }
        const launch = await aibox().restartTool(tool);
        setMsg(launch.ok ? `已切换到「${preset.name}」并重启` : launch.message);
        const meta = await aibox().getMeta();
        setLastApply(meta.lastApply as Record<string, ApplyReport | undefined>);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setSwitching((s) => ({ ...s, [cardKey]: false }));
      }
    },
    [rememberKey],
  );

  const switchPreset = useCallback(
    async (tool: ToolId, kind: CardKind, preset: Preset, apiKey?: string) => {
      const key = apiKey ?? preset.savedKey;
      if (!key) {
        setKeyInput('');
        setKeyRequest({ tool, kind, preset });
        return;
      }
      const cardKey = `${tool}-${kind}`;
      setSwitching((s) => ({ ...s, [cardKey]: true }));
      try {
        if (apiKey || !preset.keyVerified) {
          const t = await aibox().testPresetKey(preset, key);
          if (!t.ok) {
            setKeyRequest({ tool, kind, preset, apiKey: key, testError: t.message });
            return;
          }
        }
        await forceApply(tool, kind, preset, apiKey);
        if (apiKey) {
          setPresets(await aibox().savePreset({ ...preset, savedKey: key.trim(), keyVerified: true, verifiedAt: Date.now() }));
        } else if (!preset.keyVerified) {
          setPresets(await aibox().savePreset({ ...preset, keyVerified: true, verifiedAt: Date.now() }));
        }
      } finally {
        setSwitching((s) => ({ ...s, [cardKey]: false }));
      }
    },
    [forceApply],
  );

  const submitKey = async () => {
    if (!keyRequest || keyInput.trim().length < 8) return;
    const { tool, kind, preset } = keyRequest;
    setKeyRequest(null);
    await switchPreset(tool, kind, preset, keyInput.trim());
  };

  const restart = async (tool: ToolId) => {
    setMsg('正在重启…');
    const r = await aibox().restartTool(tool);
    setMsg(r.message);
    const meta = await aibox().getMeta();
    setLastApply(meta.lastApply as Record<string, ApplyReport | undefined>);
  };

  const configLight = useCallback(
    (toolId: string): { s: 'ok' | 'warn' | 'err' | 'idle'; text: string } => {
      const rep = lastApply[toolId as ToolId];
      if (!rep) return { s: 'idle', text: '未应用过配置' };
      const items = rep.items.filter((i) => i.tool === toolId);
      if (items.some((i) => i.status === 'error')) return { s: 'err', text: '上次应用存在失败项' };
      if (items.some((i) => i.status === 'pending-restart')) return { s: 'warn', text: '已写入，待重启工具生效' };
      if (items.length && items.every((i) => i.status === 'ok')) {
        const p = presets.find((x) => x.id === rep.presetId);
        return { s: 'ok', text: `配置生效中：${p?.name ?? rep.presetName}` };
      }
      return { s: 'idle', text: '未应用过配置' };
    },
    [lastApply, presets],
  );

  const currentPresetId = (toolId: string): string => {
    const rep = lastApply[toolId as ToolId];
    if (!rep) return '';
    const hasErr = rep.items.some((i) => i.tool === toolId && i.status === 'error');
    return hasErr ? '' : rep.presetId;
  };

  const toolPresets = (toolId: string) => presets.filter((p) => p.supports.includes(toolId as ToolId));

  /** 有桌面出桌面卡、有 CLI 出 CLI 卡；无则不展示。按热度 volume 降序 */
  const expanded = useMemo(() => {
    const out: Array<{ tool: ToolCardInfo; kind: CardKind }> = [];
    for (const t of cards) {
      if (t.desktop?.available) out.push({ tool: t, kind: 'desktop' });
      if (t.hasCli) out.push({ tool: t, kind: 'cli' });
    }
    out.sort((a, b) => {
      const av = a.tool.heat?.volume ?? a.tool.heat?.score ?? 0;
      const bv = b.tool.heat?.volume ?? b.tool.heat?.score ?? 0;
      if (bv !== av) return bv - av;
      return a.tool.name.localeCompare(b.tool.name);
    });
    return out;
  }, [cards]);

  const filtered = useMemo(() => {
    return expanded.filter((c) => {
      const t = c.tool;
      if (filter === 'desktop') return c.kind === 'desktop';
      if (filter === 'cli') return c.kind === 'cli';
      if (filter === 'fav') {
        return c.kind === 'desktop' ? Boolean(t.favoriteDesktop) : Boolean(t.favoriteCli);
      }
      return true;
    });
  }, [expanded, filter]);

  const toggleFavorite = async (cardKey: string) => {
    await aibox().toggleToolFavorite(cardKey);
    await refresh();
  };

  const refreshHeat = async () => {
    setMsg('正在抓取热度（GitHub + npm + VS Code）…');
    const r = await aibox().refreshHeat();
    setMsg(`热度更新完成：成功 ${r.ok} 项，失败 ${r.fail} 项`);
    await refresh();
  };

  const doUninstall = async () => {
    if (!uninstallTarget) return;
    const { id, name } = uninstallTarget;
    setUninstallTarget(null);
    setMsg(`正在卸载 ${name} …`);
    const r = await aibox().uninstallCli(id);
    setMsg(r.message);
    await refresh();
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">工具面板</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            桌面版 / CLI 双卡片 · 热度 = 公开调用量原始数字（无 100 上限）
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => void refreshHeat()}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            <Flame size={12} /> 刷新热度
          </button>
          <button
            onClick={() => void refresh(true)}
            disabled={detecting}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={detecting ? 'animate-spin' : ''} />
            {detecting ? '检测中…' : '重新检测'}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {CARD_FILTERS.map((f) => (
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
      </div>

      {msg && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {filtered.map((c) => {
          const t = c.tool;
          const isDesktop = c.kind === 'desktop';
          const cardKey = `${t.id}-${c.kind}`;

          const light = t.managed ? configLight(t.id) : { s: 'idle' as const, text: '配置经环境变量生效' };
          // 桌面/CLI 进度互不影响；installCli 只影响 CLI 卡
          const prog = isDesktop ? undefined : installing[`${t.id}-cli`];
          const busy =
            Boolean(prog && prog.stage !== 'done' && prog.stage !== 'error') || Boolean(switching[cardKey]);
          const options = t.managed ? toolPresets(t.id) : [];
          const selected = t.managed ? currentPresetId(t.id) : '';
          const clientInstalled = isDesktop ? Boolean(t.desktop?.installed) : t.installed;
          const isFav = isDesktop ? Boolean(t.favoriteDesktop) : Boolean(t.favoriteCli);
          const favKey = `${t.id}#${c.kind}`;

          return (
            <Card
              key={cardKey}
              title={
                <span className="flex items-center gap-1.5">
                  {isDesktop ? <Monitor size={13} /> : <Terminal size={13} />}
                  {(() => {
                    // 标题只留产品名，形态靠小标签区分
                    const raw = isDesktop ? t.desktop?.name ?? t.name : t.name;
                    return raw
                      .replace(/[\s（(]*桌面(版|端|应用)?[\s）)]*$/u, '')
                      .replace(/\s*\/\s*AI Studio$/u, '')
                      .replace(/\s*（VS Code）$/u, '')
                      .replace(/\s*CLI$/u, '')
                      .replace(/\s*Agent$/u, '')
                      .trim() || t.name;
                  })()}
                  <span
                    className={`rounded px-1 py-px text-[9px] ${
                      isDesktop ? 'bg-indigo-50 text-indigo-600' : 'bg-sky-50 text-sky-600'
                    }`}
                  >
                    {isDesktop ? '桌面版' : 'CLI'}
                  </span>
                  {!t.official && (
                    <span className="rounded bg-amber-50 px-1 py-px text-[9px] text-amber-600">社区</span>
                  )}
                </span>
              }
              extra={
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => void toggleFavorite(favKey)}
                    className={isFav ? 'text-rose-500' : 'text-slate-300 hover:text-slate-400'}
                    title={isFav ? '取消收藏' : '收藏'}
                  >
                    <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
                  </button>
                  <HeatBadge heat={t.heat} />
                </span>
              }
              dense
            >
              <RawMetrics heat={t.heat} />
              <div className="mt-1 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-slate-500">状态</span>
                  {clientInstalled ? (
                    isDesktop ? (
                      <span className="min-w-0 truncate text-emerald-600" title={t.desktop?.path}>
                        {t.desktop?.packageFamilyName ? '微软商店版' : t.desktop?.vscodeInstalled ? 'VS Code 插件' : '已安装'}
                        {t.desktop?.path && <span className="ml-1 text-slate-400">{t.desktop.path}</span>}
                      </span>
                    ) : (
                      <span className="min-w-0 truncate text-emerald-600" title={t.path}>
                        {t.version ?? '已安装'}
                        <span className="ml-2 text-slate-400">{t.path}</span>
                      </span>
                    )
                  ) : (
                    <span className="text-slate-400">未安装</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-slate-500">配置</span>
                  <span
                    className={`min-w-0 truncate ${
                      light.s === 'ok'
                        ? 'text-emerald-600'
                        : light.s === 'warn'
                          ? 'text-amber-600'
                          : light.s === 'err'
                            ? 'text-rose-500'
                            : 'text-slate-400'
                    }`}
                    title={light.text}
                  >
                    {!clientInstalled && light.s === 'idle' ? '未安装' : light.text}
                  </span>
                </div>
                <div className="truncate text-[10px] text-slate-400" title={t.desc}>
                  {isDesktop ? t.desktop?.note ?? t.desc : t.desc}
                </div>
              </div>

              {t.managed && (
                <div className="mt-2">
                  <select
                    value={selected}
                    disabled={Boolean(busy) || !clientInstalled}
                    onChange={(e) => {
                      const p = options.find((x) => x.id === e.target.value);
                      if (p) void switchPreset(t.id as ToolId, c.kind, p);
                    }}
                    className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] text-slate-700 focus:border-blue-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {!clientInstalled
                        ? '请先安装客户端，再切换预设'
                        : options.length === 0
                          ? '暂无可切换预设（需支持本工具）'
                          : '选择预设（切换即应用并重启）…'}
                    </option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.savedKey ? (p.keyVerified ? '✓' : '⚠') : '· 未存key'} {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {busy && prog && prog.stage !== 'done' && prog.stage !== 'error' && (
                <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{prog.message}</span>
                    {typeof prog.percent === 'number' && <span>{prog.percent}%</span>}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${prog.percent ?? 35}%` }} />
                  </div>
                </div>
              )}
              {busy && switching[cardKey] && (
                <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">
                  正在测试连通性、写入配置并重启…
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-1">
                {!clientInstalled ? (
                  isDesktop ? (
                    <button
                      onClick={() =>
                        void (t.desktop?.storeUrl
                          ? onOpenBrowser(t.desktop.storeUrl, t.desktop.name)
                          : aibox().openStorePage(t.id as ToolId).then((r) => setMsg(r.message)))
                      }
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                    >
                      <Store size={10} /> 商店/下载
                    </button>
                  ) : t.npmPackage ? (
                    <button
                      disabled={busy}
                      onClick={() => void aibox().installCli(t.id as ToolId).then((r) => setMsg(r.message))}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      <Download size={10} /> {busy ? '安装中…' : '一键安装'}
                    </button>
                  ) : (
                    <button
                      onClick={() => t.website && onOpenBrowser(t.website, t.name)}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                    >
                      <Store size={10} /> 安装指引
                    </button>
                  )
                ) : isDesktop ? (
                  <button
                    onClick={() => void aibox().launch(t.id as ToolId, 'desktop').then((r) => setMsg(r.message))}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                  >
                    <Play size={10} /> 启动
                  </button>
                ) : t.agent ? (
                  <>
                    <button
                      onClick={() => onOpenAgent(t.id)}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                    >
                      <Terminal size={10} /> 打开会话
                    </button>
                    <button
                      onClick={() => void aibox().launch(t.id as ToolId, 'cli').then((r) => setMsg(r.message))}
                      title="经外部终端启动该工具"
                      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-100"
                    >
                      <Play size={10} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void aibox().launch(t.id as ToolId, 'cli').then((r) => setMsg(r.message))}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                  >
                    <Play size={10} /> 启动终端
                  </button>
                )}
                {t.managed && clientInstalled && light.s === 'warn' && (
                  <button
                    onClick={() => void restart(t.id as ToolId)}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-400"
                  >
                    <RotateCcw size={10} /> 重启生效
                  </button>
                )}
                {t.managed && clientInstalled && selected && (
                  <button
                    onClick={() => {
                      const p = options.find((x) => x.id === selected);
                      if (p) void switchPreset(t.id as ToolId, c.kind, p);
                    }}
                    disabled={Boolean(busy)}
                    title="重新应用当前预设并重启"
                    className="flex shrink-0 items-center gap-0.5 rounded-lg border border-indigo-300 px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <Rocket size={10} /> 应用并重启
                  </button>
                )}
                {clientInstalled && (
                  <button
                    onClick={() =>
                      setUninstallTarget({
                        id: t.id,
                        name: isDesktop ? t.desktop?.name ?? t.name : t.name,
                      })
                    }
                    disabled={Boolean(busy)}
                    title="从本机卸载该工具"
                    className={`flex shrink-0 items-center gap-0.5 rounded-lg border border-rose-200 px-2 py-1 text-[10px] text-rose-500 hover:bg-rose-50 disabled:opacity-50 ${
                      !(t.managed && clientInstalled && selected) ? 'ml-auto' : ''
                    }`}
                  >
                    <Trash2 size={10} /> 卸载
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Modal title={`卸载「${uninstallTarget?.name ?? ''}」？`} open={Boolean(uninstallTarget)} onClose={() => setUninstallTarget(null)}>
        <div className="text-xs text-slate-600">
          将从本机卸载该工具（npm 全局包会执行 uninstall；桌面端打开系统卸载程序）。
          <br />
          不会删除预设与配置文件备份。
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setUninstallTarget(null)}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-xs text-slate-600 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={() => void doUninstall()}
            className="flex-1 rounded-lg bg-rose-600 py-2 text-xs font-medium text-white hover:bg-rose-500"
          >
            确认卸载
          </button>
        </div>
      </Modal>

      <Modal
        title={
          keyRequest?.testError
            ? `「${keyRequest?.preset.name ?? ''}」连接测试未通过`
            : `填写「${keyRequest?.preset.name ?? ''}」的 API Key`
        }
        open={Boolean(keyRequest)}
        onClose={() => setKeyRequest(null)}
      >
        {keyRequest?.testError ? (
          <>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {keyRequest.testError}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  const k = keyRequest;
                  setKeyRequest(null);
                  void switchPreset(k.tool, k.kind, k.preset, k.apiKey);
                }}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-xs text-slate-600 hover:bg-slate-100"
              >
                重试测试
              </button>
              <button
                onClick={() => {
                  const k = keyRequest;
                  setKeyRequest(null);
                  void forceApply(k.tool, k.kind, k.preset, k.apiKey);
                }}
                className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-medium text-white hover:bg-amber-400"
              >
                仍然写入并重启
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-..."
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
            />
            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
              <input type="checkbox" checked={rememberKey} onChange={(e) => setRememberKey(e.target.checked)} />
              记住 key 到本机预设（保存时自动做连通性测试）
            </label>
            <button
              disabled={keyInput.trim().length < 8}
              onClick={() => void submitKey()}
              className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              测试并应用
            </button>
          </>
        )}
      </Modal>
    </div>
  );
}
