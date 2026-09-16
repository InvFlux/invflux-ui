import { For, Show, type JSX } from 'solid-js';
import { slotRegistry, type SlotContribution } from './slots';
import { cx, menuItemClass } from './primitives';

/**
 * Generic context card — the **trigger** half of a disclosure: a label, a one-line summary, and a
 * chevron. The detail it discloses is rendered by {@link ContextCardPanel}, which its host floats
 * over the page rather than nesting here.
 *
 * **Why the detail is not inside the card.** These cards live in a `<ContextCardBar>` grid row, and
 * a grid row equalises its cells' heights: expanding one card in flow stretched its three siblings
 * to match, so opening "Payment" drew three tall empty boxes beside it. The content that most
 * needed the room had the least of it, too — the Addresses card holds two postal addresses side by
 * side inside a quarter-page column. Floating the panel fixes both at once: the row keeps the
 * height of its headers, and the panel is free to be wider than the card that opened it.
 *
 * Reusable across SPAs by design: dispatch's order header consumes this for the customer /
 * addresses / payment / timeline cards, procurement will consume it for the supplier /
 * address / payment-terms cards on the PO header. The host owns the slot-key namespace
 * (`order.detail.card.customer.detail`, `po.detail.card.supplier.detail`, …) and supplies the
 * collapsed summary / expanded detail render functions.
 *
 * Open/close is driven entirely by the host — typically a `<ContextCardBar>` orchestrates
 * single-open behaviour across a row of cards.
 */
export interface ContextCardProps {
  /** Header label shown at all times. */
  label: string;
  /** Collapsed summary — one short line. Receives no props. */
  summary: () => JSX.Element;
  /**
   * Controls the card offers directly in its header — "Record payment", "Settle", and the like.
   *
   * **Rendered beside the trigger, never inside it**, which is the whole reason this is a slot
   * rather than something the host puts in `summary`. Two problems come from putting a control in
   * the summary, and this fixes both:
   *
   * 1. The summary is the content of a `<button>`, so a control there is a button inside a button —
   *    invalid markup whose inner click the outer one swallows unless every handler remembers to
   *    stop propagation.
   * 2. The summary truncates, because a long gateway name has to give way rather than push the card
   *    wider. Anything after it in that line is what the clipping eats first, so the control
   *    disappeared at exactly the width where the whole bar still fit on one row — visible enough to
   *    look present, unreachable in fact.
   *
   * Out here it never shrinks and never clips: the summary yields, the action stays.
   */
  actions?: () => JSX.Element;
  /** Currently expanded. The host orchestrates single-open. */
  open: boolean;
  /** Toggle handler — host writes its open-state signal. */
  onToggle: () => void;
  /**
   * Id of the floating panel this card currently controls. Only meaningful while `open`, because
   * the panel exists only then — an `aria-controls` pointing at an element that is not in the
   * document is worse than none.
   */
  panelId?: string;
}

export function ContextCard(props: ContextCardProps): JSX.Element {
  return (
    <div
      class={cx(
        'flex items-center rounded border bg-surface',
        // The open card is the panel's anchor, and the panel floats clear of it — so the card has
        // to say which one it belongs to on its own.
        props.open ? 'border-primary/40 shadow-md' : 'border-border shadow-sm',
      )}
    >
      <button
        type="button"
        class={menuItemClass(false, false, 'min-w-0 flex-1 justify-between gap-3 py-2')}
        aria-expanded={props.open}
        aria-controls={props.open ? props.panelId : undefined}
        onClick={() => props.onToggle()}
      >
        {/* Label and summary share ONE line — `CUSTOMER: Pat Walker <pat@example.com>`. Stacked,
            a card spent two lines saying what fits on one, and four of them across the top of a
            page is a band of chrome before any of the order shows. `items-baseline` so the tiny
            uppercase eyebrow sits on the same footing as the value rather than floating above it.

            The label never shrinks and the summary always can: a truncated value is still the
            value, whereas a truncated label leaves a card that no longer says what it is. */}
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <span class="shrink-0 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {props.label}
          </span>
          <div class="min-w-0 flex-1 truncate text-sm text-gray-800">{props.summary()}</div>
        </div>
        <span
          class="text-text-muted text-xs transition-transform"
          classList={{ 'rotate-180': props.open }}
        >
          ▾
        </span>
      </button>
      <Show when={props.actions}>
        {(actions) => <span class="flex shrink-0 items-center gap-1.5 pr-2">{actions()()}</span>}
      </Show>
    </div>
  );
}

export interface ContextCardPanelProps<SlotCtx = Record<string, unknown>> {
  /** Expanded body. Called only while the panel is mounted, so heavy detail stays off the cold path. */
  detail: () => JSX.Element;
  /**
   * Slot key (`<entity>.detail.card.<id>.detail`) — when set, the registered contributions render
   * after the host's body. Optional: cards without a meaningful extension point omit the key.
   */
  slotKey?: string;
  /**
   * Context props forwarded to slot contributions. The slot key's documented shape determines the
   * type — generic here so the primitive stays surface-agnostic. The host wrapper (e.g. dispatch's
   * `<OrderContextBar>`) is the right place to enforce a specific shape via its own typed wrapper.
   */
  slotContext?: SlotCtx;
}

/** The disclosed half of a {@link ContextCard} — its body plus whatever add-ons contribute to it. */
export function ContextCardPanel<SlotCtx>(props: ContextCardPanelProps<SlotCtx>): JSX.Element {
  return (
    <>
      {props.detail()}
      <Show when={props.slotKey}>
        {(key) => (
          <For each={slotRegistry.get<SlotCtx>(key())}>
            {(slot: SlotContribution<SlotCtx>) => (
              <Show when={slot.enabled?.() ?? true}>
                {/*
                  Call the contribution as a plain function rather than going through
                  <Dynamic ... {...spread}>. The spread-typing on Dynamic is too narrow for a
                  generic SlotCtx (TS resolves it to `unknown`), and the direct call is the same
                  Solid render contract anyway — each contribution's reactive reads track normally.
                */}
                {slot.component((props.slotContext ?? {}) as SlotCtx)}
              </Show>
            )}
          </For>
        )}
      </Show>
    </>
  );
}
