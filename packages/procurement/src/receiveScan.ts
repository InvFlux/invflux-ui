import type { ScanReply, ScanSource } from '@invflux/ui/scanBus';

/**
 * A scan on the goods-receipt grid: which lines it names, and the seam a contributed capability fills.
 *
 * The grid takes scans through the scan bus, whether the focus is in its filter or on a cell. The base
 * answer is the one typing the code and pressing Enter gives: the grid narrows to the lines that hold
 * the code, and when exactly one does, focus goes to its first editable cell. A capability that does
 * more with a scan (counting one unit per scan, capturing a code the delivery is the first to carry)
 * contributes a handler, composed from the operations {@link ReceiveScanContext} hands over, each of
 * which the grid already performs for itself.
 *
 * Shaped after the commit-navigation seam ({@link ../gridCommitNav.ts}): a handler is plain data plus
 * pure functions, so a contributing bundle needs neither JSX nor the host's Solid runtime.
 */

/** The fields of a receipt line a scan reads. */
export interface ScanLine {
  subjectId: number;
  sku: string | null;
  supplierSku: string | null;
  gtin: string | null;
  codes: readonly string[];
}

/**
 * Whether a scanned code names this line: one of its codes, its SKU or its supplier's SKU, whole.
 *
 * Never part of one, since a short internal code must not find a longer one and count the wrong
 * product. Digits compare without their zero padding on both sides, because one GTIN scans as 12, 13
 * or 14 digits; anything else compares without case.
 */
export function scanNamesLine(line: ScanLine, code: string): boolean {
  const wanted = codeKey(code);
  if ('' === wanted) return false;
  const candidates = [...line.codes, line.gtin, line.sku, line.supplierSku];

  return candidates.some((c) => null !== c && '' !== c.trim() && codeKey(c) === wanted);
}

/** A code as compared: digits without their zero padding, anything else case-folded. */
export function codeKey(code: string): string {
  const trimmed = code.trim();

  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed.toLowerCase();
}

/** A line's codes as the server holds them now. */
export interface LineCodes {
  subjectId: number;
  codes: string[];
  gtin: string | null;
}

/** A lookup finished this recently already answered: a burst of unknown codes asks the server once. */
export const CODE_LOOKUP_GAP_MS = 3_000;

/**
 * Reads the order's codes again for a scan no line's codes name, once, before the scan is refused.
 *
 * A screen learns a line's codes when it loads, and a code can be added after that: a coworker's
 * capture at the next bench, a barcode set in the catalog. Without asking again, the second screen
 * would refuse a code the first just stored — "not on this order" for a product that is on it. The
 * changes the count refresh reads carry figures, not codes, and a miss is rare enough that asking on
 * it costs less than carrying codes on every refresh.
 *
 * `before(named)` answers undefined when the scan can be resolved now — some line names it, or a
 * lookup finished within {@link CODE_LOOKUP_GAP_MS} — and otherwise a promise that settles once the
 * fresh codes are applied. An unknown code arriving while a lookup is out waits for that one; a code a
 * line already names never waits. A failed lookup
 * settles all the same: the scan is then resolved against the codes already held, as before.
 */
export function codeRefresher(
  fetch: () => Promise<readonly LineCodes[]>,
  apply: (fresh: readonly LineCodes[]) => void,
  now: () => number = Date.now,
): { before: (named: boolean) => Promise<void> | undefined } {
  let inFlight: Promise<void> | undefined;
  let finishedAt = Number.NEGATIVE_INFINITY;

  return {
    before: (named) => {
      if (named) return undefined;
      if (undefined !== inFlight) return inFlight;
      if (now() - finishedAt < CODE_LOOKUP_GAP_MS) return undefined;
      inFlight = fetch()
        .then(apply, () => undefined)
        .finally(() => {
          finishedAt = now();
          inFlight = undefined;
        });

      return inFlight;
    },
  };
}

/** What the grid tells a handler about a scan, and what the handler may do about it. */
export interface ReceiveScanContext {
  /** The grid asking. Stable, host-owned: `po.receive` is the goods-reception line grid. */
  gridId: string;
  /** The scanned code, whole. */
  code: string;
  source: ScanSource;
  /** Every line of the receipt. */
  lines: readonly ScanLine[];
  /** The lines the code names (see {@link scanNamesLine}). */
  matches: readonly ScanLine[];
  /** The quantity this delivery has counted on a line so far; null when not counted. */
  received: (subjectId: number) => number | null;
  /** Stage a line's counted quantity, as typing it into the Received cell does. */
  setReceived: (subjectId: number, qty: number | null) => void;
  /**
   * Add units to a line, as a scan does: sent as an increment, so a coworker scanning the same product
   * at the same time adds to the same count instead of being refused against it.
   */
  addReceived: (subjectId: number, units: number) => void;
  /** Narrow the grid to the lines this code names, as the base does. */
  showMatches: () => void;
  /** Clear the filter. */
  clearFilter: () => void;
  /** Put keyboard focus in the quick-filter. */
  focusFilter: () => void;
  /** Put focus on a line's first editable cell, as Enter from a one-line filter does. */
  focusLine: (subjectId: number) => void;
}

/** One contributed handler. */
export interface ReceiveScanHandler {
  /** Identifier for override: re-registering the name replaces the handler. */
  name: string;
  /**
   * Whether the handler applies right now, read at scan time: a bundle loads whenever its plugin is
   * active, which is not whether its license currently allows the capability.
   */
  enabled?: () => boolean;
  /**
   * Handle the scan. `false` leaves it to the base; anything else claims it, a `{ refused }` reply
   * telling the operator why it was not taken.
   */
  handle: (ctx: ReceiveScanContext) => false | ScanReply;
}

const handlers = new Map<string, ReceiveScanHandler>();

/** Register a handler, or replace one of the same name. The base registers none. */
export function registerReceiveScanHandler(handler: ReceiveScanHandler): void {
  handlers.set(handler.name.toLowerCase(), handler);
}

/**
 * Resolve a scan: the first enabled contributed handler that claims it, otherwise the base answer.
 */
export function resolveReceiveScan(ctx: ReceiveScanContext): ScanReply {
  for (const handler of handlers.values()) {
    if (handler.enabled && !handler.enabled()) continue;
    const reply = handler.handle(ctx);
    if (false !== reply) return reply;
  }
  ctx.showMatches();
  if (1 === ctx.matches.length) ctx.focusLine(ctx.matches[0]!.subjectId);

  return undefined;
}
