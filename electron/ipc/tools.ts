import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TOOL_CATALOG } from '../../shared/toolCatalog';
import type { DesktopChannel, ToolDef } from '../../shared/toolCatalog';
import type { HeatEntry } from './heat';
import { getToolFavorites } from '../store';

const execFileP = promisify(execFile);

export interface DesktopStatus {
  available: boolean;
  installed: boolean;
  name: string;
  channel?: DesktopChannel;
  packageFamilyName?: string;
  path?: string;
  storeUrl?: string;
  vscodeInstalled?: boolean;
  note?: string;
}

export interface ToolCardInfo {
  id: string;
  name: string;
  vendor: string;
  desc: string;
  managed: boolean;
  agent: boolean;
  official: boolean;
  /** 是否有 CLI 形态（目录里声明了 cmd） */
  hasCli?: boolean;
  website?: string;
  npmPackage?: string;
  env: string;
  installed: boolean;
  path?: string;
  version?: string;
  desktop?: DesktopStatus;
  /** 卡片级收藏（桌面/CLI 分开） */
  favoriteDesktop?: boolean;
  favoriteCli?: boolean;
  heat?: HeatEntry;
}

/* ------------------------------ 性能：缓存 ------------------------------ */

const DETECT_CACHE_MS = 20_000;
const VERSION_CACHE_MS = 10 * 60_000;
const VERSION_TIMEOUT_MS = 2_500;
const APPX_CACHE_MS = 60_000;
/** 并发上限：避免几十个 where.exe / --version 同时打满 CPU */
const MAX_CONCURRENCY = 6;

type DetectCache = { at: number; result: ToolCardInfo[] };
let detectCache: DetectCache | null = null;

const versionCache = new Map<string, { at: number; version?: string }>();
const resolveCache = new Map<string, { at: number; path?: string }>();
let appxListCache: { at: number; map: Map<string, string> } | null = null;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** which/where：优先 .exe/.cmd */
async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('where.exe', [cmd], { windowsHide: true, timeout: 3_000 });
    const hits = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const rank = (p: string) => (/\.exe$/i.test(p) ? 0 : /\.cmd$/i.test(p) ? 1 : /\.bat$/i.test(p) ? 2 : 3);
    return [...hits].sort((a, b) => rank(a) - rank(b))[0];
  } catch {
    return undefined;
  }
}

let npmPrefixPromise: Promise<string> | null = null;
async function npmPrefix(): Promise<string> {
  if (npmPrefixPromise) return npmPrefixPromise;
  npmPrefixPromise = (async () => {
    try {
      const { stdout } = await execFileP('npm.cmd', ['prefix', '-g'], { windowsHide: true, timeout: 8_000 });
      return stdout.trim();
    } catch {
      return '';
    }
  })();
  return npmPrefixPromise;
}

function expand(p: string): string {
  return p
    .replace(/%APPDATA%/gi, process.env.APPDATA ?? '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE ?? '')
    .replace(/%ProgramFiles%/gi, process.env['ProgramFiles'] ?? '')
    .replace(/%PROGRAMFILES\(X86\)%/gi, process.env['ProgramFiles(x86)'] ?? '');
}

/** 深度解析：PATH 优先；命不中再扫少量关键目录 */
export async function deepResolve(cmd: string, extraDirs: string[] = []): Promise<string | undefined> {
  const key = cmd + '|' + extraDirs.join(';');
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < DETECT_CACHE_MS) return hit.path;

  const fromPath = await which(cmd);
  if (fromPath) {
    resolveCache.set(key, { at: Date.now(), path: fromPath });
    return fromPath;
  }

  const dirs: string[] = [];
  const prefix = await npmPrefix();
  if (prefix) dirs.push(prefix);
  dirs.push(path.join(process.env.APPDATA ?? '', 'npm'));
  dirs.push(path.join(process.env.USERPROFILE ?? '', 'scoop', 'shims'));
  dirs.push(path.join(process.env.LOCALAPPDATA ?? '', 'Programs'));
  dirs.push(path.join(process.env.USERPROFILE ?? '', '.local', 'bin'));
  for (const d of extraDirs) dirs.push(expand(d));

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const ext of ['.exe', '.cmd', '.bat', '']) {
      const candidate = path.join(dir, ext ? cmd + ext : cmd);
      if (fs.existsSync(candidate)) {
        resolveCache.set(key, { at: Date.now(), path: candidate });
        return candidate;
      }
    }
  }
  resolveCache.set(key, { at: Date.now(), path: undefined });
  return undefined;
}

