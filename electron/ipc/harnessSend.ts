/**
 * 发送到 DeepSeek Harness 桌面端（P0）
 * ① 登记工作区到 ~/.dsh/storages/workspace.json
 * ② 生成简报 + 剪贴板
 * ③ 启动/激活 Harness
 * ④ 点输入区 → 粘贴 → 发送（失败则回退「已复制」）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkItem } from '../../shared/workflowTypes';
import { writeTaskBrief } from '../../shared/harnessBridge';

const execFileP = promisify(execFile);

export interface SendHarnessResult {
  ok: boolean;
  message: string;
  promptPath?: string;
  autoSent: boolean;
  workspace: string;
  workspaceRegistered?: boolean;
}

function harnessExe(): string | null {
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    'D:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function dshRoot(): string {
  return path.join(os.homedir(), '.dsh');
}

function workspaceJsonPath(): string {
  return path.join(dshRoot(), 'storages', 'workspace.json');
}

function encodeWorkspaceDirName(absPath: string): string {
  // D:\_Lives\Projects\foo → --D-_Lives-_Projects-foo--
  return (
    '--' +
    absPath.replace(/^[A-Za-z]:/, (d) => d).replace(/[\\/:]/g, '-').replace(/^-/, '') +
    '--'
  ).replace(/-+/g, '-');
}

/** 把项目路径登记进 Harness 工作区表（并设为默认） */
export function ensureHarnessWorkspace(absPath: string): { ok: boolean; id: string; created: boolean } {
  const p = workspaceJsonPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let data: {
    unit?: unknown;
    global: {
      initialized?: boolean;
      defaultWorkspaceId?: string;
      workspaceIds: string[];
      archivedSessionIds?: string[];
      pinnedSessionIds?: string[];
    };
    tables: {
      workspaces: Record<
        string,
        {
          path: string;
          title: string;
          sessionIds: string[];
          createdAt: string;
          updatedAt: string;
        }
      >;
    };
  };
  try {
    data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null!;
    if (!data?.global) throw new Error('empty');
  } catch {
    data = {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: {} },
    };
  }
  const norm = path.resolve(absPath);
  // 已存在则只设默认
  for (const [id, row] of Object.entries(data.tables.workspaces)) {
    if (path.resolve(row.path) === norm) {
      data.global.defaultWorkspaceId = id;
      row.updatedAt = new Date().toISOString();
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true, id, created: false };
    }
  }
  const id = crypto.randomUUID();
  const title = path.basename(norm) || 'workspace';
  data.tables.workspaces[id] = {
    path: norm,
    title,
    sessionIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!data.global.workspaceIds.includes(id)) data.global.workspaceIds.unshift(id);
  data.global.defaultWorkspaceId = id;
  data.global.initialized = true;
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  // 会话目录约定
  const sessRoot = path.join(dshRoot(), 'sessions');
  fs.mkdirSync(path.join(sessRoot, encodeWorkspaceDirName(norm)), { recursive: true });
  return { ok: true, id, created: true };
}

export function buildSendPrompt(item: WorkItem): string {
  const acc = item.acceptance.map((a, i) => `${i + 1}. ${a.text}`).join('\n') || '1. 完成描述中的目标';
  return `# 任务 ${item.id} ${item.title}

模块：${item.module} · 阶段：${item.phase} · 优先级：${item.priority}

## 描述
${item.body || '（无）'}

## 验收
${acc}

## 约定
- 在当前工作区（仓库根）完成
- 改完后写 \`.dsh-outbox/${item.id}-report.md\`
- 用中文简要说明改动与验证
- 不要改动无关文件
请直接开始处理本任务。
`;
}

/**
 * 激活 Harness → 点输入区 → 粘贴 → 发送；窗口未就绪时最多重试 8 次
 */
