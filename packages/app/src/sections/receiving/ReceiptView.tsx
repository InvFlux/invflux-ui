import { __, _x, formatDateTime, sprintf } from '@invflux/i18n';
import { type ReadColumn, ReadLinesTable } from '@invflux/procurement/src/grid/ReadLinesTable';
import { Button, ErrorBanner, Pill } from '@invflux/ui';
import { A } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { costText, currencyDecimals, derivedCostText, fullPrecision } from './costText';
import { ReceiptCorrectionDialog } from './ReceiptCorrectionDialog';
import { purchaseOrderHref, sourceLabel } from './procurementLink';
import { ReceivingCrumbs } from './ReceivingCrumbs';
import type {
  ReceiptCorrection,
  ReceiptDetail,
  ReceiptDetailLine,
  ReceiptDetailResponse,
  ReceivingContextResponse,
} from './types';

/**
 * A posted receipt, read-only: what arrived, why, from whom, who recorded it, and at what cost.
 *
 * The receipt itself never changes — it is a fact about stock that has already moved. A receipt
 * recorded wrong is corrected beside it: each line shows what it says now, with what was posted
 * beneath where they differ, and the corrections are listed under the lines. Costs appear only for someone who may see them; the
 * server leaves them out otherwise, and the columns go with them.
 */
