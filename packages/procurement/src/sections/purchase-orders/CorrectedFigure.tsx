import { type JSX, Show } from 'solid-js';

/**
 * A receipt figure that a correction may have changed: the current value, preceded — when it differs
 * from what was posted — by the posted one struck through, muted, and an arrow (~~3~~ → 1 unit). The
 * list then agrees with the order's received quantity while still showing what was first recorded.
 *
 * The caller formats the current value (a count with its unit, a "+n damaged") and words the tooltip
 * that says the change in full.
 */
export function CorrectedFigure(props: {
  posted: number;
  /** Null when the receipt was never corrected: the posted figure is the current one. */
  current: number | null;
  format: (n: number) => JSX.Element;
  title: (posted: number, current: number) => string;
  testId?: string;
}): JSX.Element {
  // A boolean, not the value: a receipt corrected down to 0 must still show its change.
  const changed = (): boolean => null !== props.current && props.current !== props.posted;
  return (
    <Show when={changed()} fallback={props.format(props.current ?? props.posted)}>
      <span
        title={props.title(props.posted, props.current ?? props.posted)}
        data-testid={props.testId}
      >
        <span class="text-text-muted">
          <s>{props.posted}</s>
          {' → '}
        </span>
        {props.format(props.current ?? props.posted)}
      </span>
    </Show>
  );
}
