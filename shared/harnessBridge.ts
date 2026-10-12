/**
 * DeepSeek Harness 桌面协作（semi）：inbox/outbox 约定
 * 不依赖 electron，可单测。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkItem } from './workflowTypes';

export function inboxDir(repoPath: string): string {
  return path.join(repoPath, '.dsh-inbox');
}

export function outboxDir(repoPath: string): string {
  return path.join(repoPath, '.dsh-outbox');
}

export function writeTaskBrief(repoPath: string, item: WorkItem): string {
  fs.mkdirSync(inboxDir(repoPath), { recursive: true });
  const file = path.join(inboxDir(repoPath), `${item.id}.md`);
  const acc = item.acceptance.map((a) => `- [ ] ${a.text}`).join('\n') || '- [ ] 完成描述中的目标';
  const body = `# ${item.id} ${item.title}

## 类型 / 阶段 / 模块
${item.type} / ${item.phase} / ${item.module}

## 描述
${item.body || '（无）'}

## 验收
${acc}

## 优先级 / 风险
${item.priority} / ${item.risk}

---
由 AI Box 生成，请在 DeepSeek Harness 中完成并把报告写到 \`.dsh-outbox/${item.id}-report.md\`
`;
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

export function writeOutboxReport(
  repoPath: string,
  itemId: string,
  report: { summary: string; verified?: string; risks?: string },
): string {
  fs.mkdirSync(outboxDir(repoPath), { recursive: true });
  const file = path.join(outboxDir(repoPath), `${itemId}-report.md`);
  const md = `# ${itemId} 交付报告

## 摘要
${report.summary}

## 验证
${report.verified || '（未填）'}

## 风险 / 未做
${report.risks || '（无）'}

## 时间
${new Date().toISOString()}
`;
  fs.writeFileSync(file, md, 'utf8');
  return file;
}

/** 读出箱报告（若有） */
export function readOutboxReport(repoPath: string, itemId: string): string | null {
  const file = path.join(outboxDir(repoPath), `${itemId}-report.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

