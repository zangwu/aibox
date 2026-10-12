/**
 * 研发工作流存储
 * - 项目登记册：%APPDATA%/aibox/workflow/catalog.json（仅 id/name/repoPath）
 * - 项目数据： <repoPath>/.aibox/workflow.json（items/baselines/locks/settings）
 * 与项目相关的看板数据一律在项目目录下，便于备份/同步。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canMove, isStatusAllowed } from '../../shared/workflowState';
import { writeTaskBrief } from '../../shared/harnessBridge';
import type {
  GateId,
  RequirementBaseline,
  WorkItem,
  WorkItemComment,
  WorkItemPhase,
  WorkItemStatus,
  WorkflowModule,
  WorkflowProject,
  WorkflowSettings,
} from '../../shared/workflowTypes';

export interface ProjectFile {
  project: Pick<WorkflowProject, 'name' | 'repoPath' | 'harnessWorkspace' | 'version' | 'modules' | 'settings'>;
  items: WorkItem[];
  baselines: RequirementBaseline[];
  locks: Record<string, string | 'idle'>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  repoPath: string;
}

const DEFAULT_SETTINGS: WorkflowSettings = {
  acceptDev: false,
  acceptTest: true,
  requireHumanFinalAccept: true,
  maxAutoIterations: 8,
  budgetMinutes: 60,
  lockWorkspace: true,
};

function appDataRoot(): string {
  return (
    process.env.AIBOX_DATA_DIR ??
    path.join(process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'), 'aibox')
  );
}

export function catalogPath(): string {
  return path.join(appDataRoot(), 'workflow', 'catalog.json');
}

export function projectFile(repoPath: string): string {
  return path.join(repoPath, '.aibox', 'workflow.json');
}

let catalogCache: CatalogEntry[] | null = null;
const projCache = new Map<string, ProjectFile>();

export function loadCatalog(): CatalogEntry[] {
  if (catalogCache) return catalogCache;
  try {
    if (fs.existsSync(catalogPath())) {
      catalogCache = JSON.parse(fs.readFileSync(catalogPath(), 'utf8')) as CatalogEntry[];
    } else {
      catalogCache = [];
    }
  } catch {
    catalogCache = [];
  }
  return catalogCache;
}

function saveCatalog(list: CatalogEntry[]): void {
  fs.mkdirSync(path.dirname(catalogPath()), { recursive: true });
  fs.writeFileSync(catalogPath(), JSON.stringify(list, null, 2), 'utf8');
  catalogCache = list;
}

function emptyProjectFile(name: string, repoPath: string): ProjectFile {
  return {
    project: {
      name,
      repoPath,
      harnessWorkspace: repoPath,
      version: '0.1.0',
      modules: [],
      settings: { ...DEFAULT_SETTINGS },
    },
    items: [],
    baselines: [],
    locks: {},
  };
}

export function loadProjectFile(repoPath: string): ProjectFile {
  const key = path.resolve(repoPath);
  const hit = projCache.get(key);
  if (hit) return hit;
  const p = projectFile(key);
  let data: ProjectFile;
  try {
    if (fs.existsSync(p)) {
      data = JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectFile;
      data.locks = data.locks ?? {};
      data.items = data.items ?? [];
      data.baselines = data.baselines ?? [];
      data.project.settings = { ...DEFAULT_SETTINGS, ...(data.project.settings ?? {}) };
      data.project.modules = data.project.modules ?? [];
    } else {
      data = emptyProjectFile(path.basename(key), key);
    }
  } catch {
    data = emptyProjectFile(path.basename(key), key);
  }
  projCache.set(key, data);
  return data;
}

export function saveProjectFile(repoPath: string, data: ProjectFile): void {
  const key = path.resolve(repoPath);
  const p = projectFile(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  projCache.set(key, data);
}

function now(): number {
  return Date.now();
}

function nextId(prefix: string, existing: string[]): string {
  let n = 1;
  let id = `${prefix}-${n}`;
  const set = new Set(existing);
  while (set.has(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
}

function toProject(e: CatalogEntry): WorkflowProject {
  const f = loadProjectFile(e.repoPath);
  return {
    id: e.id,
    name: e.name,
    repoPath: e.repoPath,
    harnessWorkspace: f.project.harnessWorkspace ?? e.repoPath,
    version: f.project.version,
    modules: f.project.modules ?? [],
    createdAt: 0,
    updatedAt: 0,
    settings: f.project.settings ?? DEFAULT_SETTINGS,
  };
}

export function listProjects(): WorkflowProject[] {
  return loadCatalog().map(toProject);
}

/** 创建项目：必须给目录；在盒子内生成目录并写 .aibox/workflow.json */
export function createProject(input: {
  name: string;
  repoPath?: string;
  harnessWorkspace?: string;
}): WorkflowProject {
  const catalog = loadCatalog();
  const repo = input.repoPath?.trim();
  if (!repo) throw new Error('新建项目必须指定本地目录');
  const abs = path.resolve(repo);
  fs.mkdirSync(abs, { recursive: true });
  fs.mkdirSync(path.join(abs, '.aibox'), { recursive: true });
  // README 占位
  const readme = path.join(abs, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `# ${input.name}\n\n由 AI Box 创建。\n工作流数据在 \`.aibox/workflow.json\`。\n`, 'utf8');
  }
  const id = nextId('PRJ', catalog.map((c) => c.id));
  const entry: CatalogEntry = { id, name: input.name, repoPath: abs };
  catalog.push(entry);
  saveCatalog(catalog);
  const data = emptyProjectFile(input.name, abs);
  data.project.harnessWorkspace = input.harnessWorkspace ? path.resolve(input.harnessWorkspace) : abs;
  saveProjectFile(abs, data);
  return toProject(entry);
}

