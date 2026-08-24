import { __ } from '@invflux/i18n';
import { Button } from '@invflux/ui';
import { A, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createColumnHelper, createSolidTable, flexRender, getCoreRowModel } from '@tanstack/solid-table';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { AddSupplierModal } from './AddSupplierModal';
import type { Supplier, SuppliersResponse } from './types';

const columnHelper = createColumnHelper<Supplier>();

const columns = [
  columnHelper.accessor('displayName', {
    header: () => __('Supplier'),
    cell: (info) => {
      const row = info.row.original;
      return (
        <span class="flex flex-col">
          <span class="font-semibold">{info.getValue()}</span>
          {/* When a nickname stands in for a long legal name, show the legal name as a hint. */}
          <Show when={row.nickname && row.nickname !== row.name}>
            <span class="text-xs text-text-muted">{row.name}</span>
          </Show>
        </span>
      );
    },
  }),
  columnHelper.accessor('currency', {
    header: () => __('Currency'),
    cell: (info) => info.getValue() ?? '—',
  }),
  columnHelper.accessor('paymentTerms', {
    header: () => __('Payment terms'),
    cell: (info) => info.getValue() ?? '—',
  }),
  columnHelper.accessor('leadTimeDays', {
    header: () => __('Lead time'),
    cell: (info) => {
      const days = info.getValue();
      return null === days ? '—' : `${days} d`;
    },
  }),
  columnHelper.accessor('openPoCount', {
    header: () => __('Open POs'),
    cell: (info) => {
      const row = info.row.original;
      const open = info.getValue();
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
  }),
  columnHelper.accessor('status', {
    header: () => __('Status'),
    cell: (info) => <StatusPill status={info.getValue()} />,
  }),
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

  const table = createSolidTable({
    get data() {
      return query.data?.suppliers ?? [];
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const isEmpty = (): boolean => query.isSuccess && 0 === (query.data?.suppliers.length ?? 0);

  return (
    <section>
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold">{__('Suppliers')}</h1>
        <Button
          onClick={() => setShowAdd(true)}
        >
          {__('+ Add supplier')}
        </Button>
      </header>

      <Show when={query.isPending}>
        <p class="text-slate-500">{__('Loading suppliers…')}</p>
      </Show>
      <Show when={query.isError}>
        <p class="text-red-700">{__('Failed to load suppliers.')}</p>
      </Show>
      <Show when={isEmpty()}>
        <p class="text-slate-500">{__('No suppliers yet.')}</p>
      </Show>

      <Show when={query.isSuccess && !isEmpty()}>
        <table class="w-full border-collapse text-sm">
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
                  onClick={() => navigate(`/suppliers/${row.original.id}`)}
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

      <Show when={showAdd()}>
        <AddSupplierModal onClose={() => setShowAdd(false)} />
      </Show>
    </section>
  );
}
