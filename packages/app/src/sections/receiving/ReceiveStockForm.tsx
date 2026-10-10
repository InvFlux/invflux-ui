import { __ } from '@invflux/i18n';
import { Button, ErrorBanner, mintReceiptKey, RequiredMark, Select } from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import { StandaloneSession } from './StandaloneSession';
import type {
  ReceiptReasonOption,
  ReceivingContextResponse,
  StandaloneSessionResponse,
} from './types';

const FIELD = 'block text-sm font-medium text-slate-600';
const PURCHASE_WITHOUT_ORDER = 'purchase_without_order';

/**
 * Stock arriving against no document — an opening balance, a delivery nobody ordered, units found on
 * a shelf. `rest` is the count's id once one is open; without it, this is where one is opened.
 */
export function ReceiveStockForm(props: { rest: string }): JSX.Element {
  const id = (): number => Number(props.rest);
  return (
    <Show when={'' !== props.rest && Number.isInteger(id()) && id() > 0} fallback={<OpenCount />}>
      <StandaloneSession id={id()} />
    </Show>
  );
}

/**
 * Choose why the stock is arriving, then open a count for it.
 *
 * **The reason comes first and is then fixed.** It is what the receipt carries in place of a
 * document, and it decides what each line owes about cost: some reasons demand a figure, one records
 * a literal zero, two stand the product's own valuation in. That table is the server's
 * (`GET /receiving/context`) rather than a copy kept here. Because the count's columns follow from
 * it, the reason is not offered again once the count is open.
 *
 * Opening writes the count to the server, so nothing typed afterwards is lost to a reload.
 */
function OpenCount(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const context = createQuery(() => ({
    queryKey: ['receiving', 'context'],
    queryFn: () => api.get<ReceivingContextResponse>('/receiving/context'),
    // Build-level facts and a capability: stable for the session.
    staleTime: Number.POSITIVE_INFINITY,
  }));

  const [chosen, setChosen] = createSignal('');
  const [supplierId, setSupplierId] = createSignal('');
  // Only stock bought without a purchase order names who sold it.
  const namesSupplier = (): boolean => PURCHASE_WITHOUT_ORDER === chosen();
  const reason = (): ReceiptReasonOption | null =>
    context.data?.reasons.find((r) => r.value === chosen()) ?? null;
  const canStateCost = (): boolean => context.data?.canStateCost ?? false;

  // A reason this user cannot complete: it demands a cost they may not state. Said plainly rather
  // than by a disabled button with no explanation.
  const blockedByCostCap = (): boolean => 'required' === reason()?.costEntry && !canStateCost();

  /** One intent to open, kept across retries of that press — a second click finds the same count. */
  let openKey: string | null = null;

  const open = createMutation(() => ({
    mutationFn: () => {
      openKey ??= mintReceiptKey();
      return api.post<StandaloneSessionResponse>('/receiving/sessions', {
        reason: chosen(),
        supplierId: namesSupplier() && '' !== supplierId() ? Number(supplierId()) : null,
        openKey,
      });
    },
    onSuccess: (data) => {
      openKey = null;
      void queryClient.invalidateQueries({ queryKey: ['receiving', 'sessions'] });
      navigate(`/receiving/new/manual/${data.session.id}`);
    },
  }));

  const openError = (): string => {
    const e = open.error;
    if (null === e || undefined === e) return '';
    const body =
      'object' === typeof e && 'body' in e
        ? (e as { body: { error?: unknown } | null }).body
        : null;
    return 'string' === typeof body?.error
      ? body.error
      : e instanceof Error
        ? e.message
        : String(e);
  };

  return (
    <section class="max-w-4xl">
      <header class="mb-4">
        <ReceivingCrumbs
          trail={[
            { label: __('Start a reception'), href: '/receiving/new' },
            { label: __('No document') },
          ]}
        />
        <p class="mt-1 text-sm text-text-muted">
          {__(
            'For goods arriving without a purchase order behind them. Nothing is added to stock until you record the receipt.',
          )}
        </p>
      </header>

      <label class={`${FIELD} mb-1`} for="receiving-reason">
        {__('Why is this stock arriving?')} <RequiredMark />
      </label>
      <div class="flex max-w-2xl items-center gap-3">
        <Select
          id="receiving-reason"
          class="w-full max-w-md"
          value={chosen()}
          disabled={context.isPending || open.isPending}
          onChange={(e) => {
            open.reset();
            openKey = null;
            setChosen(e.currentTarget.value);
          }}
        >
          <option value="">{__('Choose a reason…')}</option>
          <For each={context.data?.reasons ?? []}>
            {(r) => (
              <option value={r.value} disabled={'unsupported' === r.costEntry}>
                {r.label}
              </option>
            )}
          </For>
        </Select>
        <Button
          data-testid="standalone-open"
          class="shrink-0"
          disabled={null === reason() || blockedByCostCap() || open.isPending}
          onClick={() => open.mutate()}
        >
          {__('Open new receipt')}
        </Button>
      </div>
      <Show when={reason()}>
        {(r) => <p class="mt-1 max-w-2xl text-xs text-text-muted">{r().hint}</p>}
      </Show>
      <Show when={namesSupplier() && (context.data?.suppliers.length ?? 0) > 0}>
        <label class={`${FIELD} mt-4 mb-1`} for="receiving-supplier">
          {__('Supplier (optional)')}
        </label>
        <Select
          id="receiving-supplier"
          data-testid="standalone-supplier"
          class="w-full max-w-md"
          value={supplierId()}
          disabled={open.isPending}
          onChange={(e) => {
            open.reset();
            openKey = null;
            setSupplierId(e.currentTarget.value);
          }}
        >
          <option value="">{__('Not recorded')}</option>
          <For each={context.data?.suppliers ?? []}>
            {(sup) => <option value={String(sup.id)}>{sup.name}</option>}
          </For>
        </Select>
        <p class="mt-1 max-w-2xl text-xs text-text-muted">
          {__(
            'Naming the supplier records who delivered, offers their catalog, and fills in unit costs from their catalog prices.',
          )}
        </p>
      </Show>
      <Show when={blockedByCostCap()}>
        <ErrorBanner class="mt-2 max-w-2xl text-xs">
          {__(
            'This kind of receipt has to state what the goods cost, and you do not have permission to do that. Ask someone who does to record it.',
          )}
        </ErrorBanner>
      </Show>
      <Show when={'' !== openError()}>
        <ErrorBanner class="mt-2 max-w-2xl text-sm">{openError()}</ErrorBanner>
      </Show>
    </section>
  );
}
