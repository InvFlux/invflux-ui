/**
 * The WorkbenchGrid dirty-cell store — the staged-edit model behind the grid's edit → review → save
 * flow. A reactive `Map<subjectId, DirtyRow>` plus the operations the grid + save flow need: stage a
 * cell, read a staged value, revert a set of cells, discard everything, and an optimistic "pending"
 * set that keeps submitted cells showing their staged value (faded + locked) across the in-flight +
 * refetch window.
 *
 * **Pending is a set, not a snapshot.** A large apply is submitted as several requests that settle
 * independently, so cells are added and released per request: a whole-set replace would let the
 * first request home unlock cells the others still have outstanding, and an unlocked cell accepts
 * an edit whose `original` was never confirmed. That baseline is not decoration — a stock
 * correction derives its movement from it, so sampling it from an unconfirmed value writes the
 * wrong movement silently, with no error anywhere. The lock is what makes that unrepresentable.
 *
 * Locking is per **cell**; refusing a *save* is per **row** ({@link DirtyCellsStore.isRowPending}),
 * because columns validate against each other and a row's edits are submitted together.
 *
 * Extracted from `@invflux/workbench`'s in-component dirty helpers (`patchDirtyCell` / `dirtyEdit` /
 * `stagedValue` / `isDirty` / pending) so the Central Workbench and the embedded product grid share
 * one model. Pure reactive state — no DOM, no fetch. The on-hand-correction delta-first semantics
 * (the `total` cell staging its frozen `new − original` over the live baseline) is NOT here: it's a
 * rendering + apply concern layered on top in v3, so this store stays value-generic.
 */

import { createSignal } from 'solid-js';
import type { DirtyEdit, DirtyRow } from '../workbenchGridTypes';

/** Composite key for the optimistic pending set — one string per (subject, column) cell. */
export function pendingCellKey(subjectId: number, columnId: string): string {
  return `${subjectId}:${columnId}`;
}

/** One staged cell edit, as {@link DirtyCellsStore.patchMany} takes them. */
export interface CellPatch {
  subjectId: number;
  columnId: string;
  original: unknown;
  next: unknown;
  /** Snapshotted onto the row for the review modal, which has no access to the grid's rows. */
  name: string;
  sku: string;
}

export interface DirtyCellsStore {
  /** The raw reactive map — for building save-review groups / the apply request. */
  dirtyCells: () => Map<number, DirtyRow>;
  /** Any staged edit anywhere. Drives the Save button + the "discard?" guard. */
  isDirty: () => boolean;
  /** The staged edit for a (subject, column) cell, or undefined. */
  edit: (subjectId: number, columnId: string) => DirtyEdit | undefined;
  /** Whether a (subject, column) cell carries a staged edit. */
  isCellDirty: (subjectId: number, columnId: string) => boolean;
  /** The staged value for a cell, else the supplied persisted `original`. Reactive. */
  stagedValue: (subjectId: number, columnId: string, original: unknown) => unknown;
  /**
   * Stage (or clear) one cell edit. A round-trip to `original` removes the cell; a row left with no
   * dirty cells is dropped. `name`/`sku` are snapshotted onto the row for the review modal.
   */
  patch: (
    subjectId: number,
    columnId: string,
    original: unknown,
    next: unknown,
    name: string,
    sku: string,
  ) => void;
  /**
   * Stage a set of cell edits as **one** write — same semantics as calling {@link patch} per cell,
   * but the grid re-renders once instead of once per cell.
   *
   * This is the shape any multi-cell caller wants, and the reason is cost, not tidiness: a bulk
   * edit over a wide selection is `edits.length` signal writes, each notifying every cell in the
   * grid that reads `stagedValue` / `isCellDirty`. That is quadratic in the selection and is felt
   * as a stalled modal at a few hundred cells. Prefer this over a loop, always.
   */
  patchMany: (edits: readonly CellPatch[]) => void;
  /** Drop the staged edits for a set of cells (select-and-revert). Empties + prunes rows. */
  revert: (cells: Array<{ subjectId: number; columnId: string }>) => void;
  /** Drop every staged edit + clear the pending set. */
  discardAll: () => void;

