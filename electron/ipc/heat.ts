import * as https from 'node:https';
import type { ToolDef } from '../../shared/toolCatalog';
import { loadConfig, saveConfig } from '../store';

/**
 * 热度 = 公开调用量原始数字（不做 0-100 封顶）。
 * 优先 npm 周下载（最接近真实调用），其次 VS Code 安装量，再次 GitHub Stars。
 * score 字段保留为兼容排序用的相对值，UI 不展示 /100。
 */

export interface HeatEntry {
  /** GitHub Stars */
  stars?: number;
  /** npm 周下载 */
  downloads?: number;
  /** VS Code 插件安装量 */
  vscodeInstalls?: number;
  /** 主热度：原始调用量（未归一化、无 100 上限） */
  volume: number;
  /** 相对分 0-100，仅内部排序 */
  score: number;
  at: number;
}

export type HeatMap = Record<string, HeatEntry>;

function getJson(url: string, timeoutMs = 15_000, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'user-agent': 'aibox-heat', accept: 'application/json', ...extraHeaders } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return getJson(res.headers.location, timeoutMs, extraHeaders).then(resolve);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    const t = setTimeout(() => {
      req.destroy(new Error('timeout'));
    }, timeoutMs);
    req.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

function postJson(url: string, body: unknown, timeoutMs = 15_000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'user-agent': 'aibox-heat',
          accept: 'application/json;api-version=3.0-preview.1',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(null);
          }
        });
      },
    );
    const t = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

const MAX_STARS = 80_000;
const MAX_DOWNLOADS = 300_000;
const MAX_VSCODE = 2_000_000;

export function computeScore(
  stars: number | undefined,
  downloads: number | undefined,
  vscodeInstalls?: number,
): number {
  const s = stars && stars > 0 ? Math.min(1, Math.log10(1 + stars) / Math.log10(1 + MAX_STARS)) : 0;
  const d = downloads && downloads > 0 ? Math.min(1, Math.log10(1 + downloads) / Math.log10(1 + MAX_DOWNLOADS)) : 0;
  const v = vscodeInstalls && vscodeInstalls > 0 ? Math.min(1, Math.log10(1 + vscodeInstalls) / Math.log10(1 + MAX_VSCODE)) : 0;

  const parts: Array<[number, number]> = [];
  if (stars && stars > 0) parts.push([s, 0.5]);
  if (downloads && downloads > 0) parts.push([d, 0.35]);
  if (vscodeInstalls && vscodeInstalls > 0) parts.push([v, 0.15]);
  if (parts.length === 0) return 0;

  const wSum = parts.reduce((a, [, w]) => a + w, 0);
  const raw = parts.reduce((a, [score, w]) => a + score * w, 0) / wSum;
  return Math.round(raw * 100);
}

/** 主热度：直接取最能代表调用量的原始数字，不设 100 上限 */
export function computeVolume(
  stars: number | undefined,
  downloads: number | undefined,
  vscodeInstalls: number | undefined,
): number {
  return downloads ?? vscodeInstalls ?? stars ?? 0;
}

export function loadHeat(): HeatMap {
  const cfg = loadConfig() as { heat?: HeatMap };
  return cfg.heat ?? {};
}

export function saveHeat(heat: HeatMap): void {
  const cfg = loadConfig() as unknown as Record<string, unknown>;
  cfg.heat = heat;
  saveConfig(cfg as unknown as Parameters<typeof saveConfig>[0]);
}

/** VS Code Marketplace 安装量 */
async function fetchVscodeInstalls(extId: string): Promise<number | undefined> {
  const j = await postJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    filters: [{ criteria: [{ filterType: 7, value: extId }] }],
    flags: 914,
  });
  try {
    const results = (j?.results as Array<Record<string, unknown>> | undefined) ?? [];
    const extensions = (results[0]?.extensions as Array<Record<string, unknown>> | undefined) ?? [];
    const stats = (extensions[0]?.statistics as Array<Record<string, unknown>> | undefined) ?? [];
    const install = stats.find((s) => s.statisticName === 'install');
    if (install && typeof install.value === 'number') return install.value;
  } catch {
    /* ignore */
  }
  return undefined;
}

export async function refreshHeat(defs: ToolDef[]): Promise<{ ok: number; fail: number }> {
  const heat = loadHeat();
  let ok = 0;
  let fail = 0;
  for (const def of defs) {
    const prev = heat[def.id];
    let stars: number | undefined;
    let downloads: number | undefined;
    let vscodeInstalls: number | undefined;
    if (def.github) {
      const j = await getJson(`https://api.github.com/repos/${def.github}`);
      if (j && typeof j.stargazers_count === 'number') {
        stars = j.stargazers_count;
        ok++;
      } else {
        fail++;
        stars = prev?.stars; // 限流/失败时保留旧值，避免清掉已有热度
      }
    } else {
      stars = prev?.stars;
    }
    if (def.npmPackage) {
      const j = await getJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(def.npmPackage)}`);
      if (j && typeof j.downloads === 'number') {
        downloads = j.downloads;
        ok++;
      } else {
        fail++;
        downloads = prev?.downloads;
      }
    } else {
      downloads = prev?.downloads;
    }
    const extId = def.vscodeExtensionId ?? def.desktop?.vscodeExtensionId;
    if (extId) {
      const v = await fetchVscodeInstalls(extId);
      if (typeof v === 'number') {
        vscodeInstalls = v;
        ok++;
      } else {
        fail++;
        vscodeInstalls = prev?.vscodeInstalls;
      }
    } else {
      vscodeInstalls = prev?.vscodeInstalls;
    }
    // 全部来源都失败且原本也无数据：不制造空记录
    if (stars === undefined && downloads === undefined && vscodeInstalls === undefined) {
      if (prev) heat[def.id] = prev;
      continue;
    }
    heat[def.id] = {
      stars,
      downloads,
      vscodeInstalls,
      volume: computeVolume(stars, downloads, vscodeInstalls),
      score: computeScore(stars, downloads, vscodeInstalls),
      at: Date.now(),
    };
  }
  saveHeat(heat);
  return { ok, fail };
}
