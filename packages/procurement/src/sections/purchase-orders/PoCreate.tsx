import { __ } from '@invflux/i18n';
import {
  Button,
  Combobox,
  IconButton,
  SearchSelect,
  toast,
  type ComboboxOption,
} from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { currencyOptions } from '../../lib/geo';
import { usePortalRoot } from '../../portal';
import type {
  Supplier,
  SuppliersResponse,
  SupplierProduct,
  SupplierProductsResponse,
} from '../suppliers/types';
import type { PurchaseOrder } from './types';

const INPUT =
  'w-full rounded border border-slate-300 px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
// Header-field input matching the Combobox/SearchSelect control (h-9, same border/bg/shadow) so ETA and
// tax rate line up with the supplier/currency pickers. The compact table INPUT above stays for line cells.
const FIELD_INPUT =
  'h-9 w-full rounded border border-border bg-surface px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary';
const FIELD = 'block text-sm text-slate-700';

/** A draft PO line. `subjectId` null until a catalogue product is picked. */
interface Line {
  key: number;
  subjectId: number | null;
  label: string;
  qty: string;
  unitCost: string;
}

/**
 * The universal "reviewable draft" PO surface (#/purchase-orders/new) — built manual-first but
 * designed to accept seed lines (the Workbench "Generate PO" replenishment/deficit paths feed the
 * same form later). Line entry is catalogue-first: pick from the chosen supplier's catalogue, with
 * unit cost pre-filled and formatted to the supplier's cost precision.
 */
