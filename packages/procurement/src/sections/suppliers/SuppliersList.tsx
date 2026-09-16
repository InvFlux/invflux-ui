import { __ } from '@invflux/i18n';
import { Button, createViewportFill, ErrorBanner } from '@invflux/ui';
import { A, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import {
  createColumnHelper,
  createSolidTable,
  flexRender,
  getCoreRowModel,
} from '@tanstack/solid-table';
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
        <Button onClick={() => setShowAdd(true)}>{__('+ Add supplier')}</Button>
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
        {/* `min-h-0`: lets the panel shrink below its rows and scroll them, instead of pushing the
            section past the height it was given. A short list still hugs its rows. */}
        <div class="min-h-0 overflow-auto rounded border border-border bg-surface">
          <table class="w-full border-collapse text-sm">
            <thead class="sticky top-0 z-10 bg-surface-raised">
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
                {(row) => {
                  const href = (): string => `/suppliers/${row.original.id}`;

                  return (
                    <tr
                      class="cursor-pointer hover:bg-slate-50"
                      onClick={(event) => {
                        // The first cell is a real link now, and the row click is only an
                        // enhancement over it. Without this guard both fire: a plain click
                        // navigates twice, and a ctrl/middle-click opens the row in a new tab AND
                        // navigates this one — the row losing its place as the cost of the shortcut.
                        if ((event.target as HTMLElement).closest('a,button,input,select,label')) {
                          return;
                        }
                        navigate(href());
                      }}
                    >
                      <For each={row.getVisibleCells()}>
                        {(cell, index) => (
                          <td class="border-b border-slate-100 px-3 py-2 align-top">
                            <Show
                              when={index() === 0}
                              fallback={flexRender(cell.column.columnDef.cell, cell.getContext())}
                            >
                              {/* The row's keyboard and assistive-tech entry point. A `<tr>` takes
                                no focus and announces no destination, so a click handler on it is
                                reachable by pointer only; the supplier name is the cell that names
                                where the row goes, so it carries the link. */}
                              <A href={href()} class="block">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </A>
                            </Show>
                          </td>
                        )}
                      </For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={showAdd()}>
        <AddSupplierModal onClose={() => setShowAdd(false)} />
      </Show>
    </section>
  );
}
