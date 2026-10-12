/**
 * 研发工作流状态机（纯函数，便于单测）
 * 规则见 docs/dev-workflow.md §2.2
 */
import type { WorkItemPhase, WorkItemStatus } from './workflowTypes';

/** phase → 允许 status */
export const PHASE_STATUS: Record<WorkItemPhase, WorkItemStatus[]> = {
  discovery: ['draft', 'open', 'cancelled'],
  design: ['open', 'doing', 'review', 'blocked', 'cancelled'],
  dev: ['open', 'doing', 'review', 'reopened', 'blocked', 'cancelled'],
  verify: ['open', 'doing', 'review', 'blocked', 'cancelled'],
  release: ['open', 'doing', 'done', 'blocked', 'cancelled'],
  done: ['done', 'closed'],
};

export function isStatusAllowed(phase: WorkItemPhase, status: WorkItemStatus): boolean {
  return PHASE_STATUS[phase]?.includes(status) ?? false;
}

/** status 迁移：from → to 是否允许（不考虑 phase 时的基础图） */
const STATUS_FLOW: Record<WorkItemStatus, WorkItemStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['doing', 'cancelled', 'blocked'],
  doing: ['review', 'blocked', 'cancelled', 'open'],
  review: ['done', 'reopened', 'doing', 'blocked'],
  reopened: ['doing', 'open', 'cancelled', 'blocked'],
  blocked: ['open', 'doing', 'cancelled'],
  done: ['closed', 'reopened'],
  closed: [],
  cancelled: ['open', 'draft'],
};

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  if (from === to) return true;
  return STATUS_FLOW[from]?.includes(to) ?? false;
}

/**
 * 完整迁移校验：图上允许 + 目标 phase/status 合法。
 */
export function canMove(
  phase: WorkItemPhase,
  from: WorkItemStatus,
  to: WorkItemStatus,
  nextPhase: WorkItemPhase = phase,
): { ok: boolean; reason?: string } {
  if (!canTransition(from, to)) {
    return { ok: false, reason: `状态不可从 ${from} 到 ${to}` };
  }
  if (!isStatusAllowed(nextPhase, to)) {
    return { ok: false, reason: `阶段 ${nextPhase} 不允许状态 ${to}` };
  }
  return { ok: true };
}

/** 进行中的 status（巡检/锁用） */
export function isActiveStatus(s: WorkItemStatus): boolean {
  return s === 'doing' || s === 'review';
}

/** 需求发现类（默认不自动开工） */
export function isSuggestionType(t: string): boolean {
  return t === 'suggestion';
}
