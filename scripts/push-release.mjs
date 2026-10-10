/**
 * 发布新版本到 Gitee Releases（供自动更新拉取）。
 * 前置：仓库已存在名为 latest 的 git 标签（只需一次：git tag -f latest && git push -f gitee latest）。
 *
 * 用法：
 *   npm run dist
 *   $env:GITEE_TOKEN='<私人令牌>'; $env:GITEE_OWNER='<你的gitee用户名>'; node scripts/push-release.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const OWNER = process.env.GITEE_OWNER;
const TOKEN = process.env.GITEE_TOKEN;
const REPO = process.env.GITEE_REPO ?? 'aibox';
const TAG = process.env.GITEE_TAG ?? 'latest';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

if (!OWNER || !TOKEN) {
  console.error('缺少环境变量 GITEE_TOKEN / GITEE_OWNER');
  process.exit(1);
}

const FILES = ['latest.yml', 'aibox-setup.exe', 'aibox-setup.exe.blockmap'].map((f) => path.join(ROOT, 'release', f));
for (const f of FILES) {
  if (!fs.existsSync(f)) {
    console.error(`缺少产物：${f}（请先 npm run dist）`);
    process.exit(1);
  }
}

const api = (p) => `https://gitee.com/api/v5/repos/${OWNER}/${REPO}${p}`;
const qs = `access_token=${encodeURIComponent(TOKEN)}`;

async function j(method, p, body) {
  const r = await fetch(`${api(p)}?${qs}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    throw new Error(`${method} ${p} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function upload(releaseId, file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await fetch(`${api(`/releases/${releaseId}/attach_files`)}?${qs}`, { method: 'POST', body: form });
  const text = await r.text();
  if (!r.ok) throw new Error(`上传 ${path.basename(file)} 失败 HTTP ${r.status}: ${text.slice(0, 300)}`);
  console.log(`  ✓ ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1e6)}MB)`);
}

console.log(`发布 AI Box v${VERSION} → gitee.com/${OWNER}/${REPO} @ ${TAG}`);

// 1) 找旧 release 并删除
const releases = await j('GET', '/releases');
const old = (releases ?? []).find((r) => r.tag_name === TAG);
if (old) {
  await j('DELETE', `/releases/${old.id}`);
  console.log(`已删除旧 release #${old.id}`);
}

// 2) 创建新 release
const rel = await j('POST', '/releases', {
  tag_name: TAG,
  name: `AI Box v${VERSION}`,
  body: `自动更新发布（latest 标签）。版本：v${VERSION}。`,
});
console.log(`已创建 release #${rel.id}`);

// 3) 上传附件
for (const f of FILES) await upload(rel.id, f);

console.log(`完成。更新源地址：https://gitee.com/${OWNER}/${REPO}/releases/download/${TAG}/latest.yml`);
