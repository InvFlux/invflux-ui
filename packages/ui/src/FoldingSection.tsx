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
  /** Replaces the body padding. Default `px-4 pb-3`. */
  bodyClass?: string;
  /** Appended to the section wrapper, for layout the caller owns (`mt-2`, `last:border-b-0`). */
  class?: string;
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
    <div class={cx('border-t border-border', props.class)}>
      <div
        class={cx(
          'flex items-center gap-3 px-4 py-3',
          collapsible() ? 'cursor-pointer select-none hover:bg-surface-raised' : '',
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