function findEntry(id: string): CatalogEntry | undefined {
  return loadCatalog().find((c) => c.id === id);
}

export function updateProject(
  id: string,
  patch: Partial<WorkflowProject>,
): WorkflowProject | null {
  const e = findEntry(id);
  if (!e) return null;
  const f = loadProjectFile(e.repoPath);
  if (patch.name) e.name = patch.name;
  if (patch.harnessWorkspace !== undefined) f.project.harnessWorkspace = patch.harnessWorkspace;
  if (patch.version !== undefined) f.project.version = patch.version;
  if (patch.modules) f.project.modules = patch.modules;
  if (patch.settings) f.project.settings = { ...f.project.settings, ...patch.settings };
  saveCatalog(loadCatalog().map((c) => (c.id === id ? e : c)));
  saveProjectFile(e.repoPath, f);
  return toProject(e);
}

export function upsertModule(
  projectId: string,
  mod: { id?: string; title: string; color?: string; order?: number },
): WorkflowProject | null {
  const e = findEntry(projectId);
  if (!e) return null;
  const f = loadProjectFile(e.repoPath);
  const modules: WorkflowModule[] = f.project.modules ?? [];
  if (mod.id) {
    const i = modules.findIndex((m) => m.id === mod.id);
    const row = { id: mod.id, title: mod.title, color: mod.color, order: mod.order };
    if (i >= 0) modules[i] = { ...modules[i], ...row };
    else modules.push(row);
  } else {
    modules.push({ id: nextId('MOD', modules.map((m) => m.id)), title: mod.title, color: mod.color });
  }
  f.project.modules = modules;
  saveProjectFile(e.repoPath, f);
  return toProject(e);
}

function fileOfProject(projectId: string): { entry: CatalogEntry; data: ProjectFile } {
  const e = findEntry(projectId);
  if (!e) throw new Error('项目不存在: ' + projectId);
  return { entry: e, data: loadProjectFile(e.repoPath) };
}

export function listItems(projectId?: string): WorkItem[] {
  if (!projectId) {
    const all: WorkItem[] = [];
    for (const c of loadCatalog()) all.push(...loadProjectFile(c.repoPath).items);
    return all;
  }
  return fileOfProject(projectId).data.items;
}

