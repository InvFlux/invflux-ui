import { describe, expect, it } from 'vitest';
import { createLineSync } from './lineSync';

describe('createLineSync', () => {
  it('sends a scan as an increment', () => {
    const s = createLineSync();
    s.added(7, 1);
    expect(s.take(7)).toEqual({ kind: 'add', units: 1 });
    expect(s.busy(7)).toBe(true);
  });

  it('adds up scans landing while a write is out, and sends them as one', () => {
    const s = createLineSync();
    s.added(7, 1);
    s.take(7);
    s.added(7, 1);
    s.added(7, 1);
    expect(s.take(7)).toBeNull(); // one write per line at a time
    expect(s.unitsOwed(7)).toBe(2);
    s.settled(7);
    expect(s.take(7)).toEqual({ kind: 'add', units: 2 });
  });

  it('lets a typed figure supersede scans still owed', () => {
    const s = createLineSync();
    s.added(7, 1);
    s.take(7);
    s.added(7, 1);
    s.edited(7);
    expect(s.unitsOwed(7)).toBe(0);
    s.settled(7);
    expect(s.take(7)).toEqual({ kind: 'figure' });
    expect(s.owes(7)).toBe(false);
  });

  it('folds scans after a typed figure into that figure', () => {
    const s = createLineSync();
    s.edited(7);
    s.added(7, 1);
    expect(s.unitsOwed(7)).toBe(0);
    expect(s.take(7)).toEqual({ kind: 'figure' });
  });

  it('keeps lines apart', () => {
    const s = createLineSync();
    s.added(1, 1);
    s.take(1);
    s.edited(2);
    expect(s.take(2)).toEqual({ kind: 'figure' });
    expect(s.busy(1)).toBe(true);
  });

  it('owes nothing once its write is taken and settled', () => {
    const s = createLineSync();
    s.added(7, 3);
    s.take(7);
    s.settled(7);
    expect(s.owes(7)).toBe(false);
    expect(s.take(7)).toBeNull();
  });
});
