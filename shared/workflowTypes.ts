/**
 * 研发工作流类型（M1 人工闭环）
 * shared/ 不得 import electron，便于 vitest 直接跑。
 */

export type WorkItemType = 'feature' | 'task' | 'test' | 'bug' | 'suggestion' | 'change';

export type WorkItemPhase =
  | 'discovery'
  | 'design'
  | 'dev'
  | 'verify'
  | 'release'
  | 'done';

export type WorkItemStatus =
  | 'draft'
  | 'open'
  | 'doing'
  | 'review'
  | 'done'
  | 'closed'
  | 'reopened'
  | 'cancelled'
  | 'blocked';

export type WorkItemPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type WorkItemAssignee = 'human' | 'ai-dev' | 'ai-test' | 'unassigned';

export type CommentKind =
  | 'note'
  | 'review'
  | 'accept'
  | 'reject'
  | 'ai-report'
  | 'ai-suggestion';

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export interface WorkItemComment {
  id: string;
  author: 'human' | 'ai';
  body: string;
  kind: CommentKind;
  createdAt: number;
  readByAi?: boolean;
}

export interface WorkflowModule {
  id: string;
  title: string;
  color?: string;
  order?: number;
}

export interface WorkflowProject {
  id: string;
  name: string;
  repoPath?: string;
  harnessWorkspace?: string;
  version?: string;
  modules: WorkflowModule[];
  createdAt: number;
  updatedAt: number;
  settings: WorkflowSettings;
}

export interface WorkflowSettings {
  /** autoReview：开发/测试是否可 AI 自审（G1/G5 始终人） */
  acceptDev: boolean;
  acceptTest: boolean;
  requireHumanFinalAccept: boolean;
  maxAutoIterations: number;
  budgetMinutes: number;
  lockWorkspace: boolean;
}

export interface WorkItem {
  id: string;
  projectId: string;
  type: WorkItemType;
  title: string;
  body: string;
  phase: WorkItemPhase;
  module: string;
  status: WorkItemStatus;
  assignee: WorkItemAssignee;
  priority: WorkItemPriority;
  risk: 'low' | 'mid' | 'high';
  acceptance: Array<{ id: string; text: string; checked: boolean; evidence?: string }>;
  dependsOn: string[];
  storyPoints?: number;
  budgetMinutes?: number;
  releaseNote?: string;
  ready?: boolean;
  comments: WorkItemComment[];
  gates: Partial<Record<GateId, { by: 'human' | 'ai'; at: number; ok: boolean; note?: string }>>;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface RequirementBaseline {
  id: string;
  projectId: string;
  title: string;
  version: number;
  bodyMd: string;
  confirmedAt?: number;
  hash?: string;
}
