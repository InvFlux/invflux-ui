import { __, _n, _x, formatDateTime, sprintf } from '@invflux/i18n';
import { Pill, useHostNav } from '@invflux/ui';
import { For, type JSX, Show } from 'solid-js';
import { CorrectedFigure } from './CorrectedFigure';
import type { PoReceipt } from './types';

/**
 * The receipts posted against this order, oldest first, each opening on the receipt's own page in
 * Receiving — the one place a receipt is read and corrected, whatever document it answers. The order
 * lists them; it does not repeat them.
 *
 * Read from the receipts themselves rather than from the order's timeline, so an order whose events
 * never recorded a receipt id still lists every delivery.
 */
/** The tooltip on a corrected good-units figure. */
export const receivedCorrected = (posted: number, current: number): string =>
  sprintf(
    /* translators: 1: units recorded when the receipt was posted, 2: units after correction. */
    _n('%1$d unit received, corrected to %2$d', '%1$d units received, corrected to %2$d', posted),
    posted,
    current,
  );

/** The tooltip on a corrected damaged-units figure. */
export const damagedCorrected = (posted: number, current: number): string =>
  sprintf(
    /* translators: 1: damaged units recorded when the receipt was posted, 2: after correction. */
    _n(
      '%1$d damaged unit recorded, corrected to %2$d',
      '%1$d damaged units recorded, corrected to %2$d',
      posted,
    ),
    posted,
    current,
  );

export function PoReceiptsList(props: { receipts: PoReceipt[] }): JSX.Element {
  const hostNav = useHostNav();
  const when = (iso: string | null): string => {
    if (null === iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : formatDateTime(d);
  };

  return (
    <table class="mt-2 w-full text-sm" data-testid="po-receipts">
      <thead>
        <tr class="text-left text-xs text-text-muted">
          <th class="pb-1 pr-4 font-normal">
            {_x('Receipt', 'column heading: the goods receipt')}
          </th>
          <th class="pb-1 pr-4 font-normal">
            {_x('Received on', 'column heading: when a goods receipt was posted')}
          </th>
          <th class="pb-1 pr-4 font-normal">
            {_x('By', 'column heading: who posted a goods receipt')}
          </th>
          <th class="pb-1 pr-4 text-right font-normal">{__('Quantity')}</th>
          <th class="pb-1 text-right font-normal">{__('Status')}</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.receipts}>
          {(r) => (
            <tr class="border-b border-border/60 last:border-b-0">
              <td class="py-1.5 pr-4 whitespace-nowrap">
                <a
                  class="text-primary hover:underline"
                  href={hostNav.routeHref(`/receiving/receipts/${r.id}`)}
                  target={hostNav.opensNewTab ? '_blank' : undefined}
                  rel={hostNav.opensNewTab ? 'noopener' : undefined}
                  data-testid="po-receipt-link"
                >
                  {sprintf(
                    /* translators: %d is a goods receipt's internal id. */
                    __('Receipt #%d'),
                    r.id,
                  )}
                </a>
              </td>
              <td class="py-1.5 pr-4 whitespace-nowrap text-text-muted">{when(r.receivedAt)}</td>
              <td class="py-1.5 pr-4 text-text-muted">{r.receivedBy ?? ''}</td>
              <td class="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                <CorrectedFigure
                  posted={r.qty}
                  current={r.correctedQty}
                  format={(n) =>
                    sprintf(
                      /* translators: %d is a number of units received in good condition. */
                      _n('%d unit', '%d units', n),
                      n,
                    )
                  }
                  title={receivedCorrected}
                  testId="po-receipt-qty-corrected"
                />
                <Show when={r.damagedQty > 0 || (r.correctedDamagedQty ?? 0) > 0}>
                  <span class="text-text-muted">
                    {' · '}
                    <CorrectedFigure
                      posted={r.damagedQty}
                      current={r.correctedDamagedQty}
                      format={(n) =>
                        sprintf(
                          /* translators: %d is a number of units that arrived damaged. */
                          _n('%d damaged', '%d damaged', n),
                          n,
                        )
                      }
                      title={damagedCorrected}
                    />
                  </span>
                </Show>
              </td>
              <td class="py-1.5 text-right">
                <Show when={'posted' !== r.state}>
                  <Pill
                    tone={'reversed' === r.state ? 'neutral' : 'info'}
                    title={
                      'reversed' === r.state
                        ? __('Every quantity was corrected to zero. The receipt stays on file.')
                        : __(
                            'Figures were corrected after posting. The receipt lists the corrections.',
                          )
                    }
                    data-testid="po-receipt-state"
                  >
                    {'reversed' === r.state
                      ? _x('Reversed', 'goods receipt status: every quantity corrected to zero')
                      : _x('Corrected', 'goods receipt status: figures corrected after posting')}
                  </Pill>
                </Show>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