export function getItem(id: string): WorkItem | undefined {
  for (const c of loadCatalog()) {
    const hit = loadProjectFile(c.repoPath).items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function createItem(input: {
  projectId: string;
  type: WorkItem['type'];
  title: string;
  body?: string;
  module: string;
  assignee?: WorkItem['assignee'];
  priority?: WorkItem['priority'];
  risk?: WorkItem['risk'];
  acceptance?: WorkItem['acceptance'];
  dependsOn?: string[];
  storyPoints?: number;
  budgetMinutes?: number;
  ready?: boolean;
  phase?: WorkItemPhase;
  status?: WorkItemStatus;
}): WorkItem {
  const { entry, data } = fileOfProject(input.projectId);
  const id = nextId('WF', data.items.map((i) => i.id));
  const phase = input.phase ?? 'discovery';
  const status = input.status ?? (input.type === 'suggestion' ? 'draft' : 'open');
  if (!isStatusAllowed(phase, status)) throw new Error(`非法组合 phase=${phase} status=${status}`);
  const item: WorkItem = {
    id,
    projectId: entry.id,
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    phase,
    module: input.module,
    status,
    assignee: input.assignee ?? 'unassigned',
    priority: input.priority ?? 'P2',
    risk: input.risk ?? 'low',
    acceptance: input.acceptance ?? [],
    dependsOn: input.dependsOn ?? [],
    storyPoints: input.storyPoints,
    budgetMinutes: input.budgetMinutes,
    ready: input.ready ?? input.type !== 'suggestion',
    comments: [],
    gates: {},
    createdAt: now(),
    updatedAt: now(),
  };
  data.items.push(item);
  saveProjectFile(entry.repoPath, data);
  return item;
}

function findItemLoc(id: string): { entry: CatalogEntry; data: ProjectFile; item: WorkItem } | null {
  for (const c of loadCatalog()) {
    const data = loadProjectFile(c.repoPath);
    const item = data.items.find((i) => i.id === id);
    if (item) return { entry: c, data, item };
  }
  return null;
}

export function updateItem(id: string, patch: Partial<WorkItem>): WorkItem | null {
  const loc = findItemLoc(id);
  if (!loc) return null;
  const { entry, data, item } = loc;
  const nextPhase = patch.phase ?? item.phase;
  const nextStatus = patch.status ?? item.status;
  if (nextStatus !== item.status || nextPhase !== item.phase) {
    const r = canMove(item.phase, item.status, nextStatus, nextPhase);
    if (!r.ok) throw new Error(r.reason);
  }
  Object.assign(item, patch, { id: item.id, updatedAt: now() });
  if (nextStatus === 'done' || nextStatus === 'closed') {
    if (!item.closedAt) item.closedAt = now();
  }
  saveProjectFile(entry.repoPath, data);
  return item;
}

export function transition(id: string, to: WorkItemStatus, opts?: { phase?: WorkItemPhase }): WorkItem {
  const item = getItem(id);
  if (!item) throw new Error('工作项不存在: ' + id);
  const phase = opts?.phase ?? item.phase;
  const r = canMove(item.phase, item.status, to, phase);
  if (!r.ok) throw new Error(r.reason);
  return updateItem(id, { status: to, phase })!;
}

export function addComment(id: string, c: Omit<WorkItemComment, 'id' | 'createdAt'>): WorkItem {
  const loc = findItemLoc(id);
  if (!loc) throw new Error('工作项不存在: ' + id);
  const { entry, data, item } = loc;
  const comment: WorkItemComment = { ...c, id: nextId('C', item.comments.map((x) => x.id)), createdAt: now() };
  item.comments.push(comment);
  item.updatedAt = now();
  if (comment.kind === 'accept') {
    // 人通过：非 review 也可直接完成（或从 review 完成）
    const allowDone = comment.author === 'human' || data.project.settings?.requireHumanFinalAccept === false;
    if (allowDone && item.status !== 'done' && item.status !== 'closed') {
      item.gates.G5 = { by: comment.author, ok: true, at: now(), note: 'accept 评论' };
      item.phase = 'done';
      item.status = 'done';
      item.closedAt = now();
    }
  }
  if (comment.kind === 'reject' && item.status !== 'done' && item.status !== 'closed') {
    const r = canMove(item.phase, item.status, 'reopened', 'dev');
    if (r.ok || item.status !== 'reopened') {
      item.status = 'reopened';
      item.phase = 'dev';
    }
  }
  saveProjectFile(entry.repoPath, data);
  return item;
}

export function setGate(id: string, gate: GateId, result: { by: 'human' | 'ai'; ok: boolean; note?: string }): WorkItem {
  const loc = findItemLoc(id);
  if (!loc) throw new Error('工作项不存在: ' + id);
  loc.item.gates[gate] = { ...result, at: now() };
  loc.item.updatedAt = now();
  saveProjectFile(loc.entry.repoPath, loc.data);
  return loc.item;
}

export function confirmBaseline(input: { projectId: string; title: string; bodyMd: string }): RequirementBaseline {
  const { entry, data } = fileOfProject(input.projectId);
  const n = data.baselines.filter((b) => b.projectId === input.projectId).length + 1;
  const hash = simpleHash(input.bodyMd);
  const b: RequirementBaseline = {
    id: nextId('DOC', data.baselines.map((x) => x.id)),
    projectId: input.projectId,
    title: input.title,
    version: n,
    bodyMd: input.bodyMd,
    confirmedAt: now(),
    hash,
  };
  data.baselines.push(b);
  saveProjectFile(entry.repoPath, data);
  return b;
}

export function listBaselines(projectId: string): RequirementBaseline[] {
  return fileOfProject(projectId).data.baselines;
}

export function acquireLock(projectId: string, itemId: string): boolean {
  const { entry, data } = fileOfProject(projectId);
  const cur = data.locks[projectId];
  if (cur && cur !== 'idle' && cur !== itemId) return false;
  data.locks[projectId] = itemId;
  saveProjectFile(entry.repoPath, data);
  return true;
}

export function releaseLock(projectId: string, itemId: string): void {
  const { entry, data } = fileOfProject(projectId);
  if (data.locks[projectId] === itemId) {
    data.locks[projectId] = 'idle';
    saveProjectFile(entry.repoPath, data);
  }
}

export function getLock(projectId: string): string | 'idle' {
  return fileOfProject(projectId).data.locks[projectId] ?? 'idle';
}

export function writeBrief(repoPath: string, item: WorkItem): string {
  return writeTaskBrief(repoPath, item);
}

export function resetWorkflowCache(): void {
  catalogCache = null;
  projCache.clear();
}

function simpleHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
