/**
 * The WorkbenchGrid bespoke (host-rendered) column definitions — the columns that need the typed
 * {@link WorkbenchRow} and can't be a generic datatype-view: the row checkbox, the name+link cell,
 * the image thumbnail, the catalogue/pricing scalars, the orders + ledger cells, and (built
 * separately, see {@link buildStockColumns}) the stock slot cells. {@link DataGrid} renders each
 * opaquely via `flexRender`; any server column id NOT in these maps falls through to a generic
 * datatype-view column.
 *
 * Extracted from `@invflux/workbench`'s in-component `BASE_COLUMNS` so the Central Workbench and the
 * embedded product-inventory grid share one set. Factories take a `deps` bag so behaviour that varies
 * by build phase / surface is injected rather than hard-wired.
 *
 * **Stock-`kind` seam.** Stock cells are NOT a hard-coded
 * `atp`/`res`/`ctd`/`total` allow-list: {@link buildStockColumns} derives them from the server column
 * list via the {@link stockSlotOf} predicate — the single place that decides "this column is a stock
 * slot". Today it matches the bare base ids; when the server later emits faceted stock
 * (`atp@wh1`, `atp·web`, or a `stock:*` dataType) those flow through the same renderer, so per-
 * warehouse / per-channel stock is a pure server concern with no client change here.
 */

import { Show, type JSX } from 'solid-js';
import { createColumnHelper, type ColumnDef } from '@tanstack/solid-table';
import { __, sprintf } from '@invflux/i18n';
import type { WorkbenchRow } from '../workbenchGridTypes';
import type { GridColumnMeta } from '../types';
import type { HostNav } from '../hostNav';
import type { SlotDeltas } from '../onHandCascade';
import { DropdownMenu } from '../DropdownMenu';
import { buildProductActionItems } from '../productActionsMenu';
import { stockSlotOf, type StockSlot } from './stockSlot';
import { workbenchValueFor } from './workbenchValueFor';
import { iconButtonClass } from '../primitives';

/** Behaviour the static (catalogue/pricing) column cells close over. */
export interface WorkbenchColumnDeps {
  /** How to build links into other InvFlux surfaces (the ledger route in the name-cell actions menu).
   *  Host-provided so this package stays free of any platform's URL shapes. */
  hostNav: HostNav;
  /** The staged value for a (subject, column) cell, or the supplied persisted `original`. */
  stagedValue: (subjectId: number, columnId: string, original: unknown) => unknown;
  /** Whether a (subject, column) cell carries a staged (unsaved) edit — drives the amber tint. */
  isCellDirty: (subjectId: number, columnId: string) => boolean;
  /** Optional read-mode transform for the name cell (e.g. strip a variation's parent-name prefix).
   *  Receives the staged-or-persisted full name; returns the string to show. Edit mode uses the full
   *  name regardless. Absent → show the name verbatim. */
  displayName?: (row: WorkbenchRow, fullName: string) => string;
  /** Optional collapse/expand affordance for grouping rows (e.g. a variable parent's variations). The
   *  host owns the actual fold (it transforms the row set); this only renders a ▸/▾ toggle in the name
   *  cell for rows whose `state(row)` isn't `"none"`, calling `toggle(row)` on click. */
  fold?: {
    state: (row: WorkbenchRow) => 'none' | 'collapsed' | 'expanded';
    toggle: (row: WorkbenchRow) => void;
  };
  /** The row id (String(subjectId)) that is the shift-range anchor, or null. The host owns the anchor
   *  (it's set from the leading-cell click); this only outlines that row's checkbox as the marker. */
  anchorRowId?: () => string | null;
  /** Host-native product-link `kind`s to omit from the name-cell actions menu. The embedded product
   *  tab passes `["catalog-edit"]`: it already lives on WooCommerce's product-edit page, so an "Edit in
   *  WooCommerce" link there is a no-op back to the current screen. Absent → show every link. */
  suppressLinkKinds?: readonly string[];
}

const emDash = (): JSX.Element => <span class="text-text-muted">—</span>;

/**
 * A stock cell for an **unmanaged** subject: InvFlux tracks no slots, so atp/res/ctd/total have no
 * meaning here.
 *
 * Shares the "not authored here" reading with an inherited value — same secondary grey, same
 * italic — because that much *is* the same statement. What differs is that an inherited value is
 * editable (typing overrides the parent) while this one is not, so it carries one extra signal:
 *
 * **A dotted underline, not a paler grey.** It is the conventional "there is an explanation on
 * hover" affordance, so it pairs with the title below instead of consuming a contrast level — and
 * there is no level left to consume: the secondary grey already sits at the WCAG AA floor, and the
 * shade this replaced measured 2.54:1.
 */
