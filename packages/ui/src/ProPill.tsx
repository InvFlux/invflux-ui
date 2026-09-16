import type { JSX } from 'solid-js';

/**
 * The InvFlux brand mark, inlined so the pill is self-contained — no `?raw`
 * bundler/ambient-decl coupling on the consuming package. Kept in sync with
 * `invflux-for-woocommerce/wporg-assets/invflux-mark.svg` (the build source of truth).
 * The gradient id is namespaced (`invfluxPillShield`) because this markup is injected into
 * a page that may already contain another copy of the mark.
 */
const INVFLUX_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -72 160 160" role="img" aria-label="InvFlux mark"><title>InvFlux mark</title><defs><linearGradient id="invfluxPillShield" gradientUnits="userSpaceOnUse" x1="0" y1="-35.5" x2="0" y2="53"><stop offset="0" stop-color="#6b4a10"/><stop offset="0.39" stop-color="#b5935c"/><stop offset="1" stop-color="#ffdca8"/></linearGradient></defs><path d="M -68 -46 C -30 -46 -21 -53 0 -64 C 21 -53 30 -46 68 -46 L 68 13 C 67 43 29 69 0 78 C -29 69 -67 43 -68 13 Z" fill="url(#invfluxPillShield)" stroke="#f59e0b" stroke-width="7" stroke-linejoin="round"/><path d="M 0 4 L 55 21 L 0 50 L -55 21 Z" fill="#1e3a5f"/><path d="M 0 -13.83 L 51.2 2 L 0 22.48 L -51.2 2 Z" fill="#007ab8"/><path d="M 0 -32.59 L 47.2 -18 L 0 -3.41 L -47.2 -18 Z" fill="#7fc0e1"/></svg>';

export interface ProPillProps {
  /** Tier label shown in the pill. Defaults to `"Pro"`. */
  tier?: string;
  /** Extra classes appended to the pill's own styling. */
  class?: string;
}

/**
 * Shared upsell pill — the InvFlux mark + a tier label (default "Pro") in the
 * house yellow badge. The one signal a feature is gated behind a paid tier; use
 * this rather than a per-surface badge so the upsell language reads identically
 * across every SPA (settings rows, the tag manager's governance controls, …).
 */
export function ProPill(props: ProPillProps): JSX.Element {
  return (
    <span
      class={`inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-yellow-200${props.class ? ` ${props.class}` : ''}`}
    >
      <span
        class="inline-flex [&_svg]:h-3.5 [&_svg]:w-auto"
        // eslint-disable-next-line solid/no-innerhtml -- module-const SVG literal in this file, not user or server data.
        innerHTML={INVFLUX_MARK}
        aria-hidden="true"
      />
      {props.tier ?? 'Pro'}
    </span>
  );
}
