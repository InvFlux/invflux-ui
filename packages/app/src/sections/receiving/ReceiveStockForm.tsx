import { __, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  IconButton,
  Input,
  RequiredMark,
  Select,
  Textarea,
  toast,
} from '@invflux/ui';
import { mintReceiptKey } from '@invflux/ui';
import { STOCK_MOVED } from '@invflux/ui/api';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { ProductPickerCell } from './ProductPickerCell';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import type {
  ReceiptReasonOption,
  ReceivingContextResponse,
  ReceivableProduct,
  ReceiveLineDraft,
  RecordedReceipt,
} from './types';

const FIELD = 'block text-sm font-medium text-slate-600';

/** The server's refusals, which carry an operator message under `error` rather than `message`. */
interface ReceiptErrorBody {
  error?: unknown;
  code?: unknown;
  /** `invflux_ungoverned_subjects` — every product that cannot take stock. */
  subjectIds?: unknown;
  /** `invflux_receipt_cost_policy` — the line that broke the reason's cost rule. */
  subjectId?: unknown;
}

const errorBody = (e: unknown): ReceiptErrorBody =>
  e !== null && 'object' === typeof e && 'body' in e && null !== (e as { body: unknown }).body
    ? ((e as { body: ReceiptErrorBody }).body ?? {})
    : {};

const numberList = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => 'number' === typeof v) : [];

/**
 * Record stock that answers no purchase order — an opening balance, a delivery nobody ordered,
 * units found on a shelf.
 *
 * **The reason is the first field because it decides the form.** It is what the receipt carries in
 * place of a document, and it selects what the lines owe about cost: some reasons demand a figure,
 * one records a literal zero, two stand the product's own valuation in. That table is the server's
 * (`GET /receiving/reasons`) rather than a copy kept here — a screen enforcing a stale copy would
 * ask for a figure the domain refuses, or omit one it requires.
 *
 * Nothing moves until [Record receipt]: quantities are staged client-side, the same discipline as
 * the purchase-order reception form. Unlike a correction, this is a **costed** movement — it
 * establishes or blends the weighted average — which is exactly why it is not the correction modal.
 */
