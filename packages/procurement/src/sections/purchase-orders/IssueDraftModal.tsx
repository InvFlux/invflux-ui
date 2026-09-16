import { __, _n, sprintf } from '@invflux/i18n';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from '@invflux/ui';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { belowMoq, nextValidQty, offCasePack } from '../../grid/qtyRules';
import { effectiveCost, type PruneReason, pruneReason, submittableLines } from './submissionRules';
import type { PoLine } from './types';

/** A line the server would drop when the order is issued (no quantity, or no price even after inheriting). */
interface RemovedLine {
  line: PoLine;
  reason: PruneReason;
}

export interface IssueDraftModalProps {
  lines: PoLine[];
  /** Catalogue MOQ / case-pack lookups (the supplier-order rules the qty is validated against). */
  moqFor: (subjectId: number) => number | null;
  casePackFor: (subjectId: number) => number | null;
  costDecimals: number;
  currency: string;
  supplierLabel: string;
  /** Stage qty fixes (parallel PATCH + invalidate). The modal stays open and recomputes from the reload. */
  onFixQtys: (patches: Array<{ id: number; qty: number }>) => void;
  /** A fix round-trip is in flight — disables the Fix buttons + the confirm while it settles. */
  fixing: boolean;
  issuing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The pre-flight review for turning a draft into a real purchase-order document — shown when the
 * operator assigns its number. This is the last look before the order acquires a permanent reference
 * the supplier will quote back, so it (a) states what's being ordered (SKU count / total qty / total
 * value over the lines that will survive), (b) flags MOQ / case-pack quantity issues with a one-click
 * [Fix all quantities] that rounds each to the next valid value, and (c) lists the lines the server
 * will drop (no quantity / no price) — offering to rescue the zero-qty ones that carry a replenishment
 * suggestion. Both fixers stage as normal qty edits, so the operator still reviews the recomputed
 * figures before confirming. The server re-checks all of it, so this modal is the primary surface,
 * not the only guard.
 */
