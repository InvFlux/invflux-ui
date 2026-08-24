import { describe, expect, it } from 'vitest';
import { checkStageGuard, isReadyForAutoAdvance } from './guards';

// ---------------------------------------------------------------------------
// checkStageGuard
// ---------------------------------------------------------------------------

describe('checkStageGuard', () => {
  it('ok — scanner input on EAN product by non-admin', () => {
    expect(checkStageGuard({ shippableQty: 1, hasEan: true, isAdmin: false, inputSource: 'scanner' }))
      .toBe('ok');
  });

  it('ean-noscan — keyboard input on EAN product by non-admin', () => {
    expect(checkStageGuard({ shippableQty: 1, hasEan: true, isAdmin: false, inputSource: 'keyboard' }))
      .toBe('ean-noscan');
  });

  it('ok — keyboard input on EAN product by admin', () => {
    expect(checkStageGuard({ shippableQty: 1, hasEan: true, isAdmin: true, inputSource: 'keyboard' }))
      .toBe('ok');
  });

  it('ok — keyboard input on no-EAN product by non-admin', () => {
    expect(checkStageGuard({ shippableQty: 1, hasEan: false, isAdmin: false, inputSource: 'keyboard' }))
      .toBe('ok');
  });

  it('no-shippable-qty — takes priority over EAN enforcement', () => {
    expect(checkStageGuard({ shippableQty: 0, hasEan: true, isAdmin: false, inputSource: 'keyboard' }))
      .toBe('no-shippable-qty');
  });

  it('no-shippable-qty — even with scanner input', () => {
    expect(checkStageGuard({ shippableQty: 0, hasEan: false, isAdmin: true, inputSource: 'scanner' }))
      .toBe('no-shippable-qty');
  });
});

// ---------------------------------------------------------------------------
// isReadyForAutoAdvance
// ---------------------------------------------------------------------------

describe('isReadyForAutoAdvance', () => {
  it('true — all lines staged, no corrections, no unshipped', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['M', 'M'],
      unprocessedCorrections: 0,
      unshippedLineCount: 0,
    })).toBe(true);
  });

  it('false — no lines in M stage', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['', ''],
      unprocessedCorrections: 0,
      unshippedLineCount: 0,
    })).toBe(false);
  });

  it('false — pending unprocessed corrections', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['M'],
      unprocessedCorrections: 1,
      unshippedLineCount: 0,
    })).toBe(false);
  });

  it('false — at least one line in W (put-aside = stuck exception)', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['M', 'W'],
      unprocessedCorrections: 0,
      unshippedLineCount: 0,
    })).toBe(false);
  });

  it('false — unshipped lines remain outside staged set', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['M'],
      unprocessedCorrections: 0,
      unshippedLineCount: 1,
    })).toBe(false);
  });

  it('false — E-staged lines do not count as ready (error/exception state)', () => {
    expect(isReadyForAutoAdvance({
      stagedLines: ['E', 'E'],
      unprocessedCorrections: 0,
      unshippedLineCount: 0,
    })).toBe(false);
  });

  it('true — mix of already-shipped and freshly staged M lines', () => {
    // unshippedLineCount=0 means the M lines account for all remaining unshipped qty
    expect(isReadyForAutoAdvance({
      stagedLines: ['M', 'M', 'M'],
      unprocessedCorrections: 0,
      unshippedLineCount: 0,
    })).toBe(true);
  });
});
