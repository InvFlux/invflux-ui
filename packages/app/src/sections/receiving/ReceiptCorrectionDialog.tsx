import { __, _n, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  Input,
  Modal,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  mintReceiptKey,
  Textarea,
} from '@invflux/ui';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { costText, currencyDecimals, derivedCostText, fullPrecision } from './costText';
import type {
  CorrectionPreview,
  CorrectionPreviewProduct,
  CorrectionRefusal,
  ReceiptDetail,
  ReceiptDetailLine,
} from './types';

/** One line as the dialog edits it: the figures after, as typed. */
interface Draft {
  qty: string;
  damaged: string;
  unitCost: string;
}

/**
 * Correct a posted receipt that was recorded wrong: each line's good and damaged quantities and,
 * for someone who may state costs, its unit cost — as the figures should read, not as deltas.
 *
 * The receipt is not edited: the server records a correction beside it and moves the stock and the
 * average cost the difference requires. What that does is previewed as the operator types — where
 * removed units come from (free stock first, then carts, then orders, which are then left short) and
 * the average now → after — from the same calculation the correction will run.
 */
export function ReceiptCorrectionDialog(props: {
  receipt: ReceiptDetail;
  canStateCost: boolean;
  costDecimals: number;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const queryClient = useQueryClient();

  // Declared before the drafts are seeded, which read it. Unit costs as stated, at the line currency's precision; averages and the variance worked out,
  // rounded unless the reader asked for them in full.
  const lineDecimals = (): number =>
    props.receipt.lineCostDecimals ??
    (props.receipt.lineCurrency !== props.receipt.baseCurrency
      ? currencyDecimals(props.receipt.lineCurrency, props.costDecimals)
      : props.costDecimals);

  const initial = (l: ReceiptDetailLine): Draft => ({
    qty: String(l.current.qty),
    damaged: String(l.current.damaged),
    unitCost:
      null === l.current.unitCost ? '' : editableCost(l.current.unitCost, untrack(lineDecimals)),
  });
  const [drafts, setDrafts] = createStore<Record<number, Draft>>(
    untrack(() => Object.fromEntries(props.receipt.lines.map((l) => [l.lineId, initial(l)]))),
  );
  const [note, setNote] = createSignal('');
  // One key per intent: a retry after a dropped response replays instead of correcting twice.
  const idempotencyKey = mintReceiptKey();

  const whole = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const price = (v: string): number | null =>
    /^\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : null;

  const invalid = (l: ReceiptDetailLine): boolean => {
    const d = drafts[l.lineId];
    return (
      null === whole(d.qty) ||
      null === whole(d.damaged) ||
      (props.canStateCost && '' !== d.unitCost.trim() && null === price(d.unitCost))
    );
  };
  const costChanged = (l: ReceiptDetailLine): boolean => {
    if (!props.canStateCost) return false;
    const typed = price(drafts[l.lineId].unitCost);
    const now = null === l.current.unitCost ? null : Number(l.current.unitCost);
    return null !== typed && typed !== now;
  };

  // Only the lines that differ, and a cost only where it was changed: anything left out keeps
  // what it has, so a viewer who cannot see costs never sends one.
  const changes = createMemo(() =>
    props.receipt.lines.flatMap((l) => {
      if (invalid(l)) return [];
      const d = drafts[l.lineId];
      const qty = whole(d.qty) as number;
      const damaged = whole(d.damaged) as number;
      const cost = costChanged(l);
      if (qty === l.current.qty && damaged === l.current.damaged && !cost) return [];
      return [
        {
          lineId: l.lineId,
          qty,
          damaged,
          ...(cost ? { unitCost: String(price(d.unitCost)) } : {}),
        },
      ];
    }),
  );
  const anyInvalid = (): boolean => props.receipt.lines.some(invalid);

  // The preview follows the figures a beat behind the keyboard, not on every keystroke.
  const [settled, setSettled] = createSignal(untrack(changes));
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const next = changes();
    clearTimeout(timer);
    timer = setTimeout(() => setSettled(next), 300);
  });
  onCleanup(() => clearTimeout(timer));

  const preview = createQuery(() => ({
    queryKey: ['receiving', 'correction-preview', props.receipt.id, settled()],
    queryFn: () =>
      api
        .post<{ preview: CorrectionPreview }>(
          `/receiving/receipts/${props.receipt.id}/corrections/preview`,
          {
            lines: settled(),
          },
        )
        .then((r) => r.preview),
    enabled: settled().length > 0,
    retry: false,
    placeholderData: (previous: CorrectionPreview | undefined) => previous,
  }));
  const refusal = (e: unknown): CorrectionRefusal | null => {
    const body = (e as { body?: unknown } | null)?.body;
    return body && 'object' === typeof body && 'string' === typeof (body as CorrectionRefusal).error
      ? (body as CorrectionRefusal)
      : null;
  };
  const previewRefusal = (): CorrectionRefusal | null =>
    preview.isError ? refusal(preview.error) : null;
  const effect = (subjectId: number): CorrectionPreviewProduct | undefined =>
    settled().length > 0 && !preview.isError
      ? preview.data?.products.find((p) => p.subjectId === subjectId)
      : undefined;

  const reverses = (): boolean =>
    props.receipt.lines.every((l) => {
      const d = drafts[l.lineId];
      return 0 === whole(d.qty) && 0 === whole(d.damaged);
    });

  const record = createMutation(() => ({
    mutationFn: () =>
      api.post<{ correctionId: number }>(`/receiving/receipts/${props.receipt.id}/corrections`, {
        lines: changes(),
        note: note().trim() || undefined,
        idempotencyKey,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['receiving'] });
      props.onClose();
    },
  }));
  const recordRefusal = (): CorrectionRefusal | null =>
    record.isError ? refusal(record.error) : null;

  const lineMoney = (v: string | null): string => (null === v ? '—' : costText(v, lineDecimals()));
  const derived = (v: string | null): string =>
    null === v ? '—' : derivedCostText(v, props.costDecimals, fullPrecision());
  const foreign = (): boolean => props.receipt.lineCurrency !== props.receipt.baseCurrency;
  const showsCosts = (): boolean => props.receipt.showsCosts;
  const canSubmit = (): boolean =>
    changes().length > 0 && !anyInvalid() && !record.isPending && null === previewRefusal();

  /**
   * Corrections are usually small, so a count is nudged as the grid's cells are: `+` / ArrowUp and
   * `-` / ArrowDown step it by one, never below zero. Any other key types as usual.
   */
  const step = (lineId: number, field: 'qty' | 'damaged', e: KeyboardEvent): void => {
    const by =
      '+' === e.key || 'ArrowUp' === e.key ? 1 : '-' === e.key || 'ArrowDown' === e.key ? -1 : 0;
    if (0 === by) return;
    e.preventDefault();
    setDrafts(lineId, field, String(Math.max(0, (whole(drafts[lineId][field]) ?? 0) + by)));
  };

  const set = (lineId: number, field: keyof Draft, value: string): void => {
    setDrafts(lineId, field, value);
  };

  return (
    <Modal onClose={props.onClose} closeOnBackdrop={false} label={__('Correct this receipt')}>
      <ModalPanel size="3xl">
        <ModalHeader
          title={sprintf(
            /* translators: %d is a goods receipt's internal id. */
            __('Correct receipt #%d'),
            props.receipt.id,
          )}
          subtitle={__(
            'Fix how this receipt was recorded: what arrived, in what state, at what cost. This is not a return to the supplier.',
          )}
        />

        <div class="space-y-3 p-4 text-sm">
          <table class="min-w-full border-collapse" data-testid="receipt-correction-lines">
            <thead>
              <tr class="text-left text-xs text-text-muted">
                <th class="min-w-64 py-1 pr-3 font-medium">{__('Product')}</th>
                <th class="w-32 py-1 pr-3 text-right font-medium">{__('Good')}</th>
                <th class="w-32 py-1 pr-3 text-right font-medium">{__('Damaged')}</th>
                <Show when={showsCosts()}>
                  <th
                    class="w-44 py-1 pr-3 text-right font-medium"
                    title={foreign() ? __('In the supplier’s currency') : undefined}
                  >
                    {__('Unit cost')}
                  </th>
                  <th class="w-48 py-1 text-right font-medium">{__('Avg cost now → after')}</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={props.receipt.lines}>
                {(l) => {
                  const d = (): Draft => drafts[l.lineId];
                  const e = (): CorrectionPreviewProduct | undefined => effect(l.subjectId);
                  const notHere = (): CorrectionRefusal | null => {
                    const r = previewRefusal() ?? recordRefusal();
                    return r && 'not_on_hand' === r.code && r.subjectId === l.subjectId ? r : null;
                  };
                  return (
                    <>
                      <tr
                        class="border-t border-slate-100 align-middle"
                        data-testid={`correction-line-${l.lineId}`}
                      >
                        <td class="py-1.5 pr-3">
                          <div class="font-medium">{l.name}</div>
                          <div class="font-mono text-xs text-slate-500">{l.sku}</div>
                        </td>
                        <td class="py-1.5 pr-3">
                          <div class="flex items-center justify-end gap-1.5">
                            <span class="tabular-nums text-text-muted">{l.current.qty} →</span>
                            <Input
                              size="sm"
                              class="w-16 text-right tabular-nums"
                              inputmode="numeric"
                              value={d().qty}
                              invalid={null === whole(d().qty)}
                              onInput={(ev) => set(l.lineId, 'qty', ev.currentTarget.value)}
                              onKeyDown={(ev) => step(l.lineId, 'qty', ev)}
                              title={__('Type a count, or press + or − to adjust it by one.')}
                              data-testid="correction-qty"
                            />
                          </div>
                        </td>
                        <td class="py-1.5 pr-3">
                          <div class="flex items-center justify-end gap-1.5">
                            <span class="tabular-nums text-text-muted">{l.current.damaged} →</span>
                            <Input
                              size="sm"
                              class="w-16 text-right tabular-nums"
                              inputmode="numeric"
                              value={d().damaged}
                              invalid={null === whole(d().damaged)}
                              onInput={(ev) => set(l.lineId, 'damaged', ev.currentTarget.value)}
                              onKeyDown={(ev) => step(l.lineId, 'damaged', ev)}
                              title={__('Type a count, or press + or − to adjust it by one.')}
                              data-testid="correction-damaged"
                            />
                          </div>
                        </td>
                        <Show when={showsCosts()}>
                          <td class="py-1.5 pr-3">
                            <div class="flex items-center justify-end gap-1.5">
                              <span class="tabular-nums text-text-muted">
                                {lineMoney(l.current.unitCost)} →
                              </span>
                              <Input
                                size="sm"
                                class="w-20 text-right tabular-nums"
                                inputmode="decimal"
                                value={d().unitCost}
                                disabled={!props.canStateCost}
                                title={
                                  props.canStateCost
                                    ? undefined
                                    : __('You may not state what goods cost.')
                                }
                                invalid={
                                  props.canStateCost &&
                                  '' !== d().unitCost.trim() &&
                                  null === price(d().unitCost)
                                }
                                onInput={(ev) => set(l.lineId, 'unitCost', ev.currentTarget.value)}
                                data-testid="correction-cost"
                              />
                            </div>
                          </td>
                          <td class="py-1.5 text-right tabular-nums">
                            <Show when={e()} fallback={<span class="text-slate-300">—</span>}>
                              {(p) => (
                                <span>
                                  {derived(p().costBefore)} → {derived(p().costAfter)}
                                </span>
                              )}
                            </Show>
                          </td>
                        </Show>
                      </tr>
                      <Show when={notHere() ?? consequence(e(), showsCosts() ? derived : null)}>
                        {(msg) => (
                          <tr>
                            <td
                              colspan={showsCosts() ? 5 : 3}
                              class={`pb-1.5 text-xs ${notHere() ? 'text-red-600' : 'text-amber-700'}`}
                              data-testid="correction-consequence"
                            >
                              {'string' === typeof msg()
                                ? (msg() as string)
                                : (msg() as CorrectionRefusal).error}
                            </td>
                          </tr>
                        )}
                      </Show>
                    </>
                  );
                }}
              </For>
            </tbody>
          </table>

          <Show when={showsCosts()}>
            <p class="text-xs text-text-muted">
              {__('Units already shipped keep the cost they left at.')}
            </p>
          </Show>

          <label class="block">
            <span class="mb-1 block text-xs text-text-muted">{__('Note (optional)')}</span>
            <Textarea
              size="sm"
              lines={2}
              value={note()}
              maxlength={500}
              onInput={(ev) => setNote(ev.currentTarget.value)}
              data-testid="correction-note"
            />
          </label>

          <Show
            when={(() => {
              const r = previewRefusal() ?? recordRefusal();
              return r && 'not_on_hand' !== r.code ? r : null;
            })()}
          >
            {(r) => <ErrorBanner class="text-sm">{r().error}</ErrorBanner>}
          </Show>
          <Show when={record.isError && null === recordRefusal()}>
            <ErrorBanner class="text-sm">{__('The correction could not be recorded.')}</ErrorBanner>
          </Show>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={props.onClose}>
            {__('Cancel')}
          </Button>
          <Button
            variant={reverses() ? 'danger' : 'primary'}
            disabled={!canSubmit()}
            loading={record.isPending}
            onClick={() => record.mutate()}
            data-testid="correction-submit"
          >
            {reverses() ? __('Reverse receipt') : __('Record correction')}
          </Button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}

