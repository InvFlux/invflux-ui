import { For, Show, createEffect, createMemo, createSignal, on, untrack } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  Button,
  IconButton,
  Modal,
  StockConcernBits,
  ModalFooter,
  ModalHeader,
  ModalPanel,
} from '@invflux/ui';
import {
  defaultReasonFor,
  deriveType,
  isShort,
  outOfStockCap,
  partiesFor,
  reasonApplies,
  reasonsFor,
  stockFatesFor,
  stockFor,
  stockReadout,
  type LineStock,
  type ResponsibleParty,
  type StockFate,
  type Timing,
} from '../correctionChoice';
import { netUnitPrice, refundFor } from '../lineRefund';
import { useCreateCorrectionMutation } from '../queries';
import type { CorrectionReason, CorrectionType, DispatchOrderLine } from '../types';
import { SegmentedChoice } from './SegmentedChoice';

/**
 * Per-line correction modal — the D1+D2 entry point. Three launch
 * routes converge here:
 *
 * - per-line `!` icon (preset `lineId`, qty defaults to `qty_outstanding`),
 * - global `C` keyboard shortcut (no preset; operator picks the line),
 * - "+ Add correction" button on the corrections panel (no preset).
 *
 * **It asks what the operator knows, not which type applies.** Four answers, in the order they are
 * known: which side of shipment (asked only once something has shipped), whose fault, why, and where
 * the stock goes. The correction type follows from them ({@see deriveType}) — the type still decides
 * what the engine does, and the reason still records whose fault it was, but an operator asked to
 * pick "cancelled by merchant" had to translate their answer into it. Each answer narrows the next:
 * the carrier is responsible only after shipment, the reasons are the party's and the side's, and
 * goods are never written off on the customer's account. Before shipment the reason also answers
 * the last question, so the stock control shows that answer rather than asking; and a reason that
 * cannot apply to the line — "out of stock" on a product that is not short, a write-off while stock
 * is for sale — is shown but not offered.
 *
 * Which after-shipment corrections exist is the server's to say, through the creatable `types` it
 * sends — this component never asks which install it runs on.
 *
 * **Type-flag cascade.** The pills render from the derived type's `preDispatch / restock / refund`
 * flags rather than branching on `code`.
 *
 * **Refund preview.** When the type carries `refund=true`, the modal shows
 * what the correction will owe — the price paid for those units, less any
 * discount — read-only. The server derives that figure itself when the
 * correction is created (the request carries no amount); this is the same
 * arithmetic, shown before submitting.
 */
