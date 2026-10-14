import { __, _n, sprintf } from '@invflux/i18n';
import { Checkbox, ConfirmModal, ErrorBanner, mintReceiptKey, toast } from '@invflux/ui';
import { ApiError } from '@invflux/ui/api';
import {
  PoReceiveForm,
  type ReceiveRow,
} from '@invflux/procurement/src/sections/purchase-orders/PoReceiveForm';
import { ShortfallFields } from '@invflux/procurement/src/sections/purchase-orders/ShortfallFields';
import {
  createShortfallState,
  partsPresent,
  projectedSplit,
  type ShortfallLine,
  type ShortfallSplit,
  type ShortfallVocabulary,
} from '@invflux/procurement/src/sections/purchase-orders/shortfall';
import type { PoLine } from '@invflux/procurement/src/sections/purchase-orders/types';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { surfaceEnabled } from '../../surfaces';
import { type Crumb, ReceivingCrumbs } from './ReceivingCrumbs';
import type { PoReceptionResponse, PoReceptionLine } from './types';

/** How often a worker says they are still here. Well inside the server's presence window. */
const HEARTBEAT_MS = 45_000;

/**
 * The receiving projection of a line, widened into the shape the shared grid reads.
 *
 * The money fields are null and stay null: this surface is never told what the goods cost, and
 * filling them with zeroes would be a figure rather than an absence. The grid renders no cost
 * column, so nothing displays them — they exist only because the grid's row type is the purchase
 * order's own, and narrowing that type is a change to the buyer's screen, not this one.
 */
const asGridLine = (line: PoReceptionLine): PoLine => ({
  subjectId: line.subjectId,
  postId: line.postId,
  productLabel: line.name,
  sku: line.sku,
  supplierSku: line.supplierSku,
  gtin: line.gtin,
  imageUrl: line.imageUrl,
  exists: line.exists,
  qtyRequested: line.qtyRequested,
  qtyExpected: line.qtyExpected,
  qtyReceived: line.qtyReceived,
  qtyDamagedSoFar: line.qtyDamagedSoFar,
  qtyClosedShort: line.qtyClosedShort,
  qtyOpen: line.qtyOpen,
  // Every money field is null on purpose, not for want of data: this screen shows no prices (see
  // the note on the component below), so the response it reads carries none to put here.
  unitCost: null,
  listUnitCost: null,
  discountPct: null,
  unitCostInvoiced: null,
  qtyInvoiced: 0,
  catalogUnitCost: null,
  lineTotal: null,
  available: null,
  onOrder: null,
  lowStockAmount: null,
  note: null,
  suggestedQty: null,
});

/**
 * Counting one delivery against one purchase order.
 *
 * **The count lives here, not on the order's page.** Everything this screen does goes through
 * `/receiving/purchase-orders/{id}/…` under the inventory capability, so the person doing it needs no
 * access to purchasing at all — and sees none of it: no prices, no totals, no approval state. The
 * order's own page keeps a link in, because a buyer watching a delivery land wants the same screen.
 *
 * **Nothing moves until Confirm.** Quantities are staged client-side and autosaved as work in
 * progress, so a reload, a flat battery or a shift change loses nothing; the session is a draft that
 * is expected to be discarded, and abandoning a count deliberately leaves no trace. Only the confirm
 * posts a receipt, and it carries an idempotency key so answering a timeout by pressing again replays
 * rather than receiving the delivery twice.
 */