export function ReceiveStockForm(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const queryClient = useQueryClient();

  // The screen's own bootstrap: the reasons this build knows and what each owes about cost, the
  // currency any figure is denominated in, and whether this user may state one at all. One request,
  // because all three are answers to "what can this person record here?".
  const context = createQuery(() => ({
    queryKey: ['receiving', 'context'],
    queryFn: () => api.get<ReceivingContextResponse>('/receiving/context'),
    // Build-level facts and a capability: stable for the session.
    staleTime: Number.POSITIVE_INFINITY,
  }));

  let nextKey = 1;
  const blankLine = (): ReceiveLineDraft => ({
    key: nextKey++,
    product: null,
    qty: null,
    damaged: null,
    unitCost: '',
  });

  const [form, setForm] = createStore<{
    reason: string;
    note: string;
    lines: ReceiveLineDraft[];
    /** Products the server named as unable to take stock, flagged on their rows. */
    ungoverned: number[];
    /** The line the server named in a cost-policy refusal. */
    costOffender: number | null;
    error: string;
  }>({ reason: '', note: '', lines: [blankLine()], ungoverned: [], costOffender: null, error: '' });

  const reason = (): ReceiptReasonOption | null =>
    context.data?.reasons.find((r) => r.value === form.reason) ?? null;
  const canStateCost = (): boolean => context.data?.canStateCost ?? false;
  const costEntry = (): string => reason()?.costEntry ?? 'none';

  // Whether the cost column is on the form at all. Two independent conditions: the reason has to
  // want a figure, AND this user has to be someone who may state one — pricing an arrival is a
  // different authority from receiving it, held by different people.
  const costAsked = (): boolean => 'required' === costEntry() || 'optional' === costEntry();
  const showsCost = (): boolean => costAsked() && canStateCost();

  // A reason this user cannot complete: it demands a cost they may not state. Said plainly rather
  // than by a disabled button with no explanation, and rather than by letting them count first and
  // meet a 403 at the end.
  const blockedByCostCap = (): boolean => 'required' === costEntry() && !canStateCost();
  const blockedByReason = (): boolean => 'unsupported' === costEntry();

  const counted = createMemo(() =>
    form.lines.filter((l) => null !== l.product && null !== l.qty && l.qty > 0),
  );
  const missingCost = createMemo(() =>
    'required' === costEntry() ? counted().filter((l) => '' === l.unitCost.trim()) : [],
  );
  const canSubmit = (): boolean =>
    '' !== form.reason &&
    !blockedByReason() &&
    !blockedByCostCap() &&
    counted().length > 0 &&
    0 === missingCost().length;

  const setLine = <K extends keyof ReceiveLineDraft>(
    index: number,
    field: K,
    value: ReceiveLineDraft[K],
  ): void => {
    setForm('lines', index, field, value);
    setForm('error', '');
  };

  // A row is picked → make sure a blank one waits below it, so entry never stops to press [Add].
  const pickProduct = (index: number, product: ReceivableProduct | null): void => {
    setLine(index, 'product', product);
    setForm('ungoverned', (ids) => ids.filter((id) => id !== product?.subjectId));
    if (null !== product && index === form.lines.length - 1) {
      setForm('lines', form.lines.length, blankLine());
    }
  };

  const removeLine = (index: number): void => {
    setForm('lines', (ls) => {
      const next = ls.filter((_, i) => i !== index);
      return 0 === next.length ? [blankLine()] : next;
    });
  };

  // Damaged is a subset of received: lowering the received count pulls it down rather than leaving
  // it stranded above, which would post more damaged units than arrived.
  const setQty = (index: number, value: number | null): void => {
    setLine(index, 'qty', value);
    const damaged = form.lines[index]?.damaged ?? null;
    if (null !== damaged && (null === value || damaged > value)) setLine(index, 'damaged', value);
  };

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if ('' === trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  };

  /**
   * One operator intent to submit, held across retries of that same submission and minted afresh for
   * the next one. Two genuine intakes can be byte-identical — same reason, same product, same count,
   * an hour apart — so the token identifies the intent, never the payload.
   */
  let submissionKey: string | null = null;

  const record = createMutation(() => ({
    mutationFn: () => {
      submissionKey ??= mintReceiptKey();
      return api.post<RecordedReceipt>('/receiving/receipts', {
        reason: form.reason,
        note: '' === form.note.trim() ? null : form.note.trim(),
        idempotencyKey: submissionKey,
        lines: counted().map((l) => ({
          subjectId: l.product?.subjectId,
          qty: l.qty,
          damaged: l.damaged ?? 0,
          // Sent only where the form asked for it: an empty string is not a price, and a figure the
          // user was never shown a field for is not theirs to have stated.
          unitCost: showsCost() && '' !== l.unitCost.trim() ? l.unitCost.trim() : undefined,
        })),
      });
    },
    onSuccess: (data) => {
      // Stock moved, so every surface holding a count is now stale — the workbench included.
      void queryClient.invalidateQueries({ queryKey: STOCK_MOVED });
      toast.success(
        sprintf(
          /* translators: %d is the number of product lines recorded. */
          __('Receipt recorded — %d line(s) into stock.'),
          data.receipt.lineCount,
        ),
      );
      // A recorded receipt is done with: the token, the counts and the note all belong to it. The
      // reason survives, because the next intake of a session is usually the same kind.
      submissionKey = null;
      nextKey = 1;
      setForm({ note: '', lines: [blankLine()], ungoverned: [], costOffender: null, error: '' });
    },
    onError: (e: unknown) => {
      const body = errorBody(e);
      const message =
        'string' === typeof body.error && '' !== body.error
          ? body.error
          : e instanceof Error
            ? e.message
            : String(e);
      setForm({
        error: message,
        ungoverned: numberList(body.subjectIds),
        costOffender: 'number' === typeof body.subjectId ? body.subjectId : null,
      });
    },
  }));

  return (
    <section class="max-w-4xl">
      <header class="mb-4">
        {/* The source's own name from the chooser, so the crumb and the card that led here agree. */}
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
      <Select
        id="receiving-reason"
        class="w-full max-w-md"
        value={form.reason}
        disabled={context.isPending}
        onChange={(e) => {
          setForm({ reason: e.currentTarget.value, error: '', costOffender: null });
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
      <Show when={reason()}>
        {(r) => <p class="mt-1 max-w-2xl text-xs text-text-muted">{r().hint}</p>}
      </Show>
      <Show when={blockedByCostCap()}>
        <ErrorBanner class="mt-2 max-w-2xl text-xs">
          {__(
            'This kind of receipt has to state what the goods cost, and you do not have permission to do that. Ask someone who does to record it.',
          )}
        </ErrorBanner>
      </Show>

      <table class="mt-5 w-full text-sm">
        <thead class="bg-surface-raised">
          <tr class="border-b border-slate-200 text-left text-xs uppercase text-text-muted">
            <th class="py-2 px-3 font-medium">{__('Product')}</th>
            <th class="py-2 px-3 w-20 text-right font-medium">{__('On hand')}</th>
            <th class="py-2 px-3 w-20 text-right font-medium">{__('Received')}</th>
            <th class="py-2 px-3 w-20 text-right font-medium">{__('Damaged')}</th>
            <Show when={showsCost()}>
              <th class="w-32 p-2 text-right font-medium">
                {sprintf(
                  /* translators: %s is the store's base currency code, e.g. EUR. */
                  __('Unit cost (%s)'),
                  context.data?.baseCurrency ?? '',
                )}
                <Show when={'required' === costEntry()}>
                  {' '}
                  <RequiredMark />
                </Show>
              </th>
            </Show>
            <th class="w-10 p-2" />
          </tr>
        </thead>
        <tbody>
          <For each={form.lines}>
            {(line, index) => (
              <tr class="border-b border-slate-100 align-middle">
                <td class="py-1.5 px-1">
                  <ProductPickerCell
                    selected={line.product}
                    invalid={
                      null !== line.product && form.ungoverned.includes(line.product.subjectId)
                    }
                    onPick={(p) => pickProduct(index(), p)}
                  />
                </td>
                <td class="py-1.5 px-1 text-right tabular-nums text-text-muted">
                  {line.product?.onHand ?? ''}
                </td>
                <td class="py-1.5 px-1">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    class="w-full text-right"
                    aria-label={__('Received')}
                    value={null === line.qty ? '' : String(line.qty)}
                    onInput={(e) => setQty(index(), numberOrNull(e.currentTarget.value))}
                  />
                </td>
                <td class="py-1.5 px-1">
                  <Input
                    type="number"
                    min="0"
                    max={null === line.qty ? undefined : String(line.qty)}
                    step="1"
                    class="w-full text-right"
                    aria-label={__('Damaged')}
                    value={null === line.damaged ? '' : String(line.damaged)}
                    onInput={(e) => {
                      const entered = numberOrNull(e.currentTarget.value);
                      setLine(
                        index(),
                        'damaged',
                        null === entered || null === line.qty
                          ? entered
                          : Math.min(entered, line.qty),
                      );
                    }}
                  />
                </td>
                <Show when={showsCost()}>
                  <td class="py-1.5 px-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.0001"
                      class="w-full text-right"
                      aria-label={__('Unit cost')}
                      invalid={
                        (null !== line.product && form.costOffender === line.product.subjectId) ||
                        missingCost().includes(line)
                      }
                      placeholder={'optional' === costEntry() ? __('Standing value') : undefined}
                      value={line.unitCost}
                      onInput={(e) => setLine(index(), 'unitCost', e.currentTarget.value)}
                    />
                  </td>
                </Show>
                <td class="py-1.5 text-right">
                  <Show when={form.lines.length > 1}>
                    <IconButton
                      label={__('Remove this line')}
                      danger
                      onClick={() => removeLine(index())}
                    >
                      ×
                    </IconButton>
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <label class={`${FIELD} mt-5 max-w-2xl`}>
        {__('Note (optional)')}
        <Textarea
          class="mt-1 w-full"
          rows="2"
          noResize
          placeholder={__('e.g. who delivered it, where it was found, what the packing slip said…')}
          value={form.note}
          onInput={(e) => setForm('note', e.currentTarget.value)}
        />
      </label>

      <Show when={'' !== form.error}>
        <ErrorBanner class="mt-4 max-w-2xl text-sm">{form.error}</ErrorBanner>
      </Show>

      <div class="mt-4 flex items-center justify-end gap-3">
        <Show when={'' !== form.reason && 0 === counted().length}>
          <span class="text-xs text-text-muted">
            {__('Pick a product and enter how many arrived.')}
          </span>
        </Show>
        <Show when={missingCost().length > 0}>
          <span class="text-xs text-amber-600">
            {__('This reason needs a unit cost on every line.')}
          </span>
        </Show>
        <Button
          disabled={!canSubmit() || record.isPending}
          onClick={() => {
            record.mutate();
          }}
        >
          {__('Record receipt')}
        </Button>
      </div>
    </section>
  );
}
