import { describe, expect, it } from 'vitest';
import { queueSortRegistry, sortQueue } from './queueSort';
import type { DispatchOrderSummary, TagSummary } from './types';

const order = (over: Partial<DispatchOrderSummary> & { id: string }): DispatchOrderSummary =>
  ({
    externalId: over.id,
    sourceSystem: 'woo',
    status: 'Untouched',
    workflowState: 'Active',
    holdReason: null,
    closedAt: null,
    stockState: 0,
    lineCount: 1,
    stagedCount: 0,
    shippedCount: 0,
    unprocessedCorrections: 0,
    pendingManualRefunds: 0,
    estDispatch: null,
    customerId: null,
    customerName: 'Pat Walker',
    customerEmail: 'pat@example.test',
    shippingAddressHash: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    wcStatus: 'processing',
    paymentMethod: 'bacs',
    paymentMethodTitle: 'Bank transfer',
    transactionId: null,
    billingPhone: null,
    tags: [],
    ...over,
  }) as DispatchOrderSummary;

const tag = (priority: number): TagSummary =>
  ({
    id: 1,
    slug: 'u',
    name: 'Urgent',
    colorId: 0,
    governanceFlags: [],
    priority,
    manageAuthority: 'Anyone',
  }) as TagSummary;

describe('sortQueue — the base install', () => {
  it('does NOT rank by governance-tag priority', () => {
    // The rule this whole seam exists for. An install that will not let a merchant assign a
    // priority tag must not honour one, and the client is where the operator actually sees the
    // order — it sorts the polled working set, so the server dropping the term is only half of it.
    const urgent = order({ id: 'b', tags: [tag(30)] });

    expect(sortQueue([order({ id: 'a' }), urgent]).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('keeps a closed order below an open one whatever else it carries', () => {
    const closedUrgent = order({ id: 'a', closedAt: '2026-02-01T09:00:00.000Z', tags: [tag(30)] });

    expect(sortQueue([closedUrgent, order({ id: 'b' })]).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('floats a ready order above one still waiting on something', () => {
    const ready = order({ id: 'a', lineCount: 2, stagedCount: 2 });
    const partial = order({ id: 'b', lineCount: 2, stagedCount: 1 });

    expect(sortQueue([partial, ready]).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('sinks an order blocked by an unprocessed correction', () => {
    const ready = order({ id: 'a', lineCount: 1, stagedCount: 1 });
    const blocked = order({ id: 'b', lineCount: 1, stagedCount: 1, unprocessedCorrections: 1 });

    expect(sortQueue([blocked, ready]).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('sortQueue — can ship before cannot', () => {
  const late = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

  it('sinks an order committed stock cannot cover below an older one that can ship', () => {
    // The owner's case: shippable and 29 days late must not trail short and 11 days late.
    const shippable = order({ id: 'a', estDispatch: late(29) });
    const short = order({ id: 'b', stockState: 0x01, stockShortQty: 1, estDispatch: late(11) });

    expect(sortQueue([short, shippable]).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('does not sink an order in a store-wide shortage it is still covered in', () => {
    const storeShort = order({
      id: 'a',
      stockState: 0x01,
      stockShortQty: 0,
      estDispatch: late(20),
    });
    const clean = order({ id: 'b', estDispatch: late(5) });

    expect(sortQueue([clean, storeShort]).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('sinks an order held by a concern that blocks shipping outright', () => {
    const held = order({ id: 'a', stockState: 0x04, estDispatch: late(20) });
    const clean = order({ id: 'b', estDispatch: late(5) });

    expect(sortQueue([held, clean]).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('does not rank by a warehouse being short on its own', () => {
    // A localised deficit: information about where stock sits, never a reason to reorder the queue.
    const warehouseShort = order({ id: 'a', stockState: 0x20, estDispatch: late(20) });
    const clean = order({ id: 'b', estDispatch: late(5) });

    expect(sortQueue([clean, warehouseShort]).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('sortQueue — expected dispatch time', () => {
  it('orders by the committed date, most overdue first', () => {
    const now = Date.parse('2026-03-10T00:00:00.000Z');
    const veryLate = order({ id: 'a', estDispatch: '2026-03-01T00:00:00.000Z' });
    const late = order({ id: 'b', estDispatch: '2026-03-08T00:00:00.000Z' });

    expect(sortQueue([late, veryLate], now).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('orders orders that are NOT yet due by when they come due', () => {
    // The case a floored day-count could not express: both are in the future, so the old rule
    // clamped both to zero and let the id tiebreak decide — which here contradicts the dates, so
    // this test fails against that implementation instead of passing for the wrong reason.
    const now = Date.parse('2026-03-10T00:00:00.000Z');
    const dueLater = order({ id: 'a', estDispatch: '2026-05-01T00:00:00.000Z' });
    const dueSooner = order({ id: 'b', estDispatch: '2026-04-01T00:00:00.000Z' });

    expect(sortQueue([dueLater, dueSooner], now).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('ranks within the same day, not just between days', () => {
    const now = Date.parse('2026-03-10T00:00:00.000Z');
    const morning = order({ id: 'b', estDispatch: '2026-03-01T07:00:00.000Z' });
    const evening = order({ id: 'a', estDispatch: '2026-03-01T19:00:00.000Z' });

    expect(sortQueue([evening, morning], now).map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('puts an order with no committed date last', () => {
    const now = Date.parse('2026-03-10T00:00:00.000Z');
    const none = order({ id: 'a', estDispatch: null });
    const future = order({ id: 'b', estDispatch: '2026-12-01T00:00:00.000Z' });

    // `a` would win the id tiebreak, so this asserts the null placement and nothing else.
    expect(sortQueue([none, future], now).map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('the contribution seam', () => {
  it('lets a registered rule reinstate tag priority ahead of the base rules', () => {
    // What the add-on does. Registered at order 10, so it outranks readiness (20) — asserted by
    // making the low-priority order the ready one, which the base rules would otherwise float.
    queueSortRegistry.register({
      name: 'tag_priority',
      order: 10,
      compare: (a, b) => {
        const p = (o: DispatchOrderSummary): number =>
          (o.tags ?? []).reduce((max, t) => Math.max(max, t.priority), 0);

        return p(b) - p(a);
      },
    });

    const urgentNotReady = order({ id: 'a', tags: [tag(30)], lineCount: 2, stagedCount: 0 });
    const plainReady = order({ id: 'b', lineCount: 2, stagedCount: 2 });

    expect(sortQueue([plainReady, urgentNotReady]).map((o) => o.id)).toEqual(['a', 'b']);

    // Overriding by name replaces in place rather than adding a second rule — so neutralising it
    // restores the base ordering, which also proves the assertion above was the rule's doing.
    queueSortRegistry.register({ name: 'tag_priority', order: 10, compare: () => 0 });

    expect(sortQueue([plainReady, urgentNotReady]).map((o) => o.id)).toEqual(['b', 'a']);
  });
});
