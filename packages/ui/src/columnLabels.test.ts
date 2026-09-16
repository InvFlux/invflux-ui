import { describe, expect, it } from 'vitest';
import {
  applyColumnOverrides,
  columnOverridesForSave,
  isRenamedColumn,
  shippedLabel,
} from './columnLabels';
import type { GridColumnMeta } from './types';

/**
 * The save endpoint replaces the whole map for a locale rather than merging one entry, so the body
 * has to carry every override in force. Sending only the edited column would clear every other
 * rename in the store — silently, for everyone, from a control whose neighbours are all per-user.
 * Nothing about the call site's shape makes that visible, which is why it is asserted here.
 */
const col = (id: string, label: string, defaultLabel?: string): GridColumnMeta =>
  ({ id, label, defaultLabel, kind: 'read_only', editable: false }) as unknown as GridColumnMeta;

describe('shippedLabel / isRenamedColumn', () => {
  it('treats a missing defaultLabel as "same as label"', () => {
    // The PO grids and supplier products build their own metadata and have no second name for a
    // column; absent must read as "not renamed", never as renamed-to-undefined.
    const plain = col('qty', 'Quantity');
    expect(shippedLabel(plain)).toBe('Quantity');
    expect(isRenamedColumn(plain)).toBe(false);
  });

  it('reads a rename off the pair, with no separate state', () => {
    expect(isRenamedColumn(col('sku', 'SKU', 'UGS'))).toBe(true);
    expect(isRenamedColumn(col('sku', 'UGS', 'UGS'))).toBe(false);
  });
});

describe('columnOverridesForSave', () => {
  const columns = [
    col('sku', 'SKU', 'UGS'),
    col('wac', 'CMP', 'Unit cost (WAC)'),
    col('price', 'Price', 'Price'),
    col('qty', 'Quantity'),
  ];

  it('carries EVERY override, not just the one being edited', () => {
    // The regression this guards: a body of `{ price: 'Tarif' }` would erase the sku and wac
    // renames, because the endpoint is a put.
    expect(columnOverridesForSave(columns, { columnId: 'price', label: 'Tarif' })).toEqual({
      sku: 'SKU',
      wac: 'CMP',
      price: 'Tarif',
    });
  });

  it('omits columns that are not renamed', () => {
    expect(columnOverridesForSave(columns)).toEqual({ sku: 'SKU', wac: 'CMP' });
  });

  it('lets the edit win, including an empty string', () => {
    // Empty is how the picker says "reset this one" without needing a second control, so it must
    // survive into the body rather than being filtered out as falsy.
    expect(columnOverridesForSave(columns, { columnId: 'sku', label: '' })).toEqual({
      sku: '',
      wac: 'CMP',
    });
  });

  it('can add an override for a column that had none', () => {
    expect(columnOverridesForSave(columns, { columnId: 'qty', label: 'Qté' })).toEqual({
      sku: 'SKU',
      wac: 'CMP',
      qty: 'Qté',
    });
  });
});

describe('applyColumnOverrides', () => {
  const columns = [col('sku', 'SKU', 'UGS'), col('wac', 'CMP', 'Unit cost (WAC)')];

  it('recomputes from the server map rather than from the typed text', () => {
    // The server trims, caps and drops; echoing the input would put a name on screen the store
    // never accepted.
    const next = applyColumnOverrides(columns, { sku: 'Réf.' });
    expect(next.map((c) => c.label)).toEqual(['Réf.', 'Unit cost (WAC)']);
  });

  it('falls a dropped override back to the shipped name — that is how a reset propagates', () => {
    expect(applyColumnOverrides(columns, {}).map((c) => c.label)).toEqual([
      'UGS',
      'Unit cost (WAC)',
    ]);
  });

  it('leaves every other field of the column untouched', () => {
    const [first] = applyColumnOverrides(columns, { sku: 'Réf.' });
    expect(first?.id).toBe('sku');
    expect(first?.defaultLabel).toBe('UGS');
  });
});