export function CorrectionModal(props: {
  orderHexId: string;
  lines: DispatchOrderLine[];
  types: CorrectionType[];
  reasons: CorrectionReason[];
  /** Pre-target one line on mount. Pass `null` to let the user pick. */
  presetLineId: string | null;
  onClose: () => void;
}) {
  const createMutation = useCreateCorrectionMutation(() => props.orderHexId);

  function shippable(line: DispatchOrderLine): number {
    return Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
  }

  /** What can be corrected on this line on the given side of shipment. */
  function correctable(line: DispatchOrderLine, side: Timing): number {
    return side === 'pre' ? shippable(line) : line.qtyShipped;
  }

  const lineStock = (line: DispatchOrderLine | undefined): LineStock => ({
    deficit: line !== undefined && (line.stockState & StockConcernBits.STOCK_DEFICIT) !== 0,
    shortfall: line?.shortfallQty ?? undefined,
    writeOffAllowed: line?.writeOffAllowed ?? undefined,
  });

  // Timing is asked only once something has shipped: before then there is one side to be on.
  const anyShipped = createMemo(() => props.lines.some((l) => l.qtyShipped > 0));
  const canCorrectBefore = createMemo(() => props.lines.some((l) => shippable(l) > 0));
  const canCorrectAfter = createMemo(() => props.types.some((t) => !t.preDispatch));

  // The opening side, read once: after that the operator owns the answer.
  const [timing, setTiming] = createSignal<Timing>(
    untrack(() => (canCorrectBefore() || !canCorrectAfter() ? 'pre' : 'post')),
  );

  // Initial line: the preset if it has something correctable, else the first line that does, else
  // the first line at all. The server rejects qty=0 anyway, but the UI shouldn't lead with a dead
  // selection if a better one is available.
  function initialLineId(): string {
    const preset = props.lines.find((l) => l.id === props.presetLineId);
    if (preset && correctable(preset, timing()) > 0) return preset.id;
    const first = props.lines.find((l) => correctable(l, timing()) > 0);
    return first?.id ?? props.lines[0]?.id ?? '';
  }

  const [lineId, setLineId] = createSignal(initialLineId());
  const selectedLine = createMemo(() => props.lines.find((l) => l.id === lineId()));

  // A line short of stock is almost always corrected because the units are not there: the
  // merchant's side and reason "out of stock" — a cancellation, since those units were never covered.
  const openingStock = untrack(() => lineStock(selectedLine()));
  const [party, setParty] = createSignal<ResponsibleParty>(
    isShort(openingStock) ? 'merchant' : 'customer',
  );
  const [reasonCode, setReasonCode] = createSignal(
    untrack(() => defaultReasonFor(props.reasons, timing(), party(), openingStock)),
  );
  // After shipment the operator says where the stock goes; before it, the reason does.
  const [chosenStock, setChosenStock] = createSignal<StockFate>(
    untrack(() => stockFor(props.reasons, reasonCode(), party())),
  );
  const stock = createMemo<StockFate>(() =>
    timing() === 'pre' ? stockFor(props.reasons, reasonCode(), party()) : chosenStock(),
  );

  const offeredReasons = createMemo(() => reasonsFor(props.reasons, timing(), party()));
  const selectedType = createMemo(() =>
    deriveType(props.types, {
      timing: timing(),
      party: party(),
      stock: stock(),
      reasonCode: reasonCode(),
    }),
  );

  /** A new party or side of shipment makes the reason — and where its stock goes — a new question. */
  function resetReason(): void {
    const code = defaultReasonFor(props.reasons, timing(), party(), lineStock(selectedLine()));
    setReasonCode(code);
    setChosenStock(stockFor(props.reasons, code, party()));
  }

  function chooseTiming(next: Timing): void {
    setTiming(next);
    if (!partiesFor(next).includes(party())) setParty('merchant');
    const line = selectedLine();
    if (!line || correctable(line, next) === 0) {
      setLineId(props.lines.find((l) => correctable(l, next) > 0)?.id ?? lineId());
    }
    resetReason();
  }

  function chooseParty(next: ResponsibleParty): void {
    setParty(next);
    resetReason();
  }

  function chooseReason(code: string): void {
    setReasonCode(code);
    setChosenStock(stockFor(props.reasons, code, party()));
  }

  const appliesToLine = (reason: CorrectionReason): boolean =>
    reasonApplies(reason, timing(), lineStock(selectedLine()));

  // Another line can rule the chosen reason out — "out of stock" on a product that is not short.
  createEffect(
    on(
      lineId,
      () => {
        const chosen = props.reasons.find((r) => r.code === reasonCode());
        if (chosen !== undefined && !appliesToLine(chosen)) resetReason();
      },
      { defer: true },
    ),
  );

  /** Units for sale or reserved, when they rule out writing the line's units off. */
  const substitutes = createMemo(() => {
    const line = selectedLine();
    if (timing() !== 'pre' || party() !== 'merchant' || line?.writeOffAllowed?.defective !== false)
      return null;
    return (line.stockAtpQty ?? 0) + (line.stockResQty ?? 0);
  });

  /** Units the shelf should still hold for other orders, when they alone rule out "missing at pick". */
  const shelfForOthers = createMemo(() => {
    const line = selectedLine();
    if (timing() !== 'pre' || party() !== 'merchant' || substitutes() !== null) return null;
    return line?.writeOffAllowed?.short_pick === false ? (line.shelfForOthersQty ?? 0) : null;
  });

  const partyLabel: Record<ResponsibleParty, () => string> = {
    customer: () => _x('Customer', 'correction cause'),
    merchant: () => _x('Merchant', 'correction cause'),
    logistics: () => _x('Carrier', 'correction cause'),
  };

  const isOutOfStock = (): boolean => timing() === 'pre' && reasonCode() === 'out_of_stock';

  // "Out of stock" cancels at most the product's shortfall — beyond it the units exist.
  const maxQty = createMemo(() => {
    const line = selectedLine();
    if (!line) return 0;
    const correctableQty = correctable(line, timing());
    return isOutOfStock() ? outOfStockCap(line, correctableQty) : correctableQty;
  });

  const [qty, setQty] = createSignal(untrack(maxQty));
  const [note, setNote] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  // Reset qty when the line, the side or the out-of-stock cap changes, so we land on what can be
  // corrected now instead of carrying the prior value. Deferred: the opening value is already right.
  createEffect(on([lineId, timing, isOutOfStock], () => setQty(untrack(maxQty)), { defer: true }));

  /** Before shipment the reason decides where the stock goes, so the modal states it rather than asks. */
  const stockReadoutText = createMemo((): string => {
    const line = selectedLine();
    if (!line) return '';
    const readout = stockReadout(line, stock(), reasonCode(), qty());
    if (readout.kind === 'writtenOff') {
      /* translators: %d: units written off. */
      return sprintf(__('Written off: %d'), readout.qty);
    }
    if (readout.kind === 'backOnSale') {
      return readout.shelved === readout.qty
        ? /* translators: %d: units put back on sale. */ sprintf(
            __('Back on sale: %d'),
            readout.qty,
          )
        : sprintf(
            /* translators: 1: units put back on sale; 2: units cancelled. */
            __('Back on sale: %1$d of %2$d — other orders are waiting for the rest'),
            readout.shelved,
            readout.qty,
          );
    }
    return readout.neverInStock
      ? __('Nothing goes back on sale: these units were never in stock')
      : __('Nothing goes back on sale: other orders are waiting for this product');
  });

  /** What the correction will owe — the server's own figure, computed the same way. */
  const refundAmount = createMemo(() => {
    const line = selectedLine();
    return line ? refundFor(line, qty()) : '0.00';
  });

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const line = selectedLine();
    if (!line) {
      setError(__('Please pick a line.'));
      return;
    }
    const max = maxQty();
    if (qty() < 1 || qty() > max) {
      setError(sprintf(__('Qty must be between 1 and %d.'), max));
      return;
    }
    const type = selectedType();
    if (!type) {
      setError(__('None of the corrections available here fits these answers.'));
      return;
    }
    if (type.refund && reasonCode() === '') {
      setError(__('Choose a reason for this correction.'));
      return;
    }
    try {
      // mutateAsync (rather than mutate + per-call onSuccess) gives a
      // direct success/failure await so we always close on success and
      // never hang in the "Adding…" disabled state. The mutation's own
      // onSuccess still runs (cache patching), and is finished before
      // this await resolves.
      await createMutation.mutateAsync({
        lineId: line.id,
        typeCode: type.code,
        qty: qty(),
        note: note().trim() === '' ? null : note(),
        reasonCode: reasonCode() === '' ? null : reasonCode(),
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : __('Unknown error'));
    }
  }

  return (
    <Modal onClose={props.onClose} label={__('Create correction')}>
      <ModalPanel size="2xl">
        {/* `submit` catches its own rejections (it sets `error` and returns), so discarding the
            promise here loses nothing — the `void` is what says so to the reader and the linter. */}
        <form onSubmit={(e) => void submit(e)}>
          <ModalHeader
            title={__('Create correction')}
            actions={
              <IconButton size="sm" label={__('Close')} onClick={props.onClose}>
                ×
              </IconButton>
            }
          />

          <div class="px-4 py-4 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <label class="md:col-span-10 block text-xs">
                <span class="block text-gray-600 mb-1">{_x('Line', 'correction form field')}</span>
                <select
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-surface"
                  value={lineId()}
                  onChange={(e) => setLineId(e.currentTarget.value)}
                >
                  <For each={props.lines}>
                    {(line) => (
                      <option value={line.id} disabled={correctable(line, timing()) === 0}>
                        {line.name} ({line.sku || '—'}) · {correctable(line, timing())} avail
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <label class="md:col-span-2 block text-xs">
                <span class="block text-gray-600 mb-1">{_x('Qty', 'correction form field')}</span>
                <input
                  type="number"
                  min="1"
                  max={maxQty()}
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-surface tabular-nums"
                  value={qty()}
                  onInput={(e) => setQty(Number(e.currentTarget.value) || 0)}
                />
              </label>
            </div>

            <div class="flex flex-wrap items-end gap-3">
              <Show when={anyShipped()}>
                <SegmentedChoice
                  name="timing"
                  label={_x('Timing', 'correction form field: before or after shipment')}
                  value={timing()}
                  onChange={chooseTiming}
                  options={[
                    { value: 'pre', label: __('Before shipment'), disabled: !canCorrectBefore() },
                    { value: 'post', label: __('After shipment'), disabled: !canCorrectAfter() },
                  ]}
                />
              </Show>

              <SegmentedChoice
                name="party"
                label={__('Responsible party')}
                value={party()}
                onChange={chooseParty}
                options={partiesFor(timing()).map((p) => ({ value: p, label: partyLabel[p]() }))}
              />

              <label class="block min-w-48 flex-1 text-xs">
                <span class="block text-gray-600 mb-1">
                  {_x('Reason', 'correction form field')}
                </span>
                <select
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-surface"
                  value={reasonCode()}
                  onChange={(e) => chooseReason(e.currentTarget.value)}
                  data-correction-reason
                >
                  <option value="" disabled={selectedType()?.refund === true}>
                    {__('Choose a reason…')}
                  </option>
                  <For each={offeredReasons()}>
                    {(reason) => (
                      <option value={reason.code} disabled={!appliesToLine(reason)}>
                        {reason.name}
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <Show
                when={timing() === 'post'}
                fallback={
                  <div class="block text-xs" data-correction-stock-readout>
                    <span class="block text-gray-600 mb-1">
                      {_x('Stock', 'correction form field')}
                    </span>
                    <span class="block py-1 text-sm text-text">{stockReadoutText()}</span>
                  </div>
                }
              >
                <SegmentedChoice
                  name="stock"
                  label={_x('Stock', 'correction form field')}
                  value={stock()}
                  onChange={(next) => setChosenStock(next)}
                  options={[
                    { value: 'shelf', label: __('Back on shelf') },
                    {
                      value: 'writeOff',
                      label: __('Write off'),
                      disabled: !stockFatesFor(party()).includes('writeOff'),
                      title:
                        party() === 'customer'
                          ? __(
                              'A write-off means the goods failed or are missing — the merchant’s side, not the customer’s.',
                            )
                          : undefined,
                    },
                  ]}
                />
              </Show>
            </div>

            <Show when={substitutes() !== null || shelfForOthers() !== null}>
              <div class="space-y-1 text-xs text-text-muted" data-correction-stock-note>
                <Show when={substitutes()}>
                  {(count) => (
                    <p>
                      {sprintf(
                        _n(
                          '%d unit of this product is still for sale or reserved, so defective or missing units are not written off here: ship from that stock, and record the bad units as an on-hand stock correction.',
                          '%d units of this product are still for sale or reserved, so defective or missing units are not written off here: ship from that stock, and record the bad units as an on-hand stock correction.',
                          count(),
                        ),
                        count(),
                      )}
                    </p>
                  )}
                </Show>
                <Show when={shelfForOthers()}>
                  {(count) => (
                    <p>
                      {sprintf(
                        _n(
                          'The shelf should still hold %d unit of this product for other orders, so units missing here are not written off on this order alone: if that one is missing too, record an on-hand stock correction.',
                          'The shelf should still hold %d units of this product for other orders, so units missing here are not written off on this order alone: if those are missing too, record an on-hand stock correction.',
                          count(),
                        ),
                        count(),
                      )}
                    </p>
                  )}
                </Show>
              </div>
            </Show>

            {/*
              D2 cascade. Each pill renders only when the derived type's
              flag says so — a new type gets the right UI without code change.
            */}
            <div class="flex flex-wrap gap-2 text-xs">
              <Show when={selectedType()?.preDispatch}>
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                  title={__(
                    'Stock returns from the quantity held for this order rather than from a saleable slot.',
                  )}
                >
                  {_x(
                    'Pre-shipment',
                    'correction badge: the stock comes back from what was held for this order',
                  )}
                </span>
              </Show>
              <Show when={selectedType()?.restock}>
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                  title={__('Stock returns to a saleable slot.')}
                >
                  {_x('Restock', 'correction badge (noun): the stock goes back to a saleable slot')}
                </span>
              </Show>
              <Show when={selectedType() && !selectedType()!.restock}>
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                  title={__('Stock is written off — does not return to a saleable slot.')}
                >
                  {_x(
                    'Write-off',
                    'correction badge (noun): the stock is written off, not returned to sale',
                  )}
                </span>
              </Show>
              <Show when={selectedType()?.refund}>
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200"
                  title={__('A refund is owed by default for this type.')}
                >
                  {__('Refund owed')}
                </span>
              </Show>
              <Show when={!selectedType()}>
                <span class="text-text-muted">
                  {__('None of the corrections available here fits these answers.')}
                </span>
              </Show>
            </div>

            <Show when={selectedType()?.refund}>
              <div class="text-xs flex items-center gap-3">
                <span class="text-gray-600">{__('Refund amount:')}</span>
                <span class="tabular-nums font-medium text-gray-900">{refundAmount()}</span>
                <span class="text-text-muted">
                  {sprintf(
                    /* translators: 1: the price paid per unit, after any discount; 2: quantity. */
                    __(
                      '(%1$s × %2$d at the price paid — the refund itself is issued through WooCommerce.)',
                    ),
                    (() => {
                      const line = selectedLine();
                      return line ? netUnitPrice(line) : '0.00';
                    })(),
                    qty(),
                  )}
                </span>
              </div>
            </Show>

            <label class="block text-xs">
              <span class="block text-gray-600 mb-1">{__('Note (optional)')}</span>
              <textarea
                rows="2"
                class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-surface"
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>

            <Show when={error()}>
              <div class="text-xs text-red-700">{error()}</div>
            </Show>
          </div>

          <ModalFooter>
            <Button variant="secondary" onClick={props.onClose}>
              {__('Cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? __('Adding…') : __('Add correction')}
            </Button>
          </ModalFooter>
        </form>
      </ModalPanel>
    </Modal>
  );
}
