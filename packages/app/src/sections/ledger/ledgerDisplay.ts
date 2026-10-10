/**
 * How this reader wants the stock ledger shown: which vocabulary, which columns, and whether the
 * keys behind the names are on display.
 *
 * These are **per-reader preferences, not store policy**. Two people can legitimately read the same
 * ledger differently — a merchant wants "Available", the person debugging a discrepancy wants
 * `oh.atp` and the actor key that identifies the principal — so they live in this browser rather
 * than on the site, and nothing here changes what the server sends or what any other reader sees.
 * A setting the *shop* decides would be a different thing, and would belong in Settings.
 */

import { __, _x } from '@invflux/i18n';
import { compareSlots, slotParts, type StockCard, type StockCardCell } from './stockCard';

export interface LedgerDisplay {
  /** Name the states ("Available") instead of keying them (`oh.atp`). */
  stateNames: boolean;
  /** Show `atp` and `res` as one Uncommitted column, and drop the rows that only move between them. */
  mergeUncommitted: boolean;
  /** Show the raw `type:ref` pair under a named actor. */
  actorKeys: boolean;
}

/**
 * Names on, keys off, nothing merged.
 *
 * Merging is opt-in because it *hides rows*: a reader who has not asked for it should never wonder
 * where a movement went. The actor key is off because the name is the answer to "who did this" and
 * the key is the answer to a question only an auditor asks — both are one click away.
 */
export const DEFAULT_DISPLAY: LedgerDisplay = {
  stateNames: true,
  mergeUncommitted: false,
  actorKeys: false,
};

const DISPLAY_KEY = 'invflux:app:ledger:display';

/**
 * This browser's preferences, defaulted field by field.
 *
 * Merged rather than replaced, so a stored object written before a preference existed keeps the rest
 * of its choices instead of being discarded whole — and anything unreadable falls back to the
 * defaults rather than throwing on a page that would otherwise render.
 */
