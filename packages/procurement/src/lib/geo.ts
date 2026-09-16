import type { ProcurementContext } from '../types';

/** A value/label pair for Combobox + native <select> options. */
export interface GeoOption {
  value: string;
  label: string;
}

/** ISO-2 country options [{value: code, label: localized name}], sorted by name. */
export function countryOptions(ctx: ProcurementContext): GeoOption[] {
  return Object.entries(ctx.geo.countries)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Currency options [{value: code, label: "CODE — Name"}], sorted by code. */
export function currencyOptions(ctx: ProcurementContext): GeoOption[] {
  return Object.entries(ctx.geo.currencies)
    .map(([value, label]) => ({ value, label: `${value} — ${label}` }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** State/region options for a country [{value: code, label: name}], or [] when WC has none. */
export function stateOptions(ctx: ProcurementContext, country: string): GeoOption[] {
  const states = ctx.geo.states[country];
  return undefined === states
    ? []
    : Object.entries(states).map(([value, label]) => ({ value, label }));
}

/** Display name for a country code (falls back to the code itself). */
export function countryName(ctx: ProcurementContext, code: string | null): string {
  return null === code || '' === code ? '' : (ctx.geo.countries[code] ?? code);
}

/** Display name for a state code within a country (falls back to the code). */
export function stateName(
  ctx: ProcurementContext,
  country: string | null,
  code: string | null,
): string {
  if (null === code || '' === code) return '';
  const states = null === country || '' === country ? undefined : ctx.geo.states[country];
  return states?.[code] ?? code;
}
