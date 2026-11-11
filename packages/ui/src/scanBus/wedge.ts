import type { ScanBus } from './bus';
import {
  SCANNER_THRESHOLD_MS,
  appendKey,
  isCharKey,
  isScannerBurst,
  readBurst,
  resolveBurst,
  type LayoutMode,
  type RawKey,
} from './keys';

/**
 * The wedge scanner as a source of the scan bus.
 *
 * A wedge types its code, so a scan is recognized only at its end: at the scanner's Enter (or Tab), or
 * when a scanner-speed burst stops with no terminator at all. By then its characters have already landed
 * wherever the focus was, and what happens depends on that:
 *
 * - **no editable element focused**: the keystrokes went nowhere, and the code goes to the screen's loop;
 * - **a registered field focused**: the field gets back the value it held before the burst, then the
 *   code, which it puts in as its own edit would;
 * - **an unregistered field focused** (a price, a note): the characters stay typed, as from any keyboard,
 *   and the scanner's Enter goes through. Removing them would delete text on a timing guess, and a
 *   misjudgment must fail toward "a person".
 *
 * Whenever the bus takes the scan (the first two cases, and a screen with nothing registered), the
 * scanner's Enter is stopped, so it can never also act as a person's Enter on the page: open a
 * highlighted row, submit a form.
 */

export interface WedgeOptions {
  /** The element holding focus, crossing shadow roots. */
  focused: () => Element | null;
  /** How to read a burst. `auto` (the default) picks the physical US reading for an all-digit code. */
  layout?: () => LayoutMode | 'auto';
  /** How long a burst may stop before it counts as ended without a terminator. */
  quietMs?: number;
}

/** A burst ending in this long a silence, with no terminator, still ends the scan (a suffix-less scanner). */
const QUIET_MS = 100;

interface Snapshot {
  el: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  start: number | null;
  end: number | null;
}

/** Listen for wedge scans on `target` (the window, normally) and hand them to the bus. Returns the uninstaller. */
export function installWedge(
  bus: ScanBus,
  options: WedgeOptions,
  target: EventTarget = window,
): () => void {
  let run: RawKey[] = [];
  let snapshot: Snapshot | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  /** The last key of a burst the bus took on silence, until the next key arrives. */
  let takenAt: number | null = null;

  const reset = (): void => {
    run = [];
    snapshot = null;
    if (null !== quiet) clearTimeout(quiet);
    quiet = null;
  };

  const read = (keys: readonly RawKey[]): string => {
    const layout = options.layout?.() ?? 'auto';
    return 'auto' === layout ? readBurst(keys) : resolveBurst(keys, layout);
  };

  /** Route a finished burst. Returns whether the bus took it (so the terminator must be stopped). */
  const finish = (keys: readonly RawKey[], before: Snapshot | null): boolean => {
    const focused = options.focused();
    const route = bus.route(focused);
    // An unregistered field keeps what was typed into it; the bus stays out of its way.
    if (isEditable(focused) && 'target' !== route.to) return false;
    const code = read(keys).trim();
    if ('' === code) return false;
    if ('target' === route.to && null !== before && before.el === focused) restore(before);
    void bus.deliver({ code, source: 'wedge' }, focused, route);

    return true;
  };

  const onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
      reset();
      return;
    }
    const key: RawKey = { key: e.key, code: e.code, shiftKey: e.shiftKey, timeStamp: e.timeStamp };

    if ('Enter' === e.key || 'Tab' === e.key) {
      // The terminator of a burst already ended by silence: the main thread ran the quiet timer before
      // this queued key. Judged on the events' own timestamps, it belongs to that scan, so it is
      // stopped as the scan's own terminator would have been.
      if (0 === run.length && null !== takenAt && key.timeStamp - takenAt < SCANNER_THRESHOLD_MS) {
        takenAt = null;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      takenAt = null;
      const withTerminator = appendKey(run, key);
      const isScan = withTerminator.length === run.length + 1 && isScannerBurst(withTerminator);
      const keys = run;
      const before = snapshot;
      reset();
      if (isScan && finish(keys, before)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (!isCharKey(key) && 'Shift' !== e.key) {
      reset();
      return;
    }

    const next = appendKey(run, key);
    if (1 === next.length) {
      // A new run starts: keep what the focused field holds before this key lands, so a scan into a
      // registered field can be given back the field's own value first.
      snapshot = snapshotOf(options.focused());
    }
    run = next;
    if (null !== quiet) clearTimeout(quiet);
    takenAt = null;
    quiet = setTimeout(() => {
      const keys = run;
      quiet = null;
      if (isScannerBurst(keys)) {
        const taken = finish(keys, snapshot);
        reset();
        if (taken) takenAt = keys[keys.length - 1]!.timeStamp;
      }
    }, options.quietMs ?? QUIET_MS);
  };

  target.addEventListener('keydown', onKeyDown, true);

  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    reset();
  };
}

/** Whether an element takes typed text. */
export function isEditable(el: Element | null): boolean {
  if (null === el) return false;
  if ('TEXTAREA' === el.tagName) return !(el as HTMLTextAreaElement).readOnly;
  if ('INPUT' === el.tagName) {
    const input = el as HTMLInputElement;
    return !input.readOnly && !NON_TEXT_INPUTS.has(input.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'file',
  'image',
  'range',
  'color',
  'hidden',
]);

function snapshotOf(el: Element | null): Snapshot | null {
  if (null === el || !isEditable(el) || !('value' in el)) return null;
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = field.selectionStart;
    end = field.selectionEnd;
  } catch {
    // Some input types expose no selection; the value alone is enough.
  }
  return { el: field, value: field.value, start, end };
}

/**
 * Give a field back its value from before the burst, as an edit the page hears: through the native
 * setter and an `input` event, so a controlled field's own handler updates its state.
 */
function restore(s: Snapshot): void {
  const proto =
    typeof HTMLInputElement === 'undefined'
      ? undefined
      : 'TEXTAREA' === s.el.tagName
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(s.el, s.value);
  else s.el.value = s.value;
  s.el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  if (null !== s.start && null !== s.end) {
    try {
      s.el.setSelectionRange(s.start, s.end);
    } catch {
      // As above: no selection on this input type.
    }
  }
}
