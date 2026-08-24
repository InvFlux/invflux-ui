/**
 * Bulk-edit modal — edit one value across many rows from a multi-cell grid selection (F2 /
 * right-click "Edit selection…", or a single `editable_multi` term-picker cell). One control per
 * editable, non-reason-gated column in the selection:
 *  - **multi-value** (term pickers, `editable_multi`): when all rows share the same set (or it's a
 *    single cell) one Combobox edits the set directly; when they disagree, an "add" + a "remove"
 *    Combobox apply `(current ∪ add) \ remove` per row.
 *  - **single-value**: uniform cells show the value; mixed cells show an empty field + a "Modify"
 *    checkbox. Only touched / changed controls emit edits.
 *
 * Applying stages each edit into the host's dirty model via `onApply`; the normal Save → review →
 * apply flow then runs. Extracted from `@invflux/workbench` so the Central Workbench and the embedded
 * product grid share it. The `row` carried on each target/result is opaque here — the grid passes its
 * typed {@link WorkbenchRow} through so the host can stage against it.
 */

import { createEffect, createMemo, For, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { __, sprintf } from '@invflux/i18n';
import { Modal } from './Modal';
import { Combobox } from './Combobox';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Input } from './Input';
import { Select } from './Select';
import type { GridColumnMeta, TaxonomySpace } from './types';
import type { WorkbenchRow } from './workbenchGridTypes';

/** One column targeted by a bulk edit: its metadata + the selected rows with their current values. */
export interface BulkEditColumn {
  meta: GridColumnMeta;
  /** `value` is the *current* value — a staged edit if any, else persisted. It's the baseline for the
   *  controls' state + uniformity AND what edits are tracked/pruned against (so reopening continues
   *  from the staged value; a revert restores persisted by dropping the dirty entry). */
  targets: Array<{ subjectId: number; row: WorkbenchRow; value: unknown }>;
}

/** An edit the bulk modal produced; the caller stages it into the dirty model. */
export interface BulkEditResult {
  subjectId: number;
  columnId: string;
  original: unknown;
  newValue: unknown;
  row: WorkbenchRow;
}

export interface BulkEditModalProps {
  columns: BulkEditColumn[];
  taxonomySpace: TaxonomySpace | undefined;
  onApply: (edits: BulkEditResult[]) => void;
  onClose: () => void;
  /** Portal the modal to this light-DOM root (shadow-DOM / transformed-ancestor surfaces). */
  mount?: HTMLElement;
}

const bulkNormalize = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const sameIdSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

