import { __ } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  Modal,
  SearchSelect,
  toast,
  Hint,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { createMutation, useQueryClient } from '@tanstack/solid-query';
import { createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { currencyOptions } from '../../lib/geo';
import { usePortalRoot } from '../../portal';
import type { Supplier } from './types';

const INPUT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
const FIELD = 'block text-sm text-slate-700';

/**
 * Quick-add supplier (D2): a modal with the minimal fields, posting to
 * `POST /procurement/suppliers` and invalidating the list on success. Editing an existing
 * supplier happens in-place on the detail page, not here.
 */
export function AddSupplierModal(props: { onClose: () => void }): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const portalRoot = usePortalRoot();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = createSignal('');
  const [nickname, setNickname] = createSignal('');
  const [currency, setCurrency] = createSignal(ctx.geo.baseCurrency || 'EUR');
  const [paymentTerms, setPaymentTerms] = createSignal('');
  const [leadTime, setLeadTime] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [phone, setPhone] = createSignal('');

  const mutation = createMutation(() => ({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ supplier: Supplier }>('/procurement/suppliers', body),
    onSuccess: (data: { supplier: Supplier }) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'suppliers'] });
      toast.success(__('Supplier created.'));
      props.onClose();
      // Straight to the new supplier: creating one is the start of setting it up — contacts,
      // catalogue, terms — never an end in itself.
      navigate(`/suppliers/${data.supplier.id}`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  const submit = (e: Event): void => {
    e.preventDefault();
    const trimmed = name().trim();
    if ('' === trimmed) return;
    mutation.mutate({
      name: trimmed,
      nickname: nickname().trim() || null,
      default_currency: currency(),
      payment_terms: paymentTerms().trim() || null,
      lead_time_days: '' === leadTime().trim() ? null : Number(leadTime()),
      email: email().trim() || null,
      phone: phone().trim() || null,
    });
  };

  return (
    <Modal onClose={props.onClose} label={__('Add supplier')} align="top">
      <ModalPanel size="md" class="mt-12">
        <ModalHeader title={__('Add supplier')} />
        <form onSubmit={submit}>
          <div class="p-4">
            <label class={FIELD}>
              {__('Name')} <span class="text-red-600">*</span>
              <input
                class={INPUT}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
                autofocus
              />
            </label>

            <label class={`${FIELD} mt-3`}>
              {__('Nickname')}{' '}
              <Hint
                text={__(
                  'A short display name used where space is tight (lists, badges, PO headers) when the legal name is long.',
                )}
              />
              <input
                class={INPUT}
                value={nickname()}
                onInput={(e) => setNickname(e.currentTarget.value)}
                placeholder={__('Short name for tight columns')}
              />
            </label>

            <div class="mt-3 grid grid-cols-2 gap-3">
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
                {__('Lead time (days)')}
                <input
                  class={INPUT}
                  type="number"
                  min="0"
                  value={leadTime()}
                  onInput={(e) => setLeadTime(e.currentTarget.value)}
                />
              </label>
            </div>

            <label class={`${FIELD} mt-3`}>
              {__('Payment terms')}
              <input
                class={INPUT}
                value={paymentTerms()}
                onInput={(e) => setPaymentTerms(e.currentTarget.value)}
                placeholder="Net 30"
              />
            </label>

            <div class="mt-3 grid grid-cols-2 gap-3">
              <label class={FIELD}>
                {__('Email')}
                <input
                  class={INPUT}
                  type="email"
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                />
              </label>
              <label class={FIELD}>
                {__('Phone')}
                <input
                  class={INPUT}
                  value={phone()}
                  onInput={(e) => setPhone(e.currentTarget.value)}
                />
              </label>
            </div>

            <Show when={mutation.isError}>
              <ErrorBanner class="mt-3 text-sm">{(mutation.error as Error).message}</ErrorBanner>
            </Show>
          </div>
          <ModalFooter>
            <Button variant="ghost" onClick={props.onClose}>
              {__('Cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || '' === name().trim()}>
              {mutation.isPending ? __('Creating…') : __('Create supplier')}
            </Button>
          </ModalFooter>
        </form>
      </ModalPanel>
    </Modal>
  );
}