export function PoCreate(): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const portalRoot = usePortalRoot();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isPro = (): boolean => ctx.hasPro;

  const [supplierId, setSupplierId] = createSignal<number | null>(null);
  const [currency, setCurrency] = createSignal('EUR');
  const [taxRate, setTaxRate] = createSignal('');
  const [expectedAt, setExpectedAt] = createSignal('');
  const [lines, setLines] = createStore<Line[]>([]);
  let nextKey = 1;

  const suppliers = createQuery(() => ({
    queryKey: ['procurement', 'suppliers'],
    queryFn: () => api.get<SuppliersResponse>('/procurement/suppliers'),
  }));
  const supplier = (): Supplier | undefined =>
    suppliers.data?.suppliers.find((s) => s.id === supplierId());

  const catalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', supplierId(), 'products'],
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${supplierId()}/products`),
    enabled: null !== supplierId(),
  }));
  const catalogueItem = (subjectId: number): SupplierProduct | undefined =>
    catalogue.data?.products.find((p) => p.subjectId === subjectId);

  const costDecimals = (): number => supplier()?.costDecimals ?? 2;

  const supplierOptions = (): ComboboxOption[] =>
    (suppliers.data?.suppliers ?? []).map((s) => ({ value: String(s.id), label: s.displayName }));
  const productOptions = (): ComboboxOption[] =>
    (catalogue.data?.products ?? []).map((p) => ({
      value: String(p.subjectId),
      label: null === p.sku ? p.productLabel : `${p.productLabel} · ${p.sku}`,
    }));

  const onSupplier = (sel: string[]): void => {
    const id = undefined === sel[0] ? null : Number(sel[0]);
    setSupplierId(id);
    setLines([]); // catalogue changes → previous lines are no longer valid
    const s = suppliers.data?.suppliers.find((x) => x.id === id);
    if (s?.currency) setCurrency(s.currency);
    setTaxRate(s?.defaultTaxRate ?? ''); // pre-fill the applied rate from the supplier default
  };

  const addLine = (): void => {
    setLines(lines.length, { key: nextKey++, subjectId: null, label: '', qty: '', unitCost: '' });
  };
  const removeLine = (idx: number): void => {
    setLines((ls) => ls.filter((_, i) => i !== idx));
  };
  const pickProduct = (idx: number, sel: string[]): void => {
    const id = undefined === sel[0] ? null : Number(sel[0]);
    setLines(idx, 'subjectId', id);
    if (null !== id) {
      const item = catalogueItem(id);
      setLines(idx, 'label', item?.productLabel ?? '');
      // Pre-fill the catalogue cost (formatted to the supplier's precision) when blank.
      if ('' === lines[idx].unitCost && item?.unitPrice != null) {
        setLines(idx, 'unitCost', Number(item.unitPrice).toFixed(costDecimals()));
      }
    }
  };

  const lineTotal = (l: Line): number => (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
  const total = createMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0));
  const canSave = (): boolean =>
    null !== supplierId() && lines.some((l) => null !== l.subjectId && Number(l.qty) > 0);

  const save = createMutation(() => ({
    mutationFn: () =>
      api.post<{ purchaseOrder: PurchaseOrder }>('/procurement/purchase-orders', {
        supplier_id: supplierId(),
        currency: currency(),
        tax_rate: !isPro() || '' === taxRate().trim() ? null : taxRate().trim(),
        expected_at: '' === expectedAt() ? null : expectedAt(),
        lines: lines
          .filter((l) => null !== l.subjectId)
          .map((l) => ({
            subject_id: l.subjectId,
            qty_requested: '' === l.qty.trim() ? 0 : Number(l.qty),
            unit_cost: '' === l.unitCost.trim() ? null : l.unitCost.trim(),
          })),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      // A fresh PO is an un-numbered draft — it gets its purchase order number later, when it is
      // assigned one just before going to the supplier. So there is nothing to name here.
      toast.success(__('Draft purchase order created.'));
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  return (
    <section>
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold">{__('New purchase order')}</h1>
      </header>

      <div class="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-4">
        <label class={`${FIELD} sm:col-span-2`}>
          {__('Supplier')} <span class="text-red-600">*</span>
          <div class="mt-1">
            <Combobox
              options={supplierOptions()}
              selected={null === supplierId() ? [] : [String(supplierId())]}
              onChange={onSupplier}
              multiple={false}
              placeholder={__('Select a supplier…')}
            />
          </div>
        </label>
        <div class={FIELD}>
          {__('Currency')}
          <div class="mt-1">
            <SearchSelect
              ariaLabel={__('Currency')}
              options={currencyOptions(ctx)}
              value={currency() || null}
              onChange={(v) => setCurrency(v ?? '')}
              placeholder={__('Select a currency…')}
              mount={portalRoot}
            />
          </div>
        </div>
        <label class={FIELD}>
          {__('Expected (ETA)')}
          <div class="mt-1">
            <input
              class={FIELD_INPUT}
              type="date"
              value={expectedAt()}
              onInput={(e) => setExpectedAt(e.currentTarget.value)}
            />
          </div>
        </label>
        <Show when={isPro()}>
          <label class={FIELD}>
            {__('Tax rate (%)')}
            <div class="mt-1">
              <input
                class={FIELD_INPUT}
                type="number"
                min="0"
                step="0.01"
                value={taxRate()}
                onInput={(e) => setTaxRate(e.currentTarget.value)}
              />
            </div>
          </label>
        </Show>
      </div>

      <Show
        when={null !== supplierId()}
        fallback={
          <p class="mt-6 text-sm text-slate-500">
            {__('Select a supplier to start adding lines.')}
          </p>
        }
      >
        <table class="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th class="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">
                {__('Product')}
              </th>
              <th class="w-24 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600">
                {__('Qty')}
              </th>
              <th class="w-32 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600">
                {__('Unit cost')}
              </th>
              <th class="w-32 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600">
                {__('Line total')}
              </th>
              <th class="w-10 border-b border-slate-200" />
            </tr>
          </thead>
          <tbody>
            <For each={lines}>
              {(line, idx) => (
                <tr>
                  <td class="border-b border-slate-100 px-3 py-1.5">
                    <Combobox
                      options={productOptions()}
                      selected={null === line.subjectId ? [] : [String(line.subjectId)]}
                      onChange={(sel) => pickProduct(idx(), sel)}
                      multiple={false}
                      placeholder={__('Search the catalogue…')}
                      emptyMessage={
                        catalogue.isFetching ? __('Loading…') : __('No catalogue products')
                      }
                    />
                  </td>
                  <td class="border-b border-slate-100 px-3 py-1.5">
                    <input
                      aria-label={__('Quantity')}
                      class={`${INPUT} text-right`}
                      type="number"
                      min="0"
                      value={line.qty}
                      onInput={(e) => setLines(idx(), 'qty', e.currentTarget.value)}
                    />
                  </td>
                  <td class="border-b border-slate-100 px-3 py-1.5">
                    <input
                      aria-label={__('Unit cost')}
                      class={`${INPUT} text-right`}
                      type="number"
                      min="0"
                      step={String(10 ** -costDecimals())}
                      value={line.unitCost}
                      onInput={(e) => setLines(idx(), 'unitCost', e.currentTarget.value)}
                    />
                  </td>
                  <td class="border-b border-slate-100 px-3 py-1.5 text-right tabular-nums">
                    <Show
                      when={null !== line.subjectId}
                      fallback={<span class="text-slate-300">—</span>}
                    >
                      {lineTotal(line).toFixed(costDecimals())}
                    </Show>
                  </td>
                  <td class="border-b border-slate-100 px-3 py-1.5 text-center">
                    <IconButton
                      size="sm"
                      danger
                      label={__('Remove line')}
                      title={__('Remove')}
                      onClick={() => removeLine(idx())}
                    >
                      ✕
                    </IconButton>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <div class="mt-2 flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={addLine}>
            {__('+ Add line')}
          </Button>
          <div class="text-sm font-semibold tabular-nums">
            {__('Total')}: {total().toFixed(costDecimals())} {currency()}
          </div>
        </div>
      </Show>

      <div class="mt-6 flex gap-2">
        <Button disabled={!canSave() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? __('Saving…') : __('Save purchase order')}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/purchase-orders')}>
          {__('Cancel')}
        </Button>
      </div>
    </section>
  );
}
