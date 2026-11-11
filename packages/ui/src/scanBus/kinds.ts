import { __ } from '@invflux/i18n';

/**
 * Kinds of code a scan target accepts.
 *
 * A target names a kind, and the bus checks the code against it before delivering. The check is on the
 * code's content, never on its symbology: a wedge does not report which symbology it read, so a rule
 * that needed one would hold for the camera only.
 *
 * Kinds are contributed, not fixed. The base registers `gtin`, `product` and `any`; a package that holds
 * a kind of its own (locations, say) registers it with {@link registerScanKind}.
 */
export interface ScanKind {
  /** Whether a code is of this kind. */
  test: (code: string) => boolean;
  /** What the operator is told when a target of this kind refuses a code. Called when shown, never at boot. */
  refusal: () => string;
}

const kinds = new Map<string, ScanKind>();

/** Register (or replace) a kind of code. */
export function registerScanKind(name: string, kind: ScanKind): void {
  kinds.set(name, kind);
}

/** A registered kind, or undefined. */
export function scanKind(name: string): ScanKind | undefined {
  return kinds.get(name);
}

/**
 * Whether a string of 8, 12, 13 or 14 digits carries a valid GS1 check digit.
 *
 * The check digit is the last one; the others are weighted 3 and 1 alternately from the right, so the
 * same rule holds for every length.
 */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = 4 - weight)
    sum += digits[i]! * weight;

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * A GTIN as its 14-digit key, so the forms of one code compare equal: a UPC-A is reported as 12 digits by
 * one decoder and as a 13-digit EAN with a leading zero by another. Null for a code that is not a GTIN.
 */
export function gtinKey(code: string): string | null {
  return isValidGtin(code) ? code.padStart(14, '0') : null;
}

registerScanKind('any', { test: () => true, refusal: () => '' });

// A product code is anything the server may resolve to a product (a GTIN, a SKU, an extra barcode), so
// the client refuses only what can be nothing at all.
registerScanKind('product', {
  test: (code) => '' !== code.trim(),
  refusal: () => __('Not a product code.'),
});

registerScanKind('gtin', {
  test: isValidGtin,
  refusal: () => __('Not a valid GTIN.'),
});
