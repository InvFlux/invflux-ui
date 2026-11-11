import { __ } from '@invflux/i18n';
import {
  Button,
  ColumnsSettingsIcon,
  createColumnModel,
  createViewportFill,
  DataTable,
  type DataTableColumn,
  ErrorBanner,
} from '@invflux/ui';
import { A, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createSignal, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { AddSupplierModal } from './AddSupplierModal';
import type { Supplier, SuppliersResponse } from './types';

/**
 * The list's columns, built when the list renders so every label is translated for the request's
 * language.
 */
const supplierColumns = (): DataTableColumn<Supplier>[] => [
  {
    id: 'supplier',
    header: __('Supplier'),
    required: true,
    sortValue: (row) => row.displayName,
    cell: (row) => (
      // The row's keyboard and assistive-tech entry point. A `<tr>` takes no focus and announces no
      // destination, so a click handler on it is reachable by pointer only; the supplier name is the
      // cell that names where the row goes, so it carries the link.
      <A href={`/suppliers/${row.id}`} class="block">
        <span class="flex flex-col">
          <span class="font-semibold">{row.displayName}</span>
          {/* When a nickname stands in for a long legal name, show the legal name as a hint. */}
          <Show when={row.nickname && row.nickname !== row.name}>
            <span class="text-xs text-text-muted">{row.name}</span>
          </Show>
        </span>
      </A>
    ),
  },
  {
    id: 'currency',
    header: __('Currency'),
    sortValue: (row) => row.currency,
    cell: (row) => row.currency ?? '—',
  },
  {
    id: 'payment_terms',
    header: __('Payment terms'),
    sortValue: (row) => row.paymentTerms,
    cell: (row) => row.paymentTerms ?? '—',
  },
  {
    id: 'lead_time',
    header: __('Lead time'),
    kind: 'num',
    sortValue: (row) => row.leadTimeDays,
    cell: (row) => (null === row.leadTimeDays ? '—' : `${row.leadTimeDays} d`),
  },
  {
    id: 'open_pos',
    header: __('Open POs'),
    kind: 'num',
    sortValue: (row) => row.openPoCount,
    cell: (row) => {
      const open = row.openPoCount;
      const draft = row.draftPoCount;
      if (0 === open && 0 === draft) return <span class="text-slate-300">—</span>;
      // Deep-link the count to the supplier's POs tab; stop the row's detail navigation.
      return (
        <A
          href={`/suppliers/${row.id}/pos`}
          onClick={(e) => e.stopPropagation()}
          class="tabular-nums text-primary hover:underline"
          title={__('Open POs (drafts)')}
        >
          {open}
          <Show when={draft > 0}>
            {' '}
            <span class="text-text-muted">({draft})</span>
          </Show>
        </A>
      );
    },
  },
  {
    id: 'status',
    header: __('Status'),
    sortValue: (row) => row.status,
    cell: (row) => <StatusPill status={row.status} />,
  },
];

/**
 * Suppliers list — the read half of the Suppliers section, plus the quick-add modal. Fetches
 * `GET /procurement/suppliers` (nonce-auth) and renders a TanStack table. In-place editing lands
 * on the supplier detail page (next increment).
 */
export function SuppliersList(): JSX.Element {
  const api = createApi(useProcurement());
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = createSignal(false);

  const query = createQuery(() => ({
    queryKey: ['procurement', 'suppliers'],
    queryFn: () => api.get<SuppliersResponse>('/procurement/suppliers'),
  }));

  // The operator's column choices for this list.
  const model = createColumnModel({ scope: 'suppliers' });
  const columns = supplierColumns();

  const isEmpty = (): boolean => query.isSuccess && 0 === (query.data?.suppliers.length ?? 0);

  // Fill from where the list starts down to the viewport bottom: a long list scrolls inside its
  // panel, so its header and bottom edge stay on screen and the page itself never scrolls. The
  // gutter under it is this element's own `pb-4`, inside that height.
  let rootEl: HTMLElement | undefined;
  const listHeight = createViewportFill(() => rootEl);

  return (
    <section
      ref={rootEl}
      data-viewport-fill
      class="flex flex-col pb-4"
      style={{ height: listHeight() }}
    >
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold">{__('Suppliers')}</h1>
        <div class="flex items-center gap-2">
          <Button onClick={() => setShowAdd(true)}>{__('+ Add supplier')}</Button>
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
        </div>
      </header>

      <Show when={query.isPending}>
        <p class="text-slate-500">{__('Loading suppliers…')}</p>
      </Show>
      <Show when={query.isError}>
        <ErrorBanner>{__('Failed to load suppliers.')}</ErrorBanner>
      </Show>
      <Show when={isEmpty()}>
        <p class="text-slate-500">{__('No suppliers yet.')}</p>
      </Show>

      <Show when={query.isSuccess && !isEmpty()}>
        {/* The table's box is a flex child of this section, whose height is fixed: its own overflow
            lets it shrink below its rows and scroll them, instead of pushing the section past the
            height it was given. A short list still hugs its rows. */}
        <DataTable
          columns={columns}
          rows={query.data?.suppliers ?? []}
          rowKey={(row) => String(row.id)}
          model={model}
          rowProps={() => ({ class: 'cursor-pointer' })}
          onRowClick={(row, event) => {
            // The name is a real link, and the row click is only an enhancement over it. Without
            // this guard both fire: a plain click navigates twice, and a ctrl/middle-click opens the
            // row in a new tab AND navigates this one.
            if ((event.target as HTMLElement).closest('a,button,input,select,label')) return;
            navigate(`/suppliers/${row.id}`);
          }}
          empty={null}
          testId="supplier-list"
        />
      </Show>

      <Show when={showAdd()}>
        <AddSupplierModal onClose={() => setShowAdd(false)} />
      </Show>
    </section>
  );
}
