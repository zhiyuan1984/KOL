import { describe, expect, it } from 'vitest';
import { advancesBatchProgress, scopeActions, scopeHandoff, scopeJob } from '../src/knowledge/scope-async.js';

describe('knowledge scope async projection contract', () => {
  it('projects a known batch total and real last progress independently of heartbeat or read time', () => {
    const job = scopeJob({ id: 'job-1', status: 'running', attempts: 1, max_attempts: 2, started_at: '2026-10-15T09:00:00.000Z' }, {
      scope_progress_done: 2,
      scope_progress_total: 5,
      scope_progress_unit: 'batches',
      scope_last_progress_at: '2026-10-15T09:01:00.000Z',
    });
    expect(job).toMatchObject({
      id: 'job-1', status: 'running',
      progress: { done: 2, total: 5, unit: 'batches', last_progress_at: '2026-10-15T09:01:00.000Z' },
    });
  });

  it('keeps an unknown total as null rather than manufacturing a percentage', () => {
    expect(scopeJob({ id: 'job-2', status: 'queued' }, { scope_progress_done: 0, scope_progress_total: null })?.progress)
      .toEqual({ done: 0, total: null, unit: 'batches' });
  });

  it('distinguishes an authorized pending handoff from old material with no intent', () => {
    expect(scopeHandoff({ scope_handoff_status: 'pending', scope_handoff_requested_at: '2026-10-15T09:00:00.000Z' }))
      .toEqual({ status: 'pending', requested_at: '2026-10-15T09:00:00.000Z' });
    expect(scopeHandoff({})).toEqual({ status: 'none' });
  });

  it('disables replay and check actions for an uncertain outcome while preserving the factual status', () => {
    const job = scopeJob({ id: 'job-uncertain', status: 'uncertain', error_summary: 'lease outcome unknown' }, {});
    expect(scopeActions({ frozen: false, documentStatus: 'pending_review', hasScope: true, job, handoff: { status: 'queued' } }))
      .toEqual({ edit: true, generate: false, check: false });
  });

  it('keeps automatic handoff waiting server-side and only permits recovery after it is visibly failed', () => {
    const input = { frozen: false, documentStatus: 'pending_review', hasScope: false, job: null } as const;
    expect(scopeActions({ ...input, handoff: { status: 'pending' } })).toMatchObject({ generate: false });
    expect(scopeActions({ ...input, handoff: { status: 'failed', error: 'outbox unavailable' } })).toMatchObject({ generate: true });
  });

  it('accepts only strictly increasing completed batches within a known total', () => {
    expect(advancesBatchProgress(0, 1, 3)).toBe(true);
    expect(advancesBatchProgress(1, 1, 3)).toBe(false);
    expect(advancesBatchProgress(2, 1, 3)).toBe(false);
    expect(advancesBatchProgress(2, 4, 3)).toBe(false);
  });
});
