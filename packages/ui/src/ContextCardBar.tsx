import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { ContextCard } from './ContextCard';

/**
 * One card's worth of data for a {@link ContextCardBar}. Hosts
 * (`<OrderContextBar>`, future `<PoContextBar>`, …) build a
 * descriptor list and the bar handles open-state + outside-click
 * + Esc + responsive layout uniformly.
 */
export interface ContextCardDescriptor<SlotCtx = Record<string, unknown>> {
  /** Stable id within the bar — also used for the slot key suffix. */
  id: string;
  label: string;
  summary: () => JSX.Element;
  detail: () => JSX.Element;
  slotKey?: string;
  slotContext?: SlotCtx;
  /** Hide the card entirely when false. Default: shown. */
  enabled?: () => boolean;
}

export interface ContextCardBarProps<SlotCtx = Record<string, unknown>> {
  /** Reactive accessor — bar re-renders when cards change. */
  cards: () => ContextCardDescriptor<SlotCtx>[];
}

/**
 * Horizontal row of {@link ContextCard}s (stacked on narrow
 * viewports). Single-open behaviour: opening card B closes A.
 * Click-outside the bar and Escape both close the current card.
 *
 * The bar is SPA-agnostic and lives in `@invflux/ui`; consumers
 * are the dispatch order header today and the procurement PO
 * header in the future ( —
 * cards land under `<entity>.detail.card.<id>.detail` slots).
 */
export function ContextCardBar<SlotCtx>(props: ContextCardBarProps<SlotCtx>): JSX.Element {
  let rootRef!: HTMLDivElement;
  const [openId, setOpenId] = createSignal<string | null>(null);

  onMount(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (!e.composedPath().includes(rootRef)) {
        setOpenId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && openId() !== null) {
        setOpenId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <div
      ref={rootRef}
      class="px-4 py-3 border-b border-gray-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2"
    >
      <For each={props.cards()}>
        {(card) => (
          <Show when={card.enabled?.() ?? true}>
            <ContextCard
              label={card.label}
              summary={card.summary}
              detail={card.detail}
              open={openId() === card.id}
              onToggle={() => setOpenId(openId() === card.id ? null : card.id)}
              slotKey={card.slotKey}
              slotContext={card.slotContext}
            />
          </Show>
        )}
      </For>
    </div>
  );
}