async function versionOf(cmdPath: string): Promise<string | undefined> {
  const hit = versionCache.get(cmdPath);
  if (hit && Date.now() - hit.at < VERSION_CACHE_MS) return hit.version;

  // 失败也缓存，避免每次刷新都去跑慢 CLI
  let version: string | undefined;
  try {
    const wrapped = /\.(cmd|bat)$/i.test(cmdPath);
    const file = wrapped ? 'cmd.exe' : cmdPath;
    const args = wrapped ? ['/d', '/s', '/c', `"${cmdPath}"`, '--version'] : ['--version'];
    const { stdout, stderr } = await execFileP(file, args, {
      windowsHide: true,
      timeout: VERSION_TIMEOUT_MS,
      windowsVerbatimArguments: true,
    });
    const line = (stdout || stderr).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    version = line?.slice(0, 120);
  } catch {
    version = undefined;
  }
  versionCache.set(cmdPath, { at: Date.now(), version });
  return version;
}

function resolveGlob(pattern: string): string | undefined {
  const parts = pattern.split(/[\\/]/);
  let roots = [''];
  for (const seg of parts) {
    const next: string[] = [];
    for (const root of roots) {
      const base = root === '' ? (pattern.startsWith('/') ? '/' : '') : root;
      const cur = base ? path.join(base, seg) : seg;
      if (!seg.includes('*')) {
        next.push(cur);
        continue;
      }
      const parent = path.dirname(cur);
      const nameRe = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (!fs.existsSync(parent)) continue;
      try {
        for (const ent of fs.readdirSync(parent)) {
          if (nameRe.test(ent)) next.push(path.join(parent, ent));
        }
      } catch {
        /* ignore */
      }
    }
    roots = next.filter((r) => r !== '');
    if (roots.length === 0) return undefined;
  }
  return roots.find((r) => fs.existsSync(r));
}

