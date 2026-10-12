import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { shell } from 'electron';
import type { ToolId } from '../../shared/types';
import { findTool } from '../../shared/toolCatalog';
import { detectCatalog } from './tools';
import { loadHeat } from './heat';
import { appendLog } from '../store';

const execFileP = promisify(execFile);

function expand(p: string): string {
  return p
    .replace(/%APPDATA%/gi, process.env.APPDATA ?? '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE ?? '')
    .replace(/%ProgramFiles%/gi, process.env['ProgramFiles'] ?? '');
}

/** CLI 已装则解析其命令路径 */
async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('where.exe', [cmd], { windowsHide: true, timeout: 8_000 });
    const hits = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const rank = (p: string) => (/\.exe$/i.test(p) ? 0 : /\.cmd$/i.test(p) ? 1 : /\.bat$/i.test(p) ? 2 : 3);
    return [...hits].sort((a, b) => rank(a) - rank(b))[0];
  } catch {
    return undefined;
  }
}

async function wtAvailable(): Promise<boolean> {
  return Boolean(await which('wt.exe'));
}

/** 启动 CLI：优先 Windows Terminal 新开窗口，兜底 PowerShell Start-Process 新开 cmd 窗口 */

/** 安全拉起：.cmd/.bat 经 cmd /c，避免 Windows spawn EINVAL */
function spawnSafe(file: string, args: string[] = [], opts: { cwd?: string } = {}): void {
  const wrapped = /\.(cmd|bat)$/i.test(file);
  const exe = wrapped ? 'cmd.exe' : file;
  const argv = wrapped ? ['/d', '/s', '/c', file, ...args] : args;
  execFile(exe, argv, { windowsHide: false, cwd: opts.cwd }, (err) => {
    if (err) appendLog('launch spawn failed: ' + file + ' ' + err.message);
  });
}

export async function launchCli(tool: string): Promise<{ ok: boolean; message: string }> {
  const cmd = findTool(tool)?.cmd ?? tool;
  if (!(await which(cmd))) {
    return { ok: false, message: '未检测到 ' + cmd + ' 命令，请先在盒子中安装' };
  }
  try {
    if (await wtAvailable()) {
      spawnSafe('wt.exe', ['new-tab', 'cmd', '/k', cmd]);
    } else {
      const ps = "Start-Process cmd -ArgumentList '/k','" + cmd + "'";
      spawnSafe('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    }
    appendLog('launch cli: ' + cmd);
    return { ok: true, message: '已在终端中启动 ' + (findTool(tool)?.name ?? tool) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog('launch cli failed: ' + cmd + ' ' + msg);
    return { ok: false, message: '启动失败：' + msg };
  }
}

/** 启动桌面版：目录元数据驱动（商店包 / 本地 exe / VS Code 扩展） */
export async function launchDesktop(tool: string): Promise<{ ok: boolean; message: string }> {
  const def = findTool(tool);
  const d = def?.desktop;
  if (!d) return { ok: false, message: '该工具无桌面版' };

  // 微软商店包
  if (d.appxName) {
    try {
      const { stdout } = await execFileP(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-AppxPackage -Name ${d.appxName} | Select-Object -First 1).PackageFamilyName`],
        { windowsHide: true, timeout: 20_000 },
      );
      const pfn = stdout.trim();
      if (pfn) {
        spawnSafe('explorer.exe', ['shell:AppsFolder\\' + pfn + '!App']);
        appendLog(`launch ${tool} desktop store: ${pfn}`);
        return { ok: true, message: `已启动 ${d.name}` };
      }
    } catch (e) {
      appendLog(`launch ${tool} desktop store failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 本地 exe 候选
  if (d.pathCandidates) {
    for (const raw of d.pathCandidates) {
      const p = expand(raw);
      if (!p.includes('*') && fs.existsSync(p)) {
        spawnSafe(p, [], { cwd: path.dirname(p) });
        appendLog(`launch ${tool} desktop: ${p}`);
        return { ok: true, message: `已启动 ${d.name}` };
      }
    }
  }

  // VS Code 扩展：拉起 VS Code（装了扩展即可用）
  if (d.channel === 'vscode') {
    const vs = await which('code');
    if (vs) {
      spawnSafe(vs);
      appendLog(`launch ${tool} desktop via vscode: ${vs}`);
      return { ok: true, message: `已启动 VS Code（${d.name}）` };
    }
  }

  return openStorePage(tool);
}

/** 重启工具：结束相关进程后重新拉起（桌面版优先，未装桌面版则开新终端跑 CLI） */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function restartTool(tool: string): Promise<{ ok: boolean; message: string }> {
  const def = findTool(tool);
  const images = new Set<string>([...(def?.desktop?.processNames ?? [])]);
  if (def?.cmd) {
    images.add(def.cmd + '.exe');
    images.add(def.cmd + '.cmd');
  }
  // 兼容旧硬编码
  if (tool === 'codex') ['ChatGPT.exe', 'codex.exe', 'Codex.exe'].forEach((x) => images.add(x));
  if (tool === 'claude-code') ['claude.exe', 'Claude.exe', 'Claude Code.exe'].forEach((x) => images.add(x));

  for (const img of images) {
    await execFileP('taskkill.exe', ['/F', '/T', '/IM', img], { windowsHide: true }).catch(() => {});
  }
  await sleep(2000);
  try {
    const tools = await detectCatalog(loadHeat());
    const info = tools.find((t) => t.id === tool);
    if (info?.desktop?.installed) {
      const r = await launchDesktop(tool);
      appendLog(`restart ${tool} (desktop): ${r.message}`);
      return { ok: r.ok, message: r.ok ? `已重启 ${findTool(tool)?.name ?? tool} 桌面版` : r.message };
    }
    const r = await launchCli(tool);
    appendLog(`restart ${tool} (cli): ${r.message}`);
    return { ok: r.ok, message: r.ok ? `已重启 ${findTool(tool)?.name ?? tool} CLI` : r.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `重启失败：${msg}` };
  }
}

/** 未装 GUI 时拉起商店页 / 下载页 */
export async function openStorePage(tool: string): Promise<{ ok: boolean; message: string }> {
  const d = findTool(tool)?.desktop;
  const url =
    d?.storeUrl ??
    (tool === 'codex'
      ? 'ms-windows-store://search?query=OpenAI%20Codex'
      : tool === 'claude-code'
        ? 'https://claude.ai/download'
        : findTool(tool)?.website ?? '');
  if (!url) return { ok: false, message: '未配置下载页' };
  try {
    await shell.openExternal(url);
    appendLog(`open store page: ${tool} -> ${url}`);
    return { ok: true, message: '已打开商店/下载页，安装后盒子会自动接管其配置' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `打开失败：${msg}` };
  }
}

/**
 * 向所有顶层窗口广播 WM_SETTINGCHANGE，
 * 提示已运行进程刷新用户环境变量（对不响应广播的进程仍无效，需重启该进程）。
 */
export async function broadcastEnvChange(): Promise<{ ok: boolean; message: string }> {
  const ps = `
Add-Type -Namespace Aibox -Name Native -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public class Native {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
}
"@
[UIntPtr]::Zero -eq [UIntPtr]::Zero | Out-Null
$result = [UIntPtr]::Zero
[Aibox.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
'ok'
`;
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      timeout: 30_000,
    });
    appendLog(`broadcast env change: ${stdout.trim()}`);
    return { ok: true, message: '已向系统广播环境变量变更；未响应的程序仍需手动重启' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog(`broadcast env change failed: ${msg}`);
    return { ok: false, message: `广播失败：${msg}` };
  }
}
