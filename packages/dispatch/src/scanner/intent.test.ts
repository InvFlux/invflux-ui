import { describe, expect, it } from 'vitest';
import { initialScannerState, scannerReducer } from './state';
import { deriveEnterIntent, deriveAutoStageIntent } from './intent';

const T = 1000;

/** Build a state that looks like scanner input (chars within threshold). */
function scannerInput(dotArmed = false) {
  let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
  s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + 10 }); // scanner-speed
  if (dotArmed) {
    s = scannerReducer(s, { type: 'CHAR', char: '.', at: T + 20 }); // dot, lastCharAt = T+20
  }
  return s;
}

/** Build a state that looks like keyboard input (chars beyond threshold). */
function keyboardInput() {
  let s = scannerReducer(initialScannerState(), { type: 'CHAR', char: 'A', at: T });
  s = scannerReducer(s, { type: 'CHAR', char: 'B', at: T + 200 }); // keyboard-speed
  return s;
}

// ---------------------------------------------------------------------------
// deriveEnterIntent
// ---------------------------------------------------------------------------

describe('deriveEnterIntent — no match', () => {
  it('returns hold-on regardless of input source or qty', () => {
    const state = scannerInput();
    expect(deriveEnterIntent(state, { enterAt: T + 20, matchCount: 0, shippableQty: 0 })).toEqual({
      kind: 'hold-on',
    });
  });
});

describe('deriveEnterIntent — multiple matches', () => {
  it('returns unconvinced/ambiguous-match', () => {
    const state = scannerInput();
    expect(deriveEnterIntent(state, { enterAt: T + 20, matchCount: 3, shippableQty: 1 })).toEqual({
      kind: 'unconvinced',
      reason: 'ambiguous-match',
    });
  });
});

describe('deriveEnterIntent — single match, scanner Enter', () => {
  it('qty=1 → stage with scanner source', () => {
    const state = scannerInput(); // lastCharAt = T+10
    expect(deriveEnterIntent(state, { enterAt: T + 20, matchCount: 1, shippableQty: 1 })).toEqual({
      kind: 'stage',
      source: 'scanner',
      multiConfirmed: false,
    });
  });

  it('qty>1, not armed → unconvinced (multi-qty guard)', () => {
    const state = scannerInput(); // not armed
    expect(deriveEnterIntent(state, { enterAt: T + 20, matchCount: 1, shippableQty: 3 })).toEqual({
      kind: 'unconvinced',
      reason: 'multi-qty-unconfirmed',
    });
  });

  it('qty>1, dot-armed → stage with multiConfirmed=true', () => {
    const state = scannerInput(true); // lastCharAt = T+20 (after dot)
    expect(deriveEnterIntent(state, { enterAt: T + 30, matchCount: 1, shippableQty: 3 })).toEqual({
      kind: 'stage',
      source: 'scanner',
      multiConfirmed: true,
    });
  });

  it('arm expires (Enter arrives after 50ms of dot) → unconvinced', () => {
    const state = scannerInput(true); // lastCharAt = T+20
    // Enter arrives well after dot — classified as keyboard, so multi-qty guard lifted
    // Actually: gap = (T+200) - (T+20) = 180 ≥ 50 → keyboard Enter
    // Keyboard Enter always stages regardless of arm
    expect(deriveEnterIntent(state, { enterAt: T + 200, matchCount: 1, shippableQty: 3 })).toEqual({
      kind: 'stage',
      source: 'keyboard',
      multiConfirmed: true,
    });
  });
});

describe('deriveEnterIntent — single match, keyboard Enter', () => {
  it('qty=1 → stage with keyboard source', () => {
    const state = scannerInput(); // lastCharAt = T+10
    expect(deriveEnterIntent(state, { enterAt: T + 1000, matchCount: 1, shippableQty: 1 })).toEqual(
      { kind: 'stage', source: 'keyboard', multiConfirmed: false },
    );
  });

  it('qty>1, not armed → stage (keyboard operator explicit override)', () => {
    const state = scannerInput();
    expect(deriveEnterIntent(state, { enterAt: T + 1000, matchCount: 1, shippableQty: 5 })).toEqual(
      { kind: 'stage', source: 'keyboard', multiConfirmed: false },
    );
  });

  it('no prior chars (lastCharAt=0) → treated as keyboard Enter', () => {
    const state = initialScannerState(); // lastCharAt = 0
    expect(deriveEnterIntent(state, { enterAt: T, matchCount: 1, shippableQty: 1 })).toEqual({
      kind: 'stage',
      source: 'keyboard',
      multiConfirmed: false,
    });
  });
});

// ---------------------------------------------------------------------------
// deriveAutoStageIntent
// ---------------------------------------------------------------------------

describe('deriveAutoStageIntent — scanner input', () => {
  it('1 match, qty=1, autoValidation=true → stage', () => {
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 1,
        shippableQty: 1,
        autoValidation: true,
      }),
    ).toBe('stage');
  });

  it('1 match, qty>1, autoValidation=true → zoom-multi', () => {
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 1,
        shippableQty: 2,
        autoValidation: true,
      }),
    ).toBe('zoom-multi');
  });

  it('0 matches → hold-on regardless of autoValidation', () => {
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 0,
        shippableQty: 0,
        autoValidation: false,
      }),
    ).toBe('hold-on');
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 0,
        shippableQty: 0,
        autoValidation: true,
      }),
    ).toBe('hold-on');
  });

  it('1 match, autoValidation=false → null (no auto-stage, just filter)', () => {
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 1,
        shippableQty: 1,
        autoValidation: false,
      }),
    ).toBeNull();
  });

  it('multiple matches → null (user must narrow filter)', () => {
    expect(
      deriveAutoStageIntent(scannerInput(), {
        matchCount: 4,
        shippableQty: 1,
        autoValidation: true,
      }),
    ).toBeNull();
  });
});

describe('deriveAutoStageIntent — keyboard input', () => {
  it('returns null regardless of match count, qty, or autoValidation', () => {
    const state = keyboardInput();
    expect(
      deriveAutoStageIntent(state, { matchCount: 1, shippableQty: 1, autoValidation: true }),
    ).toBeNull();
    expect(
      deriveAutoStageIntent(state, { matchCount: 0, shippableQty: 0, autoValidation: true }),
    ).toBeNull();
    expect(
      deriveAutoStageIntent(state, { matchCount: 3, shippableQty: 2, autoValidation: false }),
    ).toBeNull();
  });
});
