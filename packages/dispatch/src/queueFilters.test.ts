import { describe, expect, it } from 'vitest';
import {
  ANY_PENDING_ACTION,
  localQueue,
  NO_FILTER_SENTINEL,
  parseQueueFilters,
  pendingActionFilter,
  queueParamsOf,
  spansClosure,
} from './queueFilters';
import type { DispatchOrderSummary } from './types';

const ctx = {
  workflowState: { options: [{ value: 'Active' }, { value: 'OnHold' }, { value: 'Closed' }] },
  nativeStatus: { defaultSelected: ['processing'] },
  pendingAction: { options: [{ value: 'manual_refund' }, { value: 'corrections' }] },
} as unknown as Parameters<typeof parseQueueFilters>[1];

const order = (over: Partial<DispatchOrderSummary> & { id: string }): DispatchOrderSummary =>
  ({
    externalId: over.id,
    status: 'Untouched',
    workflowState: 'Active',
    closedAt: null,
    stockState: 0,
    lineCount: 1,
    stagedCount: 0,
    shippedCount: 0,
    unprocessedCorrections: 0,
    pendingManualRefunds: 0,
    estDispatch: null,
    customerName: 'Pat Walker',
    customerEmail: 'pat@example.test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    wcStatus: 'processing',
    tags: [],
    ...over,
  }) as DispatchOrderSummary;

describe('queueParamsOf', () => {
  it('reads a search string with or without its question mark, and none at all', () => {
    expect(queueParamsOf('?status=Started&search=amy%20b')).toEqual({
      status: 'Started',
      search: 'amy b',
    });
    expect(queueParamsOf('wc_status=_')).toEqual({ wc_status: '_' });
    expect(queueParamsOf('')).toEqual({});
  });
});

describe('parseQueueFilters', () => {
  /** The view a fresh tab shows: what the order page steps through when nothing was remembered. */
  it('reads no parameters as the default view: the host-status default, no workflow filter', () => {
    const filters = parseQueueFilters({}, ctx);

    expect(filters.wcStatus).toEqual(['processing']);
    expect(filters.workflowState).toBeUndefined();
    expect(filters.status).toBeUndefined();
    expect(filters.pendingActions).toEqual([]);
    expect(filters.search).toBeUndefined();
  });

  it('takes the no-filter sentinel as an explicit "every value", not as the default', () => {
    expect(parseQueueFilters({ wc_status: NO_FILTER_SENTINEL }, ctx).wcStatus).toEqual([]);
  });

  it('drops workflow states the install does not declare', () => {
    expect(parseQueueFilters({ workflow_state: 'OnHold,Bogus' }, ctx).workflowState).toEqual([
      'OnHold',
    ]);
  });

  /** Waiting work spans closure: the Active default yields to it instead of narrowing it. */
  it('lifts the Active default for a pending-action filter, unless the operator set the state', () => {
    expect(parseQueueFilters({ pending_action: 'manual_refund' }, ctx).workflowState).toEqual([]);
    expect(
      parseQueueFilters({ pending_action: 'manual_refund', workflow_state: 'Active' }, ctx)
        .workflowState,
    ).toEqual(['Active']);
  });

  it('reads the dash-joined product ids the workbench link writes', () => {
    expect(parseQueueFilters({ subject_ids: '12-34' }, ctx).subjectIds).toEqual(['12', '34']);
  });

  it('trims the search, and reads a blank one as none', () => {
    expect(parseQueueFilters({ search: '  amy ' }, ctx).search).toBe('amy');
    expect(parseQueueFilters({ search: '   ' }, ctx).search).toBeUndefined();
  });
});

describe('pendingActionFilter', () => {
  it('expands the any-action token to what the install offers', () => {
    expect(pendingActionFilter(ANY_PENDING_ACTION, ctx.pendingAction.options)).toEqual([
      'manual_refund',
      'corrections',
    ]);
  });

  /** A value dropped here would widen the union: a work queue showing more than was asked for. */
  it('keeps a value the install does not list', () => {
    expect(pendingActionFilter('receipts', ctx.pendingAction.options)).toEqual(['receipts']);
  });

  it('reads an absent parameter as no constraint', () => {
    expect(pendingActionFilter(undefined, ctx.pendingAction.options)).toEqual([]);
    expect(spansClosure([])).toBe(false);
    expect(spansClosure(['corrections'])).toBe(true);
  });
});

describe('localQueue', () => {
  it("keeps the orders the view asks for, in the queue's order", () => {
    const held = [
      order({ id: 'started', status: 'Started' }),
      order({ id: 'completed', wcStatus: 'completed' }),
      order({ id: 'untouched' }),
    ];
    const ids = localQueue(held, parseQueueFilters({}, ctx), []).map((o) => o.id);

    // The host-status default leaves the completed order out; the rest are all there, once each.
    expect(ids).not.toContain('completed');
    expect([...ids].sort()).toEqual(['started', 'untouched']);
  });
});
