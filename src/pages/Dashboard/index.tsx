import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Monitor,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Store,
  Terminal,
} from 'lucide-react';
import { aibox } from '../../lib/ipc';
import type { ApplyReport, InstallProgress, Preset, ToolId, ToolInfo } from '../../lib/ipc';
import { Card, StatusDot } from '../../components/ui';
import Modal from '../../components/Modal';

const TOOL_DESC: Record<string, string> = {
  codex: 'OpenAI 编程助手',
  'claude-code': 'Anthropic 编程助手',
  gemini: 'Google Gemini',
};

/** 卡片标题用的短名（避免「Gemini CLI CLI」这类叠加） */
const CARD_NAME: Record<string, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
};

/** 有桌面版的工具（其余仅 CLI 卡片） */
const DESKTOP_TOOLS: ToolId[] = ['codex', 'claude-code'];

type CardKind = 'desktop' | 'cli';
type PageFilter = 'all' | 'desktop' | 'cli';

const CARD_FILTERS: Array<{ id: PageFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'desktop', label: '桌面版' },
  { id: 'cli', label: 'CLI' },
];

interface KeyRequest {
  tool: ToolId;
  kind: CardKind;
  preset: Preset;
  /** 用户刚输入的 key（测试失败重试/强制写入用） */
  apiKey?: string;
  /** 连通性测试失败原因 */
  testError?: string;
}

export default function Dashboard() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
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

  const refresh = useCallback(async () => {
    setDetecting(true);
    try {
      const [t, p, meta] = await Promise.all([aibox().detectTools(), aibox().listPresets(), aibox().getMeta()]);
      setTools(t);
      setPresets(p);
      setLastApply(meta.lastApply as Record<string, ApplyReport | undefined>);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = aibox().onInstallProgress((p) => {
      setInstalling((prev) => ({ ...prev, [p.tool]: p }));
      if (p.stage === 'done' || p.stage === 'error') void refresh();
    });
    return off;
  }, [refresh]);

  /** 写入配置并重启（跳过测试，测试失败后的强制路径） */
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
          setPresets(
            await aibox().savePreset({ ...preset, savedKey: apiKey.trim(), keyVerified: false }),
          );
        }
        const launch = await aibox().restartTool(tool);
        setMsg(launch.ok ? `已切换到「${preset.name}」并重启 ${TOOL_DESC[tool]}` : launch.message);
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

  /** 切换预设：先测连通性，再写配置，再重启拉起 */
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
        // 已验证过的预设走快速通道；新 key 或未验证的先测试
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
      const rep = lastApply[toolId];
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

  const currentPresetId = (toolId: ToolId): string => {
    const rep = lastApply[toolId];
    if (!rep) return '';
    const hasErr = rep.items.some((i) => i.tool === toolId && i.status === 'error');
    return hasErr ? '' : rep.presetId;
  };

  /** 下拉框：支持本工具的预设全部可选；无 key 的选中后会引导输入 */
  const toolPresets = (toolId: ToolId) => presets.filter((p) => p.supports.includes(toolId));

  const cards = useMemo(() => {
    const out: Array<{ tool: ToolInfo; kind: CardKind }> = [];
    for (const t of tools) {
      if (DESKTOP_TOOLS.includes(t.id)) out.push({ tool: t, kind: 'desktop' });
      out.push({ tool: t, kind: 'cli' });
    }
    return out.filter((c) => filter === 'all' || c.kind === filter);
  }, [tools, filter]);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">工具面板</h1>
          <p className="mt-0.5 text-xs text-slate-500">切换预设 = 测试连通 → 写入配置 → 重启客户端</p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={detecting}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          <RefreshCw size={13} className={detecting ? 'animate-spin' : ''} />
          {detecting ? '检测中…' : '重新检测'}
        </button>
      </div>

      <div className="mb-3 flex items-center gap-1.5">
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ tool: t, kind }) => {
          const light = configLight(t.id);
          const prog = installing[t.id];
          const busy = (prog && prog.stage !== 'done' && prog.stage !== 'error') || switching[`${t.id}-${kind}`];
          const isDesktop = kind === 'desktop';
          const clientInstalled = isDesktop ? t.desktop.installed : t.cli.installed;
          const options = toolPresets(t.id);
          const selected = currentPresetId(t.id);

          return (
            <Card
              key={`${t.id}-${kind}`}
              title={
                <span className="flex items-center gap-1.5">
                  {isDesktop ? <Monitor size={13} /> : <Terminal size={13} />}
                  {CARD_NAME[t.id] ?? t.name} {isDesktop ? '桌面版' : 'CLI'}
                </span>
              }
              extra={<StatusDot status={clientInstalled ? light.s : 'idle'} />}
              dense
            >
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-slate-500">状态</span>
                  {clientInstalled ? (
                    isDesktop ? (
                      <span className="text-emerald-600">{t.desktop.packageFamilyName ? '微软商店版' : '已安装'}</span>
                    ) : (
                      <span className="min-w-0 truncate text-emerald-600" title={t.cli.path}>
                        {t.cli.version ?? '已安装'}
                        <span className="ml-2 text-slate-400">{t.cli.path}</span>
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
              </div>

              {/* 预设下拉：未安装客户端时禁用，引导先安装 */}
              <div className="mt-2">
                <select
                  value={selected}
                  disabled={Boolean(busy) || !clientInstalled}
                  onChange={(e) => {
                    const p = options.find((x) => x.id === e.target.value);
                    if (p) void switchPreset(t.id, kind, p);
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
              {busy && switching[`${t.id}-${kind}`] && (
                <div className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">
                  正在测试连通性、写入配置并重启…
                </div>
              )}

              <div className="mt-2.5 flex items-center gap-1">
                {!clientInstalled ? (
                  isDesktop ? (
                    <button
                      onClick={() => void aibox().openStorePage(t.id).then((r) => setMsg(r.message))}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                    >
                      <Store size={10} /> 商店安装
                    </button>
                  ) : (
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void aibox().installCli(t.id).then((r) => setMsg(r.message))}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      <Download size={10} /> {busy ? '安装中…' : '一键安装'}
                    </button>
                  )
                ) : light.s === 'warn' ? (
                  <button
                    onClick={() => void restart(t.id)}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-400"
                  >
                    <RotateCcw size={10} /> 重启生效
                  </button>
                ) : isDesktop ? (
                  <button
                    onClick={() => void aibox().launch(t.id, 'desktop').then((r) => setMsg(r.message))}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                  >
                    <Play size={10} /> 启动
                  </button>
                ) : (
                  <button
                    onClick={() => void aibox().launch(t.id, 'cli').then((r) => setMsg(r.message))}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                  >
                    <Play size={10} /> 启动终端
                  </button>
                )}
                {clientInstalled && selected && (
                  <button
                    onClick={() => {
                      const p = options.find((x) => x.id === selected);
                      if (p) void switchPreset(t.id, kind, p);
                    }}
                    disabled={Boolean(busy)}
                    title="重新应用当前预设并重启"
                    className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-indigo-300 px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <Rocket size={10} /> 应用并重启
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* 填 key / 测试失败弹窗 */}
      <Modal
        title={keyRequest?.testError ? `「${keyRequest?.preset.name ?? ''}」连接测试未通过` : `填写「${keyRequest?.preset.name ?? ''}」的 API Key`}
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
