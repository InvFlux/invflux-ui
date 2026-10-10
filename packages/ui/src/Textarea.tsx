import { createEffect, onCleanup, splitProps, type JSX } from 'solid-js';
import { textareaClass, type FieldSize } from './primitives';

export interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Padding + text scale. Default `sm`. */
  size?: FieldSize;
  /** Render the error border/ring. */
  invalid?: boolean;
  /** Drop the resize grabber (for auto-growing or fixed-height composers). */
  noResize?: boolean;
  /**
   * Grow with the text, up to this many lines, past which the field scrolls. Setting it turns
   * auto-grow on, and implies `noResize` — a dragged height would be undone by the next keystroke.
   */
  autoGrowMaxLines?: number;
  /**
   * Height in lines — the native `rows`, which it overrides. With `autoGrowMaxLines` it is where the
   * field starts and the least it shrinks to, and defaults to 1; without, the field stays this tall.
   */
  lines?: number;
}

/**
 * Multi-line field. Sized by `rows` (native) rather than a height class, so `size` here controls
 * padding and text scale only — a fixed height would fight `rows`.
 *
 * With `autoGrowMaxLines` the height follows the content. It is re-measured on input, when the value is set
 * from outside (a saved draft loading), and when the field's width changes — narrower means more
 * wrapped lines, and the first measurement can happen before the field has its final width.
 */
export function Textarea(props: TextareaProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'size',
    'invalid',
    'noResize',
    'autoGrowMaxLines',
    'lines',
    'class',
    'ref',
  ]);

  let el: HTMLTextAreaElement | undefined;
  const grows = (): boolean => undefined !== local.autoGrowMaxLines && local.autoGrowMaxLines > 0;
  const fit = (): void => {
    if (!grows() || undefined === el) return;
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2; // 'normal' parses to NaN
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const cap = (local.autoGrowMaxLines ?? 1) * lineHeight + padding;

    el.style.height = 'auto';
    // scrollHeight covers content + padding; the border is added back so nothing scrolls early.
    const content = el.scrollHeight;
    el.style.height = `${Math.min(content, cap) + el.offsetHeight - el.clientHeight}px`;
    el.style.overflowY = content > cap ? 'auto' : 'hidden';
  };

  createEffect(() => {
    // Tracks the value so an outside update (not a keystroke) resizes too.
    void props.value;
    if (grows()) queueMicrotask(fit);
  });

  const attach = (node: HTMLTextAreaElement): void => {
    el = node;
    const ref = local.ref as ((n: HTMLTextAreaElement) => void) | undefined;
    if ('function' === typeof ref) ref(node);
    if (!grows()) return;
    node.addEventListener('input', fit);
    let width = 0;
    const observer = new ResizeObserver(() => {
      // Only a width change can change the wrapping; reacting to our own height change would loop.
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fit();
    });
    observer.observe(node);
    onCleanup(() => {
      observer.disconnect();
      node.removeEventListener('input', fit);
    });
  };

  return (
    <textarea
      {...rest}
      rows={local.lines ?? (grows() ? 1 : rest.rows)}
      ref={(node) => attach(node)}
      class={textareaClass(
        local.size ?? 'sm',
        local.invalid ?? false,
        local.noResize || grows() ? `resize-none ${local.class ?? ''}`.trim() : local.class,
      )}
      aria-invalid={local.invalid || undefined}
    />
  );
}
