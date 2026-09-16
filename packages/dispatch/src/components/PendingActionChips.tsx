import { __, _n, sprintf, _x } from '@invflux/i18n';
import { HourglassIcon, Pill } from '@invflux/ui';
import { For, Show, type JSX } from 'solid-js';
import type { DispatchOrderSummary } from '../types';
import { pendingActionsOf } from '../workingSet';

/**
 * What this order is waiting on a **person** to do, as chips for the queue's sparse-signal column.
 *
 * The set comes from {@link pendingActionsOf} — the same predicates the `pending_action` filter and
 * its facet counts run — so a row's chips and the filter that would select it can never disagree.
 * Only the wording is local: a filter option names a *bucket of orders* ("Corrections to process"),
 * while a cell names *this order's* outstanding quantity, and the two want different phrases.
 *
 * Amber with an hourglass, matching the order detail's pending-correction pill: this is the SPA's
 * "a person still owes an action" treatment, and a queue chip that meant the same thing in another
 * colour would make the operator learn it twice. The glyph is not decoration for its own sake —
 * amber against the neighbouring tag pills is exactly the pair a colour-blind operator cannot
 * separate, so the tooltip and the icon carry what the tone alone would.
 */
export function PendingActionChips(props: {
  order: DispatchOrderSummary;
  /** Gateway ids that cannot capture through the API — `payment_entry` is defined against them. */
  manualGateways: readonly string[];
}): JSX.Element {
  const chips = (): PendingActionChip[] =>
    pendingActionsOf(props.order, props.manualGateways).flatMap((action) =>
      describe(action, props.order),
    );

  // The wrapper lives inside the `Show` rather than around it: the cell stacks its rows with a
  // `gap`, so an always-rendered empty row would spend that gap on every ordinary order — which is
  // the majority of them, and the column exists precisely to look empty when nothing is wrong.
  return (
    <Show when={chips().length > 0}>
      <div class="flex flex-wrap items-center gap-1">
        <For each={chips()}>
          {(chip) => (
            /* Default size and `rounded` rather than the tags' lozenge: the same metrics as the
               order detail's pill, and a shape that tells an action from an identity at a glance. */
            <Pill tone="warning" class="tabular-nums" title={chip.title}>
              {chip.text}
              <HourglassIcon class="h-3 w-3 shrink-0" />
            </Pill>
          )}
        </For>
      </div>
    </Show>
  );
}

interface PendingActionChip {
  text: string;
  title: string;
}

/**
 * One action's cell wording, or nothing.
 *
 * Returns a list rather than a value so an action this build has no phrasing for simply renders
 * nothing — `pendingActionsOf` narrows to the three the base install registers, and an add-on's
 * action reaching here would otherwise show as a chip labelled with its raw id.
 */
function describe(action: string, order: DispatchOrderSummary): PendingActionChip[] {
  switch (action) {
    case 'manual_refund': {
      const n = order.pendingManualRefunds;

      return [
        {
          text: sprintf(_n('%d refund', '%d refunds', n), n),
          title: sprintf(
            _n(
              '%d manual refund to pay out, not yet settled',
              '%d manual refunds to pay out, not yet settled',
              n,
            ),
            n,
          ),
        },
      ];
    }
    case 'corrections': {
      const n = order.unprocessedCorrections;

      return [
        {
          // The same wording the order detail gives its pending-correction pill, deliberately: an
          // operator who opens the order from this row should find the number they came for under
          // the phrase they clicked.
          text: sprintf(_n('%d corrected', '%d corrected', n), n),
          title: sprintf(
            _n('%d corrected unit, not yet processed', '%d corrected units, not yet processed', n),
            n,
          ),
        },
      ];
    }
    case 'payment_entry':
      // No count: an order is waiting for its payment to be recorded or it is not, and a "1" here
      // would read as one of several payments rather than the single offline one.
      return [
        {
          text: _x('Payment', 'pending-action chip: an offline payment is still to be recorded'),
          title: __('Offline payment not yet recorded'),
        },
      ];
    default:
      return [];
  }
}