  // ── Optimistic pending (submitted, awaiting the server's reconcile) ──
  /**
   * The cells with a request outstanding, as {@link pendingCellKey} strings.
   *
   * Several submissions can be outstanding at once, each settling independently, so this is a
   * **set with add/remove semantics** rather than one replaceable snapshot: a request that settles
   * releases *its own* cells and leaves everyone else's locked.
   */
  pendingCells: () => Set<string>;
  /** Whether a (subject, column) cell has a request outstanding. Drives the read-only guard. */
  isPending: (subjectId: number, columnId: string) => boolean;
  /**
   * Whether ANY cell on this row has a request outstanding.
   *
   * The save unit is the row — columns validate against each other, and a row's edits travel
   * together — so a row with anything in flight cannot be re-submitted, even through a cell that
   * is itself free.
   */
  isRowPending: (subjectId: number) => boolean;
  /** Whether anything at all is outstanding. */
  hasPending: () => boolean;
  /** Mark cells as in flight, keeping every cell already outstanding. */
  addPending: (keys: Iterable<string>) => void;
  /**
   * Take the submission lock for whole rows: accept the rows with nothing outstanding, marking
   * their cells in flight, and refuse the rest. Returns what it accepted, what it refused, and the
   * exact keys it locked — pass those same keys to {@link resolvePending} when the request settles.
   *
   * **Test-and-set in ONE call, and that is the point.** A caller that reads {@link isRowPending}
   * and calls {@link addPending} some lines later is only safe while a signal write is visible to
   * the very next read, which is a property of the scheduler rather than of this store. Fusing the
   * two makes the admission decision independent of when anything becomes observable: two callers
   * in the same tick cannot both be accepted, because the second one's check runs after the first
   * one's mark, in plain data.
   *
   * Use this for admission control (may this submission go out?). Use {@link isRowPending} for what
   * the grid *shows* — that one is a reactive read and must stay one.
   */
  claimRows: (rows: Iterable<{ subjectId: number; columnIds: Iterable<string> }>) => {
    accepted: number[];
    refused: number[];
    keys: Set<string>;
  };
  /** Release the cells one settled request owns. Other requests' cells stay locked. */
  resolvePending: (keys: Iterable<string>) => void;
  /** Release everything. For abandoning a batch outright, never for one request settling. */
  clearPending: () => void;
}

