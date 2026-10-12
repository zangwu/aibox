import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import type { InstallProgress, ToolId } from '../../shared/types';
import { findTool } from '../../shared/toolCatalog';
import { appendLog, dataDir, loadConfig, saveConfig } from '../store';

const execFileP = promisify(execFile);

/** 便携 Node 版本（LTS） */
const PORTABLE_NODE_VERSION = 'v22.14.0';
const NODE_ZIP = `node-${PORTABLE_NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/${PORTABLE_NODE_VERSION}/${NODE_ZIP}`;

export async function detectSystemNode(): Promise<{ ok: boolean; version?: string }> {
  try {
    const { stdout } = await execFileP('node.exe', ['--version'], { windowsHide: true, timeout: 8_000 });
    return { ok: true, version: stdout.trim() };
  } catch {
    return { ok: false };
  }
}

function portableDir(): string {
  return path.join(dataDir(), 'portable-node');
}

function portableNodeBin(): { npm: string; node: string; root: string } | null {
  const cfg = loadConfig();
  if (!cfg.portableNode) return null;
  const root = cfg.portableNode.path;
  const npm = path.join(root, 'npm.cmd');
  const node = path.join(root, 'node.exe');
  return fs.existsSync(node) && fs.existsSync(npm) ? { npm, node, root } : null;
}

export function getPortableNodeStatus(): { installed: boolean; version?: string; path?: string } {
  const bin = portableNodeBin();
  const cfg = loadConfig();
  return bin
    ? { installed: true, version: cfg.portableNode?.version, path: cfg.portableNode?.path }
    : { installed: false };
}

function download(url: string, dest: string, onPercent?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string, redirects = 0) => {
      https
        .get(u, { headers: { 'user-agent': 'aibox' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects > 5) return reject(new Error('重定向过多'));
            res.resume();
            return doGet(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length'] ?? 0);
          let got = 0;
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk: Buffer) => {
            got += chunk.length;
            if (total > 0 && onPercent) onPercent(Math.min(99, Math.round((got / total) * 100)));
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve()));
          out.on('error', reject);
        })
        .on('error', reject);
    };
    doGet(url);
  });
}

/** 下载并解压便携 Node 到 %APPDATA%/aibox/portable-node */
export async function setupPortableNode(
  onProgress?: (p: Omit<InstallProgress, 'tool'>) => void,
): Promise<{ ok: boolean; message: string }> {
  const existing = portableNodeBin();
  if (existing) return { ok: true, message: `便携 Node 已就绪：${loadConfig().portableNode?.version}` };

  const dir = portableDir();
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, NODE_ZIP);
  try {
    onProgress?.({ stage: 'download-node', percent: 0, message: `下载 Node.js ${PORTABLE_NODE_VERSION} …` });
    await download(NODE_URL, zip, (p) => onProgress?.({ stage: 'download-node', percent: p, message: `下载 Node.js ${PORTABLE_NODE_VERSION} ${p}%` }));
    onProgress?.({ stage: 'extract-node', message: '解压便携 Node …' });
    await execFileP('tar.exe', ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 120_000 });
    fs.rmSync(zip, { force: true });
    const root = path.join(dir, `node-${PORTABLE_NODE_VERSION}-win-x64`);
    if (!fs.existsSync(path.join(root, 'node.exe'))) throw new Error('解压后未找到 node.exe');
    const cfg = loadConfig();
    cfg.portableNode = { version: PORTABLE_NODE_VERSION, path: root, downloadedAt: Date.now() };
    saveConfig(cfg);
    appendLog(`portable node ready: ${root}`);
    return { ok: true, message: `便携 Node ${PORTABLE_NODE_VERSION} 就绪` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog(`portable node setup failed: ${msg}`);
    fs.rmSync(zip, { force: true });
    return { ok: false, message: `便携 Node 安装失败：${msg}（可检查网络后重试，或手动安装 Node.js）` };
  }
}

async function pickNpm(
  tool: ToolId,
  onProgress: (p: InstallProgress) => void,
): Promise<{ npm: string; via: 'system' | 'portable' } | { error: string }> {
  onProgress({ tool, stage: 'check-node', message: '探测系统 Node.js …' });
  const sys = await detectSystemNode();
  if (sys.ok) return { npm: 'npm.cmd', via: 'system' };

  onProgress({ tool, stage: 'check-node', message: '未检测到系统 Node.js，准备便携 Node …' });
  const portable = portableNodeBin();
  if (portable) return { npm: portable.npm, via: 'portable' };

  const r = await setupPortableNode((p) => onProgress({ tool, ...p }));
  if (!r.ok) return { error: r.message };
  const bin = portableNodeBin();
  return bin ? { npm: bin.npm, via: 'portable' } : { error: '便携 Node 准备后仍不可用' };
}