export function IssueDraftModal(props: IssueDraftModalProps): JSX.Element {
  // Lines the server will drop, with the reason it would report.
  const removed = createMemo<RemovedLine[]>(() =>
    props.lines.flatMap((line): RemovedLine[] => {
      const reason = pruneReason(line);
      return null === reason ? [] : [{ line, reason }];
    }),
  );
  // Kept lines = what actually goes on the order. Stats are computed over these (the honest figures).
  const kept = createMemo<PoLine[]>(() => submittableLines(props.lines));

  const totalQty = createMemo(() => kept().reduce((s, l) => s + l.qtyRequested, 0));
  const totalValue = createMemo(() =>
    kept().reduce((s, l) => s + l.qtyRequested * (effectiveCost(l) ?? 0), 0),
  );

  // MOQ / case-pack violations among the KEPT lines (a removed 0-qty line is not "below MOQ").
  const belowMoqLines = createMemo(() =>
    kept().filter((l) => belowMoq(l.qtyRequested, props.moqFor(l.subjectId))),
  );
  const offPackLines = createMemo(() =>
    kept().filter((l) => offCasePack(l.qtyRequested, props.casePackFor(l.subjectId))),
  );
  const invalidQtyLines = createMemo(() =>
    kept().filter(
      (l) =>
        belowMoq(l.qtyRequested, props.moqFor(l.subjectId)) ||
        offCasePack(l.qtyRequested, props.casePackFor(l.subjectId)),
    ),
  );

  // Zero-qty removed lines that carry a usable replenishment suggestion — rescuable by [Set suggested].
  const fixableZeroQty = createMemo(() =>
    removed()
      .filter(
        (r) => 'zero_qty' === r.reason && null !== r.line.suggestedQty && r.line.suggestedQty > 0,
      )
      .map((r) => r.line),
  );

  const fixAllQty = (): void =>
    props.onFixQtys(
      invalidQtyLines().map((l) => ({
        id: l.id,
        qty: nextValidQty(
          l.qtyRequested,
          props.moqFor(l.subjectId),
          props.casePackFor(l.subjectId),
        ),
      })),
    );
  const fixZeroQty = (): void =>
    props.onFixQtys(fixableZeroQty().map((l) => ({ id: l.id, qty: l.suggestedQty as number })));

  const money = (v: number): string => `${v.toFixed(props.costDecimals)} ${props.currency}`;
  const reasonLabel = (reason: RemovedLine['reason']): string =>
    'zero_qty' === reason ? __('no quantity') : __('no price');

  const confirmLabel = (): string =>
    removed().length > 0
      ? sprintf(
          _n('Remove %d & download', 'Remove %d & download', removed().length),
          removed().length,
        )
      : __('Assign number & download');

  const linkBtn =
    'rounded border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50';

  return (
    <Modal
      onClose={props.onCancel}
      closeOnBackdrop={false}
      label={__('Assign a purchase order number')}
    >
      <ModalPanel size="lg">
        <ModalHeader title={__('Assign a number and download?')} />

        <div class="space-y-3 p-4 text-sm text-text">
          <p class="">
            {sprintf(
              __('This order gets its purchase order number, ready to send to %s.'),
              props.supplierLabel,
            )}{' '}
            {__(
              'The number is permanent, so your copy and theirs always match. You can still edit the lines until you mark it as sent.',
            )}
          </p>

          {/* Stats — what actually goes on the order (the surviving lines). */}
          <div class="flex flex-wrap gap-x-6 gap-y-1 rounded border border-border bg-surface-raised px-3 py-2 tabular-nums">
            <span>
              <span class="font-semibold">{kept().length}</span>{' '}
              <span class="text-text-muted">{_n('SKU', 'SKUs', kept().length)}</span>
            </span>
            <span>
              <span class="text-text-muted">{__('Total qty')}:</span>{' '}
              <span class="font-semibold">{totalQty()}</span>
            </span>
            <span>
              <span class="text-text-muted">{__('Total value')}:</span>{' '}
              <span class="font-semibold">{money(totalValue())}</span>
            </span>
          </div>

          {/* MOQ / case-pack quantity warnings (kept lines) + one-click fix to the next valid value. */}
          <Show when={invalidQtyLines().length > 0}>
            <div class="space-y-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
              <Show when={belowMoqLines().length > 0}>
                <p>
                  ⚠️{' '}
                  {sprintf(
                    _n(
                      '%d SKU has a quantity below its minimum order quantity.',
                      '%d SKUs have a quantity below their minimum order quantity.',
                      belowMoqLines().length,
                    ),
                    belowMoqLines().length,
                  )}
                </p>
              </Show>
              <Show when={offPackLines().length > 0}>
                <p>
                  ⚠️{' '}
                  {sprintf(
                    _n(
                      '%d SKU has a quantity that is not a whole case pack.',
                      '%d SKUs have a quantity that is not a whole case pack.',
                      offPackLines().length,
                    ),
                    offPackLines().length,
                  )}
                </p>
              </Show>
              <button type="button" class={linkBtn} disabled={props.fixing} onClick={fixAllQty}>
                {__('Fix all quantities')}
              </button>
            </div>
          </Show>

          {/* Lines the server will drop when the order is issued (no quantity / no price). */}
          <Show when={removed().length > 0}>
            <div class="space-y-1.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <p>
                {sprintf(
                  _n(
                    '%d line will be removed from the order:',
                    '%d lines will be removed from the order:',
                    removed().length,
                  ),
                  removed().length,
                )}
              </p>
              <ul class="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
                <For each={removed()}>
                  {(r) => (
                    <li>
                      {r.line.productLabel || `#${r.line.id}`}{' '}
                      <span class="text-red-400">— {reasonLabel(r.reason)}</span>
                    </li>
                  )}
                </For>
              </ul>
              {/* Rescue the zero-qty lines that carry a replenishment suggestion (own [Fix], only when ≥1 is fixable). */}
              <Show when={fixableZeroQty().length > 0}>
                <div class="flex items-center gap-2 pt-0.5">
                  <span>
                    ⚠️{' '}
                    {sprintf(
                      _n(
                        '%d has a suggested quantity.',
                        '%d have a suggested quantity.',
                        fixableZeroQty().length,
                      ),
                      fixableZeroQty().length,
                    )}
                  </span>
                  <button
                    type="button"
                    class={linkBtn}
                    disabled={props.fixing}
                    onClick={fixZeroQty}
                  >
                    {__('Set suggested quantities')}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <ModalFooter>
          <button
            type="button"
            class="rounded border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text shadow-sm hover:bg-gray-100"
            onClick={props.onCancel}
          >
            {__('Cancel')}
          </button>
          <button
            type="button"
            class="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
            disabled={props.issuing || props.fixing || 0 === kept().length}
            onClick={props.onConfirm}
          >
            {confirmLabel()}
          </button>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
