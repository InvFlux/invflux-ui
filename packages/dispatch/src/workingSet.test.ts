import { describe, expect, it } from 'vitest';
import {
  countFacet,
  type FacetCombination,
  matchesLocalFilters,
  mergeDelta,
  needsServerMode,
  rewindCursor,
} from './workingSet';
import type { DispatchOrderSummary } from './types';

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

const setOf = (...orders: DispatchOrderSummary[]) => new Map(orders.map((o) => [o.id, o]));

describe('mergeDelta', () => {
  /**
   * The whole reason the poll carries no filter but the cursor: an order that left the working set
   * still comes back, so its departure needs no channel of its own. Filter the poll and this row
   * would simply be absent — indistinguishable from unchanged, and wrong on screen forever.
   */
  it('drops an order that has closed', () => {
    const result = mergeDelta(setOf(order({ id: 'a' }), order({ id: 'b' })), [
      order({ id: 'a', closedAt: '2026-02-01T09:00:00.000Z' }),
    ]);

    expect([...result.orders.keys()]).toEqual(['b']);
    expect(result.removed).toBe(1);
  });

  it('inserts an order the set has never seen', () => {
    const result = mergeDelta(setOf(order({ id: 'a' })), [order({ id: 'b' })]);

    expect([...result.orders.keys()].sort()).toEqual(['a', 'b']);
    expect(result.added).toBe(1);
  });

  it('updates in place, and is idempotent when a row arrives twice', () => {
    const twice = [order({ id: 'a', stagedCount: 3 }), order({ id: 'a', stagedCount: 3 })];
    const result = mergeDelta(setOf(order({ id: 'a', stagedCount: 0 })), twice);

    expect(result.orders.size).toBe(1);
    expect(result.orders.get('a')?.stagedCount).toBe(3);
  });

  it('re-closes idempotently — a departure delivered twice is still one departure', () => {
    const closed = order({ id: 'a', closedAt: '2026-02-01T09:00:00.000Z' });
    const result = mergeDelta(setOf(order({ id: 'a' })), [closed, closed]);

    expect(result.orders.size).toBe(0);
    expect(result.removed).toBe(1);
  });
});

describe('rewindCursor', () => {
  it('walks the cursor back so a boundary write is re-delivered rather than skipped', () => {
    expect(rewindCursor('2026-09-01 11:41:29.588689', 2)).toContain('2026-09-01 11:41:27');
  });

  it('returns an unparseable clock unchanged rather than inventing one', () => {
    expect(rewindCursor('not-a-time')).toBe('not-a-time');
  });
});

describe('matchesLocalFilters', () => {
  it('passes everything when nothing is filtered', () => {
    expect(matchesLocalFilters(order({ id: 'a' }), {})).toBe(true);
  });

  it('matches a shipping class carried by any line, `none` included', () => {
    const mixed = order({ id: 'a', shippingClasses: ['none', 'fragile'] });

    expect(matchesLocalFilters(mixed, { shippingClasses: ['fragile'] })).toBe(true);
    expect(matchesLocalFilters(mixed, { shippingClasses: ['none'] })).toBe(true);
    expect(matchesLocalFilters(mixed, { shippingClasses: ['bulky'] })).toBe(false);
  });

  it('matches a shipping method used by any package, not only the one the row names', () => {
    // The row shows the first package; the second must still be findable by its own method.
    const split = order({
      id: 'a',
      shippingMethod: 'flat_rate:3',
      shippingMethodTitle: 'Priority',
      shippingCount: 2,
      shippingMethods: ['flat_rate:3', 'free_shipping:4'],
    });

    expect(matchesLocalFilters(split, { shippingMethods: ['free_shipping:4'] })).toBe(true);
    expect(matchesLocalFilters(split, { shippingMethods: ['flat_rate:2'] })).toBe(false);
    expect(matchesLocalFilters(order({ id: 'b' }), { shippingMethods: ['flat_rate:3'] })).toBe(
      false,
    );
  });

  it('matches tags as OR by default and AND on request', () => {
    const tagged = order({
      id: 'a',
      tags: [
        {
          id: 1,
          slug: 'a',
          name: 'A',
          colorId: 0,
          governanceFlags: [],
          priority: 0,
          manageAuthority: 'Anyone',
        },
        {
          id: 2,
          slug: 'b',
          name: 'B',
          colorId: 0,
          governanceFlags: [],
          priority: 0,
          manageAuthority: 'Anyone',
        },
      ],
    });

    expect(matchesLocalFilters(tagged, { tagIds: ['1', '9'] })).toBe(true);
    expect(matchesLocalFilters(tagged, { tagIds: ['1', '9'], tagMatch: 'all' })).toBe(false);
    expect(matchesLocalFilters(tagged, { tagIds: ['1', '2'], tagMatch: 'all' })).toBe(true);
  });

  it('reads pending actions off the row, including the gateway-dependent one', () => {
    const owed = order({ id: 'a', pendingManualRefunds: 1 });
    const unpaid = order({ id: 'b', wcStatus: 'on-hold', paymentMethod: 'cheque' });

    expect(matchesLocalFilters(owed, { pendingActions: ['manual_refund'] })).toBe(true);
    expect(matchesLocalFilters(unpaid, { pendingActions: ['payment_entry'] }, ['cheque'])).toBe(
      true,
    );
    // Same order, same status, but on a gateway that can refund through the API: nobody has to
    // record anything by hand, so it is not waiting on a person.
    expect(matchesLocalFilters(unpaid, { pendingActions: ['payment_entry'] }, ['bacs'])).toBe(
      false,
    );
  });

  /**
   * Narrow, never widen. An add-on's action this build has never heard of must not quietly match
   * every order — a work queue reading longer than it is goes unnoticed.
   */
  it('matches nothing for a pending action it cannot evaluate', () => {
    expect(matchesLocalFilters(order({ id: 'a' }), { pendingActions: ['stock_take'] })).toBe(false);
  });

  it('searches the same three fields the server does', () => {
    const o = order({ id: 'a', customerName: 'Rafael Keller', externalId: '145122' });

    expect(matchesLocalFilters(o, { search: 'keller' })).toBe(true);
    expect(matchesLocalFilters(o, { search: '45122' })).toBe(true);
    expect(matchesLocalFilters(o, { search: 'nadia' })).toBe(false);
  });
});

