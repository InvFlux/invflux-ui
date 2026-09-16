export const SCANNER_THRESHOLD_MS = 50;

export type InputSource = 'scanner' | 'keyboard';

export interface ScannerState {
  /** Accumulated filter text. The dot character is excluded. */
  buffer: string;
  /** Timestamp of the last character event (ms). 0 = no input yet. */
  lastCharAt: number;
  /** Whether the last batch of characters arrived at scanner speed. */
  inputSource: InputSource;
  /**
   * True within 50ms of a '.' scan. While armed, a scanner-speed Enter
   * confirms staging of a multi-quantity product line.
   *
   * Physical workflow: packer scans product EAN (product zooms), counts the
   * units, then scans the dot barcode worn on their wrist → arms this flag →
   * the Enter appended by the scanner fires → multi-qty guard bypassed.
   */
  multiQtyArmed: boolean;
}

export type ScannerEvent =
  { type: 'CHAR'; char: string; at: number } | { type: 'DISARM_MULTI' } | { type: 'CLEAR' };

export function initialScannerState(): ScannerState {
  return { buffer: '', lastCharAt: 0, inputSource: 'keyboard', multiQtyArmed: false };
}

export function scannerReducer(state: ScannerState, event: ScannerEvent): ScannerState {
  switch (event.type) {
    case 'CHAR': {
      const gap = state.lastCharAt > 0 ? event.at - state.lastCharAt : Infinity;
      const source: InputSource = gap < SCANNER_THRESHOLD_MS ? 'scanner' : 'keyboard';
      if (event.char === '.') {
        // Dot is the arm signal; it is not part of any product filter query.
        return { ...state, lastCharAt: event.at, inputSource: source, multiQtyArmed: true };
      }
      return {
        ...state,
        buffer: state.buffer + event.char,
        lastCharAt: event.at,
        inputSource: source,
      };
    }
    case 'DISARM_MULTI':
      return { ...state, multiQtyArmed: false };
    case 'CLEAR':
      return { buffer: '', lastCharAt: 0, inputSource: 'keyboard', multiQtyArmed: false };
  }
}
