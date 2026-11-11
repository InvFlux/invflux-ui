import { __, _n, _x, formatDate, parseDateOnly, sprintf } from '@invflux/i18n';
import {
  ColumnsSettingsIcon,
  createColumnModel,
  DataTable,
  type DataTableColumn,
  ErrorBanner,
  Button,
  createViewportFill,
  FilterBar,
  FilterModeToggle,
  SegmentedControl,
  gridFiltersToDescriptors,
  type ComboboxOption,
  type FilterDescriptor,
} from '@invflux/ui';
import { A, useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { daysUntilDate } from '../../lib/dates';
import type { ProductSearchResponse } from '../suppliers/types';
import { formatPoTotal } from './poTotal';
import type { PurchaseOrder, PurchaseOrdersResponse } from './types';

/**
 * The list's segments.
 *
 * **Two questions, not one.** `draft` / `open` / `closed` answer *how is this order going* — the
 * stage. `archived` answers *is it in the working lists* — a separate column, because filing an
 * order away says nothing about how it turned out. An archived order still knows it was received,
 * and shows its real stage pill inside the Archived tab.
 *
 * **Every order is in exactly one segment**, which is a requirement rather than tidiness: the
 * segment filters the fetched rows, so an order matching none is fetched, dropped, and reachable
 * from nowhere. Archived takes precedence over the three stage buckets, so filing an order away
 * moves it rather than duplicating it.
 */
type StatusGroup = 'draft' | 'open' | 'closed' | 'archived';

/** The two *bounded* ends of the stage axis. Everything between them is open — see {@link inGroup}. */
const GROUP_STAGES: Record<'draft' | 'closed', string[]> = {
  draft: ['in_prep', 'in_review', 'approved'],
  closed: ['received', 'canceled'],
};

/**
 * Whether an order belongs in a segment.
 *
 * **Open is derived, not listed, and that is what makes the stage buckets exhaustive.** Enumerating
 * all three left `partially_received` in none of them, which did not read as a filter gap: an
 * unlisted stage is fetched, dropped, and reachable from nowhere at all. Deriving the middle removes
 * the failure rather than correcting one instance of it — a stage added later surfaces under Open,
 * which is the safe direction and almost always the right one, since new stages describe orders in
 * flight.
 *
 * It is also the truer definition. Open is not a list of stages that happen to be inbound; it is
 * *not yet sent* and *finished* having been decided, and everything else being in between.
 */
const inGroup = (po: PurchaseOrder, group: StatusGroup): boolean => {
  if (po.archived) return 'archived' === group;
  if ('archived' === group) return false;
  if ('open' === group) {
    return !GROUP_STAGES.draft.includes(po.stage) && !GROUP_STAGES.closed.includes(po.stage);
  }

  return GROUP_STAGES[group].includes(po.stage);
};

const isStatusGroup = (v: string | undefined): v is StatusGroup =>
  'draft' === v || 'open' === v || 'closed' === v || 'archived' === v;

/**
 * Stages where goods are still expected — drives the ETA countdown + late highlight.
 *
 * Wider than `open` at the front (a draft can carry an ETA worth counting down) and the same at the
 * back: an order that is partly received is still owed its remainder, so its date keeps running.
 */
const AWAITING = [
  'in_prep',
  'in_review',
  'approved',
  'submitted',
  'acknowledged',
  'in_transit',
  'in_reception',
  'partially_received',
];

/** ETA cell: locale-aware, zero-padded fixed-width date + days-to-arrival; red + countdown while overdue. */
function EtaCell(props: { iso: string | null; stage: string }): JSX.Element {
  const date = parseDateOnly(props.iso);
  if (null === date) return <span class="text-text-muted">—</span>;
  const dateStr = formatDate(date, '', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
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

/**
 * Lifecycle order of the stages, so sorting the Stage column groups orders by how far along they
 * are rather than alphabetically by code. A stage not listed sorts after the known ones.
 */
const STAGE_ORDER = [
  'in_prep',
  'in_review',
  'approved',
  'submitted',
  'acknowledged',
  'in_transit',
  'arrived',
  'in_reception',
  'partially_received',
  'received',
  'canceled',
];

/**
 * The list's columns. Built when the list renders, not at module load, so every label is translated
 * for the request's language; `hrefOf` is the router-aware address of an order (it carries the
 * list's filter query).
 */
const poColumns = (hrefOf: (po: PurchaseOrder) => string): DataTableColumn<PurchaseOrder>[] => [
  {
    id: 'number',
    header: __('PO #'),
    required: true,
    sortValue: (po) => po.number,
    // A draft has no document number yet — it gets one just before it goes to the supplier. Fall back
    // to the internal id, marked so it can never be mistaken for the real thing: the `#` sigil and the
    // word "Draft" survive a screenshot or a read-aloud, where muted styling alone would not. It is
    // deliberately unprefixed and unpadded — borrowing the document number's own signature is what
    // would make the two confusable.
    cell: (po) => (
      // The row's keyboard and assistive-tech entry point. A `<tr>` takes no focus and announces no
      // destination, so a click handler on it is reachable by pointer only; the PO number is the
      // cell that names where the row goes, so it carries the link.
      <A href={hrefOf(po)} class="block">
        {null === po.number ? (
          <span class="text-text-muted">{sprintf(__('Draft #%d'), po.id)}</span>
        ) : (
          <span class="font-semibold">{po.number}</span>
        )}
      </A>
    ),
  },
  {
    id: 'supplier',
    header: __('Supplier'),
    sortValue: (po) => po.supplierDisplay,
    cell: (po) => po.supplierDisplay ?? '—',
  },
  {
    id: 'stage',
    header: __('Stage'),
    sortValue: (po) => {
      const at = STAGE_ORDER.indexOf(po.stage);

      return -1 === at ? STAGE_ORDER.length : at;
    },
    cell: (po) => <StatusPill status={po.stage} />,
  },
  {
    id: 'discrepancy',
    header: __('Discrepancy'),
    sortValue: (po) => (po.discrepancy?.over ?? 0) + (po.discrepancy?.short ?? 0),
    // Delivery-discrepancy rollup (over / finalized-short line counts, Ordered lens) — a glanceable
    // "needs a look" flag; the per-line detail lives on the PO. Discrepancy-free POs show a dash.
    cell: (po) => {
      const d = po.discrepancy;
      if (null === d || (0 === d.over && 0 === d.short))
        return <span class="text-slate-300">—</span>;
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
  },
  {
    id: 'eta',
    header: __('ETA'),
    sortValue: (po) => po.expectedAt,
    cell: (po) => <EtaCell iso={po.expectedAt} stage={po.stage} />,
  },
  {
    id: 'lines',
    header: __('Lines'),
    kind: 'num',
    sortValue: (po) => po.lineCount,
    cell: (po) => <span class="text-slate-600">{po.lineCount}</span>,
  },
  {
    id: 'value',
    header: __('Value'),
    kind: 'num',
    sortValue: (po) => (null === po.total ? null : Number(po.total)),
    cell: (po) => formatPoTotal(po.total, po.currency, po.costDecimals),
  },
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
    else if ('eta' === id)
      setParams({ eta_from: next[0] || undefined, eta_to: next[1] || undefined });
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
      return api.get<PurchaseOrdersResponse>(
        '/procurement/purchase-orders',
        0 === Object.keys(q).length ? undefined : q,
      );
    },
  }));

  // Chip summary per filter type (the default would show raw dates / post-ids).
  const summarize = (values: string[], options: ComboboxOption[], meta: { id: string }): string => {
    if (0 === values.length) return '';
    if ('eta' === meta.id) {
      const [from, to] = [values[0] ?? '', values[1] ?? ''];
      return from && to ? `${from} – ${to}` : from ? `from ${from}` : `until ${to}`;
    }
    if ('sku' === meta.id)
      return 1 === values.length ? labelFor(values[0]) : sprintf(__('%d SKUs'), values.length);
    const labelOf = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
    return values.length <= 2
      ? values.map(labelOf).join(', ')
      : `${labelOf(values[0])} +${values.length - 1}`;
  };

  // Server-declared filters → shared FilterBar descriptors. The SKU filter is async, so wire its
  // loader + picked-label snapshot onto that descriptor.
  const descriptors = createMemo<FilterDescriptor[]>(() => {
    const base = gridFiltersToDescriptors(query.data?.filters ?? [], filterValues, setFilterValue, {
      summarize,
      modifiers: filterModifiers,
      setModifier: setFilterModifier,
      // eslint-disable-next-line solid/no-destructure -- this is a render-prop callback parameter, not component props; the plugin cannot tell them apart.
      extraFor: ({ meta, mode, setMode }) => (
        <FilterModeToggle modes={meta.modes ?? []} value={mode} onChange={setMode} />
      ),
    });
    return base.map((d) =>
      'sku' === d.id
        ? {
            ...d,
            loadOptions: loadSkuOptions,
            minQueryLength: 2,
            selectedOptions: () => d.value().map((v) => ({ value: v, label: labelFor(v) })),
          }
        : d,
    );
  });

  const rows = (): PurchaseOrder[] => {
    const all = query.data?.purchaseOrders ?? [];
    if (undefined !== props.supplierId) return all; // supplier tab: unfiltered
    return all.filter((po) => inGroup(po, segment()));
  };
  const isEmpty = (): boolean => query.isSuccess && 0 === rows().length;

  // The operator's column choices, kept per place the list appears: the full list and a supplier's
  // own tab are different working views, so a column hidden in one says nothing about the other.
  const model = createColumnModel({
    scope: undefined === props.supplierId ? 'purchase-orders' : 'supplier-purchase-orders',
  });
  const hrefOf = (po: PurchaseOrder): string => `/purchase-orders/${po.id}${location.search}`;
  const columns = createMemo(() => poColumns(hrefOf));

  // Fill from where the list starts down to the viewport bottom — on its own page and inside a
  // supplier's Purchase Orders tab alike: a long list scrolls inside its panel, so its header and
  // bottom edge stay on screen and the page itself never scrolls. The gutter under it is this
  // element's own `pb-4`, inside that height.
  let rootEl: HTMLElement | undefined;
  const listHeight = createViewportFill(() => rootEl);

  const columnsButton = (): JSX.Element => (
    <Button
      variant="secondary"
      size="xs"
      class="px-1.5!"
      title={__('Columns')}
      aria-label={__('Columns')}
      // Nothing to pick from while the table is not mounted (no rows).
      disabled={!query.isSuccess || isEmpty()}
      onClick={model.openPicker}
    >
      <ColumnsSettingsIcon class="h-4 w-4" />
    </Button>
  );

  return (
    <section
      ref={rootEl}
      data-viewport-fill
      class="flex flex-col pb-4"
      style={{ height: listHeight() }}
    >
      <Show when={undefined === props.supplierId}>
        <div class="flex gap-4 mb-4 items-center">
          <span>
            <SegmentedControl
              ariaLabel={__('Filter purchase orders by status')}
              options={[
                { value: 'draft', label: __('Draft') },
                { value: 'open', label: _x('Open', 'purchase-order status filter') },
                { value: 'closed', label: __('Closed') },
                {
                  value: 'archived',
                  label: __('Archived'),
                  title: __('Orders filed out of the working lists — they keep their status'),
                },
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
          {columnsButton()}
        </div>
      </Show>
      {/* A supplier's tab has no toolbar, so the picker gets a thin row of its own. */}
      <Show when={undefined !== props.supplierId}>
        <div class="mb-2 flex justify-end">{columnsButton()}</div>
      </Show>

      <Show when={query.isPending}>
        <p class="text-slate-500">{__('Loading purchase orders…')}</p>
      </Show>
      <Show when={query.isError}>
        <ErrorBanner>{__('Failed to load purchase orders.')}</ErrorBanner>
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
        {/* The table's box is a flex child of this section, whose height is fixed: its own overflow
            lets it shrink below its rows and scroll them, instead of pushing the section past the
            height it was given. A short list still hugs its rows. */}
        <DataTable
          columns={columns()}
          rows={rows()}
          rowKey={(po) => String(po.id)}
          model={model}
          rowProps={() => ({ class: 'cursor-pointer' })}
          onRowClick={(po, event) => {
            // The first cell is a real link, and the row click is only an enhancement over it.
            // Without this guard both fire: a plain click navigates twice, and a ctrl/middle-click
            // opens the row in a new tab AND navigates this one — the row losing its place as the
            // cost of the shortcut.
            if ((event.target as HTMLElement).closest('a,button,input,select,label')) return;
            navigate(hrefOf(po));
          }}
          empty={null}
          testId="purchase-order-list"
        />
      </Show>
    </section>
  );
}
