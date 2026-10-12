import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canMove, isStatusAllowed } from '../shared/workflowState';
import {
  acquireLock,
  addComment,
  confirmBaseline,
  createItem,
  createProject,
  getLock,
  getItem,
  listItems,
  projectFile,
  releaseLock,
  resetWorkflowCache,
  setGate,
  transition,
  upsertModule,
} from '../electron/ipc/workflow';

describe('workflow 状态机', () => {
  it('非法迁移被拒', () => {
    expect(canMove('discovery', 'draft', 'doing').ok).toBe(false);
    expect(canMove('dev', 'open', 'doing').ok).toBe(true);
    expect(isStatusAllowed('done', 'done')).toBe(true);
  });
});

describe('workflow 项目目录存储', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aibox-wf-'));
    process.env.AIBOX_DATA_DIR = root;
    resetWorkflowCache();
  });

  afterEach(() => {
    resetWorkflowCache();
  });

  it('新建项目生成目录与 .aibox/workflow.json', () => {
    const repo = path.join(root, 'proj-demo');
    const p = createProject({ name: 'Demo', repoPath: repo });
    expect(p.id).toBe('PRJ-1');
    expect(fs.existsSync(path.join(repo, 'README.md'))).toBe(true);
    expect(fs.existsSync(projectFile(repo))).toBe(true);
    upsertModule(p.id, { id: 'docs', title: '文档' });
    const item = createItem({
      projectId: p.id,
      type: 'task',
      title: '创建目录文档',
      module: 'docs',
      priority: 'P2',
      phase: 'dev',
    });
    expect(item.id).toBe('WF-1');
    const raw = JSON.parse(fs.readFileSync(projectFile(repo), 'utf8'));
    expect(raw.items).toHaveLength(1);
    expect(raw.project.modules.some((m: { id: string }) => m.id === 'docs')).toBe(true);
  });

  it('人 accept 关单 + 锁', () => {
    const repo = path.join(root, 'p2');
    const p = createProject({ name: 'P2', repoPath: repo });
    upsertModule(p.id, { id: 'm', title: 'M' });
    const it = createItem({
      projectId: p.id,
      type: 'feature',
      title: 't',
      module: 'm',
      priority: 'P1',
      phase: 'dev',
    });
    transition(it.id, 'doing');
    transition(it.id, 'review');
    addComment(it.id, { author: 'human', body: 'ok', kind: 'accept' });
    expect(getItem(it.id)!.status).toBe('done');
    expect(acquireLock(p.id, it.id)).toBe(true);
    expect(acquireLock(p.id, 'WF-99')).toBe(false);
    releaseLock(p.id, it.id);
    expect(getLock(p.id)).toBe('idle');
  });

  it('缺目录创建项目失败', () => {
    expect(() => createProject({ name: 'x' })).toThrow(/目录/);
  });

  it('基线写在项目文件', () => {
    const repo = path.join(root, 'p3');
    const p = createProject({ name: 'P3', repoPath: repo });
    const b = confirmBaseline({ projectId: p.id, title: 'PRD', bodyMd: '# 需求' });
    expect(b.hash).toBeTruthy();
    const raw = JSON.parse(fs.readFileSync(projectFile(repo), 'utf8'));
    expect(raw.baselines).toHaveLength(1);
    void listItems;
    void setGate;
  });
});
