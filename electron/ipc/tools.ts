import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolId, ToolInfo } from '../../shared/types';

const execFileP = promisify(execFile);

/** which/where 探测：返回首个命中路径 */
async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('where.exe', [cmd], {
      windowsHide: true,
      timeout: 8_000,
    });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

/** 版本解析：跑 `<cmd> --version`，容错 stderr 输出 */
async function versionOf(cmdPath: string, args: string[] = ['--version']): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileP(cmdPath, args, {
      windowsHide: true,
      timeout: 15_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const line = (stdout || stderr).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line?.slice(0, 120);
  } catch {
    return undefined;
  }
}

function envDir(...segs: string[]): string {
  const base = process.env[segs[0]];
  return base ? path.join(base, ...segs.slice(1)) : '';
}

/** Claude Desktop 安装探测：常见安装位 + 开始菜单快捷方式 */
function detectClaudeDesktop(): { installed: boolean; path?: string } {
  const candidates = [
    envDir('LOCALAPPDATA', 'AnthropicClaude', 'claude.exe'),
    envDir('ProgramFiles', 'Claude', 'claude.exe'),
    envDir('ProgramFiles(x86)', 'Claude', 'claude.exe'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return { installed: true, path: p };
  }
  const shortcut = envDir('APPDATA', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude.lnk');
  if (shortcut && fs.existsSync(shortcut)) return { installed: true, path: shortcut };
  return { installed: false };
}

/** Codex 桌面版（微软商店包）探测：带 60s 进程内缓存（Get-AppxPackage 较慢） */
let codexStoreCache: { at: number; result: { installed: boolean; packageFamilyName?: string } } | null = null;

async function detectCodexStore(): Promise<{ installed: boolean; packageFamilyName?: string }> {
  if (codexStoreCache && Date.now() - codexStoreCache.at < 60_000) return codexStoreCache.result;
  try {
    const { stdout } = await execFileP(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-AppxPackage -Name *codex* | Select-Object -First 1 -ExpandProperty PackageFamilyName'],
      { windowsHide: true, timeout: 20_000 },
    );
    const pfn = stdout.trim();
    const result = pfn ? { installed: true, packageFamilyName: pfn } : { installed: false };
    codexStoreCache = { at: Date.now(), result };
    return result;
  } catch {
    return { installed: false };
  }
}

export const TOOL_META: Record<ToolId, { name: string; cliCmd: string; npmPackage: string }> = {
  codex: { name: 'Codex', cliCmd: 'codex', npmPackage: '@openai/codex' },
  'claude-code': { name: 'Claude Code', cliCmd: 'claude', npmPackage: '@anthropic-ai/claude-code' },
  gemini: { name: 'Gemini CLI', cliCmd: 'gemini', npmPackage: '@google/gemini-cli' },
};

/** 三个工具的存在性 / 路径 / 版本 / 桌面版检测（并行，避免串行等待） */
export async function detectTools(): Promise<ToolInfo[]> {
  const ids = Object.keys(TOOL_META) as ToolId[];
  const [codexStore, claudeDesktop, ...cliResults] = await Promise.all([
    detectCodexStore(),
    Promise.resolve(detectClaudeDesktop()),
    ...ids.map(async (id) => {
      const meta = TOOL_META[id];
      const cliPath = await which(meta.cliCmd);
      const version = cliPath ? await versionOf(cliPath) : undefined;
      return { id, cliPath, version };
    }),
  ]);

  return cliResults.map(({ id, cliPath, version }) => {
    const meta = TOOL_META[id];
    let desktop: ToolInfo['desktop'] = { installed: false };
    if (id === 'codex' && codexStore.installed) {
      desktop = { installed: true, packageFamilyName: codexStore.packageFamilyName };
    }
    if (id === 'claude-code' && claudeDesktop.installed) {
      desktop = { installed: true, path: claudeDesktop.path };
    }
    return {
      id,
      name: meta.name,
      npmPackage: meta.npmPackage,
      cli: { installed: Boolean(cliPath), path: cliPath, version },
      desktop,
    };
  });
}
