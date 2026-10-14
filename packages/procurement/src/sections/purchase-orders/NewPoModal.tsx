import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  FieldError,
  Modal,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  SearchSelect,
  toast,
} from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { usePortalRoot } from '../../portal';
import type { SuppliersResponse } from '../suppliers/types';

type Start = 'suggested' | 'empty';

/**
 * Open a new purchase order draft: which supplier, and whether to start from what needs reordering
 * or from nothing. Everything else — lines, the expected date, the terms — is edited on the draft
 * itself, where the order's own tools are. The order takes the supplier's currency, and an expected
 * date left empty is filled from the supplier's lead time when the order is numbered.
 *
 * Starting from suggestions is the same sweep as the supplier page's replenishment draft, and the
 * line under that choice counts what it would hold right now. Nothing to reorder still opens a draft
 * when one was asked for: an empty one, said so.
 */
export function NewPoModal(props: { onClose: () => void }): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const portalRoot = usePortalRoot();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [supplierId, setSupplierId] = createSignal<number | null>(null);
  const [start, setStart] = createSignal<Start>('suggested');
  const [tried, setTried] = createSignal(false);
  const supplierMissing = (): boolean => tried() && null === supplierId();

  const suppliers = createQuery(() => ({
    queryKey: ['procurement', 'suppliers'],
    queryFn: () => api.get<SuppliersResponse>('/procurement/suppliers'),
  }));
  // What a suggested draft would hold right now for each supplier, counted server-side in one
  // pass. Asked for on opening and never cached: the counts are only worth what stock is now.
  const preview = createQuery(() => ({
    queryKey: ['procurement', 'replenish-preview'],
    queryFn: () =>
      api.get<{ counts: Record<string, number> }>('/procurement/purchase-orders/replenish'),
    staleTime: 0,
    gcTime: 0,
  }));
  const countFor = (id: number): number | undefined =>
    undefined === preview.data ? undefined : (preview.data.counts[String(id)] ?? 0);

  // Each name carries its count once the counts are in; until then the plain names, so the picker
  // never waits on them.
  const supplierOptions = (): { value: string; label: string }[] =>
    (suppliers.data?.suppliers ?? [])
      .filter((s) => 'active' === s.status)
      .map((s) => {
        const n = countFor(s.id);
        return {
          value: String(s.id),
          label: undefined === n ? s.displayName : `${s.displayName} (${n})`,
        };
      });
  const selectedCount = (): number | undefined => {
    const id = supplierId();
    return null === id ? undefined : countFor(id);
  };

  const open = createMutation(() => ({
    mutationFn: (): Promise<{ purchaseOrder: { id: number; lineCount: number } }> =>
      'suggested' === start()
        ? api.post('/procurement/purchase-orders/replenish', {
            supplier_id: supplierId(),
            open_empty: true,
          })
        : api.post('/procurement/purchase-orders', { supplier_id: supplierId() }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      if ('suggested' === start() && 0 === data.purchaseOrder.lineCount) {
        toast.info(__('Nothing needs reordering right now, so the draft opens empty.'));
      }
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not open the purchase order draft.')),
  }));

  const submit = (): void => {
    setTried(true);
    if (null === supplierId()) return;
    open.mutate();
  };

  return (
    <Modal onClose={props.onClose} label={__('New purchase order')} align="top">
      <ModalPanel size="md" class="mt-12">
        <ModalHeader title={__('New purchase order')} />
        <div class="space-y-4 p-4 text-sm">
          <label class="block">
            <span class="mb-1 block text-slate-700">
              {__('Supplier')}{' '}
              <span class="text-text-muted">
                {_x('(products to reorder)', 'what the number beside each supplier counts')}
              </span>{' '}
              <span class="text-red-600">*</span>
            </span>
            <SearchSelect
              ariaLabel={__('Supplier')}
              options={supplierOptions()}
              value={null === supplierId() ? null : String(supplierId())}
              onChange={(v) => setSupplierId(null === v ? null : Number(v))}
              placeholder={__('Select a supplier…')}
              mount={portalRoot}
              invalid={supplierMissing()}
              firstOptionFocus
              emptyMessage={suppliers.isPending ? __('Loading…') : __('No active suppliers')}
            />
            <FieldError
              message={supplierMissing() && __('Choose the supplier this order goes to.')}
              testId="new-po-supplier-error"
            />
          </label>

          <fieldset class="space-y-2">
            <label class="flex items-start gap-2">
              <input
                type="radio"
                name="new-po-start"
                class="mt-0.5"
                data-testid="new-po-suggested"
                checked={'suggested' === start()}
                onChange={() => setStart('suggested')}
              />
              <span>
                <span class="font-medium">{__('Prefill with suggested quantities')}</span>
                <Show when={null !== supplierId()}>
                  <span class="block text-xs text-text-muted" data-testid="new-po-preview">
                    <Switch>
                      <Match when={preview.isPending}>{__('Checking stock…')}</Match>
                      <Match when={preview.isError}>
                        {__('Could not check stock levels right now.')}
                      </Match>
                      <Match when={0 === selectedCount()}>
                        {__('Nothing needs reordering right now: the draft would open empty.')}
                      </Match>
                      <Match when={(selectedCount() ?? 0) > 0}>
                        {sprintf(
                          /* translators: %d is a number of products that need reordering. */
                          _n(
                            '%d product needs reordering at current stock levels.',
                            '%d products need reordering at current stock levels.',
                            selectedCount() ?? 0,
                          ),
                          selectedCount() ?? 0,
                        )}
                      </Match>
                    </Switch>
                  </span>
                </Show>
              </span>
            </label>
            <label class="flex items-start gap-2">
              <input
                type="radio"
                name="new-po-start"
                class="mt-0.5"
                data-testid="new-po-empty"
                checked={'empty' === start()}
                onChange={() => setStart('empty')}
              />
              <span class="text-text-muted">
                {__('Leave it empty, for manual entry or import')}
              </span>
            </label>
          </fieldset>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {__('Cancel')}
          </Button>
          <Button disabled={open.isPending} onClick={submit} data-testid="new-po-open">
            {open.isPending ? __('Opening…') : __('Open new PO draft')}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
