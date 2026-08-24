import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  FilterBar,
  FilterModeToggle,
  SegmentedControl,
  gridFiltersToDescriptors,
  type ComboboxOption,
  type FilterDescriptor,
} from '@invflux/ui';
import { useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createColumnHelper, createSolidTable, flexRender, getCoreRowModel } from '@tanstack/solid-table';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { daysUntilDate, parseDateOnly } from '../../lib/dates';
import type { ProductSearchResponse } from '../suppliers/types';
import type { PurchaseOrder, PurchaseOrdersResponse } from './types';

const columnHelper = createColumnHelper<PurchaseOrder>();

/** Status segments → the stages each one covers. Archived (terminal soft-delete) is hidden from all. */
type StatusGroup = 'draft' | 'open' | 'closed';
const GROUP_STAGES: Record<StatusGroup, string[]> = {
  draft: ['in_prep'],
  open: ['submitted', 'in_transit', 'in_reception'],
  closed: ['received', 'cancelled'],
};
const isStatusGroup = (v: string | undefined): v is StatusGroup => 'draft' === v || 'open' === v || 'closed' === v;

/** Stages where goods are still expected — drives the ETA countdown + late highlight. */
const AWAITING = ['in_prep', 'submitted', 'in_transit', 'in_reception'];

/** ETA cell: locale-aware, zero-padded fixed-width date + days-to-arrival; red + countdown while overdue. */
function EtaCell(props: { iso: string | null; stage: string }): JSX.Element {
  const date = parseDateOnly(props.iso);
  if (null === date) return <span class="text-text-muted">—</span>;
  const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const awaiting = AWAITING.includes(props.stage);
  const days = daysUntilDate(props.iso) ?? 0;
  const late = awaiting && days < 0;
  return (
    <span class="tabular-nums" classList={{ 'font-medium text-red-600': late }}>
      {dateStr}
      <Show when={awaiting}>
        {' '}
        <span classList={{ 'text-text-muted': !late }}>({days}d)</span>
      </Show>
    </span>
  );
}

const columns = [
  columnHelper.accessor('number', {
    header: () => __('PO #'),
    // A draft has no document number yet — it gets one just before it goes to the supplier. Fall back
    // to the internal id, marked so it can never be mistaken for the real thing: the `#` sigil and the
    // word "Draft" survive a screenshot or a read-aloud, where muted styling alone would not. It is
    // deliberately unprefixed and unpadded — borrowing the document number's own signature is what
    // would make the two confusable.
    cell: (info) =>
      null === info.getValue() ? (
        <span class="text-text-muted">{sprintf(__('Draft #%d'), info.row.original.id)}</span>
      ) : (
        <span class="font-semibold">{info.getValue()}</span>
      ),
  }),
  columnHelper.accessor('supplierDisplay', {
    header: () => __('Supplier'),
    cell: (info) => info.getValue() ?? '—',
  }),
  columnHelper.accessor('stage', {
    header: () => __('Stage'),
    cell: (info) => <StatusPill status={info.getValue()} />,
  }),
  columnHelper.accessor('discrepancy', {
    header: () => __('Discrepancy'),
    // Delivery-discrepancy rollup (over / finalized-short line counts, Ordered lens) — a glanceable
    // "needs a look" flag; the per-line detail lives on the PO. Discrepancy-free POs show a dash.
    cell: (info) => {
      const d = info.getValue();
      if (null === d || (0 === d.over && 0 === d.short)) return <span class="text-slate-300">—</span>;
      return (
        <span class="inline-flex gap-1">
          <Show when={d.over > 0}>
            <span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {sprintf(_n('%d over', '%d over', d.over), d.over)}
            </span>
          </Show>
          <Show when={d.short > 0}>
            <span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
              {sprintf(_n('%d short', '%d short', d.short), d.short)}
            </span>
          </Show>
        </span>
      );
    },
  }),
  columnHelper.accessor('expectedAt', {
    header: () => __('ETA'),
    cell: (info) => <EtaCell iso={info.getValue()} stage={info.row.original.stage} />,
  }),
  columnHelper.accessor('lineCount', {
    header: () => __('Lines'),
    cell: (info) => <span class="tabular-nums text-slate-600">{info.getValue()}</span>,
  }),
  columnHelper.accessor('total', {
    header: () => __('Value'),
    cell: (info) => {
      const row = info.row.original;
      return null === info.getValue() ? '—' : `${row.currency} ${info.getValue()}`;
    },
  }),
];

