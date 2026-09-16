import { Show, type JSX } from 'solid-js';
import { FoldChevron, createFold } from './fold';
import { cx } from './primitives';

export interface FoldingSectionProps {
  /** Section heading. Usually a string; takes an element for a heading that carries its own markup. */
  title: JSX.Element;
  /**
   * Muted text beside the title — a count, a summary ("3 on this order · 1 pending"). Kept
   * *outside* the toggle button so it doesn't end up in the button's accessible name.
   */
  aside?: JSX.Element;
  /**
   * Controls in the header row (a "+ Add" button, a bulk action). Their clicks are stopped from
   * reaching the row toggle, so a caller never has to remember `stopPropagation`.
   */
  actions?: JSX.Element;
  /**
   * Where `actions` sit. `end` (default) pins them to the right edge — right for a control that
   * acts on the section's *contents* ("Process 3 corrections"), and for anything a caller expects
   * to find in the same place across a stack of sections. `title` puts them straight after the
   * heading instead, for a control that reads as part of it ("+ New note"); on a wide screen the
   * right edge is a long way from the word it belongs to.
   */
  actionsAlign?: 'end' | 'title';
  /** Start expanded. Default collapsed — these panels sit below the fold on a long page. */
  defaultOpen?: boolean;
  /** Drive the fold from outside. When set, the component stops owning the state. */
  open?: boolean;
  /** Fires on every toggle, controlled or not. */
  onOpenChange?: (open: boolean) => void;
  /**
   * When false the section is permanently expanded and the header loses its toggle — for a host
   * that wants the panel's chrome without the fold.
   */
  collapsible?: boolean;
  /**
   * The heading band's tone. `warning` says **this section is holding work somebody owes**, and is
   * the only thing that puts colour on a heading here.
   *
   * Hue means state, never identity. A colour per section — red Corrections, green Notes, blue
   * Timeline — was the obvious move and is wrong twice over: it spends the whole semantic budget on
   * naming panels the reader can already read, and it paints an alarm colour on a section that is
   * perfectly healthy, so the one case that matters has nothing left to say it with. Amber plus an
   * hourglass already means "a person owes an action" on the queue's chips, an order line's pills
   * and the payment card; a fold heading earning it is that same sentence one level up.
   *
   * Pass it derived, never fixed: `pendingCount() > 0 ? 'warning' : 'default'`. A section that is
   * *always* warning is a section that is never warning.
   */
  tone?: 'default' | 'warning';
  /** Replaces the body padding. Default `px-4 pb-3`. */
  bodyClass?: string;
  /** Appended to the section wrapper, for layout the caller owns (`mt-2`, `last:border-b-0`). */
  class?: string;
  /**
   * `data-testid` on the section wrapper, so a browser or E2E check can find the section — and its
   * toggle, the `button[aria-expanded]` inside — whatever language its heading renders in.
   */
  testId?: string;
  children: JSX.Element;
}

/**
 * A foldable panel section: a top rule, a chevron header, and a body that collapses.
 *
 * This is the **page-panel** fold — the stacked sections down a detail page (an order's Timeline,
 * Corrections and Notes). `SettingsSection` is its sibling for the **settings-popover** fold: the
 * two share their behaviour through {@link createFold} but keep their own markup, for the reasons
 * set out there. Reach for this one on a page, that one inside the gear popover.
 *
 * **Why the header is a real `<button>` with the row clickable around it.** The three panels this
 * replaces had each solved the same conflict differently: a header that toggles the fold, and an
 * action button living inside that header. Nesting a `<button>` in a `<button>` is invalid, so one
 * of them degraded the toggle to a `role="button"` div with a hand-rolled keydown handler — which
 * loses the native button's form semantics, its click-on-Space-release timing, and its default
 * focus behaviour. Here the row is a plain click target, the toggle inside it is a real button
 * carrying the ARIA, and `actions` swallows its own clicks. Large hit area, honest semantics, and
 * no caller has to think about it.
 */
