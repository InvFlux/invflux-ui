/**
 * The generic (datatype-view) column factory — builds a TanStack `ColumnDef` for a server column that
 * has no bespoke host renderer: value via the host's `getValue`, cell via the datatype `viewRegistry`.
 * Reflects a staged edit (green-tinted, `old → new` tooltip) and the inherited-from-parent fade.
 *
 * Extracted from `DataGrid` so the transposed {@link RecordView} builds identical generic cells from
 * the same column model — one source of truth for how a datatype column renders.
 */

import { Dynamic } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { ColumnDef } from '@tanstack/solid-table';
import type { ColumnHelper } from '@tanstack/solid-table';
import { __ } from '@invflux/i18n';
import { viewRegistry } from '../datatypes/registry';
import type { GridColumnMeta, TaxonomySpace } from '../types';
import type { GridWrap } from './DataGrid';
import type { StagedCell } from './DataGrid';

/** Column ids that render right-aligned (numeric). Mirrors DataGrid's RIGHT_ALIGNED. */
const RIGHT_ALIGNED = new Set([
  'price',
  'sale_price',
  'weight',
  'reorder_threshold',
  'atp',
  'res',
  'ctd',
  'total',
]);

/** Host-supplied behaviour a generic cell closes over — the same seams DataGrid exposes as props. */
export interface GenericColumnDeps<TRow> {
  getValue: (row: TRow, columnId: string) => unknown;
  getStagedValue: (row: TRow, columnId: string) => StagedCell;
  isGenericColumnInherited?: (row: TRow, meta: GridColumnMeta) => boolean;
  componentChoiceId?: (dataType: string, role: 'view' | 'edit' | 'drilldown') => string | undefined;
  taxonomySpace?: () => TaxonomySpace | undefined;
  /** Current wrap mode (drives multi-item views like supplier pills). Defaults to "wrap". */
  wrap?: () => GridWrap;
}

/** Whether a column renders right-aligned (explicit set, or a numeric datatype — a count included). */
export function isRightAligned(meta: GridColumnMeta): boolean {
  return (
    RIGHT_ALIGNED.has(meta.id) ||
    meta.dataType.startsWith('number') ||
    meta.dataType.startsWith('decimal') ||
    meta.dataType.endsWith(':count')
  );
}

/** Build the generic datatype-view `ColumnDef` for `meta`. */

export function makeGenericColumn<TRow>(
  ch: ColumnHelper<TRow>,
  meta: GridColumnMeta,
  deps: GenericColumnDeps<TRow>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ColumnDef<TRow, any> {
  const rightAligned = isRightAligned(meta);
  const choice = (role: 'view' | 'edit' | 'drilldown'): string | undefined =>
    deps.componentChoiceId?.(meta.dataType, role);

  return ch.accessor((row) => deps.getValue(row, meta.id), {
    id: meta.id,
    header: meta.label,
    enableSorting: meta.sortable,
    meta: rightAligned ? { align: 'right' } : undefined,
    cell: (info): JSX.Element => {
      const view =
        viewRegistry.resolve(meta.dataType, choice('view')) ?? viewRegistry.resolve('text');
      if (!view) return <span class="text-text-muted">—</span>;

      const staged = (): StagedCell => deps.getStagedValue(info.row.original, meta.id);
      const dirty = (): boolean => staged().staged;
      const inherited = (): boolean =>
        deps.isGenericColumnInherited?.(info.row.original, meta) ?? false;

      return (
        <span
          data-staged={dirty() ? '' : undefined}
          data-inherited={!dirty() && inherited() ? '' : undefined}
          classList={{
            'text-green-700': dirty(),
            // Shared `inherited` utility (italic + muted, AA-checked) rather than opacity-60, which
            // fell under the contrast floor.
            inherited: !dirty() && inherited(),
          }}
          title={
            dirty()
              ? `${String(info.getValue() ?? '')} → ${String(staged().value ?? '')}`
              : inherited()
                ? __('Inherited from the parent product')
                : undefined
          }
        >
          <Dynamic
            component={view}
            value={dirty() ? staged().value : info.getValue()}
            row={info.row.original}
            column={meta}
            ctx={{ taxonomySpace: deps.taxonomySpace?.(), wrap: deps.wrap?.() ?? 'wrap' }}
          />
        </span>
      );
    },
  });
}