/**
 * Purchase-orders list. Fetches `GET /procurement/purchase-orders` and renders a TanStack table.
 * Rows navigate into the PO detail (built with the receiving slice); the §4.0 scaffold's
 * filter/keyboard machinery lands when the shared scaffold is adopted.
 */
export function PoList(props: { supplierId?: number }): JSX.Element {
  const api = createApi(useProcurement());
  const navigate = useNavigate();
  // Status segment + registry filter state, synced to the hash query. The supplier-embedded list
  // (a supplier-detail tab) fixes the supplier and shows no filter bar.
  // The list's filter lives in the router query, so carry it through navigations that leave the
  // list — otherwise entering a PO (and coming back) silently resets the filter.
  const location = useLocation();
  const [params, setParams] = useSearchParams<{
    status?: string;
    supplier?: string;
    eta_from?: string;
    eta_to?: string;
    sku?: string;
    supplier_mode?: string;
    sku_mode?: string;
  }>();
  const segment = (): StatusGroup => (isStatusGroup(params.status) ? params.status : 'open');

  // Registry filter value map (keyed by filter id) ⇄ URL. Supplier single at Essentials (Pro multi); SKU is
  // a comma-joined post-id list (hash-route friendly); ETA is the positional [from,to] window.
  const filterValues = (): Record<string, string[]> => ({
    // Supplier is a comma-joined id list (like SKU) so a Pro multi-select carries every pick; an Essentials
    // single-select just stores a one-element list. The server declares the control (single vs multi).
    supplier: params.supplier ? params.supplier.split(',') : [],
    eta: params.eta_from || params.eta_to ? [params.eta_from ?? '', params.eta_to ?? ''] : [],
    sku: params.sku ? params.sku.split(',') : [],
  });
  const setFilterValue = (id: string, next: string[]): void => {
    if ('supplier' === id) setParams({ supplier: next.length > 0 ? next.join(',') : undefined });
    else if ('eta' === id) setParams({ eta_from: next[0] || undefined, eta_to: next[1] || undefined });
    else if ('sku' === id) setParams({ sku: next.length > 0 ? next.join(',') : undefined });
  };
  // Per-filter match-mode modifiers (supplier any/none, SKU any/all/none) ⇄ `?<id>_mode=`.
  const filterModifiers = (): Record<string, Record<string, string>> => {
    const m: Record<string, Record<string, string>> = {};
    if (params.supplier_mode) m.supplier = { mode: params.supplier_mode };
    if (params.sku_mode) m.sku = { mode: params.sku_mode };
    return m;
  };
  const setFilterModifier = (id: string, key: string, value: string): void => {
    if ('mode' !== key) return;
    if ('supplier' === id) setParams({ supplier_mode: value || undefined });
    else if ('sku' === id) setParams({ sku_mode: value || undefined });
  };

  // SKU filter (async product search). Cache picked labels so chips/dropdown read "SKU — Name"
  // across queries (the values themselves are WC product post-ids).
  const [skuLabels, setSkuLabels] = createSignal<Record<string, string>>({});
  const labelFor = (v: string): string => skuLabels()[v] ?? v;
  const loadSkuOptions = async (q: string): Promise<ComboboxOption[]> => {
    const res = await api.get<ProductSearchResponse>('/procurement/products/search', { q });
    const opts = res.products.map((p) => {
      const name = p.name ?? String(p.postId);
      return { value: String(p.postId), label: p.sku ? `${p.sku} — ${name}` : name };
    });
    setSkuLabels((c) => {
      const next = { ...c };
      for (const o of opts) next[o.value] = o.label;
      return next;
    });
    return opts;
  };

  const query = createQuery(() => ({
    queryKey: [
      'procurement',
      'purchase-orders',
      props.supplierId ?? 'all',
      params.supplier ?? '',
      params.eta_from ?? '',
      params.eta_to ?? '',
      params.sku ?? '',
      params.supplier_mode ?? '',
      params.sku_mode ?? '',
    ],
    queryFn: () => {
      const q: Record<string, string | number | string[]> = {};
      if (undefined !== props.supplierId) q.supplier_id = props.supplierId; // tab scope
      const sup = filterValues().supplier;
      if (sup.length > 0) q.supplier = sup; // → supplier[]=…
      const eta = filterValues().eta;
      if (2 === eta.length) q.eta = eta; // → eta[]=from&eta[]=to (positional)
      const sku = filterValues().sku;
      if (sku.length > 0) q.sku = sku; // → sku[]=…
      for (const [id, mods] of Object.entries(filterModifiers())) {
        for (const [k, v] of Object.entries(mods)) q[`fmod[${id}][${k}]`] = v;
      }
      return api.get<PurchaseOrdersResponse>('/procurement/purchase-orders', 0 === Object.keys(q).length ? undefined : q);
    },
  }));

  // Chip summary per filter type (the default would show raw dates / post-ids).
  const summarize = (values: string[], options: ComboboxOption[], meta: { id: string }): string => {
    if (0 === values.length) return '';
    if ('eta' === meta.id) {
      const [from, to] = [values[0] ?? '', values[1] ?? ''];
      return from && to ? `${from} – ${to}` : from ? `from ${from}` : `until ${to}`;
    }
    if ('sku' === meta.id) return 1 === values.length ? labelFor(values[0]) : sprintf(__('%d SKUs'), values.length);
    const labelOf = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
    return values.length <= 2 ? values.map(labelOf).join(', ') : `${labelOf(values[0])} +${values.length - 1}`;
  };

  // Server-declared filters → shared FilterBar descriptors. The SKU filter is async, so wire its
  // loader + picked-label snapshot onto that descriptor.
  const descriptors = createMemo<FilterDescriptor[]>(() => {
    const base = gridFiltersToDescriptors(query.data?.filters ?? [], filterValues, setFilterValue, {
      summarize,
      modifiers: filterModifiers,
      setModifier: setFilterModifier,
      // eslint-disable-next-line solid/no-destructure -- this is a render-prop callback parameter, not component props; the plugin cannot tell them apart.
      extraFor: ({ meta, mode, setMode }) => <FilterModeToggle modes={meta.modes ?? []} value={mode} onChange={setMode} />,
    });
    return base.map((d) =>
      'sku' === d.id
        ? { ...d, loadOptions: loadSkuOptions, minQueryLength: 2, selectedOptions: () => d.value().map((v) => ({ value: v, label: labelFor(v) })) }
        : d,
    );
  });

  const rows = (): PurchaseOrder[] => {
    const all = query.data?.purchaseOrders ?? [];
    if (undefined !== props.supplierId) return all; // supplier tab: unfiltered
    const stages = GROUP_STAGES[segment()];
    return all.filter((po) => stages.includes(po.stage));
  };
  const isEmpty = (): boolean => query.isSuccess && 0 === rows().length;

  const table = createSolidTable({
    get data() {
      return rows();
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section>
      <Show when={undefined === props.supplierId}>
        <div class="flex gap-4 mb-4 items-center">
          <span>
            <SegmentedControl
              ariaLabel={__('Filter purchase orders by status')}
              options={[
                { value: 'draft', label: __('Draft') },
                { value: 'open', label: _x('Open', 'purchase-order status filter') },
                { value: 'closed', label: __('Closed') },
              ]}
              value={segment()}
              onChange={(v) => setParams({ status: v })}
            />
          </span>
          <FilterBar filters={descriptors} />
          <Button
            class="ml-auto"
            onClick={() => navigate(`/purchase-orders/new${location.search}`)}
          >
            {__('+ New PO')}
          </Button>
        </div>
      </Show>

      <Show when={query.isPending}>
        <p class="text-slate-500">{__('Loading purchase orders…')}</p>
      </Show>
      <Show when={query.isError}>
        <p class="text-red-700">{__('Failed to load purchase orders.')}</p>
      </Show>
      <Show when={isEmpty()}>
        <p class="text-slate-500">{__('No purchase orders yet.')}</p>
      </Show>

      <Show when={query.isSuccess && !isEmpty()}>
        {/*
          `data-testid` because nothing else here is a stable, locale-independent handle on "the
          list is up": inside the unified shell this surface renders no heading of its own (the tab
          strip names it), and every visible string is translated. The table is also the sharper
          landmark — it mounts only once the query has settled, so it cannot be satisfied by the
          loading placeholder standing in its place.
        */}
        <table class="w-full border-collapse text-sm" data-testid="purchase-order-list">
          <thead>
            <For each={table.getHeaderGroups()}>
              {(hg) => (
                <tr>
                  <For each={hg.headers}>
                    {(header) => (
                      <th class="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <For each={table.getRowModel().rows}>
              {(row) => (
                <tr
                  class="cursor-pointer hover:bg-slate-50"
                  onClick={() => navigate(`/purchase-orders/${row.original.id}${location.search}`)}
                >
                  <For each={row.getVisibleCells()}>
                    {(cell) => (
                      <td class="border-b border-slate-100 px-3 py-2 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}
