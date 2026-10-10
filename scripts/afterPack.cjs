/**
 * electron-builder afterPack 钩子（模块路径形式引用）：
 * exe 刚落盘时可能被安全软件短暂锁定，这里以带间隔的重试循环
 * 执行 rcedit（版本信息 + 图标），直至成功或超时（约 4 分钟）。
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const VERSION_4PART = `${APP_VERSION}.0`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findRcedit() {
  const dir = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(dir)) return null;
  for (const sub of fs.readdirSync(dir)) {
    const candidate = path.join(dir, sub, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = async function editExecutable(context) {
  if (context.electronPlatformName !== 'windows' && context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, 'AI Box.exe');
  const rcedit = findRcedit();
  if (!rcedit) throw new Error('未找到 rcedit-x64.exe');
  const icon = path.join(context.appOutDir, '..', '..', 'build', 'icon.ico');
  const args = [
    exe,
    '--set-version-string', 'FileDescription', '本地 AI 工具管理盒子：聚合中转站预设，一键写入 Codex / Claude Code / Gemini CLI 配置',
    '--set-version-string', 'ProductName', 'AI Box',
    '--set-version-string', 'LegalCopyright', 'Copyright © 2026 AI Box',
    '--set-file-version', APP_VERSION,
    '--set-product-version', VERSION_4PART,
    '--set-version-string', 'InternalName', 'AI Box',
    '--set-icon', icon,
  ];
  await sleep(15_000); // 先让安全软件完成初次扫描
  let lastErr = '';
  for (let i = 1; i <= 16; i++) {
    const code = await new Promise((resolve) => {
      execFile(rcedit, args, { timeout: 120_000, windowsHide: true }, (err, _out, stderr) => {
        if (err) lastErr = String(stderr || err.message);
        resolve(err ? 1 : 0);
      });
    });
    if (code === 0) {
      console.log(`[afterPack] rcedit 成功（第 ${i} 次尝试）`);
      return;
    }
    console.log(`[afterPack] rcedit 第 ${i} 次失败：${lastErr}，15s 后重试`);
    await sleep(15_000);
  }
  throw new Error(`rcedit 多次重试仍失败：${lastErr}`);
};
