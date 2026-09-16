/**
 * The ledger as a stock card: one column per slot, and on every row each slot's balance after that
 * movement — so a slot's whole history reads down one column.
 *
 * A movement stores two sides (source and destination), each with the slot's balance *before* it.
 * That split is how a move is recorded, not how stock is read: here each side becomes a signed change
 * in its own slot's column (−q out of the source, +q into the destination), and the balance after is
 * `before + change`.
 *
 * **Every cell has a balance, not only the ones a row touched.** A slot's balance changes only through
 * its own movements, so between two of them it is simply carried. Rows older than a slot's oldest
 * movement in view take that movement's `before`. The rows are the most recent ones, contiguous, so
 * both are exact rather than estimated.
 *
 * **A gap is reported, never smoothed over.** When a movement's recorded `before` differs from the
 * balance the previous movement left, the cell says so and the recorded value wins: something moved
 * the slot outside this ledger, which is exactly what reading a stock card is meant to catch.
 */

/** The part of a ledger row the card reads. Rows come newest first, as the ledger returns them. */
export interface StockCardRow {
  fromSlot: string | null;
  toSlot: string | null;
  quantity: number;
  /** The source slot's balance before the movement, when recorded. */
  initialFrom: number | null;
  /** The destination slot's balance before the movement, when recorded. */
  initialTo: number | null;
}

export interface StockCardCell {
  /** The slot's balance after this row; null where nothing in view establishes it. */
  balance: number | null;
  /** The signed change this row made to the slot; null where the row did not touch it. */
  change: number | null;
  /** The balance this row carried in, when its recorded `before` disagrees with it. */
  expectedBefore?: number;
}

export interface StockCard {
  /** Column order: along the stock flow (see {@link compareSlots}). */
  slots: string[];
  /** `cells[row][slot]`, rows in the order given. */
  cells: StockCardCell[][];
}

/** Where a location sits along the stock flow, left to right: supplier side → inbound → on hand → out. */
function locationRank(location: string): number {
  if ('sup' === location || location.startsWith('sup/')) return 0;
  if ('trs/inb' === location || location.startsWith('trs/inb/')) return 1;
  if ('oh' === location || location.startsWith('oh/')) return 2;
  if ('trs/dsp' === location || location.startsWith('trs/dsp/')) return 3;
  if ('trs/rto' === location || location.startsWith('trs/rto/')) return 4;
  return 5;
}

/** Within a location: not yet promisable, promisable, then held or committed, then blocked. */
const STATE_RANK: Record<string, number> = { pnd: 0, qi: 1, atp: 2, res: 3, ctd: 4, bkd: 5 };

/**
 * A slot key's location and state. The key's order is the slot space's dimension order, not a fixed
 * notation — the engine stores `atp.oh` (state first) — so the state is recognised rather than
 * assumed to come second: a known state on either side, or else whichever side the other part is a
 * known location for. A key with one segment is a location alone.
 */
export function slotParts(slot: string): { location: string; state: string } {
  const dot = slot.indexOf('.');
  if (-1 === dot) return { location: slot, state: '' };
  const first = slot.slice(0, dot);
  const second = slot.slice(dot + 1);
  const stateFirst = first in STATE_RANK || (!(second in STATE_RANK) && locationRank(second) < 5);
  return stateFirst ? { location: second, state: first } : { location: first, state: second };
}

/**
 * Order slots as stock flows: by location along the flow, then by state. Values this table does not
 * know — an add-on's location or state — sort after the known ones, alphabetically, so the order is
 * always total and stable.
 */
export function compareSlots(a: string, b: string): number {
  const pa = slotParts(a);
  const pb = slotParts(b);
  return (
    locationRank(pa.location) - locationRank(pb.location) ||
    (STATE_RANK[pa.state] ?? 99) - (STATE_RANK[pb.state] ?? 99) ||
    a.localeCompare(b)
  );
}

/** What one row did to one slot: its net change, and the balance before it when recorded. */
interface Touch {
  change: number;
  before: number | null;
}

function touchesOf(row: StockCardRow): Map<string, Touch> {
  const touches = new Map<string, Touch>();
  if (0 === row.quantity) return touches;
  const add = (slot: string | null, change: number, before: number | null): void => {
    if (null === slot) return;
    const prev = touches.get(slot);
    touches.set(slot, {
      change: (prev?.change ?? 0) + change,
      before: prev?.before ?? before,
    });
  };
  add(row.fromSlot, -row.quantity, row.initialFrom);
  add(row.toSlot, row.quantity, row.initialTo);
  return touches;
}

export function stockCard(rows: readonly StockCardRow[]): StockCard {
  const touches = rows.map(touchesOf);
  const slots = [...new Set(touches.flatMap((t) => [...t.keys()]))].sort(compareSlots);
  const cells: StockCardCell[][] = rows.map(() => []);

  slots.forEach((slot, col) => {
    // The balance before the oldest movement in view, which is also every older row's balance.
    let oldest: Touch | undefined;
    for (let i = rows.length - 1; i >= 0 && undefined === oldest; i--)
      oldest = touches[i]!.get(slot);
    let balance: number | null = oldest?.before ?? null;

    // Oldest to newest, so each movement starts from what the one before it left.
    for (let i = rows.length - 1; i >= 0; i--) {
      const touch = touches[i]!.get(slot);
      if (undefined === touch) {
        cells[i]![col] = { balance, change: null };
        continue;
      }
      const cell: StockCardCell = { balance: null, change: touch.change };
      if (null !== touch.before) {
        if (null !== balance && balance !== touch.before) cell.expectedBefore = balance;
        balance = touch.before;
      }
      balance = null === balance ? null : balance + touch.change;
      cell.balance = balance;
      cells[i]![col] = cell;
    }
  });

  return { slots, cells };
}
