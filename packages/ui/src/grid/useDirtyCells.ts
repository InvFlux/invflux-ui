/**
 * The WorkbenchGrid dirty-cell store — the staged-edit model behind the grid's edit → review → save
 * flow. A reactive `Map<subjectId, DirtyRow>` plus the operations the grid + save flow need: stage a
 * cell, read a staged value, revert a set of cells, discard everything, and an optimistic "pending"
 * set that keeps submitted cells showing their staged value (faded + locked) across the in-flight +
 * refetch window.
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
  /** Drop the staged edits for a set of cells (select-and-revert). Empties + prunes rows. */
  revert: (cells: Array<{ subjectId: number; columnId: string }>) => void;
  /** Drop every staged edit + clear the pending set. */
  discardAll: () => void;

  // ── Optimistic pending (submitted, awaiting the server's reconcile) ──
  pendingCells: () => Set<string>;
  isPending: (subjectId: number, columnId: string) => boolean;
  setPending: (keys: Set<string>) => void;
  clearPending: () => void;
}

export function useDirtyCells(): DirtyCellsStore {
  const [dirtyCells, setDirtyCells] = createSignal<Map<number, DirtyRow>>(new Map());
  const [pendingCells, setPendingCells] = createSignal<Set<string>>(new Set());

  const isDirty = (): boolean => dirtyCells().size > 0;

  const edit = (subjectId: number, columnId: string): DirtyEdit | undefined =>
    dirtyCells().get(subjectId)?.cells.get(columnId);

  const isCellDirty = (subjectId: number, columnId: string): boolean =>
    edit(subjectId, columnId) !== undefined;

  const stagedValue = (subjectId: number, columnId: string, original: unknown): unknown => {
    const e = edit(subjectId, columnId);
    return e ? e.new : original;
  };

  const patch = (
    subjectId: number,
    columnId: string,
    original: unknown,
    next: unknown,
    name: string,
    sku: string,
  ): void => {
    setDirtyCells((prev) => {
      const map = new Map(prev);
      const existing = map.get(subjectId) ?? { name, sku, cells: new Map<string, DirtyEdit>() };
      const cells = new Map(existing.cells);
      if (next === original) cells.delete(columnId);
      else cells.set(columnId, { original, new: next });
      if (cells.size === 0) map.delete(subjectId);
      else map.set(subjectId, { ...existing, cells });
      return map;
    });
  };

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
    setPendingCells(new Set<string>());
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
    revert,
    discardAll,
    pendingCells,
    isPending,
    setPending: (keys) => setPendingCells(keys),
    clearPending: () => setPendingCells(new Set<string>()),
  };
}
