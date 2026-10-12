import { execFile, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import { TOOL_CATALOG, AGENT_ARGS, findTool } from '../../shared/toolCatalog';
import { appendLog } from '../store';

const execFileP = promisify(execFile);

/**
 * 内嵌 CLI 会话（agent 模式）：以非交互 one-shot 方式运行各家 CLI，
 * 输出流式推给渲染层聊天面板。目录驱动，新增工具只需在 toolCatalog 登记。
 * 说明：交互式 TUI 需要伪终端（node-pty 原生模块），
 * 这里选择无原生依赖的 exec/-p 模式，保证开箱即用。
 */

const running = new Map<string, ChildProcessWithoutNullStreams>();

/** 读注册表中的用户级环境变量（盒子写入的 OPENAI_API_KEY 等在这里生效） */
let userEnvCache: Record<string, string> | null = null;
let userEnvAt = 0;

/** PATH 不能覆盖合并（用户 PATH 不含 System32），只能拼接去重 */
function mergeEnv(base: NodeJS.ProcessEnv, over: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  let userPath = '';
  for (const [k, v] of Object.entries(over)) {
    if (k.toUpperCase() === 'PATH') {
      userPath = v;
      continue;
    }
    out[k] = v;
  }
  if (userPath) {
    const basePath = out.PATH ?? out.Path ?? '';
    const seen = new Set(basePath.split(';').map((s) => s.toLowerCase()));
    const extra = userPath.split(';').filter((s) => s && !seen.has(s.toLowerCase()));
    out.PATH = [basePath, ...extra].filter(Boolean).join(';');
    delete out.Path;
  }
  return out;
}

async function freshUserEnv(): Promise<Record<string, string>> {
  if (userEnvCache && Date.now() - userEnvAt < 30_000) return userEnvCache;
  try {
    const { stdout } = await execFileP(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Environment]::GetEnvironmentVariables("User").GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }',
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const out: Record<string, string> = {};
    for (const line of stdout.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1);
    }
    userEnvCache = out;
    userEnvAt = Date.now();
    return out;
  } catch {
    return {};
  }
}

/** 解析命令真实路径；.cmd/.bat 需要经 cmd.exe 包装（直接 spawn 无法执行） */
async function resolveCmd(cmd: string): Promise<{ file: string; argsPrefix: string[] } | null> {
  try {
    const { stdout } = await execFileP('where.exe', [cmd], { windowsHide: true, timeout: 8_000 });
    const hits = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    // 优先可执行扩展名（where 可能先返回无扩展名的 sh 脚本）
    const ranked = [...hits].sort((a, b) => rank(a) - rank(b));
    const p = ranked[0];
    if (!p) return null;
    if (/\.(cmd|bat)$/i.test(p)) {
      return { file: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', p] };
    }
    return { file: p, argsPrefix: [] };
  } catch {
    return null;
  }
}

function rank(p: string): number {
  if (/\.exe$/i.test(p)) return 0;
  if (/\.cmd$/i.test(p)) return 1;
  if (/\.bat$/i.test(p)) return 2;
  return 3;
}

export async function agentStart(
  tool: string,
  prompt: string,
  cwd: string | undefined,
  hasHistory: boolean,
  send: (channel: 'agent:output' | 'agent:end', payload: unknown) => void,
): Promise<{ ok: boolean; message: string }> {
  if (running.has(tool)) {
    return { ok: false, message: '该工具已有会话在运行，请先停止' };
  }
  const def = findTool(tool);
  if (!def?.cmd) return { ok: false, message: '该工具不支持盒内会话' };
  const resolved = await resolveCmd(def.cmd);
  if (!resolved) {
    return { ok: false, message: `未检测到 ${def.cmd} 命令，请先安装` };
  }
  const userEnv = await freshUserEnv();
  // cmd 包装路径下，参数里的双引号会破坏引号配对，替换为单引号
  const needsSanitize = resolved.argsPrefix.length > 0;
  const argFn = AGENT_ARGS[tool] ?? ((p: string) => ['-p', p]);
  const args = [...resolved.argsPrefix, ...argFn(prompt, hasHistory).map((a) => (needsSanitize ? a.replace(/"/g, "'") : a))];
  const child = spawn(resolved.file, args, {
    env: mergeEnv(process.env, userEnv),
    cwd: cwd && cwd.length > 0 ? cwd : os.homedir(),
    windowsHide: true,
  });
  child.stdin.end(); // 管道 stdin 立即 EOF，避免 CLI 等待标准输入
  running.set(tool, child);
  appendLog(`agent start: ${tool}`);

  const absorb = (stream: 'out' | 'err') => (buf: Buffer) => {
    send('agent:output', { tool, stream, chunk: buf.toString('utf8') });
  };
  child.stdout.on('data', absorb('out'));
  child.stderr.on('data', absorb('err'));
  child.on('error', (e) => {
    running.delete(tool);
    send('agent:end', { tool, code: -1, error: e.message });
  });
  child.on('close', (code) => {
    running.delete(tool);
    send('agent:end', { tool, code: code ?? -1 });
    appendLog(`agent end: ${tool} code=${code}`);
  });
  return { ok: true, message: '' };
}

export function agentStop(tool: string): { ok: boolean; message: string } {
  const child = running.get(tool);
  if (!child) return { ok: false, message: '没有运行中的会话' };
  child.kill('SIGTERM');
  setTimeout(() => {
    const c = running.get(tool);
    if (c) c.kill('SIGKILL');
  }, 3000);
  return { ok: true, message: '已发送停止信号' };
}

export function agentRunning(tool: string): boolean {
  return running.has(tool);
}

// 保留对目录的引用（tree-shaking 防误删）
void TOOL_CATALOG;