describe('needsServerMode', () => {
  it('answers the default cut from the set, without a request', () => {
    expect(needsServerMode({})).toBe(false);
    expect(needsServerMode({ workflow_state: 'Active,OnHold', tag_id: '3' })).toBe(false);
  });

  it('goes to the server for a filter over an order’s lines', () => {
    expect(needsServerMode({ sku: 'ABC-1' })).toBe(true);
    expect(needsServerMode({ subject_ids: '1036-1037' })).toBe(true);
    expect(needsServerMode({ worksheet_id: '4' })).toBe(true);
  });

  /**
   * The collision this rule exists to prevent: asking for every state and being handed the open
   * ones, while the chip says "All states". A wider question quietly answered with a narrower
   * answer is the original defect, one layer down.
   */
  it('goes to the server for any state the working set does not hold', () => {
    expect(needsServerMode({ workflow_state: 'Closed' })).toBe(true);
    expect(needsServerMode({ workflow_state: 'Active,Closed' })).toBe(true);
    expect(needsServerMode({ workflow_state: '_' })).toBe(true);
    expect(needsServerMode({ workflow_state: '' })).toBe(true);
  });

  /**
   * Waiting work is the one filter whose meaning spans closure — a refund settled by a whole-order
   * cancel sits on a closed order — so it reaches past the set by definition.
   */
  it('goes to the server for waiting work', () => {
    expect(needsServerMode({ pending_action: 'manual_refund' })).toBe(true);
  });

  it('does not count an explicitly cleared filter as asking anything', () => {
    expect(needsServerMode({ sku: '' })).toBe(false);
    expect(needsServerMode({ sku: '_' })).toBe(false);
    expect(needsServerMode({ pending_action: '' })).toBe(false);
  });
});

const tagOf = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: name.toLowerCase(),
  name,
  colorId: 0,
  governanceFlags: [],
  priority: 0,
  manageAuthority: 'Anyone',
  ...over,
});

const tagged = (id: string, ...tags: ReturnType<typeof tagOf>[]) =>
  order({ id, tags: tags as never });

describe('tag exclusion', () => {
  const express = tagOf(1, 'Express');
  const escalated = tagOf(2, 'Escalated');

  it('drops an order carrying an excluded tag', () => {
    expect(matchesLocalFilters(tagged('a', express, escalated), { tagIdsNot: ['2'] })).toBe(false);
    expect(matchesLocalFilters(tagged('b', express), { tagIdsNot: ['2'] })).toBe(true);
  });

  /**
   * The query the exclude set exists for, and the one no modifier on a single list can express:
   * an attribute minus a problem marker.
   */
  it('combines with the include set as "X but not Y"', () => {
    const f = { tagIds: ['1'], tagIdsNot: ['2'] };
    expect(matchesLocalFilters(tagged('a', express), f)).toBe(true);
    expect(matchesLocalFilters(tagged('b', express, escalated), f)).toBe(false);
    expect(matchesLocalFilters(tagged('c', escalated), f)).toBe(false);
  });

  /** `tagMatch` governs the include set alone — an exclusion is AND-NOT in either mode. */
  it('excludes under `all` exactly as under `any`', () => {
    const both = tagged('a', express, escalated);
    expect(matchesLocalFilters(both, { tagIds: ['1'], tagMatch: 'all', tagIdsNot: ['2'] })).toBe(
      false,
    );
    expect(matchesLocalFilters(both, { tagIds: ['1'], tagMatch: 'any', tagIdsNot: ['2'] })).toBe(
      false,
    );
  });
});

