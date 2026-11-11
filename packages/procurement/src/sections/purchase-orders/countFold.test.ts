import { describe, expect, it } from 'vitest';
import { foldCounts } from './countFold';

const empty = { received: {}, damaged: {} };

describe('foldCounts', () => {
  it('shows a count the server already holds, with no refresh needed', () => {
    const out = foldCounts(
      empty,
      { 5: { staged: { received: 3, damaged: 1 } } },
      [5, 6],
      () => false,
    );
    expect(out.received).toEqual({ 5: 3, 6: null });
    expect(out.damaged).toEqual({ 5: 1, 6: null });
  });

  it('keeps a line this screen is still sending', () => {
    const local = { received: { 5: 8 }, damaged: { 5: null } };
    const out = foldCounts(
      local,
      { 5: { staged: { received: 3, damaged: 0 } } },
      [5],
      (id) => 5 === id,
    );
    expect(out.received[5]).toBe(8);
  });

  it('empties a line a coworker cleared', () => {
    const local = { received: { 5: 4 }, damaged: { 5: 1 } };
    const out = foldCounts(local, { 5: { staged: null } }, [5], () => false);
    expect(out.received[5]).toBeNull();
    expect(out.damaged[5]).toBeNull();
  });

  it('shows zero received as a count, and zero damaged as blank', () => {
    const out = foldCounts(empty, { 5: { staged: { received: 0, damaged: 0 } } }, [5], () => false);
    expect(out.received[5]).toBe(0);
    expect(out.damaged[5]).toBeNull();
  });
});
