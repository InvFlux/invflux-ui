import { InfoIcon } from './icons';
import type { JSX } from 'solid-js';

/**
 * A muted information affordance carrying a native-title tooltip — for short, inline field
 * explanations next to a label. Uses the same native-`title` pattern as the rest of the SPA
 * (constraint cells, FeatureGate) rather than a custom popover.
 *
 * The mark is {@link InfoIcon}, not the `ⓘ` character it used to be. A glyph's ring and letter are
 * one filled shape, so the space inside the circle is a hole that shows the page through it — fine
 * on white, wrong the moment the page is tinted. Painting a background on this span to cover that
 * only made it a white *rectangle* behind a circle. The stroked icon has no hole to fill, and takes
 * `currentColor` from the muted text tone like every other icon in the app.
 *
 * Sits on the **text baseline**, like the letters it annotates. An `inline-flex` box has no baseline
 * of its own, so CSS synthesises one from its bottom margin edge — the icon's feet land where the
 * letters' feet land.
 *
 * **Sized in `em`, at roughly cap height, and that is what makes the alignment read.** A baseline is
 * only half the problem: a mark taller than the capitals beside it must overshoot upward once its
 * feet are down, however correct the alignment is — at a 14px font the capitals are about 10px, so a
 * 14px icon stands a third clear of them and looks like it is floating. Matching the cap height puts
 * its top where the letters' tops are, and `em` keeps that true wherever this is used, since the same
 * component annotates labels at more than one size.
 *
 * **Two alignment utilities, because there are two kinds of parent.** `align-baseline` is
 * `vertical-align`, which governs this span in ordinary inline flow — beside a label's text. It is
 * **inert inside a flex container**, and several headings that carry a hint are `flex` rows, where
 * the span is a flex item aligned by the parent's `items-*` instead: under the common `items-center`
 * that centres the icon on the line, dropping it about half its own height below the baseline.
 * `self-baseline` answers that case, and is itself ignored in inline flow. Neither is redundant, and
 * a hint should not need its parent rewritten to sit straight.
 *
 * **The nudge is the icon's own bottom padding, not taste.** Both utilities put the box's *bottom
 * edge* on the baseline, but {@link InfoIcon} is a circle centred in a 24-unit box: with `r="9"` its
 * ink stops 2.1 units short of the bottom, so the ring would hang that far above the line. `0.09em`
 * is exactly that gap (2.1/24), expressed against the icon's own `1em` size so it holds at any text
 * size. A `transform` rather than `position`, so seating the mark cannot alter the line box.
 *
 * The correction lives here and not in the artwork on purpose. Shifting the glyph upward inside its
 * viewBox seats it in a `items-center` parent and unseats it in every inline one — and does so
 * invisibly, since nothing at the call site says the icon is off-centre.
 */
export function Hint(props: { text: string }): JSX.Element {
  return (
    <span
      class="inline-flex translate-y-[0.09em] cursor-help select-none self-baseline align-baseline text-slate-300 hover:text-text-muted"
      title={props.text}
      aria-label={props.text}
    >
      <InfoIcon class="ml-0.5 h-[1em] w-[1em]" />
    </span>
  );
}