async function activateAndPasteSend(): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const ok = await onePasteAttempt();
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function onePasteAttempt(): Promise<boolean> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,int x,int y,uint d,IntPtr e);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$procs = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
$p = $procs | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $p) { exit 2 }
[W]::ShowWindow($p.MainWindowHandle, 3) | Out-Null
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
# 尽量开新对话（若客户端支持）
try { [System.Windows.Forms.SendKeys]::SendWait("^n"); Start-Sleep -Milliseconds 600 } catch {}
$rect = New-Object W+RECT
[W]::GetWindowRect($p.MainWindowHandle, [ref]$rect) | Out-Null
$cx = [int](($rect.Left + $rect.Right) / 2)
$cy = [int]($rect.Top + ($rect.Bottom - $rect.Top) * 0.80)
[W]::SetCursorPos($cx, $cy)
Start-Sleep -Milliseconds 150
[W]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[W]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Start-Sleep -Milliseconds 350
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
exit 0
`;
  return execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    windowsHide: true,
    timeout: 30_000,
  })
    .then(() => true)
    .catch(() => false);
}

/** 调用 Python 在 Harness 工作区创建会话并注入首条消息 */
export async function createHarnessSession(
  workspace: string,
  prompt: string,
): Promise<{ ok: boolean; sessionId?: string; message: string; path?: string }> {
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'harness_create_session.py');
  // 打包后 __dirname 在 app.asar，脚本改为多路径探测
  const candidates = [
    path.join(__dirname, '..', 'assets', 'harness_create_session.py'),
    path.join(process.cwd(), 'electron', 'assets', 'harness_create_session.py'),
    path.join(process.cwd(), 'scripts', 'harness_create_session.py'),
    path.join(__dirname, '../../../scripts/harness_create_session.py'),
    'D:\\_Lives\\_Projects\\aibox\\scripts\\harness_create_session.py',
  ];
  const py = candidates.find((p) => fs.existsSync(p));
  if (!py) return { ok: false, message: '未找到 harness_create_session.py' };
  const tmp = path.join(os.tmpdir(), `aibox-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmp, prompt, 'utf8');
  const pyExe =
    'C:\\Users\\admin\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';
  try {
    const { stdout } = await execFileP(
      fs.existsSync(pyExe) ? pyExe : 'python',
      [py, workspace, tmp],
      { windowsHide: true, timeout: 20_000 },
    );
    const line = stdout.trim().split(/\r?\n/).pop() ?? '{}';
    const j = JSON.parse(line) as { ok: boolean; sessionId: string; path: string };
    return { ok: true, sessionId: j.sessionId, path: j.path, message: '已创建 Harness 会话 ' + j.sessionId };
  } catch (e) {
    return { ok: false, message: '创建会话失败: ' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** 调用 CDP 在 Harness 中选工作区、新会话并发送 */
export async function cdpSendToHarness(
  workspaceTitle: string,
  prompt: string,
  workspace: string,
): Promise<{ ok: boolean; message: string }> {
  const scriptCandidates = [
    path.join(__dirname, '..', 'assets', 'harness_cdp_send.py'),
    path.join(process.cwd(), 'scripts', 'harness_cdp_send.py'),
    path.join(process.cwd(), 'electron', 'assets', 'harness_cdp_send.py'),
    'D:\\_Lives\\_Projects\\aibox\\scripts\\harness_cdp_send.py',
    'D:\\_Lives\\_Projects\\aibox\\electron\\assets\\harness_cdp_send.py',
  ];
  const script = scriptCandidates.find((p) => fs.existsSync(p));
  if (!script) return { ok: false, message: '未找到 harness_cdp_send.py' };
  const tmp = path.join(os.tmpdir(), `aibox-cdp-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmp, prompt, 'utf8');
  const pyExe = 'C:\\Users\\admin\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';
  try {
    const { stdout } = await execFileP(
      fs.existsSync(pyExe) ? pyExe : 'python',
      [script, workspaceTitle, tmp, '9333'],
      { windowsHide: true, timeout: 40_000, cwd: workspace },
    );
    const line = stdout.trim().split(/\r?\n/).pop() ?? '{}';
    const j = JSON.parse(line) as { ok: boolean; sent?: boolean; preview?: string };
    return {
      ok: Boolean(j.ok),
      message: j.ok
        ? `已发送到 Harness 工作区「${workspaceTitle}」${j.sent ? '' : '（已插入文本）'}`
        : 'CDP 发送失败',
    };
  } catch (e) {
    return { ok: false, message: 'CDP 发送异常: ' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export async function sendToHarness(opts: {
  item: WorkItem;
  workspace: string;
  clipboard: (text: string) => Promise<void> | void;
  launch: (workspace: string) => Promise<{ ok: boolean; message: string }>;
  tryAutoPaste?: boolean;
}): Promise<SendHarnessResult> {
  const { item, workspace } = opts;
  const ws = path.resolve(workspace);
  if (!fs.existsSync(ws)) {
    return {
      ok: false,
      message: '工作区目录不存在，未自动发送。请先新建项目并选择本地目录',
      autoSent: false,
      workspace: ws,
    };
  }

  const reg = ensureHarnessWorkspace(ws);
  const prompt = buildSendPrompt(item);
  const promptPath = writeTaskBrief(ws, item);
  fs.writeFileSync(path.join(path.dirname(promptPath), `${item.id}-prompt.md`), prompt, 'utf8');
  await opts.clipboard(prompt);
  const sess = await createHarnessSession(ws, prompt);

  const title = path.basename(ws);
  // 已开客户端：直接 CDP 发送，不重启
  let cdp = await cdpSendToHarness(title, prompt, ws);
  if (!cdp.ok) {
    const launched = await opts.launch(ws);
    if (!launched.ok) {
      return {
        ok: false,
        message: `已复制简报，启动 Harness 失败：${launched.message}`,
        promptPath,
        autoSent: false,
        workspace: ws,
        workspaceRegistered: reg.ok,
      };
    }
    await new Promise((r) => setTimeout(r, 3500));
    cdp = await cdpSendToHarness(title, prompt, ws);
  }
  return {
    ok: true,
    message: cdp.ok
      ? cdp.message
      : `已打开 Harness 并复制简报；CDP 未发送成功，请粘贴（${promptPath}）`,
    promptPath,
    autoSent: cdp.ok,
    workspace: ws,
    workspaceRegistered: reg.ok,
  };
}


/** dsh headless 全自动：优先用预设市场里 DeepSeek 的 savedKey */
export async function harnessHeadless(itemId: string): Promise<{ ok: boolean; message: string }> {
  const { getItem, listProjects } = await import('./workflow');
  const { allPresets } = await import('../store');
  const item = getItem(itemId);
  if (!item) return { ok: false, message: '工作项不存在' };
  const proj = listProjects().find((p) => p.id === item.projectId);
  const cwd = proj?.repoPath || proj?.harnessWorkspace;
  if (!cwd) return { ok: false, message: '项目未配置目录' };

  // 预设联动：DeepSeek / deepseek 命名，或 supports 含 deepseek
  const presets = allPresets();
  const hit =
    presets.find((p) => p.savedKey && /deepseek/i.test(p.id + p.name)) ||
    presets.find((p) => p.savedKey && (p.supports || []).includes('deepseek' as never)) ||
    presets.find((p) => p.savedKey && /deepseek/i.test(p.baseUrl || ''));
  const apiKey = hit?.savedKey;

  const dsh =
    'D:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd';
  const prompt = buildSendPrompt(item);
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  if (apiKey) {
    env.DEESEEK_API_KEY = apiKey;
    env.DEEPSEEK_API_KEY = apiKey;
  }
  try {
    const { stdout, stderr } = await execFileP(dsh, ['headless', prompt], {
      cwd,
      windowsHide: true,
      timeout: 300_000,
      env,
    });
    const out = (stdout || stderr || '').slice(0, 600);
    return {
      ok: true,
      message: 'dsh headless 完成' + (apiKey ? `（已注入预设「${hit!.name}」的 key）` : '（未用预设 key）') + '：' + out,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: apiKey
        ? 'dsh headless 失败：' + msg.slice(0, 280)
        : '未找到 DeepSeek 预设 key，请到预设市场保存 key 后重试。' + msg.slice(0, 180),
    };
  }
}
