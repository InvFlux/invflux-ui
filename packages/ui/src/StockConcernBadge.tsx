import { __, _x, formatDateOnly, sprintf } from '@invflux/i18n';
import { For, Show, useContext, type Component } from 'solid-js';
import { HostNavCtx } from './hostNav';
import { StockConcernBits, type StockConcerns } from './types';
import { STOCK_CONCERN_LABEL } from './stockConcernLabels';

/** One open purchase order carrying inbound quantity for a deficit line. */
export interface InboundPo {
  poId: number;
  number: string;
  supplier: string;
  qty: number;
  stage: string;
  /** ATOM; the planned arrival day. Null when the PO carries no date yet. */
  expectedAt: string | null;
}

/**
 * What is on the way for a line that is short.
 *
 * `pos` is **null** when the per-PO breakdown isn't available — the add-on that computes it is
 * absent or its licence lapsed — and the badge then states the quantity alone. That is the whole
 * tier difference at this seam: everyone learns that cover exists, the breakdown says *when*.
 */
export interface InboundCover {
  onOrder: number;
  pos: InboundPo[] | null;
  /**
   * A lowered severity for the deficit, computed by whoever supplied the cover: `'warn'` when
   * inbound stock closes the shortfall *before this order has to ship*. Null means no opinion, and
   * the concern keeps its own. It can only ever lower — a verdict that could raise severity, or go
   * below `warn`, would let a licence change how alarming a real shortfall looks.
   */
  severity?: 'warn' | null;
}

/** Whole days from today to an ATOM date, or null when undated/unparseable. */
function daysUntil(atom: string | null): number | null {
  if (atom === null) return null;
  const then = Date.parse(atom);
  if (Number.isNaN(then)) return null;
  return Math.round((then - Date.now()) / 86_400_000);
}

/** Tooltip for the amber ⚠ "unmanaged" marker — governance, not a computed stock concern. */
const unmanagedTitle = (): string =>
  __(
    "Stock isn't tracked by InvFlux — availability comes from WooCommerce or another plugin, so InvFlux can't confirm it's in stock.",
  );

/**
 * Bit → display row. Severity maps to ship-impact:
 *
 * - `block` (red) — ship is gated until resolved.
 * - `warn`  (amber) — informational; ship still possible.
 */
type Severity = 'block' | 'warn';
/**
 * Labels and descriptions are getters: this list is built at chunk load, before the locale is in
 * place.
 *
 * The description is what the tooltip carries. A tooltip repeating the label it hangs off tells the
 * reader nothing they cannot already see — these say what the flag *means for the order*, in the
 * merchant's terms rather than the ledger's.
 */
const ROWS: ReadonlyArray<{
  bit: number;
  label: () => string;
  description: () => string;
  severity: Severity;
}> = [
  {
    bit: StockConcernBits.STOCK_DEFICIT,
    label: STOCK_CONCERN_LABEL[StockConcernBits.STOCK_DEFICIT],
    description: () =>
      __(
        'Committed stock is less than the total outstanding demand for this product, so some orders cannot be fulfilled.',
      ),
    severity: 'block',
  },
  {
    bit: StockConcernBits.QUALITY_HOLD,
    label: STOCK_CONCERN_LABEL[StockConcernBits.QUALITY_HOLD],
    description: () =>
      __("This product's stock is held for a quality or recall check, so it cannot be shipped."),
    severity: 'block',
  },
  {
    bit: StockConcernBits.BATCH_EXPIRED,
    label: STOCK_CONCERN_LABEL[StockConcernBits.BATCH_EXPIRED],
    description: () =>
      __('Every batch still available is past its expiry date, so this cannot ship.'),
    severity: 'block',
  },
  {
    bit: StockConcernBits.SUBJECT_INACTIVE,
    label: STOCK_CONCERN_LABEL[StockConcernBits.SUBJECT_INACTIVE],
    description: () => __('The product is in the trash in WooCommerce, or no longer exists there.'),
    severity: 'warn',
  },
  {
    bit: StockConcernBits.BATCH_EXPIRY_RISK,
    label: STOCK_CONCERN_LABEL[StockConcernBits.BATCH_EXPIRY_RISK],
    description: () =>
      __(
        'A batch close to its expiry date would be used for this order. Ship the earliest-expiring stock first.',
      ),
    severity: 'warn',
  },
  {
    bit: StockConcernBits.LOC_AT_RISK,
    label: STOCK_CONCERN_LABEL[StockConcernBits.LOC_AT_RISK],
    description: () =>
      __(
        'There is enough stock overall, but the warehouse this order draws from is short of what is allocated to it.',
      ),
    severity: 'warn',
  },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  block: 'text-red-600 font-medium',
  warn: 'text-amber-600 font-medium',
};

