import {
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from 'solid-js';
import { ContextCard, ContextCardPanel } from './ContextCard';

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
  /** Header controls, rendered beside the trigger rather than inside it — see `ContextCardProps`. */
  actions?: () => JSX.Element;
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
 * Gap between a card and the panel it opens, in px.
 *
 * Deliberately smaller than the row's own `gap-2`. That gap separates four peers; this one joins a
 * panel to the one card it belongs to, and at the same size the panel read as another item in the
 * row rather than as that card's disclosure.
 */
const PANEL_GAP = 4;
/**
 * Floor for the panel's width, in px. A card is a quarter of the page at `lg`, and the detail
 * behind it is routinely a two-column definition list or a pair of postal addresses; sized to its
 * trigger, the panel would re-create the squeeze that made the in-flow version unreadable. The
 * ceiling is the row's own width, so this only ever widens a panel, never overflows one.
 */
const MIN_PANEL_WIDTH = 320;

/** Where the floating panel sits, in the bar's own coordinates. */
interface PanelFrame {
  top: number;
  left: number;
  minWidth: number;
  maxWidth: number;
}

const SAME_FRAME = (a: PanelFrame, b: PanelFrame): boolean =>
  a.top === b.top && a.left === b.left && a.minWidth === b.minWidth && a.maxWidth === b.maxWidth;

/**
 * Horizontal row of {@link ContextCard}s (stacked on narrow
 * viewports). Single-open behaviour: opening card B closes A.
 * Click-outside the bar and Escape both close the current card.
 *
 * **The open card's detail floats, it does not expand in place.** Two problems shared one cause —
 * a grid row equalises its cells, so an in-flow panel stretched every sibling into a tall blank
 * box, and it could never be wider than the quarter-page column that opened it, which is where its
 * content was already being clipped. One absolutely-positioned panel, anchored under whichever
 * card is open, answers both: the row keeps the height of its headers, and the panel takes the
 * width its content asks for up to the full row. It also scrolls, so a viewport too short for the
 * detail no longer truncates it with no way to reach the rest.
 *
 * Anchored to the **card**, not to the row: at `grid-cols-1` and `md:grid-cols-2` the cards sit on
 * several rows, and a panel pinned below the whole grid would open a screen away from its trigger.
 *
 * The bar is SPA-agnostic and lives in `@invflux/ui`; consumers
 * are the dispatch order header today and the procurement PO
 * header in the future ( —
 * cards land under `<entity>.detail.card.<id>.detail` slots).
 */
export function ContextCardBar<SlotCtx>(props: ContextCardBarProps<SlotCtx>): JSX.Element {
  let rootRef!: HTMLDivElement;
  let gridRef!: HTMLDivElement;
  let panelRef: HTMLDivElement | undefined;
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [frame, setFrame] = createSignal<PanelFrame>({
    top: 0,
    left: 0,
    minWidth: 0,
    maxWidth: 0,
  });
  const panelId = createUniqueId();

  const openCard = (): ContextCardDescriptor<SlotCtx> | undefined =>
    props.cards().find((card) => card.id === openId());

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

  /**
   * Place the panel under its card, clamped to the band the cards themselves occupy.
   *
   * The bounds are read off the cards rather than off the grid, and neither from a copy of its
   * `px-4`: a duplicated gutter constant goes quietly wrong the day someone changes the class, and
   * the grid's own box *includes* that gutter — clamping to it let the panel hang 16px past the
   * cards on both sides, which read as a panel belonging to nothing. Leftmost and rightmost card
   * edges are the right answer at every breakpoint, including the stacked one where "the row" is
   * four rows. Measured rather than expressed in CSS because the anchor is one of four elements
   * chosen at runtime, and `anchor-name` is not available everywhere this ships.
   */
  const measure = (): void => {
    const id = untrack(openId);
    if (id === null) return;
    const cards = [...gridRef.querySelectorAll<HTMLElement>('[data-card-id]')];
    const card = cards.find((el) => el.dataset['cardId'] === id);
    if (card === undefined) return;

    const bandLeft = Math.min(...cards.map((el) => el.offsetLeft));
    const bandRight = Math.max(...cards.map((el) => el.offsetLeft + el.offsetWidth));
    const bandWidth = bandRight - bandLeft;
    // The panel is only measurable once it has rendered; before that its trigger's width is the
    // best available guess, and the effect below runs again as soon as there is a real one.
    const width = Math.min(panelRef?.offsetWidth ?? card.offsetWidth, bandWidth);
    const next: PanelFrame = {
      top: card.offsetTop + card.offsetHeight + PANEL_GAP,
      left: Math.max(bandLeft, Math.min(card.offsetLeft, bandRight - width)),
      minWidth: Math.min(Math.max(card.offsetWidth, MIN_PANEL_WIDTH), bandWidth),
      maxWidth: bandWidth,
    };

    // Bail on a no-op write: the panel's own ResizeObserver calls this, and a frame that changed
    // nothing would still notify Solid and re-run the style bindings on every observed frame.
    if (SAME_FRAME(untrack(frame), next)) return;
    setFrame(next);
  };

  // Which card is open decides everything above; the card list decides where the cards are (a
  // summary growing from one line to two moves every card below it on a stacked layout).
  createEffect(() => {
    openId();
    props.cards();
    queueMicrotask(measure);
  });

  onMount(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(gridRef);
    onCleanup(() => observer.disconnect());
  });

  /**
   * Re-measure when the panel itself resizes — which is also how the first real width arrives, the
   * pass above having placed it from its trigger's. Terminates: `left`/`top` do not feed back into
   * the panel's width, and `measure` refuses to write a frame equal to the current one.
   */
  const attachPanel = (el: HTMLDivElement): void => {
    panelRef = el;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      panelRef = undefined;
    });
  };

  return (
    <div ref={rootRef} class="relative">
      <div
        ref={gridRef}
        /* No vertical padding and no bottom rule: on a tinted page ground the cards are already
           raised surfaces, so they mark their own extent, and the rhythm between this row and what
           follows belongs to the parent's `gap`. A border here would be a line drawn to separate
           things that are separated. */
        class="grid grid-cols-1 gap-2 px-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <For each={props.cards()}>
          {(card) => (
            <Show when={card.enabled?.() ?? true}>
              <div data-card-id={card.id}>
                <ContextCard
                  label={card.label}
                  summary={card.summary}
                  actions={card.actions}
                  open={openId() === card.id}
                  panelId={panelId}
                  onToggle={() => setOpenId(openId() === card.id ? null : card.id)}
                />
              </div>
            </Show>
          )}
        </For>
      </div>

      <Show when={openCard()}>
        {(card) => (
          <div
            ref={attachPanel}
            id={panelId}
            role="region"
            aria-label={card().label}
            /* `w-max` so the panel is as wide as its content wants, between the floor and the row's
               own width — a two-address card takes the room it needs, a four-row list does not. */
            class="absolute z-menu w-max rounded-lg border border-border bg-surface shadow-xl"
            style={{
              top: `${frame().top}px`,
              left: `${frame().left}px`,
              'min-width': `${frame().minWidth}px`,
              'max-width': `${frame().maxWidth}px`,
            }}
          >
            <div class="max-h-[70vh] space-y-3 overflow-auto px-3 py-3 text-sm text-gray-700">
              <ContextCardPanel
                detail={card().detail}
                slotKey={card().slotKey}
                slotContext={card().slotContext}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
