import { createSignal, type JSX, onMount } from 'solid-js';
import { editRegistry, type EditMove, type EditProps } from '@invflux/ui';

/** Per-row config the host injects via resolveEditorMeta (editorConfig is otherwise static). */
interface ReceiptConfig {
  /** Value `.` fills in on an empty field (the "all of it" shortcut — e.g. the line's open qty). */
  dotDefault?: number;
  /** Upper clamp (e.g. damaged ≤ received). */
  max?: number;
  /** Accessible label for the input. */
  ariaLabel?: string;
}

/**
 * Goods-reception numeric editor — a blank-start integer cell tailored to counting receipts:
 *   - blank = nothing counted yet (commits as null);
 *   - `.` on an empty field fills the per-row default (open qty / received) — the "all of it" shortcut;
 *   - `+`/`-` and ArrowUp/ArrowDown step ±1 (floored at 0, capped at `max` when set);
 *   - only digits are accepted otherwise.
 * Commit/move (Enter/Tab/blur) and revert (Escape) mirror the core input editors. The per-row
 * `dotDefault`/`max` arrive through `editorConfig` (the editor never sees the row itself).
 */
function ReceiptEditor(props: EditProps): JSX.Element {
  const cfg = (): ReceiptConfig => props.column.editorConfig as ReceiptConfig;
  const clamp = (n: number): number => {
    const lo = Math.max(0, n);
    const max = cfg().max;
    return undefined === max ? lo : Math.min(max, lo);
  };
  // `.` typed to ENTER the cell (cell-nav mode) is the "all of it" fill shortcut, just like pressing
  // `.` inside an already-open empty editor — it opens the cell pre-filled with the per-row default.
  const isDotFill = (): boolean => '.' === props.initialText && undefined !== cfg().dotDefault;
  const seed = (): string => {
    if (isDotFill()) return String(clamp(cfg().dotDefault as number));
    if (undefined !== props.initialText) return props.initialText.replace(/[^0-9]/g, '');
    return null === props.value || undefined === props.value ? '' : String(props.value);
  };

  const [text, setText] = createSignal(seed());
  let ref: HTMLInputElement | undefined;

  onMount(() => {
    ref?.focus();
    // F2 / double-click (no seed char) or the `.` fill → select all so typing replaces.
    if (undefined === props.initialText || isDotFill()) ref?.select();
  });

  const current = (): number | null => ('' === text() ? null : Number.parseInt(text(), 10));

  const commit = (move: EditMove): void => {
    const v = current();
    props.onCommit(null === v ? null : clamp(v), move);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if ('+' === e.key || 'ArrowUp' === e.key) {
      e.preventDefault();
      setText(String(clamp((current() ?? 0) + 1)));
    } else if ('-' === e.key || 'ArrowDown' === e.key) {
      e.preventDefault();
      setText(String(clamp((current() ?? 0) - 1)));
    } else if ('.' === e.key && null === current() && undefined !== cfg().dotDefault) {
      e.preventDefault();
      setText(String(clamp(cfg().dotDefault as number)));
    } else if ('Enter' === e.key) {
      e.preventDefault();
      e.stopPropagation();
      commit(e.shiftKey ? 'up' : 'down');
    } else if ('Tab' === e.key) {
      e.preventDefault();
      e.stopPropagation();
      commit(e.shiftKey ? 'left' : 'right');
    } else if ('Escape' === e.key) {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    }
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }): void => {
    const digits = e.currentTarget.value.replace(/[^0-9]/g, '');
    setText('' === digits ? '' : String(clamp(Number.parseInt(digits, 10))));
  };

  return (
    <input
      ref={ref}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      class="block h-full w-full select-text border-0 bg-surface px-2 py-2 text-right tabular-nums outline-none ring-2 ring-inset ring-blue-500"
      value={text()}
      aria-label={cfg().ariaLabel}
      onKeyDown={onKeyDown}
      onInput={onInput}
      onBlur={() => commit(null)}
    />
  );
}

let registered = false;

/**
 * Register the `number:receipt` editor once (idempotent). Its codec falls back to `number` via the
 * datatype chain, so copy/paste into a receipt cell parses like any integer. Call from a grid consumer
 * before it renders receipt columns.
 */
export function registerReceiptEditor(): void {
  if (registered) {
    return;
  }
  registered = true;
  editRegistry.register('number:receipt', 'invflux.receipt-input', ReceiptEditor, {
    default: true,
  });
}
