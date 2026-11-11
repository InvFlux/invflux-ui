import { describe, expect, it } from 'vitest';
import { keepUnchanged } from './queryReconcile';

describe('keepUnchanged', () => {
  const load = () => ({
    lines: [
      { subjectId: 1, qty: 3, codes: ['A1', 'A2'] },
      { subjectId: 2, qty: 5, codes: ['B1'] },
    ],
  });

  it('keeps the previous data whole when a refetch brings back the same content', () => {
    const before = load();
    expect(keepUnchanged(before, load())).toBe(before);
  });

  it('replaces only the objects on the path of a change', () => {
    const before = load();
    const next = load();
    next.lines[1].qty = 6;
    const out = keepUnchanged(before, next);
    expect(out).not.toBe(before);
    expect(out.lines[0]).toBe(before.lines[0]);
    expect(out.lines[1]).not.toBe(before.lines[1]);
    expect(out.lines[1].codes).toBe(before.lines[1].codes);
    expect(out.lines[1].qty).toBe(6);
  });

  it('takes the new data on the first load', () => {
    const next = load();
    expect(keepUnchanged(undefined, next)).toBe(next);
  });
});
