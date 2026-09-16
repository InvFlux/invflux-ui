import { __, _x } from '@invflux/i18n';

/**
 * The dispatch queue's toggleable columns, in render order.
 *
 * The order here is the *default* one; an operator's reordering is stored alongside their hidden
 * set, so a column added in a later release still lands where this list puts it rather than
 * wherever a saved order happens to leave room. See {@link orderColumns}.
 *
 * The row's leading checkbox is deliberately absent: it is structure, not data, and a queue you
 * cannot select from is a different surface rather than a narrower one.
 *
 * Labels are getters, not strings — this module is imported at chunk load, and a `__()` evaluated
 * then resolves before the locale is in place.
 */
export interface QueueColumn {
  id: QueueColumnId;
  label: () => string;
  /** Cannot be hidden — hiding it would leave rows with no visible identity. */
  required?: boolean;
  /**
   * Starts hidden, and stays hidden until an operator shows it — for a column most stores would
   * read as noise. Honoured for operators who saved a column choice before it existed, too: see
   * {@link loadHiddenColumns}.
   */
  defaultHidden?: boolean;
}

export type QueueColumnId =
  | 'order'
  | 'age'
  | 'customer'
  | 'annotations'
  | 'payment'
  | 'dispatch'
  | 'native'
  | 'stock'
  | 'progress'
  | 'edt'
  | 'shipping_method'
  | 'shipping_class';

export const QUEUE_COLUMNS: QueueColumn[] = [
  {
    id: 'order',
    label: () => _x('Order', 'dispatch queue column: the sales order number'),
    required: true,
  },
  { id: 'age', label: () => _x('Age', 'dispatch queue column: how long ago the order was placed') },
  { id: 'customer', label: () => __('Customer') },
  { id: 'annotations', label: () => __('Tags, notes & actions') },
  { id: 'payment', label: () => __('Payment') },
  {
    id: 'dispatch',
    label: () =>
      _x('Dispatch', 'dispatch queue column: where the order stands in picking and packing'),
  },
  // The host's own status. Its header text is the *store's* wording for it, supplied at render.
  {
    id: 'native',
    label: () =>
      _x(
        'Status',
        'dispatch queue column: the WooCommerce order status, worded as WooCommerce words it',
      ),
  },
  // Not "Stock": the column carries *exceptions* and is empty on a healthy order, so a bare
  // "Stock" header invites the reader to expect a quantity.
  { id: 'stock', label: () => __('Stock concerns') },
  {
    id: 'progress',
    label: () =>
      _x('Progress', 'dispatch queue column: order lines staged, out of the lines to ship'),
  },
  { id: 'edt', label: () => _x('Ship by', 'order: the date it should ship by (a deadline)') },
  // How the order ships, beside the classes of what is in it: a packer reads the two together.
  { id: 'shipping_method', label: () => __('Shipping method') },
  // Plural, because the cell is the set of classes across the order's lines — `none, fragile` is
  // one order carrying two, and a singular header would suggest one value per order.
  //
  // Hidden by default: most stores use classes to price shipping, not to pack it, so on most rows
  // the cell reads `none`. The filter answers "which orders carry a fragile line" either way, and
  // the order page shows each line's class where the packing happens.
  { id: 'shipping_class', label: () => __('Shipping classes'), defaultHidden: true },
];

const STORAGE_KEY = 'invflux:dispatch-columns';
const SHOWN_STORAGE_KEY = 'invflux:dispatch-columns-shown';
const ORDER_STORAGE_KEY = 'invflux:dispatch-column-order';

/** The columns hidden until an operator chooses to show them — the hidden set a reset returns to. */
export function defaultHiddenColumns(): QueueColumnId[] {
  return QUEUE_COLUMNS.filter((c) => c.defaultHidden === true).map((c) => c.id);
}

function readIds(key: string, known: ReadonlySet<QueueColumnId>): QueueColumnId[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is QueueColumnId => typeof id === 'string' && known.has(id as QueueColumnId),
    );
  } catch {
    // A private window, cleared site data, or storage the browser refuses: fall back to defaults
    // rather than failing the surface over a preference.
    return [];
  }
}

