import type { ScopeDetail, ScopeHandoff, ScopeJobProgress, ScopeJobStatus } from '../../../shared/knowledge-scope.js';

type Row = Record<string, any>;

export const activeScopeJobStatuses = new Set<ScopeJobStatus>(['queued', 'running', 'retrying']);
export const terminalScopeJobStatuses = new Set<ScopeJobStatus>(['succeeded', 'failed', 'uncertain', 'cancelled']);

export function isActiveScopeJob(status: unknown): boolean {
  return activeScopeJobStatuses.has(String(status) as ScopeJobStatus);
}

export function scopeHandoff(row: Row | null | undefined): ScopeHandoff {
  const status = String(row?.scope_handoff_status || 'none');
  const normalized: ScopeHandoff['status'] = ['pending', 'queued', 'failed', 'none'].includes(status)
    ? status as ScopeHandoff['status']
    : 'none';
  const requestedAt = row?.scope_handoff_requested_at == null ? undefined : String(row.scope_handoff_requested_at);
  const error = row?.scope_handoff_error == null ? undefined : String(row.scope_handoff_error);
  return {
    status: normalized,
    ...(requestedAt ? { requested_at: requestedAt } : {}),
    ...(error ? { error } : {}),
  };
}

export function scopeJobProgress(row: Row | null | undefined): ScopeJobProgress {
  const total = row?.scope_progress_total;
  const lastProgressAt = row?.scope_last_progress_at == null ? undefined : String(row.scope_last_progress_at);
  return {
    done: Math.max(0, Number(row?.scope_progress_done || 0)),
    total: total == null ? null : Math.max(0, Number(total)),
    unit: 'batches',
    ...(lastProgressAt ? { last_progress_at: lastProgressAt } : {}),
  };
}

export function scopeJob(row: Row | null | undefined, scope: Row | null | undefined): ScopeDetail['job'] {
  if (!row) return null;
  const status = String(row.status) as ScopeJobStatus;
  return {
    id: String(row.id),
    status,
    ...(row.error_summary ? { error_summary: String(row.error_summary) } : {}),
    attempts: Math.max(0, Number(row.attempts || 0)),
    max_attempts: Math.max(1, Number(row.max_attempts || 1)),
    ...(row.started_at ? { started_at: String(row.started_at) } : {}),
    ...(row.terminal_at ? { terminal_at: String(row.terminal_at) } : {}),
    progress: scopeJobProgress(scope),
  };
}

export function scopeActions(input: {
  frozen: boolean;
  documentStatus: string;
  hasScope: boolean;
  job: ScopeDetail['job'];
  handoff: ScopeHandoff;
}): ScopeDetail['actions'] {
  const active = input.job ? isActiveScopeJob(input.job.status) : false;
  const uncertain = input.job?.status === 'uncertain';
  const autoWaiting = input.handoff.status === 'pending';
  const mutable = !input.frozen;
  return {
    edit: mutable,
    // `uncertain` has an unverified outcome and is intentionally takeover-only;
    // it is never converted into an automatic or UI-triggered replay.
    generate: mutable && input.documentStatus === 'pending_review' && !active && !uncertain && !autoWaiting,
    check: mutable && input.hasScope && !active && !uncertain,
  };
}

/** A later duplicate callback must not refresh time or regress/imitate progress. */
export function advancesBatchProgress(previousDone: number, nextDone: number, total: number): boolean {
  return Number.isInteger(previousDone) && Number.isInteger(nextDone) && Number.isInteger(total)
    && previousDone >= 0 && nextDone > previousDone && nextDone <= total;
}