function unmanagedStockCell(hostQty: string | null, untracked: boolean): JSX.Element {
  // `none` — nobody tracks this product, so a figure lingering on the host's `_stock` measures
  // nothing anyone maintains: it stays out of the cell and goes in the tooltip.
  // `external` — another plugin governs that figure, so it IS the operative availability and stays
  // visible. Hiding a number the merchant relies on is the worse error.
  const show = !untracked && null !== hostQty;

  return (
    <span
      class={`italic tabular-nums text-text-muted${
        // "There is an explanation for this number" — so it only rides a number. On the em-dash it
        // qualifies nothing and just reads as an underlined dash.
        show ? ' underline decoration-dotted underline-offset-2' : ''
      }`}
      title={
        untracked
          ? __('Stock management is disabled for this product — enable it to manage stock in InvFlux')
          : __(
              // Deliberately does not name the plugin: the row carries `external`, not *which*
              // external — most often WooCommerce itself, but it can be ATUM or another. Printing
              // a guessed vendor name as fact is worse than not naming one.
              'Another plugin manages this stock — the figure shown is theirs, not an InvFlux figure.',
            )
      }
    >
      {show ? hostQty : '—'}
    </span>
  );
}

/**
 * Build the static bespoke column map, keyed by server column id. The order here is the fallback
 * order used before server metadata arrives; once it does, {@link DataGrid} orders columns by the
 * server's list and pulls each bespoke def by id, so this map is a lookup — its iteration order only
 * matters for the pre-metadata first paint. Stock columns are built separately by
 * {@link buildStockColumns} (the stock-`kind` seam) and merged in by the host.
 */
