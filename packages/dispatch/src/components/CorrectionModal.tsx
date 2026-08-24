import { For, Show, createMemo, createSignal } from 'solid-js';
import { __ } from '@invflux/i18n';
import { Button, IconButton, Modal, StockConcernBits } from '@invflux/ui';
import { useCreateCorrectionMutation } from '../queries';
import type {
  CorrectionType,
  DispatchOrderLine,
  EssentialsCorrectionTypeCode,
} from '../types';

/**
 * Per-line correction modal — the D1+D2 entry point. Three launch
 * routes converge here:
 *
 * - per-line `!` icon (preset `lineId`, qty defaults to `qty_outstanding`),
 * - global `C` keyboard shortcut (no preset; operator picks the line),
 * - "+ Add correction" button on the corrections panel (no preset).
 *
 * **Type-flag cascade.** Sections render declaratively from the
 * `CorrectionType.preDispatch / restock / refund` flags rather than
 * branching on `code`. Adding a new type at Pro therefore needs no
 * frontend change — the flags drive the UI.
 *
 * **Refund pre-fill.** When the type carries `refund=true`, the refund
 * amount is computed as `line.unitPrice × qty` and shown read-only.
 * The value is indicative — the authoritative refund is whatever the
 * merchant issues through WooCommerce — so the operator should not
 * edit it here.
 */
