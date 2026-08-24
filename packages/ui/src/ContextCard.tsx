import { For, Show, type JSX } from 'solid-js';
import { slotRegistry, type SlotContribution } from './slots';
import { menuItemClass } from './primitives';

/**
 * Generic context card — header row (always visible) + animated
 * detail panel (rendered only when open) + optional plug-in slot
 * inside the detail panel.
 *
 * Reusable across SPAs by design: dispatch's order header consumes
 * this for the customer / shipping / payment / timestamps cards,
 * procurement will consume it for the supplier / address / payment-
 * terms cards on the PO header. The host owns the slot-key
 * namespace (`order.detail.card.customer.detail`,
 * `po.detail.card.supplier.detail`, …) and supplies the
 * collapsed summary / expanded detail render functions.
 *
 * Open/close is driven entirely by the host — typically a
 * `<ContextCardBar>` orchestrates single-open behaviour across a
 * row of cards.
 */
export interface ContextCardProps<SlotCtx = Record<string, unknown>> {
  /** Header label shown at all times. */
  label: string;
  /** Collapsed summary — one short line. Receives no props. */
  summary: () => JSX.Element;
  /**
   * Expanded body. Rendered only when `open` is true so heavy
   * detail panels stay out of the DOM until needed.
   */
  detail: () => JSX.Element;
  /** Currently expanded. The host orchestrates single-open. */
  open: boolean;
  /** Toggle handler — host writes its open-state signal. */
  onToggle: () => void;
  /**
   * Slot key (`<entity>.detail.card.<id>.detail`) — when set, the
   * registered contributions render inside the detail panel after
   * the host's body. Optional: cards without a meaningful
   * extension point omit the key.
   */
  slotKey?: string;
  /**
   * Context props forwarded to slot contributions. The slot key's
   * documented shape determines the type — `unknown` here so the
   * primitive stays surface-agnostic. The host wrapper (e.g.
   * dispatch's `<OrderContextBar>`) is the right place to enforce
   * a specific shape via its own typed wrapper.
   */
  slotContext?: SlotCtx;
}

export function ContextCard<SlotCtx>(props: ContextCardProps<SlotCtx>): JSX.Element {
  return (
    <div
      class={[
        'rounded border border-gray-200 bg-white',
        props.open ? 'shadow-md' : 'shadow-sm',
      ].join(' ')}
    >
      <button
        type="button"
        class={menuItemClass(false, false, 'justify-between gap-3 py-2')}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <div class="min-w-0 flex-1">
          <div class="text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {props.label}
          </div>
          <div class="text-sm text-gray-800 truncate">{props.summary()}</div>
        </div>
        <span
          class="text-text-muted text-xs transition-transform"
          classList={{ 'rotate-180': props.open }}
        >
          ▾
        </span>
      </button>
      <Show when={props.open}>
        <div class="border-t border-gray-100 px-3 py-3 text-sm text-gray-700 space-y-3">
          {props.detail()}
          <Show when={props.slotKey}>
            {(key) => (
              <For each={slotRegistry.get<SlotCtx>(key())}>
                {(slot: SlotContribution<SlotCtx>) => (
                  <Show when={slot.enabled?.() ?? true}>
                    {/*
                      Call the contribution as a plain function rather
                      than going through <Dynamic ... {...spread}>. The
                      spread-typing on Dynamic is too narrow for a
                      generic SlotCtx (TS resolves it to `unknown`),
                      and the direct call is the same Solid render
                      contract anyway — each contribution's reactive
                      reads track normally.
                    */}
                    {slot.component((props.slotContext ?? {}) as SlotCtx)}
                  </Show>
                )}
              </For>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

