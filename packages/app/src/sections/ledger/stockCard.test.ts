import { describe, expect, it } from 'vitest';
import { compareSlots, slotParts, stockCard, type StockCardRow } from './stockCard';

describe('slotParts', () => {
  it('recognises the state on either side of the key', () => {
    expect(slotParts('atp.oh')).toEqual({ location: 'oh', state: 'atp' });
    expect(slotParts('oh/main.bkd')).toEqual({ location: 'oh/main', state: 'bkd' });
  });

  it('takes an unknown state from its known location, and a bare key as a location', () => {
    expect(slotParts('xyz.trs/dsp')).toEqual({ location: 'trs/dsp', state: 'xyz' });
    expect(slotParts('oh')).toEqual({ location: 'oh', state: '' });
  });
});

const move = (
  fromSlot: string | null,
  toSlot: string | null,
  quantity: number,
  initialFrom: number | null = null,
  initialTo: number | null = null,
): StockCardRow => ({ fromSlot, toSlot, quantity, initialFrom, initialTo });

/** One slot's column, newest row first — `[balance, change]` per row. */
const column = (card: ReturnType<typeof stockCard>, slot: string) =>
  card.cells.map((row) => {
    const cell = row[card.slots.indexOf(slot)]!;
    return [cell.balance, cell.change];
  });

describe('compareSlots', () => {
  it('orders along the stock flow, then by state', () => {
    const slots = ['trs/dsp.atp', 'oh.ctd', 'oh.atp', 'sup.ctd', 'oh.res', 'trs/inb.pnd'];
    expect([...slots].sort(compareSlots)).toEqual([
      'sup.ctd',
      'trs/inb.pnd',
      'oh.atp',
      'oh.res',
      'oh.ctd',
      'trs/dsp.atp',
    ]);
  });

  it('reads the engine keys, which put the state first', () => {
    const slots = ['ctd.oh', 'atp.sup', 'res.oh', 'atp.oh', 'oh', 'xyz.oh'];
    // A key with no state sorts after its location's known states; an add-on state after that.
    expect([...slots].sort(compareSlots)).toEqual([
      'atp.sup',
      'atp.oh',
      'res.oh',
      'ctd.oh',
      'oh',
      'xyz.oh',
    ]);
  });

  it('treats a leaf location like its root, and puts unknown values last, alphabetically', () => {
    const slots = ['zz.atp', 'oh/main.ctd', 'aa.atp', 'oh/main.atp', 'oh.xyz'];
    expect([...slots].sort(compareSlots)).toEqual([
      'oh/main.atp',
      'oh/main.ctd',
      'oh.xyz',
      'aa.atp',
      'zz.atp',
    ]);
  });
});

describe('stockCard', () => {
  it('gives each side of a movement its own signed change and resulting balance', () => {
    const card = stockCard([move('oh.atp', 'oh.ctd', 2, 12, 3)]);
    expect(card.slots).toEqual(['oh.atp', 'oh.ctd']);
    expect(column(card, 'oh.atp')).toEqual([[10, -2]]);
    expect(column(card, 'oh.ctd')).toEqual([[5, 2]]);
  });

  it('carries a balance through rows that did not touch the slot, and back-fills older rows', () => {
    // Newest first: the reservation is recent, the receipt oldest.
    const card = stockCard([
      move('oh.atp', 'oh.res', 1, 9, 0),
      move('oh.atp', 'oh.ctd', 1, 10, 0),
      move(null, 'oh.atp', 10, null, 0),
    ]);
    expect(card.slots).toEqual(['oh.atp', 'oh.res', 'oh.ctd']);
    expect(column(card, 'oh.atp')).toEqual([
      [8, -1],
      [9, -1],
      [10, 10],
    ]);
    // Untouched until the newest row: its `before` (0) is every older row's balance.
    expect(column(card, 'oh.res')).toEqual([
      [1, 1],
      [0, null],
      [0, null],
    ]);
    expect(column(card, 'oh.ctd')).toEqual([
      [1, null],
      [1, 1],
      [0, null],
    ]);
  });

  it('leaves a balance unknown until a recorded one establishes it', () => {
    const card = stockCard([move('oh.atp', 'oh.ctd', 1, 4, null), move(null, 'oh.ctd', 2)]);
    expect(column(card, 'oh.ctd')).toEqual([
      [null, 1],
      [null, 2],
    ]);
    // Untouched by the older row, which takes the newest movement's recorded before.
    expect(column(card, 'oh.atp')).toEqual([
      [3, -1],
      [4, null],
    ]);
  });

  it('carries a derived balance forward through a movement with no recorded before', () => {
    const card = stockCard([move('oh.atp', null, 1, null), move(null, 'oh.atp', 5, null, 0)]);
    expect(column(card, 'oh.atp')).toEqual([
      [4, -1],
      [5, 5],
    ]);
  });

  it('reports a gap when a recorded before disagrees with the previous balance, and trusts the record', () => {
    const card = stockCard([move('oh.atp', null, 1, 7), move(null, 'oh.atp', 5, null, 0)]);
    const newest = card.cells[0]![card.slots.indexOf('oh.atp')]!;
    expect(newest).toEqual({ balance: 6, change: -1, expectedBefore: 5 });
    expect(card.cells[1]![0]!.expectedBefore).toBeUndefined();
  });

  it('ignores a zero-quantity row and leaves out the nil side of a movement', () => {
    const card = stockCard([move('oh.atp', 'oh.ctd', 0, 3, 3), move(null, 'oh.atp', 3, null, 0)]);
    expect(card.slots).toEqual(['oh.atp']);
    expect(column(card, 'oh.atp')).toEqual([
      [3, null],
      [3, 3],
    ]);
  });

  it('nets a movement whose source and destination are the same slot', () => {
    const card = stockCard([move('oh.atp', 'oh.atp', 2, 5, 5)]);
    expect(column(card, 'oh.atp')).toEqual([[5, 0]]);
  });

  it('is empty for no rows', () => {
    expect(stockCard([])).toEqual({ slots: [], cells: [] });
  });
});
