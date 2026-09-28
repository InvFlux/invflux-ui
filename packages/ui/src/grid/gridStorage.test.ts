import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createRoot } from 'solid-js';

// This package's tests run in `node` deliberately (no JSX runtime, no DOM), so storage is stubbed
// in-memory rather than pulling in jsdom for one module. It is also the more honest fixture here:
// what these tests care about is the read / validate / write contract and how it behaves when
// storage refuses, and a hand-written double can be made to refuse on demand.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}
const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);
import {
  gridStorageKey,
  isColumnOrder,
  isNumberRecord,
  isStringArray,
  isVisibility,
  persistedGridSignal,
} from './gridStorage';

describe('gridStorageKey', () => {
  it('names a surface, so two grids only share a layout deliberately', () => {
    expect(gridStorageKey('po-draft', 'col_pinned')).toBe('invflux:grid:po-draft:col_pinned');
    expect(gridStorageKey('central-workbench', 'cols')).toBe('invflux:grid:central-workbench:cols');
  });
});

describe('persistedGridSignal', () => {
  beforeEach(() => storage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reads a stored value back', () =>
    createRoot((dispose) => {
      localStorage.setItem('invflux:grid:s:col_pinned', JSON.stringify(['name']));
      const [get] = persistedGridSignal<string[]>('s', 'col_pinned', [], isStringArray);
      expect(get()).toEqual(['name']);
      dispose();
    }));

  it('falls back when nothing is stored', () =>
    createRoot((dispose) => {
      const [get] = persistedGridSignal<string[]>('s', 'col_pinned', ['sku'], isStringArray);
      expect(get()).toEqual(['sku']);
      dispose();
    }));

  it('discards a stored value of the wrong shape rather than adopting it', () =>
    createRoot((dispose) => {
      // The ordinary result of a rename or a downgrade. Adopted, it renders an empty grid — which
      // looks like lost data rather than a bad read, so it must never reach the signal.
      localStorage.setItem('invflux:grid:s:col_pinned', JSON.stringify({ name: true }));
      const [get] = persistedGridSignal<string[]>('s', 'col_pinned', [], isStringArray);
      expect(get()).toEqual([]);
      dispose();
    }));

  it('survives unparseable storage', () =>
    createRoot((dispose) => {
      localStorage.setItem('invflux:grid:s:cols', '{not json');
      const [get] = persistedGridSignal('s', 'cols', {}, isVisibility);
      expect(get()).toEqual({});
      dispose();
    }));

  it('keeps working in memory when storage cannot be written', () =>
    createRoot((dispose) => {
      vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const [get, set] = persistedGridSignal<string[]>('s', 'col_pinned', [], isStringArray);
      set(() => ['name']);
      // A grid that cannot SAVE a layout must still SHOW one.
      expect(get()).toEqual(['name']);
      dispose();
    }));

  it('keeps working when storage cannot be read at all', () =>
    createRoot((dispose) => {
      vi.spyOn(storage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const [get] = persistedGridSignal<string[]>('s', 'col_order', ['a'], isStringArray);
      expect(get()).toEqual(['a']);
      dispose();
    }));
});

describe('guards', () => {
  it('accepts the shapes each piece is stored as', () => {
    expect(isStringArray(['a', 'b'])).toBe(true);
    expect(isNumberRecord({ a: 1 })).toBe(true);
    expect(isVisibility({ a: true })).toBe(true);
    expect(isColumnOrder(['a'])).toBe(true);
  });

  it('rejects a mixed array, not just a wholly wrong type', () => {
    // The shape a half-migrated value actually takes.
    expect(isStringArray(['a', 3])).toBe(false);
    expect(isNumberRecord({ a: 1, b: 'x' })).toBe(false);
    expect(isVisibility({ a: true, b: 1 })).toBe(false);
  });

  it('rejects null, which typeof calls an object', () => {
    expect(isNumberRecord(null)).toBe(false);
    expect(isVisibility(null)).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });
});