export function ReceiptView(props: { id: number }): JSX.Element {
  const app = useApp();
  const api = createApi(app);

  const receipt = createQuery(() => ({
    queryKey: ['receiving', 'receipt', props.id],
    queryFn: () =>
      api.get<ReceiptDetailResponse>(`/receiving/receipts/${props.id}`).then((r) => r.receipt),
    retry: false,
  }));
  const context = createQuery(() => ({
    queryKey: ['receiving', 'context'],
    queryFn: () => api.get<ReceivingContextResponse>('/receiving/context'),
    staleTime: Number.POSITIVE_INFINITY,
  }));

  // The store's currency at the shop's own price setting; the supplier's at that currency's standard
  // precision. Stated figures keep any extra digits; worked-out ones round unless the reader asked to
  // see them in full (the Receiving gear).
  const decimals = (): number => context.data?.costDecimals ?? 2;
  const money = (v: string | null): string => (null === v ? '—' : costText(v, decimals()));
  const derived = (v: string | null): string =>
    null === v ? '—' : derivedCostText(v, decimals(), fullPrecision());
  const lineMoney =
    (r: ReceiptDetail) =>
    (v: string | null): string =>
      null === v
        ? '—'
        : costText(
            v,
            r.lineCostDecimals ??
              (foreign(r) ? currencyDecimals(r.lineCurrency, decimals()) : decimals()),
          );
  const foreign = (r: ReceiptDetail): boolean => r.lineCurrency !== r.baseCurrency;
  // A line's cost and value as it stands after corrections, in the store base through the
  // receipt's own rate — the posted figures stay beneath where they differ.
  const rate = (r: ReceiptDetail): number => (null === r.fxRate ? 1 : Number(r.fxRate));
  const nowUnitBase = (r: ReceiptDetail, l: ReceiptDetailLine): number | null =>
    null === l.current.unitCost ? null : Number(l.current.unitCost) * rate(r);
  const nowValue = (r: ReceiptDetail, l: ReceiptDetailLine): number | null => {
    const unit = nowUnitBase(r, l);
    return null === unit ? null : unit * l.current.qty;
  };
  const nowTotal = (r: ReceiptDetail): string | null => {
    let total = 0;
    for (const l of r.lines) {
      const v = nowValue(r, l);
      if (null === v) return null;
      total += v;
    }
    return total.toFixed(4);
  };
  const asMoney = (v: number | null): string | null => (null === v ? null : v.toFixed(4));
  const moneyNow = (
    now: string | null,
    posted: string | null,
    format: (v: string | null) => string = money,
  ): JSX.Element => (
    <>
      <div>{format(now)}</div>
      <Show
        when={
          null !== now && null !== posted && Number(now).toFixed(4) !== Number(posted).toFixed(4)
        }
      >
        <div class="text-xs text-text-muted">
          {sprintf(
            /* translators: %s is the amount the receipt was posted with. */
            __('posted %s'),
            format(posted),
          )}
        </div>
      </Show>
    </>
  );

  // The same read-only table a sent purchase order's lines use. Cost columns only for a viewer the
  // server sends costs to, and the supplier-currency price only when the receipt has a rate.
  const columns = (r: ReceiptDetail): ReadColumn<ReceiptDetailLine>[] => {
    const cols: ReadColumn<ReceiptDetailLine>[] = [
      {
        id: 'product',
        header: __('Product'),
        cell: (l) => <span class="font-medium">{l.name}</span>,
      },
      { id: 'sku', header: __('SKU'), kind: 'code', width: 'w-32', cell: (l) => l.sku || '—' },
      {
        id: 'received',
        header: __('Received'),
        kind: 'num',
        width: 'w-24',
        cell: (l) => <NowFigure now={l.current.qty} posted={l.qty} />,
      },
      {
        id: 'damaged',
        header: __('Damaged'),
        kind: 'num',
        width: 'w-24',
        cell: (l) =>
          l.current.damaged > 0 || l.damaged > 0 ? (
            <span class={l.current.damaged > 0 ? 'text-red-600' : ''}>
              <NowFigure now={l.current.damaged} posted={l.damaged} />
            </span>
          ) : (
            <span class="text-slate-300">—</span>
          ),
      },
    ];
    // What the receipt left: the product's on-hand after it, with what it was before beneath.
    cols.push({
      id: 'on_hand_after',
      header: __('On hand after'),
      title: __('The product’s stock on hand when this receipt was posted, and before it'),
      kind: 'num',
      width: 'w-28',
      cell: (l) => <AfterFigure after={l.onHandAfter} before={l.onHandBefore} />,
    });
    if (!r.showsCosts) return cols;
    if (foreign(r))
      cols.push({
        id: 'unit_price',
        header: __('Supplier price'),
        title: __('The unit price in the supplier’s currency, as invoiced'),
        kind: 'num',
        width: 'w-32',
        cell: (l) => moneyNow(l.current.unitCost, l.unitCost, lineMoney(r)),
      });
    cols.push(
      {
        id: 'unit_cost',
        header: __('Unit cost'),
        kind: 'num',
        width: 'w-32',
        // Converted from the supplier's price, so worked out; otherwise it is the stated cost.
        cell: (l) =>
          moneyNow(asMoney(nowUnitBase(r, l)), l.unitCostBase, foreign(r) ? derived : money),
      },
      {
        id: 'value',
        header: __('Value'),
        kind: 'num',
        width: 'w-32',
        cell: (l) => moneyNow(asMoney(nowValue(r, l)), l.valueBase, derived),
        total: () => moneyNow(nowTotal(r), r.valueBase, derived),
      },
    );
    cols.push({
      id: 'cost_after',
      header: __('Avg cost after'),
      title: __('The product’s average cost when this receipt was posted, and before it'),
      kind: 'num',
      width: 'w-36',
      cell: (l) => (
        <AfterFigure
          after={null === l.costAfter ? null : derived(l.costAfter)}
          before={null === l.costBefore ? null : derived(l.costBefore)}
        />
      ),
    });
    return cols;
  };

  const [correcting, setCorrecting] = createSignal(false);
  const corrected = (r: ReceiptDetail): boolean => r.corrections.length > 0;
  const reversed = (r: ReceiptDetail): boolean =>
    corrected(r) && r.lines.every((l) => 0 === l.current.qty && 0 === l.current.damaged);

  const errorText = (): string => {
    const e = receipt.error as { body?: { error?: unknown } } | null;
    return 'string' === typeof e?.body?.error ? e.body.error : __('Could not load this receipt.');
  };

  return (
    <section class="max-w-5xl">
      <header class="mb-4 flex items-start justify-between gap-4">
        <ReceivingCrumbs
          trail={[
            {
              label: sprintf(
                /* translators: %d is a goods receipt's internal id. */
                __('Receipt #%d'),
                props.id,
              ),
            },
          ]}
        />
        <Show when={receipt.data}>
          {(r) => (
            <div class="flex items-center gap-2">
              <Show when={corrected(r())}>
                <Pill
                  tone={reversed(r()) ? 'neutral' : 'info'}
                  title={
                    reversed(r())
                      ? __('Every quantity was corrected to zero. The receipt stays on file.')
                      : __(
                          'Figures were corrected after posting. The corrections are listed below.',
                        )
                  }
                  data-testid="receipt-corrected-pill"
                >
                  {reversed(r())
                    ? _x('Reversed', 'goods receipt status: every quantity corrected to zero')
                    : _x('Corrected', 'goods receipt status: figures corrected after posting')}
                </Pill>
              </Show>
              <Show when={r().lines.length > 0 && !reversed(r())}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCorrecting(true)}
                  data-testid="receipt-correct"
                >
                  {__('Correct…')}
                </Button>
              </Show>
            </div>
          )}
        </Show>
      </header>

      <Show when={receipt.isError}>
        <ErrorBanner class="max-w-2xl text-sm">{errorText()}</ErrorBanner>
      </Show>

      <Show when={receipt.data}>
        {(r) => (
          <>
            <dl
              data-testid="receipt-header"
              class="mb-5 grid max-w-3xl grid-cols-[max-content_1fr_max-content_1fr] gap-x-3 gap-y-1 text-sm"
            >
              <dt class="text-text-muted">{__('Received')}</dt>
              <dd>
                {formatDateTime(r().receivedAt, '—', { dateStyle: 'medium', timeStyle: 'short' })}
              </dd>
              <Show when={null !== r().reasonLabel}>
                <dt class="text-text-muted">{__('Reason')}</dt>
                <dd>{r().reasonLabel}</dd>
              </Show>
              {/* What the receipt answers, and the way back to it. Plain text for a viewer who
                  cannot open Procurement, and for a document type this build cannot name. */}
              <Show when={r().source}>
                {(source) => (
                  <>
                    <dt class="text-text-muted">{__('Against')}</dt>
                    <dd data-testid="receipt-source">
                      <Show
                        when={
                          'purchase_order' === source().type ? purchaseOrderHref(source().id) : null
                        }
                        fallback={sourceLabel(source())}
                      >
                        {(href) => (
                          <A href={href()} class="text-primary hover:underline">
                            {sourceLabel(source())} →
                          </A>
                        )}
                      </Show>
                    </dd>
                  </>
                )}
              </Show>
              <Show when={r().supplier}>
                {(s) => (
                  <>
                    <dt class="text-text-muted">{__('Supplier')}</dt>
                    <dd>{s().name}</dd>
                  </>
                )}
              </Show>
              <Show when={null !== r().receivedBy}>
                <dt class="text-text-muted">{__('Recorded by')}</dt>
                <dd>{r().receivedBy}</dd>
              </Show>
              {/* Every money column is in one currency, said once here rather than on each
                  column; a foreign receipt's supplier price is the one exception, named beside
                  its rate. */}
              <Show when={r().showsCosts}>
                <dt class="text-text-muted">{__('Costs in')}</dt>
                <dd>{r().baseCurrency}</dd>
              </Show>
              <Show when={r().showsCosts && foreign(r())}>
                <dt class="text-text-muted">{__('Supplier currency')}</dt>
                <dd>{r().lineCurrency}</dd>
              </Show>
              <Show when={r().showsCosts && null !== r().fxRate}>
                <dt class="text-text-muted">{__('Exchange rate')}</dt>
                <dd class="tabular-nums">
                  {sprintf(
                    /* translators: 1: the supplier's currency code; 2: the rate; 3: the store's currency code — "1 USD = 0.9 EUR". */
                    __('1 %1$s = %2$s %3$s'),
                    r().lineCurrency,
                    Number(r().fxRate).toString(),
                    r().baseCurrency,
                  )}
                </dd>
              </Show>
              <Show when={null !== r().note && '' !== r().note}>
                <dt class="text-text-muted">{__('Note')}</dt>
                <dd class="whitespace-pre-line">{r().note}</dd>
              </Show>
            </dl>

            <ReadLinesTable
              columns={columns(r())}
              rows={r().lines}
              empty={__('This receipt has no lines.')}
              totalLabel={__('Total value')}
              testId="receipt-lines"
            />

            <Show when={corrected(r())}>
              <section class="mt-6 max-w-3xl" data-testid="receipt-corrections">
                <h3 class="mb-2 text-sm font-semibold text-text">{__('Corrections')}</h3>
                <ol class="space-y-3">
                  <For each={r().corrections}>
                    {(c) => (
                      <CorrectionEntry
                        correction={c}
                        receipt={r()}
                        lineMoney={lineMoney(r())}
                        derived={derived}
                      />
                    )}
                  </For>
                </ol>
              </section>
            </Show>

            <Show when={correcting()}>
              <ReceiptCorrectionDialog
                receipt={r()}
                canStateCost={context.data?.canStateCost ?? false}
                costDecimals={context.data?.costDecimals ?? 2}
                onClose={() => setCorrecting(false)}
              />
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}

/**
 * A figure as this receipt left it, with what it was before in small print beneath. A dash when the
 * receipt predates the record of it: shown as unknown, never reconstructed.
 */
function AfterFigure(props: {
  after: number | string | null;
  before: number | string | null;
}): JSX.Element {
  return (
    <Show when={null !== props.after} fallback={<span class="text-slate-300">—</span>}>
      <div>{props.after}</div>
      <Show when={null !== props.before}>
        <div class="text-xs text-text-muted">
          {sprintf(
            /* translators: %s is the figure before the receipt, e.g. 12 or 4.50. */
            __('from %s'),
            String(props.before),
          )}
        </div>
      </Show>
    </Show>
  );
}

/** A line's figure as it stands, with what was posted beneath when a correction changed it. */
function NowFigure(props: { now: number; posted: number }): JSX.Element {
  return (
    <>
      <div>{props.now}</div>
      <Show when={props.now !== props.posted}>
        <div class="text-xs text-text-muted">
          {sprintf(
            /* translators: %d is the quantity the receipt was posted with. */
            __('posted %d'),
            props.posted,
          )}
        </div>
      </Show>
    </>
  );
}

/** One correction: when, by whom, why, and what it changed per line. */
function CorrectionEntry(props: {
  correction: ReceiptCorrection;
  receipt: ReceiptDetail;
  /** Unit costs as stated, in the receipt's line currency. */
  lineMoney: (v: string | null) => string;
  /** Worked-out figures — averages, the variance — in the store's currency. */
  derived: (v: string | null) => string;
}): JSX.Element {
  const name = (subjectId: number): string =>
    props.receipt.lines.find((l) => l.subjectId === subjectId)?.name ?? `#${subjectId}`;
  const when = (): string =>
    formatDateTime(props.correction.correctedAt, '—', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <li class="rounded border border-border bg-surface px-3 py-2 text-sm">
      <div class="text-text-muted">
        {null === props.correction.correctedBy
          ? when()
          : sprintf(
              /* translators: 1: when the correction was recorded; 2: who recorded it. */
              __('%1$s by %2$s'),
              when(),
              props.correction.correctedBy,
            )}
      </div>
      <Show when={props.correction.note}>
        {(n) => <div class="mt-0.5 whitespace-pre-line">{n()}</div>}
      </Show>
      <ul class="mt-1 space-y-0.5">
        <For each={props.correction.lines}>
          {(l) => (
            <li>
              <span class="font-medium">{name(l.subjectId)}</span>
              <span class="text-text-muted"> · </span>
              {changesText(l, props.lineMoney, props.derived)}
            </li>
          )}
        </For>
      </ul>
      <Show when={props.correction.variance}>
        {(v) => (
          <div class="mt-1 text-xs text-amber-700">
            {sprintf(
              /* translators: %s is an amount of money. */
              __('Cost variance recorded: %s, value the remaining stock could not carry.'),
              props.derived(v()),
            )}
          </div>
        )}
      </Show>
    </li>
  );
}

function changesText(
  l: ReceiptCorrection['lines'][number],
  lineMoney: (v: string | null) => string,
  derived: (v: string | null) => string,
): string {
  const parts: string[] = [];
  if (l.qtyBefore !== l.qtyAfter)
    /* translators: 1: good units before; 2: good units after. */
    parts.push(sprintf(__('good %1$d → %2$d'), l.qtyBefore, l.qtyAfter));
  if (l.damagedBefore !== l.damagedAfter)
    /* translators: 1: damaged units before; 2: damaged units after. */
    parts.push(sprintf(__('damaged %1$d → %2$d'), l.damagedBefore, l.damagedAfter));
  if (null !== l.unitCostBefore && l.unitCostBefore !== l.unitCostAfter)
    /* translators: 1: unit cost before; 2: unit cost after. */
    parts.push(
      sprintf(__('unit cost %1$s → %2$s'), lineMoney(l.unitCostBefore), lineMoney(l.unitCostAfter)),
    );
  if (null !== l.costBefore && null !== l.costAfter && l.costBefore !== l.costAfter)
    /* translators: 1: the product's average cost before the correction; 2: after it. */
    parts.push(
      sprintf(__('average cost %1$s → %2$s'), derived(l.costBefore), derived(l.costAfter)),
    );
  return parts.join(', ');
}
