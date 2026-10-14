import { describe, expect, it } from 'vitest';
import type { WorkbenchRow } from '../workbenchGridTypes';
import { workbenchFooterSum } from './workbenchFooterSum';

type Shape = Pick<WorkbenchRow, 'subjectId' | 'wcProductId' | 'role' | 'total' | 'stockValue'>;

const row = (shape: Shape): WorkbenchRow => shape as WorkbenchRow;
const totalOf = (r: WorkbenchRow): number => r.total;
const valueOf = (r: WorkbenchRow): number =>
  r.stockValue === null || r.stockValue === undefined ? NaN : Number(r.stockValue);

// A family of two variations (3 + 4 units, valued 30.00 + 40.00) and a simple product of 5 units
// valued 50.00. The parent comes in two forms: as the Workbench shows it (its variations summed into
// it) and as the server sends it, which the product page's Inventory tab shows as is (0 units).
const summedParent = row({ subjectId: 1, wcProductId: 10, role: 'parent', total: 7, stockValue: null });
const serverParent = row({ subjectId: 1, wcProductId: 10, role: 'parent', total: 0, stockValue: null });
const blue = row({ subjectId: 2, wcProductId: 10, role: 'variation', total: 3, stockValue: '30.00' });
const red = row({ subjectId: 3, wcProductId: 10, role: 'variation', total: 4, stockValue: '40.00' });
const simple = row({ subjectId: 4, wcProductId: 20, role: 'simple', total: 5, stockValue: '50.00' });

describe('workbenchFooterSum', () => {
  it('counts an unfolded family once, through its variations', () => {
    expect(workbenchFooterSum([summedParent, blue, red, simple], 'total', totalOf)).toBe(12);
  });

  it('counts the variations whatever the parent row shows', () => {
    expect(workbenchFooterSum([serverParent, blue, red, simple], 'total', totalOf)).toBe(12);
  });

  it('counts a folded family through its parent', () => {
    expect(workbenchFooterSum([summedParent, simple], 'total', totalOf)).toBe(12);
  });

  it('values an unfolded family through its variations', () => {
    expect(workbenchFooterSum([summedParent, blue, red, simple], 'stock_value', valueOf)).toBe(120);
  });

  it('counts a variation shown without its parent', () => {
    expect(workbenchFooterSum([red, simple], 'total', totalOf)).toBe(9);
  });

  it('counts the variations shown when only some of a family is displayed', () => {
    expect(workbenchFooterSum([summedParent, red, simple], 'total', totalOf)).toBe(9);
  });
});
