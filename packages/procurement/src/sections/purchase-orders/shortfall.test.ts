import { describe, expect, it } from 'vitest';
import { createShortfallState, partsPresent, projectedSplit, splitLine } from './shortfall';

// The same cases as core's ShortfallTest::testTheSplitAlwaysAddsUpToWhatIsOpen — this mirror is what
// the prompt shows before the server re-derives the split at the close, so the two must agree.
describe('splitLine', () => {
  it('always adds up to what is open', () => {
    expect(splitLine(4, 10, null, 0)).toEqual({ undelivered: 4 });
    expect(splitLine(4, 10, 6, 0)).toEqual({ unconfirmed: 4 });
    expect(splitLine(12, 20, 12, 2)).toEqual({ unconfirmed: 8, undelivered: 2, damaged: 2 });
    expect(splitLine(5, 10, 14, 0)).toEqual({ undelivered: 5 });
    expect(splitLine(3, 10, 2, 5)).toEqual({ unconfirmed: 3 });
    expect(splitLine(0, 10, 2, 1)).toEqual({});
  });
});

describe('projectedSplit', () => {
  const line = { subjectId: 7, qtyRequested: 10, qtyExpected: 6, qtyDamagedSoFar: 0, qtyOpen: 10 };

  it('splits the remainder a count will leave', () => {
    // 6 counted, all good: the 4 never confirmed are what is left.
    expect(projectedSplit([line], [{ subjectId: 7, received: 6, damaged: 0 }])).toEqual({
      7: { unconfirmed: 4 },
    });
    // 6 counted, 1 damaged: the damaged unit is still open, beside the 4 unconfirmed.
    expect(
      partsPresent(projectedSplit([line], [{ subjectId: 7, received: 6, damaged: 1 }])),
    ).toEqual({
      unconfirmed: 4,
      damaged: 1,
    });
  });
});

describe('createShortfallState', () => {
  // Two lines: product 1 has 4 unconfirmed and 1 undelivered, product 2 has 2 undelivered.
  const split = { 1: { unconfirmed: 4, undelivered: 1 }, 2: { undelivered: 2 } };

  it('names each part some line has no cause for, and counts the attempt', () => {
    const s = createShortfallState();
    expect(s.issues(split)).toEqual({ causes: ['unconfirmed', 'undelivered'], note: false });
    expect(s.attempt(split)).toBe(false);
    expect(s.state.attempts).toBe(1);

    s.setPart('unconfirmed', { cause: 'out_of_stock', party: null });
    // A line override covers its own line only: product 2 still has no cause for undelivered.
    s.setLine(1, 'undelivered', { cause: 'shipped_short', party: null });
    expect(s.issues(split).causes).toEqual(['undelivered']);

    s.setPart('undelivered', { cause: 'withheld', party: null });
    expect(s.attempt(split)).toBe(true);
  });

  it('requires the note once a cause is not known yet', () => {
    const s = createShortfallState();
    s.setPart('unconfirmed', { cause: 'unknown', party: null });
    s.setPart('undelivered', { cause: 'out_of_stock', party: null });
    expect(s.issues(split)).toEqual({ causes: [], note: true });
    s.setNote('   ');
    expect(s.attempt(split)).toBe(false);
    s.setNote('Supplier has not answered');
    expect(s.attempt(split)).toBe(true);
  });

  it('starts over on reset, errors included', () => {
    const s = createShortfallState();
    s.attempt(split);
    s.reset();
    expect(s.state.attempts).toBe(0);
  });
});
