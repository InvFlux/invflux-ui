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
import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  computeNumericOp,
  decimalsForValues,
  isDeltaOp,
  isMoneyDataType,
  isNumericDataType,
  isPercentOp,
  parseNumericValue,
  type NumericOp,
} from './numericBulkOps';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';
import { Combobox } from './Combobox';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Input } from './Input';
import { Select } from './Select';
import type { GridColumnMeta, TaxonomySpace } from './types';
import { orderTaxonomyValues } from './taxonomyOrder';
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
  /** Portal the modal to this root (shadow-DOM / transformed-ancestor surfaces). */
  mount?: HTMLElement;
}

const bulkNormalize = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

const sameIdSet = (a: number[], b: number[]): boolean =>
  a.length === b.length &&
  [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

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
    /** Numeric column → the operator row (set / add / subtract / the four percentage forms). */
    numeric: boolean;
    /** Money is emitted as a fixed-decimal string, everything else as a number. */
    money: boolean;
    decimals: number;
    min?: number;
    max?: number;
  }

  const numberFromConfig = (config: Record<string, unknown>, key: string): number | undefined =>
    typeof config[key] === 'number' ? (config[key] as number) : undefined;

  const descriptors: Descriptor[] = props.columns.map((column) => {
    const multi = column.meta.kind === 'editable_multi';
    if (multi) {
      const taxonomy =
        typeof column.meta.editorConfig.taxonomy === 'string'
          ? column.meta.editorConfig.taxonomy
          : '';
      const space = props.taxonomySpace?.[taxonomy];
      const options = space
        ? orderTaxonomyValues(space).map((v) => ({
            value: String(v.id),
            label: v.name,
            depth: v.depth,
          }))
        : [];
      const rowSets = column.targets.map((t) =>
        Array.isArray(t.value) ? (t.value as number[]) : [],
      );
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
        numeric: false,
        money: false,
        decimals: 0,
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
    // The operator row is offered only where an amount is meaningful: a numeric column with a free
    // input. An enum/bool column has `options`, and "add 10%" means nothing to a dropdown.
    const numeric = options.length === 0 && isNumericDataType(column.meta.dataType);
    const money = isMoneyDataType(column.meta.dataType);

    return {
      meta: column.meta,
      targets: column.targets,
      multi,
      uniform,
      uniformValue: uniform ? (values[0] ?? '') : '',
      uniformIds: [],
      options,
      removeOptions: [],
      numeric,
      money,
      decimals: numeric ? decimalsForValues(money, values) : 0,
      min: numberFromConfig(column.meta.editorConfig, 'min'),
      max: numberFromConfig(column.meta.editorConfig, 'max'),
    };
  });

  interface ColState {
    touched: boolean;
    value: string;
    add: string[];
    remove: string[];
    /** Multi-value uniform editing: the staged term-id set (replaces all rows' sets). */
    set: string[];
    /** Numeric columns: what `value` means — a replacement, or a delta from each row's own value. */
    op: NumericOp;
  }
  const initial: Record<string, ColState> = {};
  for (const d of descriptors) {
    initial[d.meta.id] = {
      touched: false,
      value: d.uniform ? d.uniformValue : '',
      add: [],
      remove: [],
      set: d.multi && d.uniform ? d.uniformIds : [],
      op: 'set',
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
    // Under a delta, any operand is an edit — including one equal to the column's shared value.
    // "Add 31.90" to a column of 31.90s is a real instruction; "set to 31.90" is not.
    const touched = isDeltaOp(state[d.meta.id].op)
      ? value.trim() !== ''
      : d.uniform
        ? value !== d.uniformValue
        : value !== '';
    setState(d.meta.id, 'touched', touched);
  };
  const onModifyToggle = (id: string, checked: boolean): void => {
    setState(id, 'touched', checked);
    if (!checked) setState(id, 'value', '');
  };

  /**
   * Switching the operator clears the field, because the number it holds changes meaning: a uniform
   * column pre-fills with the shared value, and leaving "31.90" in place under "Add" would offer to
   * add 31.90 to every row — the one edit nobody meant to make.
   */
  const onOpChange = (d: Descriptor, op: NumericOp): void => {
    setState(d.meta.id, 'op', op);
    setState(d.meta.id, 'value', op === 'set' && d.uniform ? d.uniformValue : '');
    setState(d.meta.id, 'touched', false);
  };

  /** Operator labels, built at render so they are translated in the reader's locale. */
  const opOptions = (): Array<{ value: NumericOp; label: string }> => [
    { value: 'set', label: __('Set to') },
    { value: 'add', label: __('Add') },
    { value: 'subtract', label: __('Subtract') },
    { value: 'increase-pct', label: __('Increase by %') },
    { value: 'decrease-pct', label: __('Decrease by %') },
    { value: 'undo-increase-pct', label: __('Undo an increase of %') },
    { value: 'undo-decrease-pct', label: __('Undo a decrease of %') },
  ];

  const formatNum = (d: Descriptor, value: number): string => value.toFixed(d.decimals);

  interface Preview {
    /** A real row from the selection, before and after — the clearest statement of what will happen. */
    sample: { from: string; to: string } | null;
    changed: number;
    skipped: number;
    clamped: number;
  }

  /**
   * What the current operator + operand would do to the selection. Recomputed per keystroke over
   * every target, which is cheap next to the render the apply itself triggers.
   */
  const previewOf = (d: Descriptor): Preview | null => {
    const s = state[d.meta.id];
    if (!d.numeric || !isDeltaOp(s.op) || !s.touched) return null;
    const operand = Number(s.value.trim());
    if (s.value.trim() === '' || !Number.isFinite(operand)) return null;

    const bounds = { decimals: d.decimals, min: d.min, max: d.max };
    let sample: Preview['sample'] = null;
    let changed = 0;
    let skipped = 0;
    let clamped = 0;
    for (const t of d.targets) {
      const current = parseNumericValue(t.value);
      const out = computeNumericOp(s.op, current, operand, bounds);
      if (out.value === null) {
        skipped += 1;
        continue;
      }
      changed += 1;
      if (out.clamped) clamped += 1;
      if (sample === null && current !== null) {
        sample = { from: formatNum(d, current), to: formatNum(d, out.value) };
      }
    }

    return { sample, changed, skipped, clamped };
  };

  /**
   * One line stating what the operator will do, led by a real row from the selection.
   *
   * The worked example is the point: it is the only thing that makes "undo an increase of 10%"
   * legible as a division rather than a −10%, and it costs the merchant no arithmetic to check.
   */
  const previewLine = (d: Descriptor, p: Preview): string => {
    if (p.changed === 0) {
      return p.skipped > 0
        ? __('No row in the selection has a value to change.')
        : __('This operation would change nothing.');
    }

    const parts: string[] = [];
    if (p.sample !== null) {
      /* translators: a worked example — 1: a row's current value, 2: what it becomes */
      parts.push(sprintf(__('%1$s → %2$s'), p.sample.from, p.sample.to));
    }
    /* translators: %d: number of rows the operation changes */
    parts.push(sprintf(_n('%d row', '%d rows', p.changed), p.changed));
    if (p.skipped > 0) {
      parts.push(
        sprintf(
          /* translators: %d: rows left alone because they hold no value to apply a delta to */
          _n('%d skipped, no current value', '%d skipped, no current value', p.skipped),
          p.skipped,
        ),
      );
    }
    if (p.clamped > 0) {
      parts.push(
        sprintf(
          /* translators: %d: rows whose result fell outside the column's allowed range */
          _n('%d held at the column limit', '%d held at the column limit', p.clamped),
          p.clamped,
        ),
      );
    }

    return parts.join(' · ');
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
              edits.push({
                subjectId: t.subjectId,
                columnId: d.meta.id,
                original: current,
                newValue: set,
                row: t.row,
              });
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
            edits.push({
              subjectId: t.subjectId,
              columnId: d.meta.id,
              original: current,
              newValue: next,
              row: t.row,
            });
          }
        }
        continue;
      }
      if (!s.touched) continue;
      // A delta reads each row's own value, so it produces a different result per row — unlike every
      // other control here, which computes one value and writes it everywhere. Rows the operator
      // cannot act on (no current value, or an undefined result) are dropped, having been counted
      // in the preview the merchant just read.
      if (d.numeric && isDeltaOp(s.op)) {
        const operand = Number(s.value.trim());
        if (s.value.trim() === '' || !Number.isFinite(operand)) continue;
        const bounds = { decimals: d.decimals, min: d.min, max: d.max };
        for (const t of d.targets) {
          const out = computeNumericOp(s.op, parseNumericValue(t.value), operand, bounds);
          if (out.value === null) continue;
          edits.push({
            subjectId: t.subjectId,
            columnId: d.meta.id,
            original: t.value,
            newValue: d.money ? out.value.toFixed(d.decimals) : out.value,
            row: t.row,
          });
        }
        continue;
      }
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
        edits.push({
          subjectId: t.subjectId,
          columnId: d.meta.id,
          original: t.value,
          newValue,
          row: t.row,
        });
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

  const rowCount = createMemo(
    () => new Set(props.columns.flatMap((c) => c.targets.map((t) => t.subjectId))).size,
  );

  return (
    <Modal onClose={props.onClose} mount={props.mount} label={__('Edit selection')}>
      <ModalPanel size="lg" class="invflux-bulk-edit">
        <ModalHeader
          title={__('Edit selection')}
          subtitle={sprintf(
            /* translators: 1: column count, 2: row count */
            __('%1$d column(s) × %2$d row(s)'),
            descriptors.length,
            rowCount(),
          )}
        />

        <div ref={bodyRef} class="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <Show
            when={descriptors.length > 0}
            fallback={
              <p class="text-sm text-text-muted">{__('No editable columns in the selection.')}</p>
            }
          >
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
                            <label
                              class="flex items-center gap-1 text-xs text-text-muted"
                              title={_x(
                                'Check to change this field for every selected row; leave it unchecked to keep each row’s current value.',
                                'bulk edit: per-field Modify checkbox tooltip',
                              )}
                            >
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
                            <Show
                              when={d.numeric}
                              fallback={
                                <Input
                                  class="w-full"
                                  value={state[d.meta.id].value}
                                  placeholder={d.uniform ? undefined : __('(mixed)')}
                                  onInput={(e) => onFieldInput(d, e.currentTarget.value)}
                                />
                              }
                            >
                              <div class="flex items-center gap-2">
                                <Select
                                  class="w-48 shrink-0"
                                  aria-label={sprintf(
                                    /* translators: %s: column label, e.g. "Price" */
                                    __('Operation for %s'),
                                    d.meta.label,
                                  )}
                                  value={state[d.meta.id].op}
                                  onChange={(e) =>
                                    onOpChange(d, e.currentTarget.value as NumericOp)
                                  }
                                >
                                  <For each={opOptions()}>
                                    {(o) => <option value={o.value}>{o.label}</option>}
                                  </For>
                                </Select>
                                <Input
                                  class="w-full flex-1"
                                  inputMode="decimal"
                                  value={state[d.meta.id].value}
                                  placeholder={
                                    isDeltaOp(state[d.meta.id].op)
                                      ? undefined
                                      : d.uniform
                                        ? undefined
                                        : __('(mixed)')
                                  }
                                  onInput={(e) => onFieldInput(d, e.currentTarget.value)}
                                />
                                <Show when={isPercentOp(state[d.meta.id].op)}>
                                  <span class="shrink-0 text-sm text-text-muted">%</span>
                                </Show>
                              </div>
                            </Show>
                          }
                        >
                          <Select
                            aria-label={d.meta.label}
                            class="w-full"
                            value={state[d.meta.id].value}
                            onChange={(e) => onFieldInput(d, e.currentTarget.value)}
                          >
                            <Show when={!d.uniform}>
                              <option value="">{__('(mixed)')}</option>
                            </Show>
                            <For each={d.options}>
                              {(o) => <option value={o.value}>{o.label}</option>}
                            </For>
                          </Select>
                        </Show>
                        <Show when={previewOf(d)}>
                          {(p) => (
                            <p class="text-2xs text-text-muted tabular-nums">
                              {previewLine(d, p())}
                            </p>
                          )}
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
                        placeholder={_x(
                          'Choose…',
                          'bulk edit placeholder: pick the categories or tags every selected product gets',
                        )}
                      />
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={props.onClose}>
            {__('Cancel')}
          </Button>
          <Button onClick={apply}>{__('Apply to selection')}</Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
