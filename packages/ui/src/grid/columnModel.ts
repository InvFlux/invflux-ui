import { type Accessor, createSignal } from 'solid-js';
import { mergeColumnOrder } from './columnOrder';
import { isNumberRecord, isStringArray, isVisibility, persistedGridSignal } from './gridStorage';
import {
  DEFAULT_GRID_SETTINGS,
  type GridSettings,
  loadGridSettings,
  saveGridSettings,
} from './gridSettings';

/**
 * What a table remembers about its columns, apart from the columns themselves: the order, which are
 * shown, the widths. One model per table, keyed by a `scope` (see {@link persistedGridSignal}); with no
 * `scope` it works the same and forgets on reload.
 *
 * The columns a table is *given* and the operator's *choices* are kept apart on purpose. A column
 * may be unavailable for a while (received/damaged before the first receipt, an invoice column before
 * an invoice) without losing its saved place or visibility: nothing here is pruned against the
 * available set, and a column that reappears finds its choice where it left it.
 */
export interface ColumnSpec {
  id: string;
  /** Cannot be hidden. The picker lists it checked and disabled. */
  required?: boolean;
  /** Hidden until the operator turns it on. Only an explicit choice is stored, so a column added later stays out of sight. */
  defaultHidden?: boolean;
}

export function isColumnVisible(spec: ColumnSpec, visibility: Record<string, boolean>): boolean {
  if (true === spec.required) return true;

  return visibility[spec.id] ?? true !== spec.defaultHidden;
}

/**
 * The available columns in the operator's order. A saved order is merged with the available ids
 * rather than filtered by them ({@link mergeColumnOrder}), so a column not yet available keeps its
 * saved slot and a column the operator has never seen lands beside its default neighbor.
 */
export function arrangeColumns<T extends { id: string }>(
  available: readonly T[],
  savedOrder: readonly string[],
): T[] {
  const byId = new Map(available.map((column) => [column.id, column]));
  const arranged: T[] = [];
  for (const id of mergeColumnOrder([...savedOrder], [...byId.keys()])) {
    const column = byId.get(id);
    if (undefined !== column) arranged.push(column);
  }

  return arranged;
}

/** `sourceId` takes `targetId`'s slot. Both are looked up in the merged order, so an absent column keeps its place. */
export function moveInOrder(
  savedOrder: readonly string[],
  availableIds: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  const order = mergeColumnOrder([...savedOrder], availableIds);
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, sourceId);

  return next;
}

/** Drop `sourceId` in front of `targetId`, or after it from the target's far half (a header drag). */
export function moveBeside(
  savedOrder: readonly string[],
  availableIds: readonly string[],
  sourceId: string,
  targetId: string,
  after: boolean,
): string[] {
  const order = mergeColumnOrder([...savedOrder], availableIds);
  if (!order.includes(sourceId) || !order.includes(targetId) || sourceId === targetId) return order;

  const rest = order.filter((id) => id !== sourceId);
  rest.splice(rest.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);

  return rest;
}

type Updater<T> = (prev: T) => T;

function stateSignal<T>(
  scope: string | undefined,
  piece: 'cols' | 'col_order' | 'col_sizing',
  fallback: T,
  isValid: (v: unknown) => v is T,
): [Accessor<T>, (updater: Updater<T>) => void] {
  if (undefined !== scope) return persistedGridSignal(scope, piece, fallback, isValid);

  const [get, set] = createSignal<T>(fallback);

  return [get, (updater) => set((prev) => updater(prev))];
}

export interface ColumnModel {
  order: Accessor<string[]>;
  setOrder: (updater: Updater<string[]>) => void;
  visibility: Accessor<Record<string, boolean>>;
  setVisibility: (updater: Updater<Record<string, boolean>>) => void;
  sizing: Accessor<Record<string, number>>;
  setSizing: (updater: Updater<Record<string, number>>) => void;
  /** Display settings: row height, wrapping, text size, header lines, per-column wrap. */
  settings: Accessor<GridSettings>;
  setSettings: (next: GridSettings) => void;
  settingsOpen: Accessor<boolean>;
  openSettings: () => void;
  closeSettings: () => void;
  /** Forget the layout choices: default order, default visibility, natural widths. Display settings are separate. */
  reset: () => void;
  pickerOpen: Accessor<boolean>;
  /** For the caller's own button: a table has no toolbar, so where the trigger sits is the caller's call. */
  openPicker: () => void;
  closePicker: () => void;
}

/** A read-only table wraps its cells unless told otherwise; the spreadsheet grid defaults to one line. */
const TABLE_SETTINGS: Partial<GridSettings> = { wrap: 'wrap' };

/** Call in a component body. */
export function createColumnModel(
  options: { scope?: string; defaults?: Partial<GridSettings> } = {},
): ColumnModel {
  const [order, setOrder] = stateSignal<string[]>(options.scope, 'col_order', [], isStringArray);
  const [visibility, setVisibility] = stateSignal<Record<string, boolean>>(
    options.scope,
    'cols',
    {},
    isVisibility,
  );
  const [sizing, setSizing] = stateSignal<Record<string, number>>(
    options.scope,
    'col_sizing',
    {},
    isNumberRecord,
  );
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const defaults = { ...TABLE_SETTINGS, ...options.defaults };
  const [settings, setSettingsSignal] = createSignal<GridSettings>(
    undefined !== options.scope
      ? loadGridSettings(options.scope, defaults)
      : { ...DEFAULT_GRID_SETTINGS, ...defaults },
  );
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return {
    order,
    setOrder,
    visibility,
    setVisibility,
    sizing,
    setSizing,
    reset() {
      setOrder(() => []);
      setVisibility(() => ({}));
      setSizing(() => ({}));
    },
    settings,
    setSettings(next) {
      setSettingsSignal(next);
      if (undefined !== options.scope) saveGridSettings(options.scope, next);
    },
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
  };
}
