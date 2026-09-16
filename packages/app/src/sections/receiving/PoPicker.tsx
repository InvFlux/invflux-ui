import { __, _n, sprintf } from '@invflux/i18n';
import { Button, Checkbox, ErrorBanner, Select } from '@invflux/ui';
import { createQuery } from '@tanstack/solid-query';
import { useNavigate } from '@solidjs/router';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import type { ReceivablePurchaseOrder, ReceivablePurchaseOrdersResponse } from './types';

/**
 * Stages an order can be in before anyone has recorded that it shipped.
 *
 * A count may still be opened against one — goods arriving before a dispatch was ever recorded is
 * ordinary, and the honest record is the arrival — but it is the one case the screen pauses on,
 * because opening it moves an order that nobody has said is on its way.
 */
const PRE_TRANSIT = ['submitted', 'acknowledged'];

/** The stage names an operator reads, in their own vocabulary rather than the lifecycle's. */
const stageLabel = (stage: string): string => {
  switch (stage) {
    case 'submitted':
      return __('Sent to the supplier');
    case 'acknowledged':
      return __('Acknowledged');
    case 'in_transit':
      return __('On its way');
    case 'in_reception':
      return __('Being counted');
    case 'partially_received':
      return __('Partly received');
    default:
      return stage;
  }
};

const orderLabel = (order: ReceivablePurchaseOrder): string => {
  const name =
    order.number ??
    sprintf(
      /* translators: %d is an internal purchase-order id. */ __('Draft order #%d'),
      order.id,
    );
  const parts = [name];
  if (null !== order.supplier) parts.push(order.supplier);
  parts.push(stageLabel(order.stage));
  if (order.sessionOpen && order.counters > 0) {
    parts.push(
      sprintf(
        /* translators: %d is how many people are counting this delivery right now. */
        _n('%d counting', '%d counting', order.counters),
        order.counters,
      ),
    );
  }
  return parts.join(' · ');
};

/**
 * Choosing which order a delivery answers, and opening the count against it.
 *
 * **The list never reshuffles.** Every open order is in it, whatever its stage, because a dropdown
 * whose contents change under a checkbox teaches an operator that the order they are holding may or
 * may not exist depending on a setting. What changes instead is the *button*, which says what will
 * happen before it happens:
 *
 * - already being counted → *Join the count*, with how many people are on it
 * - on its way, or partly received → *Start counting*
 * - not yet marked as shipped → *Start counting*, disabled until the line beneath it is ticked
 *
 * That last one is the whole reason there is a checkbox at all. Its label is its accessible name, so
 * the label is the action and the fact sits beside it — and there is no confirmation modal on top,
 * because the label already says what will happen. Stacking checkbox, modal and button teaches people
 * to click through all three.
 */
export function PoPicker(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [unlocked, setUnlocked] = createSignal(false);

  const query = createQuery(() => ({
    queryKey: ['receiving', 'receivable-purchase-orders'],
    queryFn: () => api.get<ReceivablePurchaseOrdersResponse>('/receiving/purchase-orders'),
  }));

  const orders = (): ReceivablePurchaseOrder[] => query.data?.purchaseOrders ?? [];
  const selected = createMemo((): ReceivablePurchaseOrder | null => {
    const id = selectedId();
    return null === id ? null : (orders().find((o) => o.id === id) ?? null);
  });

  /** Whether the chosen order has not been marked as shipped — the one case that needs unlocking. */
  const needsUnlock = createMemo((): boolean => {
    const order = selected();
    return null !== order && !order.sessionOpen && PRE_TRANSIT.includes(order.stage);
  });

  const actionLabel = (): string =>
    (selected()?.sessionOpen ?? false) ? __('Join the count') : __('Start counting');

  const blocked = (): boolean => null === selected() || (needsUnlock() && !unlocked());

  // Straight to the count: the reception itself opens with the first counted line, so choosing an
  // order here changes nothing. A ticked unlock travels along, so the count does not ask again.
  const open = (order: ReceivablePurchaseOrder): void =>
    navigate(`/receiving/new/purchase-order/${order.id}${needsUnlock() ? '?unlocked=1' : ''}`);

  return (
    <div class="max-w-2xl">
      <header class="mb-5">
        {/* The last crumb has no order in it yet — choosing one is what this screen is for. */}
        <ReceivingCrumbs
          trail={[
            { label: __('Start a reception'), href: '/receiving/new' },
            { label: __('A purchase order') },
          ]}
        />

        <p class="mt-1 text-sm text-text-muted">{__('Which order does this delivery answer?')}</p>
      </header>

      <Show when={query.isError}>
        <ErrorBanner class="mb-4 text-sm">
          {__('Could not load the open purchase orders.')}
        </ErrorBanner>
      </Show>

      <Show
        when={orders().length > 0}
        fallback={
          <Show
            when={!query.isPending}
            fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}
          >
            <p class="text-sm text-text-muted">
              {__('No purchase order is waiting for a delivery right now.')}
            </p>
          </Show>
        }
      >
        <label class="block text-sm">
          <span class="mb-1 block font-medium">{__('Purchase order')}</span>
          <Select
            class="w-full"
            value={selectedId() ?? ''}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              setSelectedId('' === raw ? null : Number(raw));
              // A fresh choice is a fresh decision: the unlock does not carry over to another order.
              setUnlocked(false);
            }}
          >
            <option value="">{__('Choose an order…')}</option>
            <For each={orders()}>
              {(order) => <option value={order.id}>{orderLabel(order)}</option>}
            </For>
          </Select>
        </label>

        <Show when={needsUnlock()}>
          <div class="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
            <p class="mb-1 text-sm text-amber-800">
              {__("This purchase order isn't marked as shipped yet.")}
            </p>
            <label class="flex items-center gap-2 text-sm text-amber-900">
              <Checkbox
                checked={unlocked()}
                onChange={(e) => setUnlocked(e.currentTarget.checked)}
              />
              {__('Enable receiving anyway')}
            </label>
          </div>
        </Show>

        <div class="mt-4">
          <Button
            disabled={blocked()}
            onClick={() => {
              const order = selected();
              if (null !== order) open(order);
            }}
          >
            {actionLabel()}
          </Button>
        </div>
      </Show>
    </div>
  );
}
