import * as fs from 'node:fs';
import * as path from 'node:path';
import builtinJson from '../shared/builtinPresets.json';
import { parsePresetList } from '../shared/presetSchema';
import type { BoxConfig, Preset } from '../shared/types';

/**
 * 盒子自身数据层：%APPDATA%/aibox/config.json
 * 不依赖 electron（可用 env.AIBOX_DATA_DIR 覆盖目录，便于单测）。
 */

const builtinPresets = parsePresetList(builtinJson);

export function dataDir(): string {
  const override = process.env.AIBOX_DATA_DIR;
  if (override) return override;
  const appData = process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
  return path.join(appData, 'aibox');
}

const CONFIG_PATH = () => path.join(dataDir(), 'config.json');
const LOG_PATH = () => path.join(dataDir(), 'logs.txt');

let cache: BoxConfig | null = null;

export function defaultConfig(): BoxConfig {
  return { schemaVersion: 1, presets: [], presetOverrides: {}, toolFavorites: {}, subscriptions: [], lastApply: {} };
}

export function loadConfig(): BoxConfig {
  if (cache) return cache;
  let cfg: BoxConfig = defaultConfig();
  try {
    if (fs.existsSync(CONFIG_PATH())) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')) as BoxConfig;
      cfg = { ...defaultConfig(), ...raw };
      cfg.presetOverrides = cfg.presetOverrides ?? {};
    }
  } catch {
    // 损坏时从默认重建（原子写保护下的极端兜底）
  }
  cache = cfg;
  return cfg;
}

export function saveConfig(cfg: BoxConfig): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${CONFIG_PATH()}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH());
  cache = cfg;
}

/** 内置预设 + 用户预设合并视图（用户侧同 id 覆盖内置；内置再叠本地覆盖层） */
export function allPresets(): Preset[] {
  const cfg = loadConfig();
  const map = new Map<string, Preset>();
  for (const p of builtinPresets) map.set(p.id, { ...p, builtin: true });
  for (const p of cfg.presets) map.set(p.id, { ...p, builtin: false });
  // 覆盖层只作用于内置预设（用户预设可直接改本体）
  for (const p of map.values()) {
    if (p.builtin) {
      const o = cfg.presetOverrides[p.id];
      if (o) Object.assign(p, o);
    }
  }
  return [...map.values()];
}

/** 保存内置预设的本地字段（收藏/备注/评分/已存 key），不产生副本 */
export function savePresetOverride(id: string, patch: import('../shared/types').PresetLocalOverrides): Preset[] {
  const cfg = loadConfig();
  cfg.presetOverrides[id] = { ...cfg.presetOverrides[id], ...patch };
  saveConfig(cfg);
  return allPresets();
}

/** 清掉内置预设的本地覆盖 */
export function clearPresetOverride(id: string): Preset[] {
  const cfg = loadConfig();
  delete cfg.presetOverrides[id];
  saveConfig(cfg);
  return allPresets();
}

/** 工具卡片收藏（与预设收藏同交互） */
export function toggleToolFavorite(cardKey: string): Record<string, boolean> {
  const cfg = loadConfig();
  cfg.toolFavorites = cfg.toolFavorites ?? {};
  cfg.toolFavorites[cardKey] = !cfg.toolFavorites[cardKey];
  saveConfig(cfg);
  return { ...cfg.toolFavorites };
}

export function getToolFavorites(): Record<string, boolean> {
  return loadConfig().toolFavorites ?? {};
}

export function upsertPreset(preset: Preset): Preset[] {
  const cfg = loadConfig();
  const idx = cfg.presets.findIndex((p) => p.id === preset.id);
  if (idx >= 0) cfg.presets[idx] = preset;
  else cfg.presets.push(preset);
  saveConfig(cfg);
  return allPresets();
}

export function removePreset(id: string): Preset[] {
  const cfg = loadConfig();
  const target = allPresets().find((p) => p.id === id);
  if (target?.builtin) return allPresets(); // 内置不可删
  cfg.presets = cfg.presets.filter((p) => p.id !== id);
  saveConfig(cfg);
  return allPresets();
}

/* -------------------------------- 日志 -------------------------------- */

export function appendLog(line: string): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(LOG_PATH(), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* 日志失败不阻断业务 */
  }
}

export function readLogs(maxLines = 300): string[] {
  try {
    if (!fs.existsSync(LOG_PATH())) return [];
    const lines = fs.readFileSync(LOG_PATH(), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/* ------------------------------ CLI 会话存档 ------------------------------ */

const CHATS_PATH = () => path.join(dataDir(), 'chats.json');
const AGENT_TURN_CAP = 50_000; // 单个 agent 输出最大保留字符数
const AGENT_TURNS_KEPT = 100;

export interface AgentTurn {
  role: 'user' | 'agent';
  text: string;
}

export function loadChats(tool: string): AgentTurn[] {
  try {
    if (!fs.existsSync(CHATS_PATH())) return [];
    const all = JSON.parse(fs.readFileSync(CHATS_PATH(), 'utf8')) as Record<string, AgentTurn[]>;
    return Array.isArray(all[tool]) ? all[tool] : [];
  } catch {
    return [];
  }
}

export function saveChats(tool: string, turns: AgentTurn[]): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    let all: Record<string, AgentTurn[]> = {};
    try {
      if (fs.existsSync(CHATS_PATH())) all = JSON.parse(fs.readFileSync(CHATS_PATH(), 'utf8'));
    } catch {
      /* 损坏则重建 */
    }
    const trimmed = turns.slice(-AGENT_TURNS_KEPT).map((t) => ({
      ...t,
      text: t.text.length > AGENT_TURN_CAP ? t.text.slice(0, AGENT_TURN_CAP) + '\n…(已截断)' : t.text,
    }));
    all[tool] = trimmed;
    const tmp = `${CHATS_PATH()}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(all), 'utf8');
    fs.renameSync(tmp, CHATS_PATH());
  } catch {
    /* 存档失败不影响会话 */
  }
}

/** 供外部（ipc）拿到内置清单做合并 */
export function builtinList(): Preset[] {
  return builtinPresets.map((p) => ({ ...p, builtin: true }));
}
