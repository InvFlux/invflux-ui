import { __ } from '@invflux/i18n';
import type { DropdownMenuItem } from './DropdownMenu';
import type { HostNav } from './hostNav';

/**
 * One host-native product link, as the adapter emits it. `kind` is a platform-agnostic hint the UI
 * maps to a leading glyph — a WooCommerce adapter emits `catalog-edit` / `storefront`; another
 * platform emits its own. The UI knows nothing about WooCommerce.
 */
export interface ProductLink {
  label: string;
  url: string;
  kind: string;
}

/** Map a product-link `kind` to a leading glyph. Unknown kinds fall back to a generic "open" arrow. */
export function linkIcon(kind: string): string {
  switch (kind) {
    case 'catalog-edit':
      return '✏️';
    case 'storefront':
      return '🛍️';
    case 'ledger':
      return '📖';
    case 'workbench':
      return '▦';
    default:
      return '↗';
  }
}

/**
 * Build the shared "product actions" dropdown-menu items used by any surface that shows per-product
 * navigation — the dispatch order detail and the Central Workbench name cell. Two provenances,
 * matching the inbound/outbound split in arch-identity-keying §3:
 *
 *  - **Host-native links** (`links`, e.g. Edit in WooCommerce / storefront) are supplied by the
 *    adapter as `{label, url, kind}` and open the platform's own pages in a new browser tab.
 *  - **The ledger** is an InvFlux route, composed *client-side* from the subject id the row already
 *    holds (never server-emitted) — identical under any adapter. Embedded it opens as an SPA detail
 *    tab; standalone it needs the unified-app page, so a new browser tab keeps the caller in view.
 *
 * `includeLedger: false` omits the ledger item — e.g. a variable parent, which is an aggregate of its
 * variations and has no single ledger of its own.
 */
export function buildProductActionItems(opts: {
  links: ProductLink[];
  subjectId: number;
  hostNav: HostNav;
  includeLedger?: boolean;
}): DropdownMenuItem[] {
  const { links, subjectId, hostNav, includeLedger = true } = opts;
  const items: DropdownMenuItem[] = links.map((l) => ({
    id: l.kind,
    label: `${linkIcon(l.kind)}  ${l.label}`,
    run: () => window.open(l.url, '_blank', 'noopener,noreferrer'),
  }));

  if (includeLedger && subjectId > 0) {
    items.push({
      id: 'ledger',
      label: `${linkIcon('ledger')}  ${__('Product ledger')}`,
      run: () => {
        const href = hostNav.routeHref(`/ledger/${subjectId}`);
        if (hostNav.opensNewTab) window.open(href, '_blank', 'noopener,noreferrer');
        else window.location.href = href;
      },
    });
  }

  return items;
}
