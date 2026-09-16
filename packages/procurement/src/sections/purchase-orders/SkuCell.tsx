import { __ } from '@invflux/i18n';
import { type JSX, Show } from 'solid-js';
import type { PoLine } from './types';

/**
 * Whether two product codes are the same code written differently.
 *
 * A UPC-A is a GTIN-12, and a GTIN-12 is a GTIN-13 or GTIN-14 with zeros in front, so the same
 * barcode arrives as `20714445355`, `020714445355` or `0020714445355` depending on who typed it.
 * Leading zeros carry no information in any of them.
 */
export const sameCode = (a: string, b: string): boolean =>
  a.trim().replace(/^0+/, '') === b.trim().replace(/^0+/, '');

/**
 * Our SKU, with the GTIN beneath it — but only where the two differ, since a store that uses the
 * barcode as its SKU would otherwise see every code twice.
 */
export function SkuCell(props: { line: PoLine }): JSX.Element {
  const gtin = (): string | null => {
    const { gtin, sku } = props.line;
    return gtin && !(sku && sameCode(gtin, sku)) ? gtin : null;
  };

  // No wrapper div — code + GTIN are direct cell children so the grid's no-wrap truncation reaches them.
  return (
    <>
      <span class="block font-mono text-slate-500">{props.line.sku ?? '—'}</span>
      <Show when={gtin()}>
        {(code) => (
          <div class="text-xs text-text-muted">
            <span class="text-slate-300">{__('GTIN')}:</span> {code()}
          </div>
        )}
      </Show>
    </>
  );
}