/**
 * A stored cost as the field shows it: the store's decimals, and more only where the cost has them
 * (`30.0000` → `30.00`, `12.3456` → `12.3456`), so leaving the field alone never reads as a change.
 */
function editableCost(stored: string, decimals: number): string {
  const full = Number(stored).toFixed(4);
  const trimmed = full.replace(/0+$/, '');
  const places = Math.max(decimals, (trimmed.split('.')[1] ?? '').length);
  return Number(stored).toFixed(places);
}

/**
 * What the change does that the operator should know before committing it, in one sentence: units
 * taken from orders or carts, units brought in, or value the stock left cannot carry.
 */
function consequence(
  p: CorrectionPreviewProduct | undefined,
  money: ((v: string | null) => string) | null,
): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.fromCommitted > 0) {
    parts.push(
      sprintf(
        /* translators: %d is a number of units. */
        _n(
          '%d of these units is committed to orders; removing it leaves those orders short.',
          '%d of these units are committed to orders; removing them leaves those orders short.',
          p.fromCommitted,
        ),
        p.fromCommitted,
      ),
    );
  }
  if (p.fromHeld > 0) {
    parts.push(
      sprintf(
        /* translators: %d is a number of units. */
        _n(
          '%d unit held in a cart is released.',
          '%d units held in carts are released.',
          p.fromHeld,
        ),
        p.fromHeld,
      ),
    );
  }
  if (null !== money && !p.absorbed && null !== p.variance) {
    parts.push(
      sprintf(
        /* translators: %s is an amount of money. */
        __(
          'The stock left cannot carry this change: the average stays, and %s is recorded as a cost variance.',
        ),
        money(p.variance),
      ),
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