export function useDirtyCells(): DirtyCellsStore {
  const [dirtyCells, setDirtyCells] = createSignal<Map<number, DirtyRow>>(new Map());

  /**
   * The outstanding cells, plus the rows they belong to.
   *
   * Both indexes live in ONE signal and are rebuilt together in every update, so they cannot
   * disagree. The row index is not a cache to keep in step by hand — a `rows` set updated
   * separately from `cells` drifts the first time an add and a resolve interleave, and the drift
   * presents as a row the merchant can never save again, with nothing to explain it.
   *
   * It is also not a `createMemo`: the row lookup runs per rendered row on a grid that can be
   * thousands of rows long, so it must be O(1) rather than a scan, and building it at write time
   * keeps the read free without depending on a reactive graph the store would otherwise not need.
   */
  const EMPTY_PENDING = (): { cells: Set<string>; rows: Set<number> } => ({
    cells: new Set(),
    rows: new Set(),
  });

  /**
   * The authoritative index, kept in a plain variable and replaced synchronously on every write.
   *
   * The signal below mirrors it so the grid re-renders; this one is what {@link claimRows} decides
   * against. Keeping the two separate is deliberate: a *reactive* read answers "what is on screen",
   * which a framework is entitled to make lag a write by a microtask, and admission control must
   * not be built on that. Everything here is replace-never-mutate, so a mirrored snapshot handed to
   * a consumer stays valid.
   */
  let live = EMPTY_PENDING();
  const [pending, setPending] = createSignal(live);
  const pendingCells = (): Set<string> => pending().cells;

  /** Rebuild both indexes from a mutated copy of the cell set, then publish. */
  function commitPending(mutate: (cells: Set<string>) => void): void {
    const cells = new Set(live.cells);
    mutate(cells);
    const rows = new Set<number>();
    for (const key of cells) {
      // Split on the separator, never a prefix match: subject 1 and subject 12 share a leading
      // character, so a prefix test would block row 1 whenever row 12 was saving.
      const sep = key.indexOf(':');
      if (sep > 0) rows.add(Number(key.slice(0, sep)));
    }
    live = { cells, rows };
    setPending(live);
  }

  function resetPending(): void {
    live = EMPTY_PENDING();
    setPending(live);
  }

  const isDirty = (): boolean => dirtyCells().size > 0;

  const edit = (subjectId: number, columnId: string): DirtyEdit | undefined =>
    dirtyCells().get(subjectId)?.cells.get(columnId);

  const isCellDirty = (subjectId: number, columnId: string): boolean =>
    edit(subjectId, columnId) !== undefined;

  const stagedValue = (subjectId: number, columnId: string, original: unknown): unknown => {
    const e = edit(subjectId, columnId);
    return e ? e.new : original;
  };

  const patchMany = (edits: readonly CellPatch[]): void => {
    if (edits.length === 0) return;
    setDirtyCells((prev) => {
      const map = new Map(prev);
      // Rows whose `cells` map this pass has already replaced with a copy of its own. A second edit
      // to the same row then writes into that copy rather than cloning it again — nothing observes
      // the map between two edits of one pass, so the intermediate clones would be pure waste.
      // `prev`'s own maps are never mutated, which is what keeps the update immutable.
      const copied = new Set<number>();
      for (const { subjectId, columnId, original, next, name, sku } of edits) {
        const row = map.get(subjectId) ?? { name, sku, cells: new Map<string, DirtyEdit>() };
        const cells = copied.has(subjectId) ? row.cells : new Map(row.cells);
        copied.add(subjectId);
        if (next === original) cells.delete(columnId);
        else cells.set(columnId, { original, new: next });
        if (cells.size === 0) map.delete(subjectId);
        else map.set(subjectId, { ...row, cells });
      }
      return map;
    });
  };

  const patch = (
    subjectId: number,
    columnId: string,
    original: unknown,
    next: unknown,
    name: string,
    sku: string,
  ): void => patchMany([{ subjectId, columnId, original, next, name, sku }]);

  const revert = (targets: Array<{ subjectId: number; columnId: string }>): void => {
    setDirtyCells((prev) => {
      const map = new Map(prev);
      for (const { subjectId, columnId } of targets) {
        const row = map.get(subjectId);
        if (!row) continue;
        const cells = new Map(row.cells);
        cells.delete(columnId);
        if (cells.size === 0) map.delete(subjectId);
        else map.set(subjectId, { ...row, cells });
      }
      return map;
    });
  };

  const discardAll = (): void => {
    setDirtyCells(new Map());
    resetPending();
  };

  const isPending = (subjectId: number, columnId: string): boolean =>
    pendingCells().has(pendingCellKey(subjectId, columnId));

  return {
    dirtyCells,
    isDirty,
    edit,
    isCellDirty,
    stagedValue,
    patch,
    patchMany,
    revert,
    discardAll,
    pendingCells,
    isPending,
    isRowPending: (subjectId) => pending().rows.has(subjectId),
    hasPending: () => pending().cells.size > 0,
    addPending: (keys) =>
      commitPending((cells) => {
        for (const k of keys) cells.add(k);
      }),
    claimRows: (rows) => {
      const accepted: number[] = [];
      const refused: number[] = [];
      const keys = new Set<string>();
      // Decided against `live`, never `pending()`: this is the admission decision, and it has to
      // hold for a second caller in the same tick that has not seen a re-render yet.
      const takenRows = live.rows;
      for (const { subjectId, columnIds } of rows) {
        if (takenRows.has(subjectId)) {
          refused.push(subjectId);
          continue;
        }
        accepted.push(subjectId);
        for (const columnId of columnIds) keys.add(pendingCellKey(subjectId, columnId));
      }
      // One write for the whole claim; `commitPending` rebuilds the row index from the cell set, so
      // the rows just accepted are refused by the next claim without a second pass.
      if (keys.size > 0)
        commitPending((cells) => {
          for (const k of keys) cells.add(k);
        });
      return { accepted, refused, keys };
    },
    resolvePending: (keys) =>
      commitPending((cells) => {
        for (const k of keys) cells.delete(k);
      }),
    clearPending: resetPending,
  };
}
