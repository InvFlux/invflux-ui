import { __ } from '@invflux/i18n';

/**
 * Incoterms® 2020 — the ICC's standard delivery terms, stating where the supplier's obligation ends
 * and ours begins. The codes mirror core's `Incoterm` enum, which is the server-side authority: the
 * three-letter values are the wire contract and must stay in step with it, while the wording here is
 * ours to translate.
 *
 * The list is closed *per revision*. The ICC revises roughly each decade; a new revision is a
 * deliberate code change in both places, never something a merchant configures — the terms carry
 * legal meaning defined by the ICC and not by us.
 *
 * Labels stay lazy (`() => __()`) so they resolve at render, after the translations have loaded.
 */
export interface IncotermOption {
  code: string;
  label: () => string;
  /** Restricted to sea and inland-waterway transport — mirrors `Incoterm::isMaritimeOnly()`. */
  maritimeOnly: boolean;
}

export const INCOTERMS: IncotermOption[] = [
  { code: 'EXW', label: () => __('Ex Works — we collect at their premises'), maritimeOnly: false },
  {
    code: 'FCA',
    label: () => __('Free Carrier — they hand over to our carrier'),
    maritimeOnly: false,
  },
  {
    code: 'CPT',
    label: () => __('Carriage Paid To — they pay carriage, risk passes early'),
    maritimeOnly: false,
  },
  {
    code: 'CIP',
    label: () => __('Carriage & Insurance Paid To — as CPT, plus insurance'),
    maritimeOnly: false,
  },
  {
    code: 'DAP',
    label: () => __('Delivered At Place — they bear cost and risk to the place'),
    maritimeOnly: false,
  },
  {
    code: 'DPU',
    label: () => __('Delivered At Place Unloaded — as DAP, and they unload'),
    maritimeOnly: false,
  },
  {
    code: 'DDP',
    label: () => __('Delivered Duty Paid — they bear everything, duty included'),
    maritimeOnly: false,
  },
  {
    code: 'FAS',
    label: () => __('Free Alongside Ship — delivered alongside the vessel'),
    maritimeOnly: true,
  },
  { code: 'FOB', label: () => __('Free On Board — risk passes once aboard'), maritimeOnly: true },
  {
    code: 'CFR',
    label: () => __('Cost & Freight — they pay freight, risk passes on board'),
    maritimeOnly: true,
  },
  {
    code: 'CIF',
    label: () => __('Cost, Insurance & Freight — as CFR, plus insurance'),
    maritimeOnly: true,
  },
];

/** `FCA — Free Carrier …` for a known code; the bare code for anything unrecognised. */
export function incotermLabel(code: string): string {
  const found = INCOTERMS.find((t) => t.code === code);

  return undefined === found ? code : `${code} — ${found.label()}`;
}

/**
 * What a code *means*, without the code — `Free Carrier — they hand over to our carrier`.
 *
 * Null for a code this revision does not know, which is the honest answer rather than a guess: the
 * three-letter values are the wire contract with core's `Incoterm` enum, so an unrecognised one is a
 * version skew, and inventing a gloss for it would state something the ICC did not.
 *
 * Split from {@link incotermLabel} because the two answer different questions. A *chooser* needs the
 * code and its meaning together, since that is what the reader is picking between; a *statement of
 * fact* on a document needs the code, which is the term of art the trade actually uses, with the
 * meaning available on demand for whoever does not have all eleven memorised.
 */
export function incotermGloss(code: string): string | null {
  return INCOTERMS.find((t) => t.code === code)?.label() ?? null;
}

export function isMaritimeOnly(code: string): boolean {
  return INCOTERMS.find((t) => t.code === code)?.maritimeOnly ?? false;
}
