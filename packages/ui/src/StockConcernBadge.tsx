import { Show, type Component } from 'solid-js';
import { StockConcernBits, type StockConcerns } from './types';

/** Tooltip for the amber ⚠ "unmanaged" marker — governance, not a computed stock concern. */
const UNMANAGED_TITLE =
  "Stock isn't tracked by InvFlux — availability comes from WooCommerce or another plugin, so InvFlux can't confirm it's in stock.";

/**
 * Bit → display row. Severity maps to ship-impact:
 *
 * - `block` (red) — ship is gated until resolved.
 * - `warn`  (amber) — informational; ship still possible.
 */
type Severity = 'block' | 'warn';
const ROWS: ReadonlyArray<{ bit: number; label: string; severity: Severity }> = [
  { bit: StockConcernBits.STOCK_DEFICIT,     label: 'Deficit',           severity: 'block' },
  { bit: StockConcernBits.QUALITY_HOLD,      label: 'Quality hold',      severity: 'block' },
  { bit: StockConcernBits.BATCH_EXPIRED,     label: 'Expired batch',     severity: 'block' },
  { bit: StockConcernBits.SUBJECT_INACTIVE,  label: 'Inactive product',  severity: 'warn' },
  { bit: StockConcernBits.BATCH_EXPIRY_RISK, label: 'Expiry risk',       severity: 'warn' },
  { bit: StockConcernBits.LOC_AT_RISK,       label: 'Warehouse short',   severity: 'warn' },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  block: 'text-red-600 font-medium',
  warn:  'text-amber-600 font-medium',
};

/**
 * Renders the subject-tied stock-concerns bitmask.
 *
 * - `0` → muted dash (no concerns; healthy order).
 * - Single bit set → that bit's label, coloured by severity.
 * - Multiple bits set → highest-severity label + "+N"; `title` lists all.
 *
 * `deficitQty`, when supplied (> 0), turns the deficit label into "Deficit: N" — the magnitude of
 * unfulfillable units. Callers without a per-context quantity (e.g. the per-order dispatch badge)
 * omit it and get the bare "Deficit" label.
 *
 * `unmanaged` is a **governance** signal, not a concern: the subject isn't InvFlux-governed, so InvFlux
 * can't vouch for its stock. It renders as an amber ⚠, kept visually distinct from the red deficit so
 * "can't vouch" never masks a real "this is short". Both can show at once on the per-order rollup (a
 * mixed order with a deficit on one line and an unmanaged other line).
 */
export const StockConcernBadge: Component<{ bits: StockConcerns; deficitQty?: number; unmanaged?: boolean }> = (
  props,
) => {
  const set = () => ROWS.filter((r) => (props.bits & r.bit) !== 0);
  const primary = () => {
    const list = set();
    return list.find((r) => r.severity === 'block') ?? list[0] ?? null;
  };
  const labelFor = (r: { bit: number; label: string }): string =>
    r.bit === StockConcernBits.STOCK_DEFICIT && typeof props.deficitQty === 'number' && props.deficitQty > 0
      ? `${r.label}: ${props.deficitQty}`
      : r.label;
  const display = () => {
    const p = primary();
    if (!p) return null;
    const count = set().length;
    return count > 1 ? `${labelFor(p)} +${count - 1}` : labelFor(p);
  };
  const tooltip = () => {
    const list = set();
    return list.length === 0 ? 'No stock concerns' : list.map(labelFor).join(', ');
  };
  const hasConcern = () => set().length > 0;

  return (
    <span class="text-xs inline-flex items-center gap-1">
      <Show when={props.unmanaged}>
        <span class="text-amber-600 font-medium" title={UNMANAGED_TITLE}>
          ⚠<Show when={!hasConcern()}> Unmanaged</Show>
        </span>
      </Show>
      <Show when={hasConcern()}>
        <span class={SEVERITY_CLASS[primary()!.severity]} title={tooltip()}>
          {display()}
        </span>
      </Show>
      <Show when={!props.unmanaged && !hasConcern()}>
        <span class="text-text-muted">—</span>
      </Show>
    </span>
  );
};
