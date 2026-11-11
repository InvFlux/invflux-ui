/**
 * Telling a scanner's keystrokes from a person's, and reading what the scanner meant.
 *
 * A wedge scanner is a keyboard: its code arrives as ordinary keystrokes, distinguishable from typing
 * only by speed. This module holds that judgment and the reading of a burst through the right keyboard
 * layout. It is pure: it reads the fields of key events it is handed and nothing else.
 */

/**
 * The widest gap between two keys of a scan. Scanners run roughly 10–30 ms per character and a very fast
 * typist stays above 100 ms; narrowing it makes a jittery scanner look like a person.
 */
export const SCANNER_THRESHOLD_MS = 50;

/**
 * Characters a burst needs before it reads as a scan. A person's finger can roll two or three keys
 * inside the threshold, the last character and Enter above all; four in a row at scanner speed is a
 * machine. The shortest retail barcode (EAN-8) has eight.
 */
export const MIN_BURST_CHARS = 4;

/** The fields of a `KeyboardEvent` the resolver reads. `timeStamp` is the event's own, not the clock at handling. */
export interface RawKey {
  key: string;
  code: string;
  shiftKey: boolean;
  timeStamp: number;
}

/**
 * How a burst's characters are read.
 *
 * - `as-typed`: the OS layout's character (`KeyboardEvent.key`). Correct when the scanner is set to the
 *   same layout as the machine.
 * - `physical-us`: the character the physical key makes on a US keyboard (`KeyboardEvent.code`). Correct
 *   when the scanner is set to US, which is the factory default, whatever layout the OS has.
 */
export type LayoutMode = 'as-typed' | 'physical-us';

const SHIFTED_DIGITS = ')!@#$%^&*(';

/** Unshifted / shifted pairs for the punctuation keys that appear in product codes. */
const PUNCTUATION: Record<string, readonly [string, string]> = {
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Backquote: ['`', '~'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Space: [' ', ' '],
};

const NUMPAD: Record<string, string> = {
  NumpadDecimal: '.',
  NumpadSubtract: '-',
  NumpadAdd: '+',
  NumpadMultiply: '*',
  NumpadDivide: '/',
};

/**
 * The character a physical key produces on a US keyboard, or null when the key is not a character key.
 *
 * `code` names the physical position (`Digit5`, `KeyA`) independently of the OS layout, which is why a
 * scanner configured for US still reads correctly on an AZERTY or QWERTZ machine. `code` carries no case,
 * so a letter's case comes from `shiftKey`.
 */
export function physicalChar(e: Pick<RawKey, 'code' | 'shiftKey'>): string | null {
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) {
    return e.shiftKey ? SHIFTED_DIGITS[Number(digit[1])]! : digit[1]!;
  }
  const numpad = /^Numpad([0-9])$/.exec(e.code);
  if (numpad) return numpad[1]!;
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return e.shiftKey ? letter[1]! : letter[1]!.toLowerCase();
  if (e.code in NUMPAD) return NUMPAD[e.code]!;
  const punctuation = PUNCTUATION[e.code];
  return punctuation ? punctuation[e.shiftKey ? 1 : 0] : null;
}

/** Whether a key makes a character, as opposed to a modifier or a control key. */
export function isCharKey(k: Pick<RawKey, 'key'>): boolean {
  return 1 === [...k.key].length;
}

/**
 * Add a key to the run being collected, starting a new run when it arrives at a person's pace.
 *
 * A burst is the **trailing** run of scanner-speed keys, not everything since the last Enter: a slower
 * key earlier in the field (a person typed, then scanned) would otherwise make the whole scan read as
 * typing and silently drop it.
 */
export function appendKey(run: readonly RawKey[], key: RawKey): RawKey[] {
  const last = run[run.length - 1];

  return undefined !== last && key.timeStamp - last.timeStamp >= SCANNER_THRESHOLD_MS
    ? [key]
    : [...run, key];
}

/**
 * True when the keystrokes arrived at scanner speed throughout, and carry at least
 * {@link MIN_BURST_CHARS} characters.
 *
 * Measured on the events' own timestamps, never on the clock at handling time: a main-thread stall
 * delays when a handler runs, not when the browser received the key, so the queued events keep their
 * real spacing and a stall cannot turn a scanner's closing Enter into one that looks like a person's.
 * Modifier keys count toward the timing, because a scanner sends the Shift around a shifted character
 * at the same speed, but not toward the characters.
 */
export function isScannerBurst(keys: readonly RawKey[]): boolean {
  if (keys.filter(isCharKey).length < MIN_BURST_CHARS) return false;
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i]!.timeStamp - keys[i - 1]!.timeStamp >= SCANNER_THRESHOLD_MS) return false;
  }
  return true;
}

/**
 * The text a burst of keystrokes stands for, read through one layout.
 *
 * Resolved over the whole burst at once, after its last key, because the first character of a burst has
 * no timing reference and cannot be recognized as scanner input when it arrives; resolving as it arrives
 * would read exactly that character through the wrong layout. Keys that make no character (modifiers,
 * Enter, Tab) are skipped.
 */
export function resolveBurst(keys: readonly RawKey[], layout: LayoutMode): string {
  let text = '';
  for (const k of keys) {
    const typed = isCharKey(k) ? k.key : null;
    const char = 'physical-us' === layout ? (physicalChar(k) ?? typed) : typed;
    if (null !== char) text += char;
  }
  return text;
}

/**
 * The reading of a scanned burst when no layout has been configured: the physical US reading when it is
 * all digits and the typed one is not, else the typed one.
 *
 * Narrow on purpose. A product code is digits far more often than not, and a US-configured scanner on an
 * AZERTY machine turns every digit into punctuation, which is the failure worth catching unasked. An
 * alphanumeric code keeps the typed reading, because a scanner set to the local layout is right under it
 * and the two cannot be told apart from the keystrokes alone; that case needs a configured mode.
 */
export function readBurst(keys: readonly RawKey[]): string {
  const typed = resolveBurst(keys, 'as-typed');
  const physical = resolveBurst(keys, 'physical-us');

  return /^\d+$/.test(physical) && !/^\d+$/.test(typed) ? physical : typed;
}
