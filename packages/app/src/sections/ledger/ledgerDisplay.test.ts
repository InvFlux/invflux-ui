import { describe, expect, it } from 'vitest';
import { buildDisplayCard, DEFAULT_DISPLAY, UNCOMMITTED, visibleCount } from './ledgerDisplay';
import { stockCard, type StockCardRow } from './stockCard';

const merged = { ...DEFAULT_DISPLAY, mergeUncommitted: true };

/** Reserve 3 of 10 available, then commit them — newest first, as the ledger returns rows. */
const rows: StockCardRow[] = [
  { fromSlot: 'oh.res', toSlot: 'oh.ctd', quantity: 3, initialFrom: 3, initialTo: 0 },
  { fromSlot: 'oh.atp', toSlot: 'oh.res', quantity: 3, initialFrom: 10, initialTo: 0 },
];

describe('buildDisplayCard', () => {
  it('leaves every slot its own column when nothing is merged', () => {
    const card = buildDisplayCard(stockCard(rows), DEFAULT_DISPLAY);

    expect(card.columns.map((c) => c.key)).toEqual(['oh.atp', 'oh.res', 'oh.ctd']);
    expect(card.hiddenRows).toEqual([false, false]);
  });

  it('sums the merged slots, so the column totals what both held', () => {
    const card = buildDisplayCard(stockCard(rows), merged);

    expect(card.columns.map((c) => c.key)).toEqual(['oh.uncommitted', 'oh.ctd']);
    expect(card.columns[0]!.members).toEqual(['oh.atp', 'oh.res']);
    // Newest row first: after committing 3, uncommitted holds 7 (4 available + 3 reserved → 7 + 0).
    // Seeding the column from one side alone would have reported 4 here, short by the reservation.
    expect(card.cells[0]![0]!.balance).toBe(7);
    expect(card.cells[1]![0]!.balance).toBe(10);
  });

  it('hides a row that only moves stock inside one merged column', () => {
    const card = buildDisplayCard(stockCard(rows), merged);

    // The reservation (atp → res) nets to zero once the two are one column; the commitment does not.
    expect(card.hiddenRows).toEqual([false, true]);
    expect(visibleCount(card.hiddenRows)).toBe(1);
  });

  it('hides by the row having no visible effect, not by which movement it was', () => {
    // A state this build has never heard of, merged with nothing: it must stay visible, and the
    // row that moves between the two merged states must not, whatever movement produced it.
    const exotic: StockCardRow[] = [
      { fromSlot: 'oh.atp', toSlot: 'oh.qi', quantity: 2, initialFrom: 5, initialTo: 0 },
      { fromSlot: 'oh.res', toSlot: 'oh.atp', quantity: 1, initialFrom: 1, initialTo: 4 },
    ];
    const card = buildDisplayCard(stockCard(exotic), merged);

    // `qi` sits before `atp` along the flow (inspected before promisable), so it heads the row.
    expect(card.columns.map((c) => c.state)).toEqual(['qi', UNCOMMITTED]);
    expect(card.hiddenRows).toEqual([false, true]);
  });

  it('groups each location into one run, so a head can span its columns', () => {
    const across: StockCardRow[] = [
      { fromSlot: 'sup.atp', toSlot: 'oh.atp', quantity: 4, initialFrom: 9, initialTo: 1 },
      { fromSlot: 'oh.atp', toSlot: 'oh.ctd', quantity: 2, initialFrom: 5, initialTo: 0 },
    ];
    const card = buildDisplayCard(stockCard(across), DEFAULT_DISPLAY);

    expect(card.groups.map((g) => g.location)).toEqual(['sup', 'oh']);
    expect(card.groups.map((g) => g.columns.length)).toEqual([1, 2]);
  });

  it('reports no balance for a merged column while either side is unestablished', () => {
    // `res` is established, `atp` never recorded a before, so the pair's total is not knowable —
    // and a column answering "0" would be understating by whatever `atp` holds.
    const partial: StockCardRow[] = [
      { fromSlot: 'oh.res', toSlot: 'oh.ctd', quantity: 3, initialFrom: 3, initialTo: 0 },
      { fromSlot: 'oh.atp', toSlot: 'oh.ctd', quantity: 1, initialFrom: null, initialTo: null },
    ];
    const card = buildDisplayCard(stockCard(partial), merged);

    expect(card.cells[0]![0]!.balance).toBeNull();
  });
});
