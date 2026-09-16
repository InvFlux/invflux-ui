import { For, Show, createMemo, createSignal } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, FoldingSection } from '@invflux/ui';
import { useDispatch } from '../context';
import { useDeleteCorrectionMutation, useOrderCorrectionsQuery } from '../queries';
import type { DispatchCorrection, DispatchOrderLine, DispatchOrderSummary } from '../types';
import { ProcessCorrectionsModal } from './ProcessCorrectionsModal';

/**
 * Essentials-tier corrections panel rendered below the line table per F25 (see
 * ). Lists current corrections with a delete
 * affordance for own + unprocessed rows.
 *
 * Creation is delegated to the parent via `onOpenCorrection`: the modal
 * is owned by `OrderDetail` so it can also be launched from the per-line
 * `!` affordance and the global `C` shortcut. The panel's "+ Add
 * correction" button passes `null` (no preset line); per-line entries
 * pass a specific `lineId`.
 */
export function CorrectionsPanel(props: {
  orderHexId: string;
  order: DispatchOrderSummary;
  lines: DispatchOrderLine[];
  onOpenCorrection: (lineId: string | null) => void;
}) {
  const ctx = useDispatch();
  const correctionsQuery = useOrderCorrectionsQuery(() => props.orderHexId);
  const deleteMutation = useDeleteCorrectionMutation(() => props.orderHexId);
  const [processModalOpen, setProcessModalOpen] = createSignal(false);
  // Collapse state. Default open when there's anything to show or
  // the panel is loading; collapsed otherwise so an empty section
  // doesn't visually compete with the line table or ShipBar.
  const [expanded, setExpanded] = createSignal(true);

  const linesById = createMemo(() => {
    const map = new Map<string, DispatchOrderLine>();
    for (const line of props.lines) map.set(line.id, line);
    return map;
  });

  const corrections = createMemo<DispatchCorrection[]>(
    () => correctionsQuery.data?.corrections ?? [],
  );

  function canDelete(c: DispatchCorrection): boolean {
    // Withdrawing rides with raising: same capability, own rows only, unprocessed only.
    return (
      ctx.capabilities.createCorrections &&
      c.createdBy === ctx.currentUser.id &&
      c.processedAt === null
    );
  }

  const pendingCount = createMemo(() => corrections().filter((c) => c.processedAt === null).length);

  return (
    <>
      <FoldingSection
        testId="corrections-panel"
        // "Corrections (2)" — the count in parentheses after the noun, as every fold heading on
        // this page states its size. Zero drops the parenthesis; the body already says the section
        // is empty, and "(0)" makes an absence look like a measurement.
        title={
          corrections().length > 0
            ? sprintf(__('Corrections (%d)'), corrections().length)
            : __('Corrections')
        }
        // The heading carries the state the count already states, so an operator scanning a
        // collapsed page sees which section is holding work without reading any of them. Derived,
        // so it goes away the moment the last correction is processed.
        tone={pendingCount() > 0 ? 'warning' : 'default'}
        // Only what the count cannot say. How many there are is now in the title; how many still
        // owe someone an action is a different fact, and the one that earns the amber heading.
        aside={
          <Show when={pendingCount() > 0}>
            <span
              class="text-amber-700"
              data-testid="corrections-pending"
              data-pending-count={pendingCount()}
            >
              {sprintf(_n('%d pending', '%d pending', pendingCount()), pendingCount())}
            </span>
          </Show>
        }
        actions={
          <>
            {/* Processing issues the refund, so it needs the CS capability, not the floor-ops one. */}
            <Show when={pendingCount() > 0 && ctx.capabilities.processCorrections}>
              {/* `primary`, not `success`. Emerald is the house "this completed a workflow", and
                  this button completes nothing — the trailing ellipsis is the honest part: it opens
                  the review modal, whose OWN confirm is the emerald one. Wearing it here spends the
                  completion colour twice on one workflow, and the first spend is a promise the
                  click does not keep.

                  Primary is what it actually is: the dominant action on this surface, and the
                  thing standing between the order and shipping. That it shares a colour with
                  "Ship order" is the point rather than a collision — ship is disabled while a
                  correction is pending, so exactly one blue is live at a time and it is always
                  the next real step. */}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setProcessModalOpen(true)}
                title={__('Review refund handling, then process all pending corrections.')}
              >
                {sprintf(
                  _n('Process %d correction…', 'Process %d corrections…', pendingCount()),
                  pendingCount(),
                )}
              </Button>
            </Show>
            <Show when={ctx.capabilities.createCorrections}>
              <Button variant="secondary" size="sm" onClick={() => props.onOpenCorrection(null)}>
                {__('+ Add correction')}
              </Button>
            </Show>
          </>
        }
        open={expanded()}
        onOpenChange={setExpanded}
        // Rows, empty states and the table carry their own padding.
        bodyClass=""
      >
        <Show when={correctionsQuery.isLoading}>
          <div class="px-4 py-3 text-xs text-text-muted">{__('Loading corrections…')}</div>
        </Show>

        <Show when={!correctionsQuery.isLoading && corrections().length === 0}>
          <div class="px-4 py-3 text-xs text-text-muted">{__('No corrections on this order.')}</div>
        </Show>

        <Show when={corrections().length > 0}>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50">
                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('Line', 'corrections table column')}
                </th>
                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('Type', 'corrections table column')}
                </th>
                <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('Qty', 'corrections table column')}
                </th>
                <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('Refund', 'corrections table column')}
                </th>
                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('State', 'corrections table column')}
                </th>
                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {_x('Note', 'corrections table column')}
                </th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <For each={corrections()}>
                {(c) => {
                  const line = linesById().get(c.lineId);
                  const lineLabel = line
                    ? line.name
                    : sprintf(__('Line %s…'), c.lineId.slice(0, 8));
                  // In the batch model, processing IS the refund confirmation
                  // (auto or attested) — there is no post-processing "refund
                  // pending" sub-state. A processed correction is simply Processed.
                  const stateLabel = c.processedAt
                    ? _x('Processed', 'correction state')
                    : _x('Pending', 'correction state');
                  const stateClass = c.processedAt
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-800';
                  const deletable = canDelete(c);
                  const isPending = deleteMutation.isPending && deleteMutation.variables === c.id;
                  return (
                    <tr>
                      <td class="px-3 py-2 truncate max-w-[16ch]">{lineLabel}</td>
                      <td class="px-3 py-2">
                        <span class="text-gray-800">{c.typeName}</span>
                      </td>
                      <td class="px-3 py-2 text-center tabular-nums">{c.qty}</td>
                      <td class="px-3 py-2 text-right tabular-nums">{c.refundAmount}</td>
                      <td class="px-3 py-2">
                        <span
                          class={`inline-flex items-center px-2 py-0.5 rounded text-xs ${stateClass}`}
                        >
                          {stateLabel}
                        </span>
                      </td>
                      <td class="px-3 py-2 text-xs text-gray-500 truncate max-w-[24ch]">
                        {c.note ?? '—'}
                      </td>
                      <td class="px-3 py-2 text-right">
                        <Show when={deletable}>
                          <Button
                            variant="secondary"
                            size="xs"
                            class="hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            disabled={isPending}
                            onClick={() => deleteMutation.mutate(c.id)}
                          >
                            {isPending ? '…' : __('Delete')}
                          </Button>
                        </Show>
                        {/* The legacy "Mark refund done" affordance was removed: in
                            the batch model, processing already confirms the refund
                            (via the CorrectionRefundConfirmed batch event), so the
                            per-correction attestation would emit a duplicate refund
                            record and double-count past refunds. */}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>

        <Show when={deleteMutation.isError}>
          <ErrorBanner as="div" class="px-4 py-2 bg-red-50 text-sm">
            {sprintf(__('Delete failed: %s'), deleteMutation.error?.message ?? __('Unknown error'))}
          </ErrorBanner>
        </Show>
      </FoldingSection>

      {/* Outside the section on purpose: the header action that opens this modal stays visible
          while the body is collapsed, so the modal must not unmount with it. */}
      <Show when={processModalOpen()}>
        <ProcessCorrectionsModal
          orderHexId={props.orderHexId}
          order={props.order}
          corrections={corrections()}
          lines={props.lines}
          onClose={() => setProcessModalOpen(false)}
        />
      </Show>
    </>
  );
}
