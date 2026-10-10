import * as https from 'node:https';
import type { Preset, PresetLocalOverrides, Subscription } from '../../shared/types';
import { decodeShareCode, parsePresetList, subscriptionPayloadSchema } from '../../shared/presetSchema';
import { allPresets, appendLog, builtinList, loadConfig, removePreset, saveConfig, savePresetOverride, upsertPreset } from '../store';

/**
 * 保存预设：
 * - 目标是内置预设（id 命中内置）→ 只写本地覆盖层（收藏/备注/评分/已存 key），绝不复制副本
 * - 目标是用户预设 → 就地更新
 * - 新建用户预设与内置撞 id → 自动加后缀
 */
export function saveUserPreset(input: Preset): Preset[] {
  const isBuiltinTarget = builtinList().some((p) => p.id === input.id);
  if (isBuiltinTarget) {
    const patch: PresetLocalOverrides = {};
    if (input.favorite !== undefined) patch.favorite = input.favorite;
    if (input.userNote !== undefined) patch.userNote = input.userNote;
    if (input.localRating !== undefined) patch.localRating = input.localRating;
    if (input.savedKey !== undefined) patch.savedKey = input.savedKey;
    if (input.keyVerified !== undefined) patch.keyVerified = input.keyVerified;
    if (input.verifiedAt !== undefined) patch.verifiedAt = input.verifiedAt;
    appendLog(`preset override saved: ${input.id}`);
    return savePresetOverride(input.id, patch);
  }
  const preset = { ...input, builtin: false };
  if (allPresets().some((p) => p.builtin && p.id === preset.id)) {
    let n = 2;
    while (allPresets().some((p) => p.id === `${preset.id}-${n}`)) n++;
    preset.id = `${preset.id}-${n}`;
  }
  appendLog(`preset saved: ${preset.id}`);
  return upsertPreset(preset);
}

export function removeUserPreset(id: string): Preset[] {
  appendLog(`preset removed: ${id}`);
  // store.removePreset 内部已保护内置预设
  return removePreset(id);
}

export function importShare(code: string): Preset[] {
  const preset = decodeShareCode(code);
  appendLog(`share code imported: ${preset.id}`);
  return saveUserPreset(preset);
}

function fetchJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string, redirects = 0) => {
      const req = https.get(u, { headers: { 'user-agent': 'aibox' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects > 5) {
            clearTimeout(timer);
            return reject(new Error('重定向过多'));
          }
          clearTimeout(timer);
          return doGet(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('响应不是合法 JSON'));
          }
        });
      });
      const timer = setTimeout(() => {
        req.destroy(new Error('请求超时'));
      }, timeoutMs);
      req.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    };
    doGet(url);
  });
}

/** 拉取单个订阅源并合并入库（同 id 覆盖用户预设，不覆盖内置） */
export async function fetchSubscription(sub: Subscription): Promise<{ ok: boolean; message: string }> {
  const cfg = loadConfig();
  const target = cfg.subscriptions.find((s) => s.id === sub.id);
  try {
    const data = await fetchJson(sub.url);
    const payload = subscriptionPayloadSchema.parse(data);
    const incoming = parsePresetList(payload.presets).map((p) => ({ ...p, builtin: false as const }));
    let added = 0;
    for (const p of incoming) {
      const exists = allPresets().find((e) => e.id === p.id);
      if (exists?.builtin) continue; // 内置不被订阅覆盖
      upsertPreset(p);
      added++;
    }
    if (target) {
      target.lastFetchedAt = Date.now();
      target.lastError = undefined;
      saveConfig(cfg);
    }
    appendLog(`subscription fetched: ${sub.url} +${added}`);
    return { ok: true, message: `订阅更新完成，合并 ${added} 条预设` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (target) {
      target.lastError = msg;
      target.lastFetchedAt = Date.now();
      saveConfig(cfg);
    }
    appendLog(`subscription failed: ${sub.url} ${msg}`);
    return { ok: false, message: `订阅拉取失败：${msg}` };
  }
}

export function addSubscription(url: string): Preset[] {
  const cfg = loadConfig();
  const trimmed = url.trim();
  if (cfg.subscriptions.some((s) => s.url === trimmed)) return allPresets();
  cfg.subscriptions.push({ id: `sub-${Date.now().toString(36)}`, url: trimmed, enabled: true });
  saveConfig(cfg);
  appendLog(`subscription added: ${trimmed}`);
  void fetchSubscription(cfg.subscriptions[cfg.subscriptions.length - 1]);
  return allPresets();
}

export function toggleSubscription(id: string, enabled: boolean): Preset[] {
  const cfg = loadConfig();
  const sub = cfg.subscriptions.find((s) => s.id === id);
  if (sub) {
    sub.enabled = enabled;
    saveConfig(cfg);
  }
  return allPresets();
}

export function removeSubscription(id: string): Preset[] {
  const cfg = loadConfig();
  cfg.subscriptions = cfg.subscriptions.filter((s) => s.id !== id);
  saveConfig(cfg);
  return allPresets();
}

/** 定时拉取所有启用订阅（每 6 小时） */
export function startSubscriptionScheduler(): void {
  const tick = () => {
    for (const sub of loadConfig().subscriptions) {
      if (sub.enabled) void fetchSubscription(sub);
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 6 * 60 * 60 * 1000);
}
