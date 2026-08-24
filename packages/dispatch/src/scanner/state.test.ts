import { describe, expect, it } from 'vitest';
import { SCANNER_THRESHOLD_MS, initialScannerState, scannerReducer } from './state';

const T = 1000; // arbitrary base timestamp

describe('scannerReducer — CHAR', () => {
  it('first character is always keyboard (no prior timing reference)', () => {
    const s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    expect(s.inputSource).toBe('keyboard');
    expect(s.buffer).toBe('A');
    expect(s.lastCharAt).toBe(T);
  });

  it('character arriving within threshold is scanner input', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + SCANNER_THRESHOLD_MS - 1 });
    expect(s.inputSource).toBe('scanner');
    expect(s.buffer).toBe('AB');
  });

  it('character arriving exactly at threshold is keyboard', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + SCANNER_THRESHOLD_MS });
    expect(s.inputSource).toBe('keyboard');
  });

  it('character arriving beyond threshold is keyboard', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + 500 });
    expect(s.inputSource).toBe('keyboard');
    expect(s.buffer).toBe('AB');
  });

  it('dot sets multiQtyArmed and is excluded from the buffer', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 10 });
    expect(s.multiQtyArmed).toBe(true);
    expect(s.buffer).toBe('A');
  });

  it('dot updates lastCharAt so subsequent Enter timing is measured correctly', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 10 });
    expect(s.lastCharAt).toBe(T + 10);
  });

  it('dot is classified scanner or keyboard by its own gap', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    // dot arrives 200ms later → keyboard speed
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 200 });
    expect(s.inputSource).toBe('keyboard');
    expect(s.multiQtyArmed).toBe(true); // armed regardless of speed
  });
});

describe('scannerReducer — DISARM_MULTI', () => {
  it('clears multiQtyArmed', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: '.', at: T });
    expect(s.multiQtyArmed).toBe(true);
    s = scannerReducer(s, { type: 'DISARM_MULTI' });
    expect(s.multiQtyArmed).toBe(false);
  });

  it('leaves all other fields unchanged', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 10 });
    const { multiQtyArmed: _, ...before } = s;
    const after = scannerReducer(s, { type: 'DISARM_MULTI' });
    const { multiQtyArmed: __, ...afterRest } = after;
    expect(afterRest).toEqual(before);
  });
});

describe('scannerReducer — CLEAR', () => {
  it('resets to initial state regardless of prior input', () => {
    let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
    s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + 10 });
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 20 });
    s = scannerReducer(s, { type: 'CLEAR' });
    expect(s).toEqual(initialScannerState());
  });
});