/** 静默全局安装 CLI，全程推送进度事件 */
export async function installCli(
  tool: ToolId,
  onProgress: (p: InstallProgress) => void,
): Promise<{ ok: boolean; message: string }> {
  const meta = findTool(tool);
  if (!meta?.npmPackage) return { ok: false, message: '该工具没有可用的 npm 包' };
  const npm = await pickNpm(tool, onProgress);
  if ('error' in npm) {
    onProgress({ tool, stage: 'error', message: npm.error });
    return { ok: false, message: npm.error };
  }

  const args = ['install', '-g', '--no-audit', '--no-fund', meta.npmPackage];
  onProgress({ tool, stage: 'npm-install', message: `${npm.via === 'portable' ? '便携 Node' : '系统 Node'} 安装 ${meta.npmPackage} …` });
  appendLog(`npm install -g ${meta.npmPackage} (via ${npm.via})`);

  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', npm.npm, ...args], {
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let tail = '';
    const absorb = (buf: Buffer) => {
      tail = (tail + buf.toString()).split(/\r?\n/).slice(-3).join(' ');
      onProgress({ tool, stage: 'npm-install', message: tail.slice(0, 200) });
    };
    child.stdout.on('data', absorb);
    child.stderr.on('data', absorb);
    child.on('error', (e) => {
      onProgress({ tool, stage: 'error', message: e.message });
      resolve({ ok: false, message: `npm 启动失败：${e.message}` });
    });
    child.on('close', async (code) => {
      if (code !== 0) {
        onProgress({ tool, stage: 'error', message: `npm 退出码 ${code}` });
        appendLog(`npm install failed for ${meta.npmPackage}: exit ${code}`);
        return resolve({ ok: false, message: `安装失败（npm 退出码 ${code}）。常见原因：网络受限、需以管理员身份运行一次。` });
      }
      onProgress({ tool, stage: 'verify', message: '校验安装结果 …' });
      try {
        await execFileP('where.exe', [meta.cmd ?? ''], { windowsHide: true, timeout: 10_000 });
        onProgress({ tool, stage: 'done', message: `${meta.name} 安装完成` });
        appendLog(`installed ${meta.npmPackage}`);
        resolve({ ok: true, message: `${meta.name} CLI 安装完成` });
      } catch {
        onProgress({ tool, stage: 'error', message: '安装后仍未在 PATH 中找到命令' });
        resolve({ ok: false, message: 'npm 报告成功，但命令未进入 PATH；请重启盒子后重试' });
      }
    });
  });
}

/** 从本机卸载工具（npm 全局包优先；桌面版引导系统卸载） */
/** 从本机卸载工具（先杀进程再 npm 卸载，避免文件占用失败） */
export async function uninstallCli(tool: string): Promise<{ ok: boolean; message: string }> {
  appendLog('uninstallCli enter ' + tool);
  const meta = findTool(tool);
  if (!meta) return { ok: false, message: '未知工具' };

  const notes: string[] = [];
  let removed = false;

  // 先杀残留进程，否则 Windows 上 npm 可能因文件占用卸载失败
  const images = new Set<string>([...(meta.desktop?.processNames ?? [])]);
  if (meta.cmd) {
    images.add(meta.cmd + '.exe');
    images.add(meta.cmd + '.cmd');
    images.add(meta.cmd + '-windows-sandbox-service.exe');
  }
  if (tool === 'codex') {
    for (const x of ['ChatGPT.exe', 'codex.exe', 'Codex.exe', 'codex-windows-sandbox-service.exe']) {
      images.add(x);
    }
  }
  for (const img of images) {
    await execFileP('taskkill.exe', ['/F', '/T', '/IM', img], { windowsHide: true }).catch(() => {});
  }
  // 兜底：按名字模糊结束（含 sandbox-service 等）
  // 模糊进程名兜底（仅 taskkill，避免 PowerShell Stop-Process 误杀）
  const blur = (meta.cmd ?? tool).replace(/[^a-z0-9_-]/gi, '');
  if (blur) {
    await execFileP('taskkill.exe', ['/F', '/T', '/IM', blur + '.exe'], { windowsHide: true }).catch(() => {});
    await execFileP('taskkill.exe', ['/F', '/T', '/IM', blur + '-windows-sandbox-service.exe'], { windowsHide: true }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 1200));

  if (meta.npmPackage) {
    const npm = await pickNpm(tool as ToolId, () => {});
    if (!('error' in npm)) {
      const args = ['uninstall', '-g', '--no-audit', '--no-fund', meta.npmPackage];
      appendLog('npm uninstall -g ' + meta.npmPackage);
      // Windows 上 spawn(.cmd) 可能 EINVAL；卸载用 execFile 更稳
      // Windows 对 npm.cmd 直接 spawn/execFile 可能 EINVAL，统一走 cmd /c
      const code = await execFileP('cmd.exe', ['/d', '/s', '/c', npm.npm, ...args], {
        windowsHide: true,
        timeout: 120_000,
        env: { ...process.env, NO_COLOR: '1' },
      })
        .then(() => 0)
        .catch((e: unknown) => {
          appendLog('uninstall exec error: ' + (e instanceof Error ? e.message : String(e)));
          return 1;
        });
      const still = await execFileP('where.exe', [meta.cmd ?? meta.npmPackage], { windowsHide: true, timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (code === 0 && !still) {
        removed = true;
        notes.push('已卸载 npm 包 ' + meta.npmPackage);
      } else if (code === 0 && still) {
        notes.push('npm 报告卸载成功，但 ' + meta.cmd + ' 仍在 PATH');
      } else {
        notes.push('npm 卸载 ' + meta.npmPackage + ' 失败（退出码 ' + code + '）');
      }
    } else {
      notes.push('未找到可用 npm，无法卸载 ' + meta.npmPackage);
    }
  }

  if (meta.desktop) {
    try {
      await execFileP('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process appwiz.cpl',
      ], { windowsHide: true, timeout: 10_000 });
      notes.push('桌面端「' + meta.desktop.name + '」请在系统卸载程序中移除');
    } catch {
      notes.push('请手动卸载桌面端「' + meta.desktop.name + '」');
    }
  }

  if (removed || notes.length) {
    appendLog('uninstall ' + tool + ': ' + notes.join('; '));
    return { ok: removed, message: notes.join('；') || '已处理' };
  }
  return { ok: false, message: '该工具没有可卸载的 npm 包' };
}
