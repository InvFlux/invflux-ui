import { fuzzyScore } from '@invflux/ui/fuzzy';
import type { DispatchOrderLine, LineFilterField, LineFilterOptions } from '../types';

/** Every field a typed query can match, the default when a contribution names none. */
export const ALL_LINE_FILTER_FIELDS: readonly LineFilterField[] = ['name', 'sku', 'codes'];

/**
 * The order page's line filter: which lines a query keeps.
 *
 * Essentials offers no filter of its own; a contribution in the `order.detail.lines.header` slot
 * sets the query, and the host applies it to the table. How a query matches depends on how it was
 * entered, because a scan and a person typing ask different questions:
 *
 * - **`scan`** — a whole code read off a label. It matches a line whose code (its GTIN, or any other
 *   barcode its product carries) is that code, or whose SKU is that whole SKU. Never part of one: a
 *   short internal code `1234` must not find `SKU-12345` and stage the wrong product. Digits compare
 *   without their zero padding on both sides, since a GTIN is padded to a fixed width and the same
 *   product scans as 12, 13 or 14 digits; that holds for a digits-only SKU too, which is where many
 *   stores keep the barcode.
 * - **`typed`** — a person narrowing by hand. Name and SKU match by {@link fuzzyScore}, the picker's
 *   subsequence rule, in whichever of the two `fields` names; with `codes` among them a code keyed
 *   in full matches exactly, as for a label that will not scan. Lines keep their order; matching
 *   filters, it never ranks.
 *
 * Without options a query is a scan, the strict reading: a contribution that forgets to say how the
 * query was entered loses matches rather than gaining wrong ones. An empty or blank query keeps
 * every line.
 */
export function lineMatches(
  line: DispatchOrderLine,
  query: string,
  opts: LineFilterOptions = { mode: 'scan' },
): boolean {
  const q = query.trim();
  if (q === '') return true;

  const wanted = codeKey(q);
  const codeHit = (): boolean => lineCodes(line).some((code) => codeKey(code) === wanted);

  if (opts.mode === 'scan') {
    return codeHit() || (line.sku.trim() !== '' && codeKey(line.sku) === wanted);
  }

  const fields = opts.fields ?? ALL_LINE_FILTER_FIELDS;
  return (
    (fields.includes('name') && fuzzyScore(q, line.name) !== null) ||
    (fields.includes('sku') && line.sku !== '' && fuzzyScore(q, line.sku) !== null) ||
    (fields.includes('codes') && codeHit())
  );
}

/** The lines a query keeps, in their order. */
export function filterLines(
  lines: DispatchOrderLine[],
  query: string,
  opts?: LineFilterOptions,
): DispatchOrderLine[] {
  return query.trim() === '' ? lines : lines.filter((line) => lineMatches(line, query, opts));
}

function lineCodes(line: DispatchOrderLine): string[] {
  return [...(line.codes ?? []), ...(line.gtin ? [line.gtin] : [])];
}

/** A code as compared: digits without their zero padding, anything else case-folded. */
function codeKey(code: string): string {
  const trimmed = code.trim();

  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed.toLowerCase();
}
