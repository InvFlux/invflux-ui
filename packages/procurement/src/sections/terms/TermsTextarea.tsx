import { Textarea } from '@invflux/ui';
import { createEffect, createSignal, Index, on, onCleanup, onMount, type JSX } from 'solid-js';

/** The tallest the box grows, as a share of the window — the same cap as the rendered text's box. */
const MAX_HEIGHT = 0.45;

/**
 * The terms text box, with the line numbers the numbering check reports in a gutter beside it.
 *
 * Numbers count lines of the text — what the check counts — not rows on screen: a clause that wraps
 * onto three rows is one line, so its number sits against its first row and the next two are blank.
 * A textarea says nothing about where it wrapped, so each line's height is measured on a hidden copy
 * laid out exactly as the box is.
 *
 * The box grows with its text up to {@link MAX_HEIGHT}, so a long text never pushes the dialog's
 * buttons out of view; past that it scrolls, and the gutter scrolls with it.
 */
export function TermsTextarea(props: {
  id: string;
  value: string;
  onInput: (value: string) => void;
  /** The height the box starts at, in rows, before its text grows it. */
  minRows: number;
  /** Lines to mark in the gutter — the ones the last numbering check named. */
  flagged: ReadonlySet<number>;
  placeholder?: string;
}): JSX.Element {
  let box: HTMLTextAreaElement | undefined;
  let mirror: HTMLDivElement | undefined;
  const [heights, setHeights] = createSignal<number[]>([]);
  const [offsetTop, setOffsetTop] = createSignal(0);
  const [lineHeight, setLineHeight] = createSignal('normal');
  const [boxHeight, setBoxHeight] = createSignal<number | null>(null);
  const [scrollTop, setScrollTop] = createSignal(0);

  const measure = (): void => {
    if (!box || !mirror) {
      return;
    }
    // Grow to the text: `auto` falls back to the rows the box starts at, so it never shrinks below.
    // Past the cap the box scrolls instead — set before the width is read below, since a scrollbar
    // appearing narrows the text and moves every wrap.
    box.style.height = 'auto';
    const natural = box.scrollHeight + box.offsetHeight - box.clientHeight;
    const cap = Math.max(box.offsetHeight, Math.round(window.innerHeight * MAX_HEIGHT));
    box.style.height = `${Math.min(natural, cap)}px`;
    box.style.overflowY = natural > cap ? 'auto' : 'hidden';
    setBoxHeight(box.offsetHeight);
    setScrollTop(box.scrollTop);

    const style = getComputedStyle(box);
    Object.assign(mirror.style, {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      wordSpacing: style.wordSpacing,
      lineHeight: style.lineHeight,
      tabSize: style.tabSize,
      wordBreak: style.wordBreak,
      width: `${box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`,
    });
    mirror.replaceChildren(
      ...props.value.split('\n').map((line) => {
        const row = document.createElement('div');
        // An empty line still takes a row; a zero-width space gives it one.
        row.textContent = '' === line ? '​' : line;

        return row;
      }),
    );
    setOffsetTop(parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth));
    setLineHeight(style.lineHeight);
    setHeights(Array.from(mirror.children, (row) => row.getBoundingClientRect().height));
  };

  // Re-measure after the text changes, once it has been laid out.
  createEffect(
    on(
      () => props.value,
      () => requestAnimationFrame(measure),
    ),
  );

  // And when the width changes, which moves every wrap. Only the width: measuring sets the height.
  // A window resized taller or shorter moves the cap, so that measures too. The gutter follows the
  // box's scroll, listened to on the element itself.
  onMount(() => {
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (box && box.clientWidth !== width) {
        width = box.clientWidth;
        measure();
      }
    });
    const follow = (): void => {
      setScrollTop(box?.scrollTop ?? 0);
    };
    if (box) {
      observer.observe(box);
      box.addEventListener('scroll', follow, { passive: true });
    }
    window.addEventListener('resize', measure);
    onCleanup(() => {
      observer.disconnect();
      box?.removeEventListener('scroll', follow);
      window.removeEventListener('resize', measure);
    });
  });

  return (
    <div class="relative mt-1 flex">
      <div
        aria-hidden="true"
        class="min-w-8 select-none overflow-hidden pr-2 text-right font-mono text-xs tabular-nums text-text-muted"
        style={{ height: null === boxHeight() ? undefined : `${boxHeight()}px` }}
      >
        <div
          style={{ 'padding-top': `${offsetTop()}px`, transform: `translateY(-${scrollTop()}px)` }}
        >
          <Index each={heights()}>
            {(height, i) => (
              <div
                style={{ height: `${height()}px`, 'line-height': lineHeight() }}
                class={props.flagged.has(i + 1) ? 'font-semibold text-red-600' : undefined}
              >
                {i + 1}
              </div>
            )}
          </Index>
        </div>
      </div>
      <Textarea
        ref={box}
        id={props.id}
        rows={props.minRows}
        placeholder={props.placeholder}
        noResize
        class="w-full overflow-hidden font-mono"
        data-testid="terms-textarea"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <div
        ref={mirror}
        aria-hidden="true"
        class="pointer-events-none invisible absolute left-0 top-0 whitespace-pre-wrap break-words"
      />
    </div>
  );
}
