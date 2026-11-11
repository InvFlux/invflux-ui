/**
 * The duplicate-code check's pure half: the form a code is compared in, by the codes its column
 * competes with (the server's `CodeSpace`), and the duplicates among the codes the grid has staged.
 * The store-wide half is the server's (`POST /workbench/code-collisions`); WooCommerce's own check
 * when the edit is saved stays the final word.
 */

import { __, sprintf } from '@invflux/i18n';

/** The codes a column's value competes with, as the server names them; open to add-on spaces. */
export type CodeSpace = 'sku' | 'gtin' | 'scannable' | (string & {});

/** A staged code: a product, a column whose values may not repeat, the value staged into it. */
export interface StagedCode {
  subjectId: number;
  columnId: string;
  space: CodeSpace;
  value: string;
}

/** The product already holding a code, as the server names it. */
export interface CodeHolder {
  subjectId: number;
  postId: number;
  /** Its name as WooCommerce titles it; empty when the refusal names no product. */
  name: string;
  sku: string;
}

/** A staged code the server found held by another product. */
export interface CodeCollision {
  subjectId: number;
  columnId: string;
  value: string;
  holder: CodeHolder;
}

/**
 * The form two codes of one space are compared in, or null for a value never checked (an empty one,
 * or `0`, which WooCommerce treats as empty). A SKU as WooCommerce's table usually compares it:
 * blind to case and to trailing spaces. A GTIN stripped of everything WooCommerce strips. A scanned
 * code by the scan matcher's key: digits without leading zeros, anything else lower-cased.
 */
export function codeCompareForm(space: CodeSpace, value: string): string | null {
  let form: string;
  if (space === 'gtin') form = value.replace(/[^0-9Xx-]/g, '').toLowerCase();
  else if (space === 'scannable') {
    const trimmed = value.trim();
    form = /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed.toLowerCase();
  } else form = value.replace(/\s+$/u, '').toLowerCase();
  return form === '' || form === '0' ? null : form;
}

/** The key a cell's check results are kept under. */
export const cellKey = (subjectId: number, columnId: string): string => `${subjectId}:${columnId}`;

/**
 * Staged codes that another staged code of the same column equals, each with the first other
 * product staging it, by {@link cellKey}. Two products cannot both take one code, whichever saves
 * first, so both are marked.
 */
export function stagedDuplicates(codes: StagedCode[]): Map<string, number> {
  const byForm = new Map<string, number[]>();
  for (const code of codes) {
    const form = codeCompareForm(code.space, code.value);
    if (form === null) continue;
    const key = `${code.columnId}\u0000${form}`;
    const subjects = byForm.get(key) ?? [];
    if (!subjects.includes(code.subjectId)) subjects.push(code.subjectId);
    byForm.set(key, subjects);
  }
  const out = new Map<string, number>();
  for (const code of codes) {
    const form = codeCompareForm(code.space, code.value);
    if (form === null) continue;
    const subjects = byForm.get(`${code.columnId}\u0000${form}`) ?? [];
    const other = subjects.find((s) => s !== code.subjectId);
    if (other !== undefined) out.set(cellKey(code.subjectId, code.columnId), other);
  }
  return out;
}

/** What a cell's field error says when its code is staged for another product too. */
export function stagedDuplicateMessage(value: string, otherName: string): string {
  return sprintf(
    /* translators: 1: a SKU, GTIN or barcode the merchant staged; 2: the name of another product it is also staged for. */
    __('%1$s is also staged for “%2$s”.'),
    value,
    otherName,
  );
}

/**
 * What a cell's field error says when another product holds its code. The holder may be a row of the
 * grid with its own change staged in that column: the code stays taken until that change is saved.
 */
export function heldCodeMessage(
  value: string,
  holderName: string,
  holderChangeStaged: boolean,
): string {
  if (holderName === '') {
    return sprintf(
      /* translators: %s: a SKU, GTIN or barcode the merchant staged, which WooCommerce reports as taken without naming the product. */
      __('%s is already used by another product.'),
      value,
    );
  }
  return holderChangeStaged
    ? sprintf(
        /* translators: 1: a SKU, GTIN or barcode the merchant staged; 2: the product holding it, whose own staged change in that column is not saved yet. */
        __('%1$s is used by “%2$s” until its change is saved.'),
        value,
        holderName,
      )
    : sprintf(
        /* translators: 1: a SKU, GTIN or barcode the merchant staged; 2: the name of the product that already has it. */
        __('%1$s is already used by “%2$s”.'),
        value,
        holderName,
      );
}
