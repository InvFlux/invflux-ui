import { describe, expect, it } from 'vitest';
import { createUnsavedLines } from './unsavedLines';

describe('createUnsavedLines', () => {
  it('holds a changed line until a save covering it succeeds', () => {
    const u = createUnsavedLines();
    u.mark(7);
    expect(u.has(7)).toBe(true);
    const at = u.checkpoint();
    expect(u.has(7)).toBe(true); // the save is in flight: the server does not have it yet
    u.settle(at);
    expect(u.has(7)).toBe(false);
  });

  it('keeps a line changed again while its save was in flight', () => {
    const u = createUnsavedLines();
    u.mark(7);
    const first = u.checkpoint();
    u.mark(7); // a second scan lands before the first save returns
    u.settle(first);
    expect(u.has(7)).toBe(true);
    u.settle(u.checkpoint());
    expect(u.has(7)).toBe(false);
  });

  it('settles only the lines the save carried', () => {
    const u = createUnsavedLines();
    u.mark(1);
    const at = u.checkpoint();
    u.mark(2);
    u.settle(at);
    expect(u.has(1)).toBe(false);
    expect(u.has(2)).toBe(true);
  });

  it('leaves a failed save unsettled', () => {
    const u = createUnsavedLines();
    u.mark(3);
    u.checkpoint(); // taken, never settled
    expect(u.has(3)).toBe(true);
  });

  it('settles out-of-order saves without reviving a newer change', () => {
    const u = createUnsavedLines();
    u.mark(4);
    const a = u.checkpoint();
    u.mark(4);
    const b = u.checkpoint();
    u.settle(b); // the later save returns first
    expect(u.has(4)).toBe(false);
    u.settle(a); // the earlier one changes nothing now
    expect(u.has(4)).toBe(false);
  });

  it('settles one line without settling the others changed before the save', () => {
    const u = createUnsavedLines();
    u.mark(1);
    u.mark(2);
    const at = u.checkpoint();
    u.settleLine(2, at);
    expect(u.has(2)).toBe(false);
    expect(u.has(1)).toBe(true);
    expect(u.ids()).toEqual([1]);
  });

  it('keeps a line changed again after its own save was taken', () => {
    const u = createUnsavedLines();
    u.mark(5);
    const at = u.checkpoint();
    u.mark(5);
    u.settleLine(5, at);
    expect(u.has(5)).toBe(true);
  });
});