function resolvePathCandidates(candidates: string[]): string | undefined {
  for (const raw of candidates) {
    const p = expand(raw);
    if (p.includes('*')) {
      const hit = resolveGlob(p);
      if (hit) return hit;
    } else if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

function detectShortcut(shortcutNames: string[]): string | undefined {
  const menu = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : '';
  if (!menu) return undefined;
  for (const name of shortcutNames) {
    const p = path.join(menu, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** 一次列出全部 Appx（避免每个工具各起一次 PowerShell） */
async function loadAppxMap(): Promise<Map<string, string>> {
  if (appxListCache && Date.now() - appxListCache.at < APPX_CACHE_MS) return appxListCache.map;
  const map = new Map<string, string>();
  try {
    const { stdout } = await execFileP(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-AppxPackage | Select-Object Name,PackageFamilyName | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, timeout: 12_000 },
    );
    const parsed = JSON.parse(stdout) as Array<{ Name: string; PackageFamilyName: string }> | { Name: string; PackageFamilyName: string };
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of list) {
      if (row?.Name && row?.PackageFamilyName) map.set(row.Name.toLowerCase(), row.PackageFamilyName);
    }
  } catch {
    /* 无商店/失败则空表 */
  }
  appxListCache = { at: Date.now(), map };
  return map;
}

function matchAppx(map: Map<string, string>, pattern: string): string | undefined {
  // pattern like '*codex*' or 'Name'
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  for (const [name, pfn] of map) {
    if (re.test(name)) return pfn;
  }
  return undefined;
}

async function detectDesktop(def: ToolDef, appxMap: Map<string, string>): Promise<DesktopStatus | undefined> {
  const d = def.desktop;
  if (!d) return undefined;
  const base: DesktopStatus = {
    available: true,
    installed: false,
    name: d.name,
    channel: d.channel,
    storeUrl: d.storeUrl,
    note: d.note,
  };

  if (d.vscodeExtensionId) {
    const vs = detectVscodeExtension(d.vscodeExtensionId);
    base.vscodeInstalled = vs.installed;
    if (vs.installed) {
      base.installed = true;
      base.path = vs.path;
    }
  }

  if (d.appxName) {
    const pfn = matchAppx(appxMap, d.appxName);
    if (pfn) {
      base.installed = true;
      base.packageFamilyName = pfn;
    }
  }

  if (d.pathCandidates) {
    const p = resolvePathCandidates(d.pathCandidates);
    if (p) {
      base.installed = true;
      base.path = base.path ?? p;
    }
  }

  if (!base.installed && d.shortcutNames) {
    const s = detectShortcut(d.shortcutNames);
    if (s) {
      base.installed = true;
      base.path = s;
    }
  }

  return base;
}

function detectVscodeExtension(extId: string): { installed: boolean; path?: string } {
  const roots = [
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.vscode', 'extensions') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.vscode-insiders', 'extensions') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.vscode-oss', 'extensions') : '',
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const hit = fs.readdirSync(root).find((d) => d === extId || d.startsWith(extId + '-'));
      if (hit) return { installed: true, path: path.join(root, hit) };
    } catch {
      /* ignore */
    }
  }
  return { installed: false };
}

/**
 * 目录驱动检测。
 * force=false 时 20s 内直接吃缓存——打开/切换页秒开。
 */
export async function detectCatalog(heat: Record<string, HeatEntry>, opts?: { force?: boolean }): Promise<ToolCardInfo[]> {
  if (!opts?.force && detectCache && Date.now() - detectCache.at < DETECT_CACHE_MS) {
    const favs = getToolFavorites();
    return detectCache.result.map((c) => ({
      ...c,
      favoriteDesktop: Boolean(favs[`${c.id}#desktop`]),
      favoriteCli: Boolean(favs[`${c.id}#cli`]),
      heat: heat[c.id] ?? c.heat,
    }));
  }

  const favs = getToolFavorites();
  const appxMap = await loadAppxMap();

  const result = await mapLimit(TOOL_CATALOG, MAX_CONCURRENCY, async (def: ToolDef): Promise<ToolCardInfo> => {
    let installed = false;
    let cliPath: string | undefined;
    let version: string | undefined;
    if (def.cmd) {
      cliPath = await deepResolve(def.cmd, def.extraDirs ?? []);
      installed = Boolean(cliPath);
      // 版本单独缓存；失败也缓存，避免反复拉起慢 CLI
      if (installed && cliPath) version = await versionOf(cliPath);
    }
    const desktop = await detectDesktop(def, appxMap);
    return {
      id: def.id,
      name: def.name,
      vendor: def.vendor,
      desc: def.desc,
      managed: def.managed,
      agent: def.agent,
      official: def.official,
      hasCli: Boolean(def.cmd),
      website: def.website,
      npmPackage: def.npmPackage,
      env: def.env,
      installed,
      path: cliPath,
      version,
      desktop,
      favoriteDesktop: Boolean(favs[`${def.id}#desktop`]),
      favoriteCli: Boolean(favs[`${def.id}#cli`]),
      heat: heat[def.id],
    };
  });

  detectCache = { at: Date.now(), result };
  return result;
}

/** 强制刷新（用户点「重新检测」） */
export function invalidateDetectCache(): void {
  detectCache = null;
  resolveCache.clear();
  appxListCache = null;
}
