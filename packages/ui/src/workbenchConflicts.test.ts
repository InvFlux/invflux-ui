import { describe, expect, it } from 'vitest';
import { describeConflicts, explainConflict } from './workbenchConflicts';
import type { WorkbenchApplyConflict } from './workbenchGridTypes';

const conflict = (
  reason: string,
  columnId = 'wac',
  actual: unknown = null,
): WorkbenchApplyConflict => ({
  subject_id: 906,
  column_id: columnId,
  reason,
  expected: null,
  actual,
});

const labelOf = (columnId: string): string => ('wac' === columnId ? 'Unit cost (WAC)' : columnId);

describe('explainConflict', () => {
  /**
   * The regression this file exists for: a base-currency refusal used to fall through to "the value
   * changed on the server; review and retry", which is false twice over — nothing changed, and
   * retrying reproduces it forever. The operator needs the remedy, which lives on another screen.
   */
  it('tells a blocked cost edit what is actually wrong and where to fix it', () => {
    const message = explainConflict('base_currency_drift', 'Unit cost (WAC)');

    expect(message).toContain('Unit cost (WAC)');
    expect(message).toContain('Base currency');
    expect(message).not.toContain('retry');
  });

  it('only invites a retry where retrying can actually succeed', () => {
    expect(explainConflict('stale_original', 'Unit cost (WAC)')).toContain('retry');

    // Every one of these is a refusal, not a race: the same request would be refused identically.
    for (const reason of ['base_currency_drift', 'cost_locked', 'negative_stock', 'forbidden']) {
      expect(explainConflict(reason, 'Col'), reason).not.toContain('retry');
    }
  });

  it('returns null for a code this build does not know, rather than inventing a cause', () => {
    expect(explainConflict('some_future_reason', 'Col')).toBeNull();
  });
});

describe('describeConflicts', () => {
  it('names the column and the reason for each refused edit', () => {
    const message = describeConflicts([conflict('base_currency_drift')], labelOf);

    expect(message).toContain('Unit cost (WAC)');
    expect(message).toContain('Convert your stored costs');
  });

  it('surfaces a server-authored message verbatim where one is sent', () => {
    const message = describeConflicts(
      [conflict('write_rejected', 'sku', 'Invalid or duplicated SKU.')],
      labelOf,
    );

    expect(message).toBe('sku: Invalid or duplicated SKU.');
  });

  /** `stock_management_locked` carries the blocking workflow's own name — better than any fixed
   *  string — but must still say something useful when the server sends nothing. */
  it('falls back to its own wording when the server sends no detail', () => {
    const withDetail = describeConflicts(
      [conflict('stock_management_locked', 'stock_management', 'A stock take is in progress.')],
      labelOf,
    );
    const without = describeConflicts(
      [conflict('stock_management_locked', 'stock_management')],
      labelOf,
    );

    expect(withDetail).toContain('A stock take is in progress.');
    expect(without).toContain('busy in a stock workflow');
  });

  it('counts only unrecognised codes into the generic bucket', () => {
    const message = describeConflicts(
      [conflict('base_currency_drift'), conflict('mystery_a', 'a'), conflict('mystery_b', 'b')],
      labelOf,
    );

    expect(message).toContain('Convert your stored costs');
    expect(message).toContain('2 changes');
  });

  it('describes a mixed batch one refusal at a time', () => {
    const message = describeConflicts(
      [conflict('base_currency_drift'), conflict('negative_stock', 'total')],
      labelOf,
    );

    expect(message).toContain('Unit cost (WAC)');
    expect(message).toContain('total');
    expect(message).toContain('below zero');
  });
});