export function FoldingSection(props: FoldingSectionProps): JSX.Element {
  const collapsible = (): boolean => props.collapsible ?? true;
  const { open, toggle, bodyId } = createFold({
    defaultOpen: props.defaultOpen,
    open: () => props.open,
    onOpenChange: (o) => props.onOpenChange?.(o),
    collapsible,
  });

  return (
    <div
      /*
        The rule BETWEEN sections is 2px of `border-strong`, not 1px of `border`. Two bands meeting
        is the one place `--color-border` cannot work: it is solved as a hairline on the panel's
        white, and against the band it measures 1.049 — lighter than what it divides. Width alone
        would not have fixed that.

        `first:border-t-0` because the first section's top edge is the enclosing panel's own border;
        drawing both stacks two rules into one visual edge.
      */
      class={cx('border-t-2 border-border-strong first:border-t-0', props.class)}
      data-testid={props.testId}
    >
      <div
        /*
          The heading is a **band**, not a line of text. `surface-raised` against the panel's own
          white gives each section a visible top and bottom, which is what tells an operator where
          one ends and the next begins; before this it was bare text with a chevron, read as a link,
          and a fold's extent was invisible until you opened it.

          The bottom rule stays even though the tint now carries the band on its own. It is what
          closes the heading against its *body*, which is the panel's white either way — the token
          moved the band away from the panel, not away from the content under it.

          Hover steps to `surface-hover`, the tone that sits *between* the panel and this band,
          rather than to a hardcoded grey or to the panel itself: the band is the step furthest
          from the panel in both themes, so moving part-way back is a visible lift in both —
          lighter here, darker on a dark page. Stepping all the way to `surface` was the earlier
          choice and overshot, repainting the band as though it had become a panel; `ground`
          overshot the other way and stopped working entirely once `raised` moved past it.

          A `warning` band swaps the whole trio — fill, rule and hover — for the amber ramp rather
          than tinting the neutral one, so it moves as one thing between themes. Its hover walks the
          ramp (100 -> 200) instead of stepping toward the panel: hue here means state, and a hover
          that drained the amber would read as the state clearing under the cursor.

          It sits a rung higher than the neutral band (100/200, not 50/100) because it is not
          decoration — it marks work someone owes, and at 50 the fill was close enough to the panel
          that the state read as absent. The rule moves with it (300, not 200) or the hover would
          repaint the fill to exactly the border's colour and the band would lose its edge at the
          moment it is being pointed at.
        */
        class={cx(
          'flex items-center gap-3 border-b px-4 py-2',
          'warning' === props.tone
            ? 'border-amber-300 bg-amber-100'
            : 'border-border bg-surface-raised',
          collapsible()
            ? cx(
                'cursor-pointer select-none',
                'warning' === props.tone ? 'hover:bg-amber-200' : 'hover:bg-surface-hover',
              )
            : '',
        )}
        onClick={() => toggle()}
      >
        <Show
          when={collapsible()}
          fallback={<span class="text-sm font-medium text-text">{props.title}</span>}
        >
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-text transition-colors hover:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-expanded={open()}
            aria-controls={bodyId}
            // The row toggles too, so let the button's own click be the only one that counts.
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <FoldChevron open={open()} />
            <span>{props.title}</span>
          </button>
        </Show>

        <Show when={props.actions && 'title' === props.actionsAlign}>
          <div class="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {props.actions}
          </div>
        </Show>

        <Show when={props.aside}>
          <span class="text-xs text-text-muted">{props.aside}</span>
        </Show>

        <Show when={props.actions && 'title' !== props.actionsAlign}>
          <div class="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {props.actions}
          </div>
        </Show>
      </div>

      <Show when={open()}>
        <div id={bodyId} class={props.bodyClass ?? 'px-4 pb-3'}>
          {props.children}
        </div>
      </Show>
    </div>
  );
}
