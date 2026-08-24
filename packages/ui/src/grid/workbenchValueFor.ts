import type { WorkbenchRow } from '../workbenchGridTypes';
import { productTypeKind } from '../datatypes/views';

const TAXONOMY_PREFIX = 'taxonomy.';

/** snake_case → camelCase (e.g. `catalog_visibility` → `catalogVisibility`, `image_url` → `imageUrl`). */
function snakeToCamel(id: string): string {
  return id.replace(/_([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
}

/**
 * The WorkbenchGrid value seam: resolve a column's value for a row by its server-emitted column id.
 * This is the default `getValue` the grid hands to the underlying {@link DataGrid} — a pure function
 * of (row, columnId) with no per-column table to maintain:
 *
 * - **core columns** → the matching camelCase {@link WorkbenchRow} field. Every core column id is the
 *   snake_case form of its field (`catalog_visibility` → `catalogVisibility`, `image_url` →
 *   `imageUrl`), so the mapping is a pure snake→camel conversion — a newly server-declared core
 *   column needs no client change here.
 * - **`taxonomy.{name}`** → the row's `taxonomy` bag (term-id list, `[]` when absent).
 * - **anything else** (add-on / dispatch / costing columns) → the `extra` bag (`undefined` when absent).
 *
 * Moved verbatim from `@invflux/workbench`'s `columns/valueFor.ts` during the WorkbenchGrid
 * extraction so both the Central Workbench and the embedded product-inventory grid share one seam.
 */
export function workbenchValueFor(row: WorkbenchRow, columnId: string): unknown {
  if (columnId.startsWith(TAXONOMY_PREFIX)) {
    const taxonomyName = columnId.slice(TAXONOMY_PREFIX.length);
    return row.taxonomy?.[taxonomyName] ?? [];
  }

  // The Type column's canonical value is the role-aware kind, not the raw `productType` slug (a
  // variation row carries its parent's "variable" slug). This keeps copy in step with the icon view,
  // which resolves the same way — otherwise copying a variation's Type cell yields "variable".
  if (columnId === 'product_type') {
    return productTypeKind(row.productType, row);
  }

  const field = snakeToCamel(columnId) as keyof WorkbenchRow;
  if (field in row) {
    return row[field];
  }

  return row.extra?.[columnId];
}

/**
 * The inverse of {@link workbenchValueFor}: return a shallow copy of `row` with a live-update patch's
 * fields applied. `fields` is keyed by column id (the wire shape of a {@link RowPatch}); each is
 * routed to its home the same way `workbenchValueFor` reads it — a core column to its camelCase
 * field, `taxonomy.{name}` to the taxonomy bag, anything else to the `extra` bag. Used by the grid to
 * fold live-stock (and future audit) deltas into rows without mutating the query cache.
 */
export function applyRowPatch(row: WorkbenchRow, fields: Record<string, unknown>): WorkbenchRow {
  const patched: WorkbenchRow = { ...row };
  for (const [columnId, value] of Object.entries(fields)) {
    if (columnId.startsWith(TAXONOMY_PREFIX)) {
      const taxonomyName = columnId.slice(TAXONOMY_PREFIX.length);
      patched.taxonomy = { ...(patched.taxonomy ?? {}), [taxonomyName]: value as number[] };
      continue;
    }
    const field = snakeToCamel(columnId);
    if (field in row) {
      (patched as unknown as Record<string, unknown>)[field] = value;
    } else {
      patched.extra = { ...(patched.extra ?? {}), [columnId]: value };
    }
  }
  return patched;
}