/**
 * Column choices live in `localStorage`, next to the DataGrid's own display settings
 * (`invflux:grid-settings:*`) and for the same reason: which columns *this operator* wants on
 * *this screen* is a per-browser convenience, not store policy, and putting it on the server would
 * make one packer's narrow laptop reshape the queue for everyone.
 *
 * Stored as the **hidden** set rather than the visible one, so a column added in a later release
 * shows up by default instead of being silently absent for everyone who ever opened the picker.
 *
 * A {@link QueueColumn.defaultHidden} column inverts that, so it is tracked the other way round: a
 * second key holds the default-hidden columns an operator has chosen to *show*, and everything else
 * among them stays hidden. Folding it into the hidden set instead would show the column to every
 * operator whose stored set predates it — the exact people it was meant to stay out of the way of.
 */
export function loadHiddenColumns(): QueueColumnId[] {
  const hideable = new Set(QUEUE_COLUMNS.filter((c) => c.required !== true).map((c) => c.id));
  const hidden = new Set(readIds(STORAGE_KEY, hideable));
  const shown = new Set(readIds(SHOWN_STORAGE_KEY, hideable));
  for (const id of defaultHiddenColumns()) if (!shown.has(id)) hidden.add(id);

  return [...hidden];
}

export function saveHiddenColumns(hidden: QueueColumnId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
    localStorage.setItem(
      SHOWN_STORAGE_KEY,
      JSON.stringify(defaultHiddenColumns().filter((id) => !hidden.includes(id))),
    );
  } catch {
    // Nothing to do — the session keeps its in-memory choice and the next one starts from defaults.
  }
}

/**
 * The operator's column order, as a list of ids — stored beside the hidden set and for the same
 * reason, but as a *separate* key: the two are independent choices, and a reader of either should
 * not have to know the other's shape.
 *
 * Unknown ids are dropped on read rather than kept as placeholders: an id in storage that no
 * release defines is a column that has been removed, and holding its slot open would leave a gap
 * whose cause is invisible.
 */
export function loadColumnOrder(): QueueColumnId[] {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(QUEUE_COLUMNS.map((c) => c.id));

    return parsed.filter(
      (id): id is QueueColumnId => typeof id === 'string' && known.has(id as QueueColumnId),
    );
  } catch {
    return [];
  }
}

export function saveColumnOrder(order: QueueColumnId[]): void {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // As above: a preference that cannot be written is not a reason to fail the surface.
  }
}

/**
 * The columns to render, in the operator's order.
 *
 * A stored order is a **partial** statement — it says where the columns that existed when it was
 * saved should go, and nothing about any column added since. So the saved ids are laid down first,
 * then every remaining column is inserted **after the neighbour it follows by default**, which puts
 * a new column where its author meant it to be rather than at whichever end is convenient. Landing
 * new columns at the end would be the quiet failure here: they would appear off the right edge of a
 * customised queue and read as missing.
 *
 * A stored order that is empty (never customised, or unreadable) yields the defaults unchanged.
 */
export function orderColumns(order: readonly QueueColumnId[]): QueueColumn[] {
  const byId = new Map(QUEUE_COLUMNS.map((c) => [c.id, c]));
  const result: QueueColumn[] = [];
  for (const id of order) {
    const column = byId.get(id);
    if (column !== undefined && !result.includes(column)) result.push(column);
  }

  QUEUE_COLUMNS.forEach((column, index) => {
    if (result.includes(column)) return;
    // Walking the defaults in order means this column's default predecessor is already placed,
    // whether it came from storage or was inserted here a moment ago.
    const predecessor = index === 0 ? undefined : QUEUE_COLUMNS[index - 1];
    const at = predecessor === undefined ? -1 : result.findIndex((c) => c.id === predecessor.id);
    result.splice(at + 1, 0, column);
  });

  return result;
}

/**
 * Move `sourceId` into `targetId`'s slot, as a drag means it: the dragged column ends up **at the
 * index the target held**, and the target shifts by one to make room.
 *
 * Both indices are read *before* the removal, deliberately — that is what makes the two directions
 * symmetric. Re-reading the target's index after taking the source out would silently land a
 * downward drag one slot short of where it was dropped, while an upward drag stayed exact.
 */
export function moveColumn(
  order: readonly QueueColumnId[],
  sourceId: QueueColumnId,
  targetId: QueueColumnId,
): QueueColumnId[] {
  const next = [...order];
  const from = next.indexOf(sourceId);
  const to = next.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);

  return next;
}