describe('presence filters', () => {
  it('separates marked orders from ordinary ones', () => {
    const marked = tagged('a', tagOf(1, 'Express'));
    const plain = order({ id: 'b' });

    expect(matchesLocalFilters(marked, { hasTags: ['yes'] })).toBe(true);
    expect(matchesLocalFilters(plain, { hasTags: ['yes'] })).toBe(false);
    expect(matchesLocalFilters(plain, { hasTags: ['no'] })).toBe(true);
  });

  it('reads note presence off the count the row already carries', () => {
    expect(matchesLocalFilters(order({ id: 'a', noteCount: 3 }), { hasNotes: ['yes'] })).toBe(true);
    expect(matchesLocalFilters(order({ id: 'b', noteCount: 0 }), { hasNotes: ['yes'] })).toBe(
      false,
    );
    expect(matchesLocalFilters(order({ id: 'b', noteCount: 0 }), { hasNotes: ['no'] })).toBe(true);
  });

  /**
   * An archived tag still renders on the row, hatched — so a presence filter that called this
   * order untagged would contradict the column beside it.
   */
  it('counts an archived-only order as marked, matching what the column shows', () => {
    const archivedOnly = tagged('a', tagOf(9, 'Summer sale 2023', { archived: true }));

    expect(matchesLocalFilters(archivedOnly, { hasTags: ['yes'] })).toBe(true);
    expect(matchesLocalFilters(archivedOnly, { hasTags: ['no'] })).toBe(false);
  });

  it('selecting both values is the same as not filtering', () => {
    const marked = tagged('a', tagOf(1, 'Express'));
    const plain = order({ id: 'b' });
    for (const o of [marked, plain]) {
      expect(matchesLocalFilters(o, { hasTags: ['yes', 'no'] })).toBe(true);
    }
  });
});

describe('countFacet — conjunctive dimensions', () => {
  const express = tagOf(1, 'Express');
  const escalated = tagOf(2, 'Escalated');
  const fraud = tagOf(3, 'Fraud review');
  const tagValues = (o: Parameters<typeof matchesLocalFilters>[0]) =>
    (o.tags ?? []).map((t) => String(t.id));

  // Escalated and Fraud review overlap on `b` — the correlation that makes the two bases differ.
  const orders = [
    tagged('a', express, escalated),
    tagged('b', escalated, fraud),
    tagged('c', fraud),
  ];

  /**
   * The defect this rule exists to prevent. With `Escalated` already excluded, `b` is gone — so
   * excluding `Fraud review` too would remove only `c`. Counting against a base that has forgotten
   * `Escalated` says 2, promising twice the effect.
   */
  it('counts what an exclusion would ADDITIONALLY remove', () => {
    const counts = countFacet(
      orders,
      { tagIdsNot: ['2'] },
      'tagIdsNot',
      tagValues,
      [],
      'conjunctive',
    );

    expect(counts['3']).toBe(1);

    // ...and the rule this replaced would say 2. Asserted so the test cannot quietly stop
    // discriminating: if both bases ever agree here, the fixture has lost the overlap it needs.
    const naive = countFacet(
      orders,
      { tagIdsNot: ['2'] },
      'tagIdsNot',
      tagValues,
      [],
      'disjunctive',
    );
    expect(naive['3']).toBe(2);
  });

  it('keeps a selected option in its own picker even when nothing is left carrying it', () => {
    const counts = countFacet(
      orders,
      { tagIdsNot: ['2'] },
      'tagIdsNot',
      tagValues,
      [],
      'conjunctive',
    );

    // `Escalated` is excluded, so no surviving row carries it — but the option must still render,
    // or the operator cannot see or undo the choice they are standing on.
    expect(counts['2']).toBe(2);
  });

  /**
   * The reason this is hard to catch: with nothing selected the conjunctive and disjunctive bases
   * are identical, so a first look agrees and every subsequent click diverges.
   */
  it('agrees with the disjunctive rule while the dimension is empty', () => {
    const args = [orders, {}, 'tagIdsNot', tagValues, []] as const;
    const dis = countFacet(...args, 'disjunctive' as FacetCombination);
    const con = countFacet(...args, 'conjunctive' as FacetCombination);

    expect(con).toEqual(dis);
  });
});

describe('countFacet', () => {
  const orders = [
    order({ id: 'a', workflowState: 'Active', wcStatus: 'processing' }),
    order({ id: 'b', workflowState: 'Active', wcStatus: 'on-hold' }),
    order({ id: 'c', workflowState: 'OnHold', wcStatus: 'processing' }),
  ];

  /**
   * Self-exclusion, the rule the whole affordance rests on: counting a dimension applies every
   * filter but its own, so an option the operator has *not* picked still reports what picking it
   * would return. Without it `OnHold` reads 0 the moment `Active` is selected, and the control
   * becomes a dead end that looks like an empty result.
   */
  it('counts a dimension with its own filter excluded', () => {
    const counts = countFacet(orders, { workflowState: ['Active'] }, 'workflowState', (o) => [
      o.workflowState,
    ]);

    expect(counts).toEqual({ Active: 2, OnHold: 1 });
  });

  it('still applies every other filter', () => {
    const counts = countFacet(
      orders,
      { workflowState: ['Active'], wcStatus: ['processing'] },
      'workflowState',
      (o) => [o.workflowState],
    );

    expect(counts).toEqual({ Active: 1, OnHold: 1 });
  });
});