export function loadDisplay(): LedgerDisplay {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (null === raw) return DEFAULT_DISPLAY;
    const stored: unknown = JSON.parse(raw);
    if (null === stored || 'object' !== typeof stored) return DEFAULT_DISPLAY;
    const bag = stored as Record<string, unknown>;
    const bool = (key: keyof LedgerDisplay): boolean =>
      'boolean' === typeof bag[key] ? (bag[key] as boolean) : DEFAULT_DISPLAY[key];

    return {
      stateNames: bool('stateNames'),
      mergeUncommitted: bool('mergeUncommitted'),
      actorKeys: bool('actorKeys'),
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** Remember this reader's choice; a browser that refuses storage keeps it for this visit only. */
export function saveDisplay(display: LedgerDisplay): void {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
  } catch {
    // Not remembered across visits; the choice still holds for this one.
  }
}

/** The synthetic state an `atp` + `res` column carries while they are merged. */
export const UNCOMMITTED = 'uncommitted';

/** The states folded into {@link UNCOMMITTED}: everything on hand that no order has claimed. */
const UNCOMMITTED_MEMBERS = ['atp', 'res'];

/**
 * A state in words. Read at render time so the active locale applies, and unknown values — an
 * add-on's state — come back as themselves rather than as a blank or a guess.
 */
export function stateLabel(state: string): string {
  switch (state) {
    case 'atp':
      return _x('Available', 'stock state atp, as a stock-card column head');
    case 'res':
      return _x('Reserved', 'stock state res, as a stock-card column head');
    case 'ctd':
      return _x('Committed', 'stock state ctd, as a stock-card column head');
    case 'pnd':
      return _x('Pending', 'stock state pnd, as a stock-card column head');
    case 'qi':
      return _x('Quality inspection', 'stock state qi, as a stock-card column head');
    case 'bkd':
      return _x('Blocked', 'stock state bkd, as a stock-card column head');
    case UNCOMMITTED:
      return _x('Uncommitted', 'merged stock-card column: available + reserved');
    default:
      return state;
  }
}

/**
 * A location in words. A leaf keeps its own name under its root's word ("On-hand / main"), because
 * which shelf a unit sits on is the merchant's own vocabulary, not ours to translate away.
 */
export function locationLabel(location: string): string {
  const root = location.split('/')[0] ?? location;
  const leaf = location.slice(root.length + 1);
  const rootLabel = ((): string => {
    switch (root) {
      case 'oh':
        return _x('On-hand', 'stock location oh, as a stock-card column group');
      case 'sup':
        return _x('Supplier', 'stock location sup, as a stock-card column group');
      case 'trs':
        return _x('In transit', 'stock location trs, as a stock-card column group');
      default:
        return root;
    }
  })();

  return '' === leaf ? rootLabel : `${rootLabel} / ${leaf}`;
}

/** One column of the rendered card: what it is called, and which stored slots it totals. */
export interface DisplayColumn {
  /** Stable key for this column — the slot key, or `{location}.{UNCOMMITTED}` when merged. */
  key: string;
  location: string;
  /** A state code, or {@link UNCOMMITTED}. */
  state: string;
  /** The stored slots this column sums. One, unless merged. */
  members: string[];
}

/** A location's columns, for the head that spans them. */
export interface DisplayGroup {
  location: string;
  columns: DisplayColumn[];
}

/**
 * The card as it will be rendered: columns (merged or not), their location groups, the cells under
 * them, and which rows have nothing left to show.
 */
export interface DisplayCard {
  columns: DisplayColumn[];
  groups: DisplayGroup[];
  cells: StockCardCell[][];
  /** `true` where the row changes no visible column — see {@link buildDisplayCard}. */
  hiddenRows: boolean[];
}

/** Sum a row's cells across the slots one column covers. */
function mergeCells(members: readonly StockCardCell[]): StockCardCell {
  if (1 === members.length) return members[0]!;

  // A balance is known only when every member's is: a column that totals two slots cannot report a
  // total while half of it is unestablished, and saying "null" is the honest version of that.
  const balances = members.map((c) => c.balance);
  const changes = members.map((c) => c.change).filter((c): c is number => null !== c);
  const expected = members.filter((c) => undefined !== c.expectedBefore);
  const cell: StockCardCell = {
    balance: balances.some((b) => null === b)
      ? null
      : balances.reduce((sum: number, b) => sum + (b ?? 0), 0),
    change: 0 === changes.length ? null : changes.reduce((sum, c) => sum + c, 0),
  };
  // A gap under any member is a gap in the total, and the total's own expected value is the sum.
  if (expected.length > 0 && null !== cell.balance) {
    cell.expectedBefore = members.reduce((sum, c) => sum + (c.expectedBefore ?? c.balance ?? 0), 0);
  }

  return cell;
}

/**
 * Fold the per-slot card into the columns this reader asked for.
 *
 * **The merge happens here, over computed balances — never by rewriting slot keys before the card is
 * built.** Each slot's balance is established by its own movements and its own recorded `before`; a
 * column covering two slots is their sum at every row. Renaming `oh.atp` and `oh.res` to one key
 * ahead of the card would instead seed the column from whichever side a row happened to touch, and
 * every balance under it would be wrong by the other slot's holding.
 *
 * **Which rows disappear falls out of that sum rather than being listed.** A movement from `atp` to
 * `res` adds and removes the same quantity inside one merged column, so its net change there is
 * zero and it has nothing to say on a page that no longer separates the two. The rule is "this row
 * changes no visible column", so an add-on's own movement between two merged states is covered
 * without anyone maintaining a list of movement types to suppress. Nothing is hidden while the
 * columns are unmerged: there, every movement changes something.
 */
export function buildDisplayCard(card: StockCard, display: LedgerDisplay): DisplayCard {
  const columns: DisplayColumn[] = [];
  if (display.mergeUncommitted) {
    const byKey = new Map<string, DisplayColumn>();
    for (const slot of card.slots) {
      const { location, state } = slotParts(slot);
      const merged = UNCOMMITTED_MEMBERS.includes(state);
      const key = merged ? `${location}.${UNCOMMITTED}` : slot;
      const existing = byKey.get(key);
      if (existing) existing.members.push(slot);
      else {
        const column = { key, location, state: merged ? UNCOMMITTED : state, members: [slot] };
        byKey.set(key, column);
        columns.push(column);
      }
    }
  } else {
    for (const slot of card.slots) {
      const { location, state } = slotParts(slot);
      columns.push({ key: slot, location, state, members: [slot] });
    }
  }

  const indexOf = new Map(card.slots.map((slot, i) => [slot, i]));
  const cells = card.cells.map((row) =>
    columns.map((column) => mergeCells(column.members.map((slot) => row[indexOf.get(slot)!]!))),
  );
  const hiddenRows = cells.map((row) =>
    display.mergeUncommitted
      ? row.every((cell) => null === cell.change || 0 === cell.change)
      : false,
  );

  // Columns arrive in slot order, which groups each location's together (see `compareSlots`), so a
  // group is a run rather than a regrouping.
  const groups: DisplayGroup[] = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.location === column.location) last.columns.push(column);
    else groups.push({ location: column.location, columns: [column] });
  }

  return { columns, groups, cells, hiddenRows };
}

/** A column's head when the reader wants keys rather than names. */
export function columnKeyLabel(column: DisplayColumn): string {
  return column.state === UNCOMMITTED
    ? `${column.location}.${UNCOMMITTED_MEMBERS.join('+')}`
    : column.key;
}

/** Keep the slot comparator reachable to callers of this module. */
export { compareSlots };

/** The tooltip for a column: the other vocabulary, so neither reader has to switch the setting. */
export function columnTitle(column: DisplayColumn, display: LedgerDisplay): string {
  return display.stateNames
    ? columnKeyLabel(column)
    : `${locationLabel(column.location)} · ${stateLabel(column.state)}`;
}

/** How many rows are shown out of how many the server sent, for the footer's count. */
export function visibleCount(hiddenRows: readonly boolean[]): number {
  return hiddenRows.filter((hidden) => !hidden).length;
}

/** Translated captions for the gear panel's switches. Getters, so the locale applies on read. */
export function displayOptions(): Array<{
  key: keyof LedgerDisplay;
  label: string;
  hint: string;
}> {
  return [
    {
      key: 'stateNames',
      label: __('Name the stock states'),
      hint: __('Show “Available” rather than oh.atp.'),
    },
    {
      key: 'mergeUncommitted',
      label: __('Merge available and reserved'),
      hint: __(
        'One Uncommitted column for stock no order has claimed. Movements that only shift stock between the two are hidden, because they change nothing you can see.',
      ),
    },
    {
      key: 'actorKeys',
      label: __('Show the key behind each actor'),
      hint: __('Adds the raw user:1 pair under the name, for matching against the database.'),
    },
  ];
}