export function buildWorkbenchColumns(
  deps: WorkbenchColumnDeps,
): Map<string, ColumnDef<WorkbenchRow, unknown>> {
  const ch = createColumnHelper<WorkbenchRow>();
  const { stagedValue, isCellDirty, hostNav } = deps;
  const displayNameOf = deps.displayName ?? ((_row: WorkbenchRow, full: string): string => full);

  // Row-checkbox range selection: a plain checkbox click records its row as the anchor; a later
  // shift-click on another row's checkbox fills the whole displayed range A→B (see the "select"
  // column). Both live in the factory closure — the factory runs once per grid mount, so they persist.
  // `shiftHeld` is captured in onClick (which carries shiftKey) and consumed in onChange (which
  // carries the resulting checked state but not the modifier) — the two fire in that order for a
  // checkbox, and driving the range from onChange avoids the double-toggle that preventDefault-in-click
  // caused (the native change would revert the clicked end-cell).
  // The shift-range anchor lives in the host (set from the leading-cell click); here we only outline
  // that row's checkbox as the marker.
  const isAnchorRow = (id: string): boolean => (deps.anchorRowId?.() ?? null) === id;

  /**
   * Read-mode render of an editable catalogue/pricing scalar so it reflects a staged edit (amber) —
   * the editor mounts at the `<td>` level; this is the display view. `format` maps the
   * staged-or-persisted value to text.
   */
  const scalarCell = (
    row: WorkbenchRow,
    columnId: string,
    original: unknown,
    baseClass: string,
    format: (value: unknown) => string,
  ): JSX.Element => (
    <span class={baseClass} classList={{ 'text-amber-700': isCellDirty(row.subjectId, columnId) }}>
      {format(stagedValue(row.subjectId, columnId, original))}
    </span>
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defs: ColumnDef<WorkbenchRow, any>[] = [
    ch.display({
      id: 'select',
      enableHiding: false,
      enableSorting: false,
      size: 36,
      header: (info) => (
        <input
          type="checkbox"
          class="cursor-pointer"
          aria-label={__('Select all')}
          checked={info.table.getIsAllPageRowsSelected()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => info.table.toggleAllPageRowsSelected(e.currentTarget.checked)}
        />
      ),
      // Presentational only: the whole "select" cell is the click target (the host's leading-cell
      // click drives the plain toggle, the shift-range, and the anchor). `pointer-events-none` lets a
      // click on the box itself fall through to the cell; `readOnly` marks it non-interactive. The
      // outline marks the shift-range anchor row.
      cell: (info) => (
        <input
          type="checkbox"
          readOnly
          tabindex={-1}
          class="pointer-events-none rounded-sm"
          classList={{ 'outline outline-2 outline-offset-1 outline-blue-500': isAnchorRow(info.row.id) }}
          aria-label={__('Select row')}
          checked={info.row.getIsSelected()}
        />
      ),
    }),

    ch.accessor('name', {
      id: 'name',
      enableHiding: false,
      enableSorting: true,
      header: __('Product'),
      cell: (info) => {
        const row = info.row.original;
        const indented = row.wcVariationId !== null;
        const dirty = (): boolean => isCellDirty(row.subjectId, 'name');
        const foldState = (): 'none' | 'collapsed' | 'expanded' => deps.fold?.state(row) ?? 'none';
        const displayName = (): string =>
          displayNameOf(row, String(stagedValue(row.subjectId, 'name', info.getValue()) ?? ''));
        return (
          <div class={`flex items-center ${foldState() !== 'none' ? '-ml-2' : ''} ${indented ? 'pl-3' : ''}`}>
            {/* Collapse/expand caret for a grouping parent (variations); host owns the fold state. */}
            <Show when={foldState() !== 'none'}>
              <button
                type="button"
                class={iconButtonClass('xs', false, '-ml-1 h-4 w-4 shrink-0')}
                aria-label={foldState() === 'collapsed' ? __('Expand') : __('Collapse')}
                aria-expanded={foldState() === 'expanded'}
                onClick={(e) => {
                  e.stopPropagation();
                  deps.fold?.toggle(row);
                }}
              >
                {foldState() === 'collapsed' ? '▸' : '▾'}
              </button>
            </Show>
            {/* The name opens the shared product-actions menu (Edit in WooCommerce / storefront from the
                server, + the client-built ledger route) — the same menu as a dispatch order line. A
                variable parent has no single ledger, so its menu omits it. Falls back to plain text when
                nothing resolved. */}
            {(() => {
              // A variable parent DOES get a ledger link now: it opens the family ledger view (the
              // segmented variation switcher, blank until a variation is picked). So no role gating.
              const suppress = deps.suppressLinkKinds;
              const links = suppress
                ? (row.links ?? []).filter((l) => !suppress.includes(l.kind))
                : row.links ?? [];
              const items = buildProductActionItems({
                links,
                subjectId: row.subjectId,
                hostNav,
              });
              return (
                <Show
                  when={items.length > 0}
                  fallback={
                    <span class="font-medium text-text" classList={{ 'text-amber-700': dirty() }}>
                      {displayName()}
                    </span>
                  }
                >
                  <DropdownMenu
                    ariaLabel={sprintf(__('Product actions for %s'), displayName())}
                    triggerClass={`inline-flex items-center gap-1 text-left font-medium hover:underline cursor-pointer ${dirty() ? 'text-amber-700' : 'text-blue-700'}`}
                    trigger={
                      <>
                        {displayName()}
                        <span class="text-2xs text-text-muted" aria-hidden="true">▾</span>
                      </>
                    }
                    items={items}
                  />
                </Show>
              );
            })()}
          </div>
        );
      },
    }),

    ch.accessor('sku', {
      id: 'sku',
      enableSorting: true,
      /* translators: SKU = Stock Keeping Unit; keep "SKU" or use the local term (fr: UGS). */
      header: __('SKU'),
      cell: (info) =>
        scalarCell(info.row.original, 'sku', info.getValue(), 'font-mono text-xs text-text-muted', (v) =>
          String(v ?? '').trim() === '' ? '—' : String(v),
        ),
    }),

    ch.accessor('imageUrl', {
      id: 'image_url',
      enableSorting: false,
      header: __('Image'),
      cell: (info) => {
        const url = info.getValue();
        return <>{url ? (
          <img src={url} alt="" class="h-10 w-10 rounded object-cover" loading="lazy" />
        ) : (
          emDash()
        )}</>;
      },
    }),

    ch.accessor('price', {
      id: 'price',
      enableSorting: true,
      header: __('Price'),
      meta: { align: 'right' },
      cell: (info) =>
        scalarCell(info.row.original, 'price', info.getValue(), 'tabular-nums', (v) =>
          v === null || v === undefined || v === '' ? '—' : String(v),
        ),
    }),

    ch.accessor('salePrice', {
      id: 'sale_price',
      enableSorting: true,
      header: __('Sale Price'),
      meta: { align: 'right' },
      cell: (info) =>
        scalarCell(info.row.original, 'sale_price', info.getValue(), 'tabular-nums', (v) =>
          v === null || v === undefined || v === '' ? '—' : String(v),
        ),
    }),

    ch.accessor('taxStatus', {
      id: 'tax_status',
      enableSorting: false,
      header: __('Tax Status'),
      cell: (info) =>
        scalarCell(info.row.original, 'tax_status', info.getValue(), '', (v) => {
          const labels: Record<string, string> = {
            taxable: __('Taxable'),
            shipping: __('Shipping only'),
            none: __('None'),
          };
          return typeof v === 'string' && v in labels ? labels[v] : '—';
        }),
    }),

    ch.accessor('taxClass', {
      id: 'tax_class',
      enableSorting: false,
      header: __('Tax Class'),
      cell: (info) =>
        scalarCell(info.row.original, 'tax_class', info.getValue(), '', (v) =>
          v === 'parent'
            ? __('Same as parent')
            : v === ''
              ? __('Standard')
              : v === null || v === undefined
                ? '—'
                : String(v),
        ),
    }),

    ch.accessor('weight', {
      id: 'weight',
      enableSorting: true,
      header: __('Weight'),
      meta: { align: 'right' },
      cell: (info) =>
        scalarCell(info.row.original, 'weight', info.getValue(), 'tabular-nums', (v) =>
          v === null || v === undefined || v === '' ? '—' : String(v),
        ),
    }),

    ch.accessor('soldIndividually', {
      id: 'sold_individually',
      enableSorting: false,
      header: __('Indiv.'),
      cell: (info) =>
        scalarCell(info.row.original, 'sold_individually', info.getValue(), '', (v) =>
          v ? __('Yes') : __('No'),
        ),
    }),

    ch.accessor('reorderThreshold', {
      id: 'reorder_threshold',
      enableSorting: true,
      header: __('Reorder'),
      meta: { align: 'right' },
      cell: (info) =>
        scalarCell(info.row.original, 'reorder_threshold', info.getValue(), 'tabular-nums', (v) =>
          v === null || v === undefined ? '—' : String(v),
        ),
    }),

    ch.accessor('reorderStatus', {
      id: 'reorder_status',
      enableSorting: false,
      header: __('Status'),
      cell: (info) => {
        const v = info.getValue();
        const cls =
          v === 'below'
            ? 'text-red-600'
            : v === 'at'
              ? 'text-amber-600'
              : v === 'above'
                ? 'text-green-600'
                : 'text-text-muted';
        const labels: Record<string, string> = {
          below: __('Below'),
          at: __('At'),
          above: __('Above'),
        };
        return <span class={cls}>{typeof v === 'string' && v in labels ? labels[v] : '—'}</span>;
      },
    }),

    // NOTE: the "Orders" (open-order count → filtered dispatch queue) and "Ledger" columns are NOT
    // bespoke here — they are ordinary server-declared columns of the generic `link` datatype
    // (see NativeWorkbenchColumns + the LinkView in datatypes/views.tsx). The server supplies a plain
    // value (the count) and a static link template; the SPA composes the href client-side from data
    // the row already holds (`sku`, `subjectId`), so nothing platform-specific leaks into the payload.
  ];

  return new Map(
    defs.map((def): [string, ColumnDef<WorkbenchRow, unknown>] => [
      def.id as string,
      def as ColumnDef<WorkbenchRow, unknown>,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Stock columns (the stock-`kind` seam)
// ---------------------------------------------------------------------------

// The stock-`kind` seam (`stockSlotOf` / `StockSlot`) lives in `./stockSlot` — a Kobalte-free module
// so it stays unit-testable under the `node` vitest env — imported above for internal use and
// re-exported here so existing callers (index.ts, tests) keep their import path.
export { stockSlotOf, type StockSlot };

/** Behaviour the stock cells close over — the on-hand-correction cascade + conflict state (v3). */
export interface StockColumnDeps {
  fmt: (n: number) => string;
  /** The per-slot deltas from a row's staged on-hand (`total`) correction, or null when none. */
  stagedCascade: (row: WorkbenchRow) => SlotDeltas | null;
  /** The frozen `total` delta (staged new − original, cascaded over the live baseline), 0 if none. */
  totalDelta: (row: WorkbenchRow) => number;
  /** A save conflict for a row (the live total moved under a staged correction), if any. */
  conflict: (row: WorkbenchRow) => { expected: number; actual: number } | undefined;
}

const SLOT_CLASS: Record<StockSlot, string> = {
  atp: 'font-medium tabular-nums',
  res: 'tabular-nums text-amber-700',
  ctd: 'tabular-nums text-blue-700',
  total: 'font-semibold tabular-nums',
};

/**
 * A stock cell showing its persisted value followed by an unsaved, signed delta — "10 +3" / "10 −4"
 * `delta` is an accessor so the cell stays reactive to the staged
 * correction; a 0 delta renders the bare value.
 */
function deltaCell(fmt: (n: number) => string, base: number, delta: () => number, baseClass: string): JSX.Element {
  return (
    <Show when={delta() !== 0} fallback={<span class={baseClass}>{fmt(base)}</span>}>
      <span class={baseClass} title={`${fmt(base)} → ${fmt(base + delta())}`}>
        {fmt(base)}{' '}
        <span class={delta() >= 0 ? 'text-green-700' : 'text-red-700'}>
          {delta() > 0 ? '+' : '−'}
          {fmt(Math.abs(delta()))}
        </span>
      </span>
    </Show>
  );
}

/**
 * Build the stock-slot bespoke columns from the server column list — one per column that
 * {@link stockSlotOf} recognises. The aggregate `total` cell renders the delta-first on-hand
 * correction (its frozen delta over the live baseline) + a conflict ring; the aggregate `atp`/`res`/
 * `ctd` cells render their slice of that correction's cascade. Faceted (per-location / -channel)
 * stock columns render their base value read-only — the aggregate is the only correctable view today.
 */
export function buildStockColumns(
  metas: GridColumnMeta[],
  deps: StockColumnDeps,
): Map<string, ColumnDef<WorkbenchRow, unknown>> {
  const ch = createColumnHelper<WorkbenchRow>();
  const { fmt, stagedCascade, totalDelta, conflict } = deps;
  const map = new Map<string, ColumnDef<WorkbenchRow, unknown>>();

  for (const meta of metas) {
    const slot = stockSlotOf(meta);
    if (slot === null) continue;
    // A bare aggregate column (id === slot) carries the correction UI; a faceted view is read-only.
    const isAggregate = meta.id === slot;
    const cls = SLOT_CLASS[slot];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def: ColumnDef<WorkbenchRow, any> = ch.accessor((row) => workbenchValueFor(row, meta.id), {
      id: meta.id,
      header: meta.label,
      enableSorting: meta.sortable,
      meta: { align: 'right' },
      cell: (info) => {
        const row = info.row.original;
        if (row.stockManaged === false) {
          // The only figure available for an unmanaged subject is the host store's own, and it
          // would otherwise sit under a header naming an InvFlux concept (ATP) that it does not
          // measure. Labelling it is the difference between reporting another system's number and
          // appearing to report ours; the other slots have no counterpart at all, hence the dash.
          // Only a TRULY untracked product ('none') empties its cell. For 'external' the figure
          // is another plugin's and is the operative availability, so it stays visible — hiding a
          // number the merchant relies on is the worse error. Undefined (older payload) also shows,
          // so a missing field never silently swallows data.
          return unmanagedStockCell(
            'atp' === slot && null != row.wcStock ? fmt(row.wcStock) : null,
            'none' === row.stockManagement,
          );
        }
        const base = Number(info.getValue() ?? 0);
        if (!isAggregate) return <span class={cls}>{fmt(base)}</span>;

        if (slot === 'total') {
          const c = (): { expected: number; actual: number } | undefined => conflict(row);
          return (
            <span
              classList={{ 'rounded px-1 ring-1 ring-red-300': !!c() }}
              title={
                c()
                  ? sprintf(
                      /* translators: %1$s = expected total, %2$s = current live total. */
                      __('Expected %1$s, current %2$s'),
                      fmt(c()!.expected),
                      fmt(c()!.actual),
                    )
                  : undefined
              }
            >
              {deltaCell(fmt, base, () => totalDelta(row), cls)}
            </span>
          );
        }

        // atp / res / ctd aggregate: this slot's slice of the staged total correction's cascade.
        return deltaCell(fmt, base, () => stagedCascade(row)?.[slot] ?? 0, cls);
      },
    });

    map.set(meta.id, def as ColumnDef<WorkbenchRow, unknown>);
  }

  return map;
}