/**
 * Renders the subject-tied stock-concerns bitmask.
 *
 * - `0` → muted dash (no concerns; healthy order).
 * - Single bit set → that bit's label, coloured by severity.
 * - Multiple bits set → highest-severity label + "+N"; `title` explains each, one per line.
 *
 * `deficitQty`, when supplied (> 0), turns the deficit label into "Deficit: N" — the magnitude of
 * unfulfillable units. Callers without a per-context quantity (e.g. the per-order dispatch badge)
 * omit it and get the bare "Deficit" label.
 *
 * `unmanaged` is a **governance** signal, not a concern: the subject isn't InvFlux-governed, so InvFlux
 * can't vouch for its stock. It renders as an amber "⚠ Unmanaged", kept visually distinct from the red
 * deficit so "can't vouch" never masks a real "this is short". Both can show at once on the per-order
 * rollup (a mixed order with a deficit on one line and an unmanaged other line), and both stay
 * labelled when they do: the amber marker means the same thing whether or not it has company.
 */
export const StockConcernBadge: Component<{
  bits: StockConcerns;
  deficitQty?: number;
  /**
   * The deficit's operands — committed demand and the stock set aside for it, store-wide. When both
   * are supplied the deficit reads `Deficit: 1 (= 4 − 3)`, which says what the number is a
   * difference *of*: on a line whose own demand was corrected away, it is what shows that the
   * shortfall belongs to the rest of the store. `0` demand means not known, and nothing is added.
   */
  demandQty?: number;
  ctdQty?: number;
  unmanaged?: boolean;
  /** Inbound cover for a deficit. Rendered only beside an actual deficit — on a healthy line it
   *  would answer a question nobody asked. */
  inbound?: InboundCover;
  /**
   * Units this line — or, summed, this order — cannot get from committed stock once units staged
   * for other orders are set aside. Supplied only where the badge speaks for an order: then a
   * deficit reads red "Can't ship: short N" when positive, and amber — only the store is short, this
   * order is covered — when `0`. Absent (the workbench, which has no order) leaves a deficit as it
   * always was.
   */
  shortQty?: number;
}> = (props) => {
  // Read rather than `useHostNav()`: that throws without a provider, and a shared badge must not be
  // able to take down a host that never links anywhere. No nav ⇒ the chips render as plain text.
  const hostNav = useContext(HostNavCtx);
  const set = () => ROWS.filter((r) => (props.bits & r.bit) !== 0);
  const primary = () => {
    const list = set();
    return list.find((r) => r.severity === 'block') ?? list[0] ?? null;
  };
  /** What this order cannot get past — the stage-2 case, when the host says so. */
  const shortForOrder = (): number => (typeof props.shortQty === 'number' ? props.shortQty : 0);
  /**
   * The stage-2 headline, in two pieces so a narrow cell wraps them as a pair — "Can't ship:" over
   * "short 2" — rather than breaking the count away from what it counts.
   */
  const cantShipLabel = (): string => _x("Can't ship:", 'stock concern badge');
  const shortLabel = (): string =>
    sprintf(
      /* translators: %d: units this order cannot get from committed stock. */
      _x('short %d', 'stock concern badge'),
      shortForOrder(),
    );
  const labelFor = (r: { bit: number; label: () => string }): string => {
    if (r.bit !== StockConcernBits.STOCK_DEFICIT) return r.label();
    if (shortForOrder() > 0) return `${cantShipLabel()} ${shortLabel()}`;
    return typeof props.deficitQty === 'number' && props.deficitQty > 0
      ? `${r.label()}: ${props.deficitQty}`
      : r.label();
  };
  /**
   * `(= 4 − 3)`, only beside a deficit that is the headline and whose operands are known — and not
   * beside "Can't ship", where a store-wide equation would explain a different number.
   */
  const equation = (): string | null => {
    const p = primary();
    if (!p || p.bit !== StockConcernBits.STOCK_DEFICIT) return null;
    if (shortForOrder() > 0) return null;
    if (!(typeof props.deficitQty === 'number' && props.deficitQty > 0)) return null;
    if (!(typeof props.demandQty === 'number' && props.demandQty > 0)) return null;
    if (typeof props.ctdQty !== 'number') return null;
    return `(= ${props.demandQty} − ${props.ctdQty})`;
  };
  const extraCount = () => Math.max(0, set().length - 1);
  const tooltip = () => {
    const list = set();
    if (list.length === 0) return __('No stock concerns');
    // Named as well as explained: with two concerns showing, the description alone leaves the
    // reader matching prose back to labels.
    const lines = list.map((r) => `${labelFor(r)} — ${r.description()}`);
    if (equation() !== null) {
      lines.push(
        sprintf(
          /* translators: 1: units owed on paid, undispatched orders across the store; 2: units set aside for them. */
          __(
            'Store-wide, not just this order: %1$d owed on open paid orders, %2$d set aside for them.',
          ),
          props.demandQty ?? 0,
          props.ctdQty ?? 0,
        ),
      );
    }
    // Where the host says whether this order is covered, the tooltip says what that means and, when
    // it is not, the two ways out — both of which set the record straight before anything ships.
    if (hasDeficit() && typeof props.shortQty === 'number') {
      lines.push(
        props.shortQty > 0
          ? sprintf(
              /* translators: %d: units this order cannot get from committed stock. */
              __(
                'This order cannot ship as it stands: %d short once stock staged for other orders is set aside. Record stock found on the shelf with an on-hand correction, or correct the order for the units that cannot ship.',
              ),
              props.shortQty,
            )
          : __(
              'This order can still ship: committed stock covers it, though not every order for this product.',
            ),
      );
    }
    return lines.join('\n');
  };
  const hasConcern = () => set().length > 0;
  const hasDeficit = () => (props.bits & StockConcernBits.STOCK_DEFICIT) !== 0;
  /**
   * The concern's own severity, unless the cover says the deficit lands in time. Applied only when
   * the deficit *is* the headline concern: a quality hold sharing the cell is not made less urgent
   * by a purchase order arriving.
   */
  const effectiveSeverity = (): Severity => {
    // Where the host says whether this order is covered, a deficit speaks for this order: red when it
    // cannot ship as it stands, amber when only the store is short. Elsewhere it keeps its own.
    const p = primary()!;
    const own: Severity =
      p.bit === StockConcernBits.STOCK_DEFICIT && typeof props.shortQty === 'number'
        ? props.shortQty > 0
          ? 'block'
          : 'warn'
        : p.severity;
    const lowered = props.inbound?.severity;
    return lowered === 'warn' && primary()!.bit === StockConcernBits.STOCK_DEFICIT ? 'warn' : own;
  };

  return (
    <span class="text-xs inline-flex items-center gap-1">
      <Show when={props.unmanaged}>
        {/* Always labelled, including next to a concern. Dropping the word to save width left a
            bare ⚠ standing where "⚠ Unmanaged" stands elsewhere, and one signal wearing two
            appearances reads as two signals — the glyph alone says "something", not "untracked". */}
        <span class="text-amber-600 font-medium whitespace-nowrap" title={unmanagedTitle()}>
          ⚠ {__('Unmanaged')}
        </span>
      </Show>
      <Show when={hasConcern()}>
        <span
          class={'flex flex-col md:flex-row gap-x-1 ' + SEVERITY_CLASS[effectiveSeverity()]}
          title={tooltip()}
        >
          <Show
            when={shortForOrder() > 0 && primary()!.bit === StockConcernBits.STOCK_DEFICIT}
            fallback={<span class="text-nowrap">{labelFor(primary()!)}</span>}
          >
            <span class="inline-flex flex-col sm:flex-row sm:gap-x-1">
              <span class="text-nowrap">{cantShipLabel()}</span>
              <span class="text-nowrap">{shortLabel()}</span>
            </span>
          </Show>
          {/* Muted and normal weight: the operands explain the number, they are not what should
              draw the eye. */}
          <Show when={equation()}>
            {(eq) => <span class="font-normal text-text-muted text-nowrap"> {eq()}</span>}
          </Show>
          <Show when={extraCount() > 0}> +{extraCount()}</Show>
        </span>
      </Show>
      {/* Inbound cover, and only against a deficit: it is the answer to that concern, not a fact
          about the line in general. */}
      <Show when={hasDeficit() && props.inbound !== undefined && props.inbound.onOrder > 0}>
        {/* Punctuation is layout, not translatable text — and `-ml-1` cancels the row gap so the
            comma sits against the concern it follows rather than floating between the two. */}
        <span class="-ml-1 text-text-muted" aria-hidden="true">
          ,
        </span>
        {/* One lead-in for both shapes: the tier changes what follows "incoming:", never whether
            the line admits that cover exists. Essentials states the quantity; the add-on's
            breakdown replaces it with a chip per open PO. */}
        <Show
          when={props.inbound?.pos !== null && (props.inbound?.pos?.length ?? 0) > 0}
          fallback={
            <span class="text-text-muted">
              {__('incoming:')} {props.inbound?.onOrder ?? 0}
            </span>
          }
        >
          <span class="text-text-muted">
            {__('incoming:')}{' '}
            <For each={props.inbound?.pos ?? []}>
              {(po, i) => {
                const days = (): number | null => daysUntil(po.expectedAt);
                const when = (): string => {
                  const d = days();
                  if (d === null) return __('no date');
                  if (d <= 0) return __('due');
                  return sprintf(_x('%dd', 'days until a purchase order is expected'), d);
                };
                const title = (): string =>
                  [
                    po.supplier,
                    po.number,
                    po.expectedAt === null ? __('no date') : formatDateOnly(po.expectedAt),
                  ]
                    .filter((part) => part !== '')
                    .join(' — ');
                const text = (): string => `${when()} (${po.qty})`;
                return (
                  <>
                    <Show when={i() > 0}>{', '}</Show>
                    <Show when={hostNav} fallback={<span title={title()}>{text()}</span>}>
                      <a
                        class="text-primary hover:text-primary-hover no-underline hover:underline"
                        href={hostNav!.routeHref(`/procurement/purchase-orders/${po.poId}`)}
                        title={title()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {text()}
                      </a>
                    </Show>
                  </>
                );
              }}
            </For>
          </span>
        </Show>
      </Show>
      <Show when={!props.unmanaged && !hasConcern()}>
        <span class="text-text-muted">—</span>
      </Show>
    </span>
  );
};