export function BulkEditModal(props: BulkEditModalProps) {
  interface Descriptor {
    meta: GridColumnMeta;
    targets: BulkEditColumn['targets'];
    multi: boolean;
    uniform: boolean;
    uniformValue: string;
    /** Multi-value: the shared term-id set (as strings) when all rows agree — the single-combobox seed. */
    uniformIds: string[];
    options: Array<{ value: string; label: string; depth?: number }>;
    removeOptions: Array<{ value: string; label: string; depth?: number }>;
  }

  const descriptors: Descriptor[] = props.columns.map((column) => {
    const multi = column.meta.kind === 'editable_multi';
    if (multi) {
      const taxonomy = typeof column.meta.editorConfig.taxonomy === 'string' ? column.meta.editorConfig.taxonomy : '';
      const space = props.taxonomySpace?.[taxonomy];
      const options = space
        ? Object.values(space.values).map((v) => ({ value: String(v.id), label: v.name, depth: v.depth }))
        : [];
      const rowSets = column.targets.map((t) => (Array.isArray(t.value) ? (t.value as number[]) : []));
      // Uniform (incl. a single cell) → one combobox showing the shared set; mixed → add/remove deltas.
      const uniform = rowSets.every((set) => sameIdSet(set, rowSets[0] ?? []));
      const union = new Set(rowSets.flat());
      return {
        meta: column.meta,
        targets: column.targets,
        multi,
        uniform,
        uniformValue: '',
        uniformIds: uniform ? (rowSets[0] ?? []).map(String) : [],
        options,
        removeOptions: options.filter((o) => union.has(Number(o.value))),
      };
    }

    const values = column.targets.map((t) => bulkNormalize(t.value));
    const uniform = values.every((v) => v === values[0]);
    const options =
      column.meta.dataType === 'bool'
        ? [
            { value: 'true', label: __('Yes') },
            { value: 'false', label: __('No') },
          ]
        : Array.isArray(column.meta.editorConfig.options)
          ? (column.meta.editorConfig.options as Array<{ value: string; label: string }>)
          : [];
    return {
      meta: column.meta,
      targets: column.targets,
      multi,
      uniform,
      uniformValue: uniform ? (values[0] ?? '') : '',
      uniformIds: [],
      options,
      removeOptions: [],
    };
  });

  interface ColState {
    touched: boolean;
    value: string;
    add: string[];
    remove: string[];
    /** Multi-value uniform editing: the staged term-id set (replaces all rows' sets). */
    set: string[];
  }
  const initial: Record<string, ColState> = {};
  for (const d of descriptors) {
    initial[d.meta.id] = {
      touched: false,
      value: d.uniform ? d.uniformValue : '',
      add: [],
      remove: [],
      set: d.multi && d.uniform ? d.uniformIds : [],
    };
  }
  const [state, setState] = createStore<Record<string, ColState>>(initial);

  // Auto-focus the first edit control on open (skip the "Modify" checkbox; a Combobox's focusable
  // element is its inner <input>).
  let bodyRef: HTMLDivElement | undefined;
  createEffect(() => {
    bodyRef?.querySelector<HTMLElement>('input:not([type="checkbox"]), select')?.focus();
  });

  // Single-value field change: typing a non-empty value (or, when uniform, anything differing from the
  // shared value) marks the control "touched" so it emits an edit.
  const onFieldInput = (d: Descriptor, value: string): void => {
    setState(d.meta.id, 'value', value);
    setState(d.meta.id, 'touched', d.uniform ? value !== d.uniformValue : value !== '');
  };
  const onModifyToggle = (id: string, checked: boolean): void => {
    setState(id, 'touched', checked);
    if (!checked) setState(id, 'value', '');
  };

  const apply = (): void => {
    const edits: BulkEditResult[] = [];
    for (const d of descriptors) {
      const s = state[d.meta.id];
      if (d.multi) {
        if (d.uniform) {
          // One shared set → replace every row's terms with the edited set (pruned when unchanged).
          const set = s.set.map(Number);
          for (const t of d.targets) {
            const current = Array.isArray(t.value) ? (t.value as number[]) : [];
            if (!sameIdSet(current, set)) {
              edits.push({ subjectId: t.subjectId, columnId: d.meta.id, original: current, newValue: set, row: t.row });
            }
          }
          continue;
        }
        const add = s.add.map(Number);
        const remove = new Set(s.remove.map(Number));
        if (add.length === 0 && remove.size === 0) continue;
        for (const t of d.targets) {
          const current = Array.isArray(t.value) ? (t.value as number[]) : [];
          const next = [...new Set([...current, ...add])].filter((id) => !remove.has(id));
          if (!sameIdSet(current, next)) {
            edits.push({ subjectId: t.subjectId, columnId: d.meta.id, original: current, newValue: next, row: t.row });
          }
        }
        continue;
      }
      if (!s.touched) continue;
      // Coerce to the column's value shape so no-op pruning + in-grid display work: bool → boolean,
      // integer (`number`) → number|null, decimals/text/enum stay strings (WC stores decimals as strings).
      let newValue: unknown;
      if (d.meta.dataType === 'bool') {
        newValue = s.value === 'true';
      } else if (d.meta.dataType.startsWith('number')) {
        const trimmed = s.value.trim();
        if (trimmed === '') {
          newValue = null;
        } else {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed)) continue; // garbage typed → don't stage this column
          newValue = parsed;
        }
      } else {
        newValue = s.value;
      }
      for (const t of d.targets) {
        // Track against the current (staged) value so reopening continues from it; the host prunes
        // no-ops (newValue === original) downstream.
        edits.push({ subjectId: t.subjectId, columnId: d.meta.id, original: t.value, newValue, row: t.row });
      }
    }
    props.onApply(edits);
  };

  // Ctrl/Cmd+Enter or Ctrl/Cmd+S applies the bulk edits (same as the button). Capture phase +
  // stopPropagation pre-empts the grid's bubble handler (which would otherwise open the save flow).
  createEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== 'Enter' && event.key !== 's' && event.key !== 'S') return;
      event.preventDefault();
      event.stopPropagation();
      apply();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const rowCount = createMemo(() => new Set(props.columns.flatMap((c) => c.targets.map((t) => t.subjectId))).size);

  return (
    <Modal onClose={props.onClose} mount={props.mount} backdropClass="flex items-center justify-center bg-black/30 p-6" label={__('Edit selection')}>
      <div
        class="invflux-bulk-edit flex max-h-[80vh] w-full max-w-lg flex-col rounded border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="border-b border-border px-4 py-3">
          <h2 class="text-base font-semibold text-text">{__('Edit selection')}</h2>
          <p class="text-xs text-text-muted">
            {sprintf(
              /* translators: 1: column count, 2: row count */
              __('%1$d column(s) × %2$d row(s)'),
              descriptors.length,
              rowCount(),
            )}
          </p>
        </header>

        {/* When a term-picker (Combobox) control is present, reserve height so its open dropdown
            isn't clipped by the scroll container (the SPA's Shadow DOM rules out a portal). */}
        <div
          ref={bodyRef}
          class="flex flex-col gap-4 overflow-y-auto px-4 py-4"
          classList={{ 'min-h-[22rem]': descriptors.some((d) => d.multi) }}
        >
          <Show when={descriptors.length > 0} fallback={<p class="text-sm text-text-muted">{__('No editable columns in the selection.')}</p>}>
            <For each={descriptors}>
              {(d) => (
                <div class="flex flex-col gap-1">
                  <Show
                    when={d.multi}
                    fallback={
                      <>
                        <div class="flex items-center justify-between gap-2">
                          <label class="text-sm font-medium text-text">{d.meta.label}</label>
                          <Show when={!d.uniform}>
                            <label class="flex items-center gap-1 text-xs text-text-muted">
                              <Checkbox
                                checked={state[d.meta.id].touched}
                                onChange={(e) => onModifyToggle(d.meta.id, e.currentTarget.checked)}
                              />
                              {__('Modify')}
                            </label>
                          </Show>
                        </div>
                        <Show
                          when={d.options.length > 0}
                          fallback={
                            <Input
                              class="w-full"
                              value={state[d.meta.id].value}
                              placeholder={d.uniform ? undefined : __('(mixed)')}
                              onInput={(e) => onFieldInput(d, e.currentTarget.value)}
                            />
                          }
                        >
                          <Select
                            class="w-full"
                            value={state[d.meta.id].value}
                            onChange={(e) => onFieldInput(d, e.currentTarget.value)}
                          >
                            <Show when={!d.uniform}>
                              <option value="">{__('(mixed)')}</option>
                            </Show>
                            <For each={d.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
                          </Select>
                        </Show>
                      </>
                    }
                  >
                    <label class="text-sm font-medium text-text">{d.meta.label}</label>
                    <Show
                      when={d.uniform}
                      fallback={
                        // Rows disagree → edit by delta (add / remove) rather than a single set.
                        <div class="flex flex-col gap-1">
                          <Combobox
                            options={d.options}
                            selected={state[d.meta.id].add}
                            onChange={(sel) => setState(d.meta.id, 'add', sel)}
                            placeholder={__('Add…')}
                          />
                          <Combobox
                            options={d.removeOptions}
                            selected={state[d.meta.id].remove}
                            onChange={(sel) => setState(d.meta.id, 'remove', sel)}
                            placeholder={__('Remove…')}
                            emptyMessage={__('Nothing to remove')}
                          />
                        </div>
                      }
                    >
                      {/* Single cell, or all rows share the same terms → edit the set directly. */}
                      <Combobox
                        options={d.options}
                        selected={state[d.meta.id].set}
                        onChange={(sel) => setState(d.meta.id, 'set', sel)}
                        placeholder={__('Terms…')}
                      />
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        <footer class="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={props.onClose}>
            {__('Cancel')}
          </Button>
          <Button onClick={apply}>
            {__('Apply to selection')}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
