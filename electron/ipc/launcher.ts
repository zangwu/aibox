import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { shell } from 'electron';
import type { ToolId } from '../../shared/types';
import { TOOL_META, detectTools } from './tools';
import { appendLog } from '../store';

const execFileP = promisify(execFile);

function localAppData(...segs: string[]): string {
  const base = process.env.LOCALAPPDATA;
  return base ? path.join(base, ...segs) : '';
}

/** CLI 已装则解析其命令路径 */
async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('where.exe', [cmd], { windowsHide: true, timeout: 8_000 });
    return stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

async function wtAvailable(): Promise<boolean> {
  return Boolean(await which('wt.exe'));
}

/** 启动 CLI：优先 Windows Terminal 新开窗口，兜底 PowerShell Start-Process 新开 cmd 窗口 */
export async function launchCli(tool: ToolId): Promise<{ ok: boolean; message: string }> {
  const cmd = TOOL_META[tool].cliCmd;
  if (!(await which(cmd))) {
    return { ok: false, message: `未检测到 ${cmd} 命令，请先在盒子中安装` };
  }
  try {
    if (await wtAvailable()) {
      execFile('wt.exe', ['new-tab', 'cmd', '/k', cmd], { windowsHide: false }, (err) => {
        if (err) appendLog(`wt launch failed: ${err.message}`);
      });
    } else {
      // 注意：不要自己拼引号，Start-Process 内部处理参数转义
      const ps = `Start-Process cmd -ArgumentList '/k','${cmd}'`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err) => {
        if (err) appendLog(`start-process launch failed: ${err.message}`);
      });
    }
    appendLog(`launch cli: ${cmd}`);
    return { ok: true, message: `已在终端中启动 ${TOOL_META[tool].name}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog(`launch cli failed: ${cmd} ${msg}`);
    return { ok: false, message: `启动失败：${msg}` };
  }
}

/** 启动桌面版 */
export async function launchDesktop(tool: ToolId): Promise<{ ok: boolean; message: string }> {
  if (tool === 'codex') {
    // 微软商店版：explorer shell:AppsFolder\<PFN>!App
    try {
      const { stdout } = await execFileP(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-AppxPackage -Name *codex* | Select-Object -First 1).PackageFamilyName'],
        { windowsHide: true, timeout: 20_000 },
      );
      const pfn = stdout.trim();
      if (!pfn) return openStorePage('codex');
      execFile('explorer.exe', [`shell:AppsFolder\\${pfn}!App`], { windowsHide: false });
      appendLog(`launch codex desktop: ${pfn}`);
      return { ok: true, message: '已启动 Codex 桌面版' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog(`launch codex desktop failed: ${msg}`);
      return openStorePage('codex');
    }
  }
  if (tool === 'claude-code') {
    const candidates = [
      localAppData('AnthropicClaude', 'claude.exe'),
      path.join(process.env.ProgramFiles ?? '', 'Claude', 'claude.exe'),
    ].filter(Boolean);
    const hit = candidates.find((p) => fs.existsSync(p));
    if (hit) {
      execFile(hit, [], { windowsHide: false, cwd: path.dirname(hit) });
      appendLog(`launch claude desktop: ${hit}`);
      return { ok: true, message: '已启动 Claude Desktop' };
    }
    return openStorePage('claude-code');
  }
  return { ok: false, message: 'Gemini CLI 无桌面版' };
}

/** 重启工具：结束相关进程后重新拉起（桌面版优先，未装桌面版则开新终端跑 CLI） */
const KILL_MAP: Record<ToolId, string[]> = {
  codex: ['ChatGPT.exe', 'codex.exe', 'Codex.exe'],
  'claude-code': ['claude.exe', 'Claude.exe', 'Claude Code.exe'],
  gemini: ['gemini.exe', 'Gemini.exe'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function restartTool(tool: ToolId): Promise<{ ok: boolean; message: string }> {
  for (const img of KILL_MAP[tool]) {
    await execFileP('taskkill.exe', ['/F', '/T', '/IM', img], { windowsHide: true }).catch(() => {});
  }
  await sleep(2000);
  try {
    const tools = await detectTools();
    const info = tools.find((t) => t.id === tool);
    if (info?.desktop.installed) {
      const r = await launchDesktop(tool);
      appendLog(`restart ${tool} (desktop): ${r.message}`);
      return { ok: r.ok, message: r.ok ? `已重启 ${TOOL_META[tool].name} 桌面版` : r.message };
    }
    const r = await launchCli(tool);
    appendLog(`restart ${tool} (cli): ${r.message}`);
    return { ok: r.ok, message: r.ok ? `已重启 ${TOOL_META[tool].name} CLI` : r.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `重启失败：${msg}` };
  }
}

/** 未装 GUI 时拉起商店页 / 下载页 */export async function openStorePage(tool: ToolId): Promise<{ ok: boolean; message: string }> {
  const url =
    tool === 'codex'
      ? // 商店搜索页（产品 id 随商店上架变化，搜索最稳）
        'ms-windows-store://search?query=OpenAI%20Codex'
      : 'https://claude.ai/download';
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
public static class Native {
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