export function CorrectionModal(props: {
  orderHexId: string;
  lines: DispatchOrderLine[];
  types: CorrectionType[];
  /** Pre-target one line on mount. Pass `null` to let the user pick. */
  presetLineId: string | null;
  onClose: () => void;
}) {
  const createMutation = useCreateCorrectionMutation(() => props.orderHexId);

  function shippable(line: DispatchOrderLine): number {
    return Math.max(0, line.qtyOrdered - line.qtyCorrected - line.qtyShipped);
  }

  /**
   * Pick the initial type code given the preset line's stock concerns.
   * A line with `BIT_STOCK_DEFICIT` set is almost always being corrected
   * because the units are missing from the warehouse — defaulting to
   * `writeoff_missing` removes one click from the most common path.
   * Falls back to the first type in the list otherwise.
   */
  function initialTypeCode(): EssentialsCorrectionTypeCode {
    const preset = props.lines.find((l) => l.id === props.presetLineId);
    if (preset && (preset.stockState & StockConcernBits.STOCK_DEFICIT) !== 0) {
      const missing = props.types.find((t) => t.code === 'writeoff_missing');
      if (missing) return missing.code;
    }
    return props.types[0]?.code ?? 'cancel_customer';
  }

  // Initial line: the preset if it has outstanding qty, else the first
  // line that does, else the first line at all. The mutation will reject
  // qty=0 server-side anyway, but the UI shouldn't lead with a dead
  // selection if a better one is available.
  function initialLineId(): string {
    const preset = props.lines.find((l) => l.id === props.presetLineId);
    if (preset && shippable(preset) > 0) return preset.id;
    const firstAvail = props.lines.find((l) => shippable(l) > 0);
    return firstAvail?.id ?? props.lines[0]?.id ?? '';
  }

  const [lineId, setLineId] = createSignal(initialLineId());
  const [typeCode, setTypeCode] = createSignal<EssentialsCorrectionTypeCode>(initialTypeCode());

  const selectedLine = createMemo(() => props.lines.find((l) => l.id === lineId()));
  const selectedType = createMemo(() => props.types.find((t) => t.code === typeCode()));
  const maxQty = createMemo(() => {
    const line = selectedLine();
    return line ? shippable(line) : 0;
  });

  const [qty, setQty] = createSignal(maxQty());
  const [note, setNote] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  // Reset qty when the line changes so we land on the new line's
  // outstanding qty instead of carrying the prior value.
  let lastLineId = lineId();
  createMemo(() => {
    const current = lineId();
    if (current !== lastLineId) {
      lastLineId = current;
      setQty(maxQty());
    }
  });

  /**
   * Refund pre-fill = `unitPrice × qty`, formatted to 2 decimals. The
   * server stores a decimal string, so we emit a string. `parseFloat`
   * accepts both `"0.00"` and `"12.5"`.
   */
  const refundAmount = createMemo(() => {
    const line = selectedLine();
    if (!line) return '0.00';
    const price = parseFloat(line.unitPrice) || 0;
    const total = price * qty();
    return total.toFixed(2);
  });

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const line = selectedLine();
    if (!line) {
      setError('Please pick a line.');
      return;
    }
    const max = shippable(line);
    if (qty() < 1 || qty() > max) {
      setError(`Qty must be between 1 and ${max}.`);
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
        typeCode: typeCode(),
        qty: qty(),
        // Server requires the field even when the type doesn't carry a
        // refund; "0.00" is the no-refund neutral.
        refundAmount: selectedType()?.refund ? refundAmount() : '0.00',
        note: note().trim() === '' ? null : note(),
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <Modal
      onClose={props.onClose}
      backdropClass="bg-black/30 flex items-center justify-center p-6"
      label="Create correction"
    >
      <div
        class="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* `submit` catches its own rejections (it sets `error` and returns), so discarding the
            promise here loses nothing — the `void` is what says so to the reader and the linter. */}
        <form onSubmit={(e) => void submit(e)}>
          <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 class="text-base font-medium text-gray-900">{__('Create correction')}</h2>
            <IconButton
              size="sm"
              label="Close"
              onClick={props.onClose}
            >
              ×
            </IconButton>
          </div>

          <div class="px-5 py-4 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <label class="md:col-span-6 block text-xs">
                <span class="block text-gray-600 mb-1">Line</span>
                <select
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-white"
                  value={lineId()}
                  onChange={(e) => setLineId(e.currentTarget.value)}
                >
                  <For each={props.lines}>
                    {(line) => (
                      <option value={line.id} disabled={shippable(line) === 0}>
                        {line.name} ({line.sku || '—'}) · {shippable(line)} avail
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <label class="md:col-span-4 block text-xs">
                <span class="block text-gray-600 mb-1">Type</span>
                <select
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-white"
                  value={typeCode()}
                  onChange={(e) => setTypeCode(e.currentTarget.value as EssentialsCorrectionTypeCode)}
                >
                  <For each={props.types}>
                    {(t) => <option value={t.code}>{t.name}</option>}
                  </For>
                </select>
              </label>

              <label class="md:col-span-2 block text-xs">
                <span class="block text-gray-600 mb-1">Qty</span>
                <input
                  type="number"
                  min="1"
                  max={maxQty()}
                  class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-white tabular-nums"
                  value={qty()}
                  onInput={(e) => setQty(Number(e.currentTarget.value) || 0)}
                />
              </label>
            </div>

            {/*
              D2 cascade. Each pill renders only when the active type's
              flag says so — adding a new type at Pro (e.g. a post-shipment
              return) automatically gets the right UI without code change.
            */}
            <div class="flex flex-wrap gap-2 text-xs">
              <Show when={selectedType()?.preDispatch}>
                <span class="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                      title={__('Stock returns from the quantity held for this order rather than from a saleable slot.')}>
                  {__('Pre-shipment')}
                </span>
              </Show>
              <Show when={selectedType()?.restock}>
                <span class="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                      title={__('Stock returns to a saleable slot.')}>
                  {__('Restock')}
                </span>
              </Show>
              <Show when={selectedType() && !selectedType()!.restock}>
                <span class="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                      title={__('Stock is written off — does not return to a saleable slot.')}>
                  {__('Write-off')}
                </span>
              </Show>
              <Show when={selectedType()?.refund}>
                <span class="inline-flex items-center px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200"
                      title={__('A refund is owed by default for this type.')}>
                  {__('Refund owed')}
                </span>
              </Show>
            </div>

            <Show when={selectedType()?.refund}>
              <div class="text-xs flex items-center gap-3">
                <span class="text-gray-600">{__('Refund amount:')}</span>
                <span class="tabular-nums font-medium text-gray-900">
                  {refundAmount()}
                </span>
                <span class="text-text-muted">
                  ({selectedLine()?.unitPrice ?? '0.00'} × {qty()} — indicative;
                  the refund itself is resolved through WooCommerce.)
                </span>
              </div>
            </Show>

            <label class="block text-xs">
              <span class="block text-gray-600 mb-1">{__('Note (optional)')}</span>
              <textarea
                rows="2"
                class="w-full text-sm border border-gray-300 rounded pl-2 pr-4 py-1 bg-white"
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>

            <Show when={error()}>
              <div class="text-xs text-red-700">{error()}</div>
            </Show>
          </div>

          <div class="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={props.onClose}
            >
              {__('Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Adding…' : 'Add correction'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