export function PoReception(props: { poId: number }): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // An order not yet marked as shipped asks to be unlocked before it is counted. The picker asks the
  // same question, and a tick given there arrives as `?unlocked=1` rather than being asked twice.
  const [params] = useSearchParams<{ unlocked?: string }>();
  const [unlocked, setUnlocked] = createSignal('1' === params.unlocked);

  const [shortModal, setShortModal] = createSignal(false);
  // Why each part of what is closed out did not come — the close-short prompt's state.
  const shortfall = createShortfallState();
  // A receipt staged behind the reason modal: committed only once the reason is confirmed, so
  // nothing is irreversible on the click that opens it.
  const [pendingReceipt, setPendingReceipt] = createSignal<{
    rows: ReceiveRow[];
    note: string;
    fxRate: string | null;
  } | null>(null);
  // One key per confirm intent, held across retries of the same click and dropped once it lands, so
  // a genuine second delivery is never mistaken for a replay of the first.
  const [receiptKey, setReceiptKey] = createSignal<string | null>(null);
  const currentReceiptKey = (): string => {
    const held = receiptKey();
    if (null !== held) return held;
    const minted = mintReceiptKey();
    setReceiptKey(minted);
    return minted;
  };

  const key = (): (string | number)[] => ['receiving', 'purchase-order', props.poId];
  const query = createQuery(() => ({
    queryKey: key(),
    queryFn: () => api.get<PoReceptionResponse>(`/receiving/purchase-orders/${props.poId}`),
  }));

  // The close-short prompt's vocabulary (causes per part, each one's default party under this
  // order's Incoterm). Asked for when the prompt opens.
  const shortfallVocab = createQuery(() => ({
    queryKey: ['receiving', 'purchase-order', props.poId, 'shortfall'],
    queryFn: () =>
      api.get<ShortfallVocabulary>(`/receiving/purchase-orders/${props.poId}/shortfall`),
    enabled: shortModal(),
  }));
  const shortfallLines = (): ShortfallLine[] =>
    (query.data?.lines ?? []).map((l) => ({
      subjectId: l.subjectId,
      qtyRequested: l.qtyRequested,
      qtyExpected: l.qtyExpected,
      qtyDamagedSoFar: l.qtyDamagedSoFar,
      qtyOpen: l.qtyOpen,
    }));
  // What the remainder will split into once the staged count is posted.
  const pendingSplit = (): ShortfallSplit =>
    projectedSplit(shortfallLines(), pendingReceipt()?.rows ?? []);
  // Everything the supplier confirmed is in by the saved count, and what is left was never
  // confirmed: the order is done in all but the buyer's say-so, which is the close-short.
  const onlyUnconfirmedLeft = (): number => {
    const saved = (query.data?.lines ?? [])
      .filter((l) => null !== l.staged)
      .map((l) => ({
        subjectId: l.subjectId,
        received: l.staged?.received ?? 0,
        damaged: l.staged?.damaged ?? 0,
      }));
    const parts = partsPresent(projectedSplit(shortfallLines(), saved));
    return (parts.undelivered ?? 0) + (parts.damaged ?? 0) > 0 ? 0 : (parts.unconfirmed ?? 0);
  };

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: key() });
    // The landing lists show this count and, once it commits, the receipt it became.
    void queryClient.invalidateQueries({ queryKey: ['receiving', 'sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['receiving', 'receipts'] });
    // The order's own page is where the operator goes next, and it renders exactly what this
    // changes: the stage pill, and whether a count is open against the order. Both surfaces live in
    // one SPA, so returning to the order is a route change rather than a page load — without this
    // it keeps answering from the cache, showing "Receiving" and offering to start counting an
    // order that has just been received.
    void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
  };

  const po = () => query.data?.purchaseOrder;
  const lines = (): PoLine[] => (query.data?.lines ?? []).map(asGridLine);
  const participants = () => query.data?.participants ?? [];
  const orderLabel = (): string =>
    po()?.number ??
    sprintf(
      /* translators: %d is an internal purchase-order id. */ __('Draft order #%d'),
      props.poId,
    );

  /**
   * Whether the order and its supplier are reachable from here — the capability that mounts the
   * Procurement surface, and the install's own choice to have it at all. A dock worker holding only
   * the inventory capability sees the same two names, as plain words: they are what is being
   * counted, and naming them costs nothing that the count does not already reveal.
   */
  const procurementReachable = (): boolean =>
    hasCapability('managePurchaseOrders') && surfaceEnabled('procurement');

  const trail = (order: PoReceptionResponse['purchaseOrder']): Crumb[] => {
    const crumbs: Crumb[] = [
      {
        label: orderLabel(),
        href: procurementReachable() ? `/procurement/purchase-orders/${props.poId}` : undefined,
      },
    ];
    const supplier = order.supplier;
    if (null !== supplier) {
      crumbs.push({
        label: supplier.name,
        href: procurementReachable() ? `/procurement/suppliers/${supplier.id}/pos` : undefined,
      });
    }

    return crumbs;
  };

  // Autosave the running count. Fire-and-forget: a transient failure just means the next keystroke
  // tries again, and the figures on screen are the ones being counted either way.
  const persist = createMutation(() => ({
    mutationFn: (p: { rows: ReceiveRow[]; note: string }) =>
      api.put(`/receiving/purchase-orders/${props.poId}/session`, { lines: p.rows, note: p.note }),
    // The first counted line is what opens the reception, so until the order reads as receiving
    // each save may be the one that opened it — re-read, and presence starts once it has.
    onSuccess: () => {
      if (!po()?.receiving) invalidate();
    },
  }));

  const receive = createMutation(() => ({
    mutationFn: (p: {
      rows: ReceiveRow[];
      note: string;
      fxRate: string | null;
      remainder: 'settle' | 'close_short';
      /** What the operator said they were doing — the wire call is the same, the sentence is not. */
      intent: 'complete' | 'partial' | 'short';
    }) =>
      api.post(`/receiving/purchase-orders/${props.poId}/receipts`, {
        lines: p.rows,
        note: p.note,
        fxRate: p.fxRate,
        remainder: p.remainder,
        ...('close_short' === p.remainder ? { shortfall: shortfall.body(pendingSplit()) } : {}),
        idempotencyKey: currentReceiptKey(),
      }),
    onSuccess: (_data: unknown, variables) => {
      invalidate();
      setReceiptKey(null); // landed — the next receipt is a new intent
      setPendingReceipt(null);
      setShortModal(false);
      shortfall.reset();
      toast.success(
        'short' === variables.intent
          ? __('Received, and the order is closed on what arrived.')
          : 'partial' === variables.intent
            ? __('Delivery received — the order stays open for the rest.')
            : __('Delivery received.'),
      );
      navigate('/receiving');
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error ? e.message : __('Could not record the delivery. Nothing was received.'),
      ),
  }));

  // Leave a count that turned out to be nothing: the staged figures are discarded, no receipt is
  // logged, no stock moves, and the order goes back to waiting. A count nobody received anything
  // against is deliberately not an event in the order's history.
  const abandon = createMutation(() => ({
    // A count with nothing counted yet never opened a reception — the first counted line is what
    // does — so there is nothing on the server to cancel, and leaving is all canceling means.
    mutationFn: async (): Promise<void> => {
      if (!po()?.receiving) return;
      await api.del(`/receiving/purchase-orders/${props.poId}/session`);
    },
    onSuccess: () => {
      invalidate();
      toast.success(__('Count cancelled — nothing was received.'));
      navigate('/receiving');
    },
    onError: (e: unknown) => {
      // 409 means the reception is already gone — never opened, or ended by a colleague meanwhile.
      // The count is canceled either way, which is what was asked for.
      if (e instanceof ApiError && 409 === e.status) {
        invalidate();
        navigate('/receiving');
        return;
      }
      toast.error(e instanceof Error ? e.message : __('Could not cancel the count.'));
    },
  }));

  // Nothing arrived this time, and nothing more will: finish the order on what earlier deliveries
  // brought. There is no receipt to log — nothing is being received — so this is the write-off alone,
  // on the route that takes it without one.
  const closeShortOnly = createMutation(() => ({
    mutationFn: (note: string) =>
      api.post(`/receiving/purchase-orders/${props.poId}/close-short`, {
        shortfall: shortfall.body(pendingSplit()),
        note: '' === note.trim() ? null : note.trim(),
      }),
    onSuccess: () => {
      invalidate();
      setShortModal(false);
      setPendingReceipt(null);
      shortfall.reset();
      toast.success(__('The order is closed on what arrived.'));
      navigate('/receiving');
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not close the order short.')),
  }));

  // "Still here." Presence only, so arriving on the beat a colleague is mid-save cannot roll their
  // figures back. Stops when the component unmounts, which is what a worker leaving looks like.
  createEffect(() => {
    // Only once a count exists: before the first counted line there is nothing to be present in.
    if (!query.isSuccess || !po()?.receiving) return;
    const beat = setInterval(() => {
      void api
        .post(`/receiving/purchase-orders/${props.poId}/session/heartbeat`, {})
        .catch(() => undefined); // a missed beat is not worth telling anyone about
    }, HEARTBEAT_MS);
    onCleanup(() => clearInterval(beat));
  });

  return (
    <div>
      <Show when={query.isError}>
        <ErrorBanner class="text-sm">
          {__('Could not load this order. It may have been cancelled or already received.')}
        </ErrorBanner>
      </Show>

      <Show when={po()} fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}>
        {(order) => (
          <>
            <header class="mb-4">
              <ReceivingCrumbs trail={trail(order())} />
            </header>

            <Show when={participants().length > 1}>
              <div class="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {sprintf(
                  _n(
                    '%d person is counting this delivery — the figures refresh as they work.',
                    '%d people are counting this delivery — the figures refresh as they work.',
                    participants().length,
                  ),
                  participants().length,
                )}
              </div>
            </Show>

            {/* The count shows for any order that can take a delivery; the reception itself opens
                with the first counted line. An order not yet marked as shipped asks to be unlocked
                first, the same question the picker asks. */}
            <Show
              when={
                order().receiving ||
                (order().receivable && (!order().awaitingDispatch || unlocked()))
              }
              fallback={
                <Show
                  when={order().receivable}
                  fallback={
                    // Nothing left to count against — the order was finished or canceled, possibly
                    // while this screen was open. Said plainly rather than shown as a form that would
                    // be refused.
                    <p class="rounded border border-border bg-surface p-4 text-sm text-text-muted">
                      {__('This order is no longer being received.')}
                    </p>
                  }
                >
                  <div class="rounded border border-amber-200 bg-amber-50 px-3 py-2">
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
              }
            >
              <Show when={onlyUnconfirmedLeft() > 0 && hasCapability('grCloseShort')}>
                <p
                  class="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
                  data-testid="reception-only-unconfirmed"
                >
                  {sprintf(
                    /* translators: %d is a number of units the supplier never confirmed. */
                    _n(
                      'Everything the supplier confirmed has arrived; %d unit was never confirmed. "Close short" finishes the order and records it as not confirmed.',
                      'Everything the supplier confirmed has arrived; %d units were never confirmed. "Close short" finishes the order and records them as not confirmed.',
                      onlyUnconfirmedLeft(),
                    ),
                    onlyUnconfirmedLeft(),
                  )}
                </p>
              </Show>
              <PoReceiveForm
                poId={props.poId}
                lines={lines()}
                // An order in another currency is received at an exchange rate, which this count
                // asks for, offering the last one recorded for that currency. A rate is not a
                // price: what the goods cost stays off this surface. Without it the delivery would
                // be valued as if its prices were in the store's currency, so the server refuses.
                currency={query.data?.purchaseOrder.currency ?? ''}
                baseCurrency={query.data?.purchaseOrder.baseCurrency ?? ''}
                initialFxRate={query.data?.purchaseOrder.suggestedFxRate ?? null}
                hasPro={app.hasPro}
                pending={receive.isPending || abandon.isPending || closeShortOnly.isPending}
                initial={(query.data?.lines ?? [])
                  .filter((l) => null !== l.staged)
                  .map((l) => ({
                    subjectId: l.subjectId,
                    received: l.staged?.received ?? 0,
                    damaged: l.staged?.damaged ?? 0,
                  }))}
                initialNote={query.data?.note ?? ''}
                canLax={hasCapability('grCloseShortLax')}
                canCloseShort={hasCapability('grCloseShort')}
                onPersist={(rows, note) => persist.mutate({ rows, note })}
                // Both settle: the resulting status is *derived* from what is still open, never
                // dictated from here. A count that believed it was complete and a database that
                // disagrees cannot produce an order marked received with stock still owed.
                onConfirm={(rows, note, fxRate) =>
                  receive.mutate({ rows, note, fxRate, remainder: 'settle', intent: 'complete' })
                }
                onKeepOpen={(rows, note, fxRate) =>
                  receive.mutate({ rows, note, fxRate, remainder: 'settle', intent: 'partial' })
                }
                onCancel={() => abandon.mutate()}
                onCloseShort={(rows, note, fxRate) => {
                  // Stage it and ask why — the write-off is recorded with a reason, never inferred.
                  setPendingReceipt({ rows, note, fxRate });
                  setShortModal(true);
                }}
              />
            </Show>
          </>
        )}
      </Show>

      <Show when={shortModal()}>
        <ConfirmModal
          title={__('Finish on what arrived?')}
          message={
            <div>
              <p class="mb-3 text-sm">
                {__(
                  'The units still outstanding will be cancelled and the order finished. Say why, part by part, so the record shows it.',
                )}
              </p>
              <Show
                when={shortfallVocab.data}
                fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}
              >
                {(vocab) => (
                  <ShortfallFields
                    vocab={vocab()}
                    split={pendingSplit()}
                    state={shortfall}
                    lineLabel={(id) =>
                      (query.data?.lines ?? []).find((l) => l.subjectId === id)?.name ?? `#${id}`
                    }
                  />
                )}
              </Show>
            </div>
          }
          confirmLabel={__('Finish the order')}
          variant="warning"
          onConfirm={() => {
            const staged = pendingReceipt();
            if (null === staged) return setShortModal(false);
            // The prompt stays open until every part says why: the record is the point.
            if (!shortfall.attempt(pendingSplit())) return;
            const note = shortfall.state.note.trim();
            // A count of zeroes receives nothing: the write-off is the whole of it.
            if (0 === staged.rows.length) return closeShortOnly.mutate(note || staged.note);
            receive.mutate({
              ...staged,
              note: note || staged.note,
              remainder: 'close_short',
              intent: 'short',
            });
          }}
          onCancel={() => {
            setShortModal(false);
            setPendingReceipt(null);
            shortfall.reset();
          }}
        />
      </Show>
    </div>
  );
}
