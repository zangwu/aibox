import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ApplyReport, ApplyReportItem, Preset, ToolId, VerifyStatus } from '../../shared/types';

/**
 * 配置写入器（核心差异化：写临时文件 → 原子替换 → 读回解析比对）。
 * 所有函数同步实现，便于单测注入；真实环境变量写入通过 setUserEnv 注入。
 */

export interface WriteDeps {
  /** 覆盖 HOME（单测指向临时目录） */
  homeDir?: string;
  /** 写用户级环境变量（单测传记录用 fake） */
  setUserEnv?: (key: string, value: string) => void;
}

export function defaultHome(): string {
  return os.homedir();
}

/** 真实实现：写入注册表 HKCU\Environment（用户级） */
export function realSetUserEnv(key: string, value: string): void {
  const ps = `[Environment]::SetEnvironmentVariable('${key.replace(/'/g, "''")}','${value.replace(/'/g, "''")}','User')`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    windowsHide: true,
    timeout: 15_000,
  });
}

/** 原子写：同目录临时文件 → rename 替换；已有文件先备份为 .aibox-backup */
export function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.aibox-backup`);
  }
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function item(
  tool: ToolId,
  target: string,
  field: string,
  status: VerifyStatus,
  detail: string,
): ApplyReportItem {
  return { tool, target, field, status, detail };
}

/* ------------------------------ Codex ------------------------------ */

export interface CodexWriteInput {
  preset: Preset;
  apiKey: string;
}

/** 由预设协议推导 wire_api：中转站大多不支持 Responses API */
export function codexWireApi(protocol: Preset['protocol']): 'chat' | 'responses' {
  return protocol === 'openai-responses' ? 'responses' : 'chat';
}

function providerIdOf(preset: Preset): string {
  return preset.id.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function escapeTomlBasic(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, "'");
}

/** 提取既有顶层 model_provider（沿用旧 id，保证 Codex 历史线程可恢复） */
export function detectCodexProviderId(existing: string): string | undefined {
  for (const raw of existing.split(/\r?\n/)) {
    if (/^\s*\[/.test(raw)) break; // 进入表区域即停
    const m = raw.match(/^model_provider\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return undefined;
}

export interface CodexUpsertResult {
  content: string;
  providerId: string;
}

/**
 * 外科式更新 config.toml（非破坏性，这是与 ccswitch 的关键差异）：
 * - 沿用既有 model_provider id（没有才用预设 id），历史会话因此可恢复
 * - 只改/插 model、model_provider 两个顶层键，其余字节原样保留
 * - 只替换 [model_providers.<pid>] 表体；不存在则在文件末尾追加
 */
export function upsertCodexConfig(existing: string, preset: Preset): CodexUpsertResult {
  const pid = detectCodexProviderId(existing) ?? providerIdOf(preset);
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  const out: string[] = [];
  const isHeader = (l: string) => /^\s*\[/.test(l);

  const modelLine = `model = "${escapeTomlBasic(preset.model)}"`;
  const providerLine = `model_provider = "${pid}"`;
  const tableHeader = `[model_providers.${pid}]`;
  const tableBody = [
    `name = "${escapeTomlBasic(preset.name)}"`,
    `base_url = "${preset.baseUrl}"`,
    `env_key = "OPENAI_API_KEY"`,
    `wire_api = "${codexWireApi(preset.protocol)}"`,
  ];

  let i = 0;
  let sawModel = false;
  let sawProvider = false;
  let tableDone = false;

  // 1) 顶层区域（第一个表头之前）：就地改 model / model_provider
  while (i < lines.length) {
    const line = lines[i];
    if (isHeader(line)) break;
    if (/^model\s*=/.test(line)) {
      if (!sawModel) {
        out.push(modelLine);
        sawModel = true;
      }
    } else if (/^model_provider\s*=/.test(line)) {
      if (!sawProvider) {
        out.push(providerLine);
        sawProvider = true;
      }
    } else {
      out.push(line);
    }
    i++;
  }
  if (!sawModel) out.push(modelLine);
  if (!sawProvider) out.push(providerLine);

  // 2) 表区域：原样拷贝，仅替换目标 provider 表
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === tableHeader) {
      i++;
      while (i < lines.length && !isHeader(lines[i])) i++; // 跳过旧表体
      out.push(tableHeader, ...tableBody);
      tableDone = true;
      continue;
    }
    out.push(line);
    i++;
  }

  if (!tableDone) {
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    out.push(tableHeader, ...tableBody, '');
  }

  return { content: out.join(eol), providerId: pid };
}

/**
 * 简版 TOML 读回：只解析顶层键与目标 provider 表，
 * 避免其它表（如 [windows] sandbox）的同名字段污染校验。
 */
export function parseCodexConfig(content: string, providerId?: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inTop = true;
  let inProviderTable = false;
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^\[/.test(trimmed)) {
      inTop = false;
      inProviderTable = providerId ? trimmed === `[model_providers.${providerId}]` : false;
      continue;
    }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"$/);
    if (!m) continue;
    if (inTop || inProviderTable) out[m[1]] = m[2];
  }
  return out;
}

function applyCodex(input: CodexWriteInput, deps: Required<WriteDeps>): ApplyReportItem[] {
  const { preset, apiKey } = input;
  const home = deps.homeDir;
  const codexDir = path.join(home, '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const wire = codexWireApi(preset.protocol);
  const items: ApplyReportItem[] = [];

  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const { content, providerId: pid } = upsertCodexConfig(existing, preset);
  atomicWrite(configPath, content);

  const readback = parseCodexConfig(fs.readFileSync(configPath, 'utf8'), pid);
  const checks: Array<[string, string]> = [
    ['model', preset.model],
    ['model_provider', pid],
    ['base_url', preset.baseUrl],
    ['env_key', 'OPENAI_API_KEY'],
    ['wire_api', wire],
  ];
  for (const [field, expected] of checks) {
    items.push(
      readback[field] === expected
        ? item('codex', '~/.codex/config.toml', field, 'ok', `读回一致：${expected}`)
        : item('codex', '~/.codex/config.toml', field, 'error', `读回不一致，期望 ${expected}，实际 ${readback[field] ?? '(缺失)'}`),
    );
  }

  // 用户级环境变量（新终端/新进程生效）
  deps.setUserEnv('OPENAI_API_KEY', apiKey);
  deps.setUserEnv('OPENAI_BASE_URL', preset.baseUrl);
  items.push(item('codex', '用户环境变量', 'OPENAI_API_KEY', 'pending-restart', '已写入用户环境变量，需重启终端/工具后生效'));
  items.push(item('codex', '用户环境变量', 'OPENAI_BASE_URL', 'pending-restart', `已写入：${preset.baseUrl}，需重启终端/工具后生效`));

  return items;
}

/* ---------------------------- Claude Code ---------------------------- */

function applyClaude(input: CodexWriteInput, deps: Required<WriteDeps>): ApplyReportItem[] {
  const { preset, apiKey } = input;
  const settingsPath = path.join(deps.homeDir, '.claude', 'settings.json');
  const items: ApplyReportItem[] = [];

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      fs.copyFileSync(settingsPath, `${settingsPath}.aibox-backup`);
      existing = {};
      items.push(item('claude-code', '~/.claude/settings.json', '(原文件)', 'skipped', '原文件 JSON 解析失败，已备份并重建'));
    }
  }
  const env = { ...((existing.env as Record<string, unknown>) ?? {}) };
  env.ANTHROPIC_BASE_URL = preset.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  // 部分中转站要求 x-api-key 头而非 Bearer，两个都写保证兼容
  env.ANTHROPIC_API_KEY = apiKey;
  const next = { ...existing, env };

  atomicWrite(settingsPath, JSON.stringify(next, null, 2) + '\n');

  const readback = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
    env?: Record<string, string>;
  };
  const pairs: Array<[string, string]> = [
    ['ANTHROPIC_BASE_URL', preset.baseUrl],
    ['ANTHROPIC_AUTH_TOKEN', apiKey],
    ['ANTHROPIC_API_KEY', apiKey],
  ];
  for (const [field, expected] of pairs) {
    const actual = readback.env?.[field];
    const masked = field.includes('TOKEN') || field.includes('KEY') ? '（已写入，读回一致）' : actual ?? '';
    items.push(
      actual === expected
        ? item('claude-code', '~/.claude/settings.json', field, 'ok', field.includes('TOKEN') ? masked : `读回一致：${masked}`)
        : item('claude-code', '~/.claude/settings.json', field, 'error', '读回不一致'),
    );
  }
  return items;
}

/* ------------------------------ Gemini ------------------------------ */

function applyGemini(input: CodexWriteInput, deps: Required<WriteDeps>): ApplyReportItem[] {
  const { preset, apiKey } = input;
  const settingsPath = path.join(deps.homeDir, '.gemini', 'settings.json');
  const items: ApplyReportItem[] = [];

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      fs.copyFileSync(settingsPath, `${settingsPath}.aibox-backup`);
      existing = {};
      items.push(item('gemini', '~/.gemini/settings.json', '(原文件)', 'skipped', '原文件 JSON 解析失败，已备份并重建'));
    }
  }
  const env = { ...((existing.env as Record<string, unknown>) ?? {}) };
  if (preset.protocol === 'google') {
    env.GEMINI_API_KEY = apiKey;
    if (preset.baseUrl) env.GOOGLE_GEMINI_BASE_URL = preset.baseUrl;
  } else {
    // OpenAI 兼容模式
    env.OPENAI_API_KEY = apiKey;
    env.OPENAI_BASE_URL = preset.baseUrl;
  }
  const next = { ...existing, env };

  atomicWrite(settingsPath, JSON.stringify(next, null, 2) + '\n');

  const readback = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
    env?: Record<string, string>;
  };
  const expectedPairs =
    preset.protocol === 'google'
      ? ([
          ['GEMINI_API_KEY', apiKey],
          ['GOOGLE_GEMINI_BASE_URL', preset.baseUrl],
        ] as Array<[string, string]>)
      : ([
          ['OPENAI_API_KEY', apiKey],
          ['OPENAI_BASE_URL', preset.baseUrl],
        ] as Array<[string, string]>);
  for (const [field, expected] of expectedPairs) {
    const actual = readback.env?.[field];
    items.push(
      actual === expected
        ? item('gemini', '~/.gemini/settings.json', field, 'ok', field.includes('KEY') ? '（已写入，读回一致）' : `读回一致：${actual}`)
        : item('gemini', '~/.gemini/settings.json', field, 'error', '读回不一致'),
    );
  }
  return items;
}

/* ------------------------------ 总入口 ------------------------------ */

export function applyPresetToTools(
  preset: Preset,
  tools: ToolId[],
  apiKey: string,
  deps: WriteDeps = {},
): ApplyReport {
  const full: Required<WriteDeps> = {
    homeDir: deps.homeDir ?? defaultHome(),
    setUserEnv: deps.setUserEnv ?? realSetUserEnv,
  };
  const warnings: string[] = [];
  const items: ApplyReportItem[] = [];

  const input: CodexWriteInput = { preset, apiKey };

  for (const tool of tools) {
    if (!preset.supports.includes(tool)) {
      items.push(item(tool, '-', '-', 'skipped', '该预设不支持此工具'));
      continue;
    }
    try {
      if (tool === 'codex') {
        // 检测到 auth.json 时提醒删除，避免与 API key 模式冲突
        const authJson = path.join(full.homeDir, '.codex', 'auth.json');
        if (fs.existsSync(authJson)) {
          warnings.push('检测到 ~/.codex/auth.json：可能优先于环境变量生效，建议删除后重试（盒子的应用记录中已保留此提醒）');
        }
        items.push(...applyCodex(input, full));
      } else if (tool === 'claude-code') {
        items.push(...applyClaude(input, full));
      } else {
        items.push(...applyGemini(input, full));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      items.push(item(tool, '-', '-', 'error', `写入异常：${msg}`));
    }
  }

  return {
    presetId: preset.id,
    presetName: preset.name,
    appliedAt: Date.now(),
    items,
    warnings,
  };
}
