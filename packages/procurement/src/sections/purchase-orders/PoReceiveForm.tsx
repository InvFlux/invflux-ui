import { __, _n, _x, sprintf } from '@invflux/i18n';
import { createComputed, createEffect, createSignal, type JSX, on, Show } from 'solid-js';
import { Button, SplitActionButton, Textarea, toast } from '@invflux/ui';
import { PoReceiveGrid } from './PoReceiveGrid';
import { foldCounts } from './countFold';
import { createLineSync } from './lineSync';
import { createUnsavedLines } from './unsavedLines';
import { orderedQty } from '../../lib/variance';
import {
  PO_RECEIVE_ACTIONS_SCOPE,
  type PoReceiveActionContext,
  registerPoReceiveActions,
} from './poReceiveActions';
import type { LineCodes } from '../../receiveScan';
import type { RemoveProductCodeRequest } from '@invflux/ui/productCodes';
import type { ProductCodesResponse, RemovedProductCode } from './PoReceiveGrid';
import type { PoLine, ReceivingSessionRow } from './types';

/** A staged receipt line the parent posts to /receive on confirm (alias of the persisted WIP row). */
export type ReceiveRow = ReceivingSessionRow;

/**
 * A count line as the server holds it: the staged figure (null when nothing is counted), the version
 * a write must name (null while the line has no row), and who entered the figure.
 */
export interface CountLine {
  staged: { received: number; damaged: number } | null;
  version: number | null;
  countedBy: string | null;
  countedAt: string | null;
}

/**
 * How a line write ended. `saved` carries the line as stored (null when nothing was stored — a
 * zero on an order whose reception has not opened). `stale` means someone changed the line since this
 * screen last showed it; it carries the line as it stands. `failed` is anything else, and the line
 * stays as counted here, to go again.
 */
export type StageLineResult =
  | { outcome: 'saved'; line: CountLine | null }
  | { outcome: 'stale'; line: CountLine }
  | { outcome: 'failed' };

/** How a scan's increment ended: the line as stored (coworkers' units included), or not at all. */
export type AddLineResult = { outcome: 'saved'; line: CountLine } | { outcome: 'failed' };

// Register the core finalize actions (confirm / keep-open / close-short) into the shared entity-action
// registry on first import of the form. Idempotent.
registerPoReceiveActions();

/**
 * The open-receiving-session form. Quantities are staged **client-side** (blank to start — receiving
 * is a deliberate count, not an assumption) and nothing touches inventory until the parent's "Confirm
 * receipt" posts the whole session. Per line the worker enters **Received** (total that arrived) and,
 * of which, **Damaged**; the derived **Good** (= received − damaged) is what will move into stock.
 * Short/over are never entered — they fall out of received vs ordered at posting. A free-text note
 * captures anything that isn't a line quantity (a mis-pick / wrong item). Costs are absent: invoiced
 * cost reconciliation is a separate finance workflow.
 *
 * The line grid is the shared {@link PoReceiveGrid} (DataGrid): every counted cell shows staged
 * (yellow) until the session is committed. The grid's per-cell editor holds its own in-flight value,
 * so an incoming multi-worker sync can fold the underlying counts without yanking an open edit.
 *
 * **Each change goes to the server alone, as it happens** — a committed cell, a +/- press, a scan.
 * Several workers can count one delivery, each taking their own products, and a write that carried the
 * whole count would put back a stale copy of a colleague's lines. A write names the version of the line
 * this screen last showed; if someone changed it since, the server refuses and hands back their
 * figure, which replaces ours on screen with a notice — entering ours again then replaces theirs.
 */
export function PoReceiveForm(props: {
  poId: number;
  lines: PoLine[];
  /** Where to show a product, by subject id; undefined where this user cannot open it. */
  productLink?: (subjectId: number) => string | undefined;
  /** The order's codes as the server holds them now, for a scan that names no line (PoReceiveGrid). */
  lookupCodes?: () => Promise<readonly LineCodes[]>;
  /** A product's barcodes, and taking one off: the GTIN cell's drill-down (PoReceiveGrid). */
  fetchCodes?: (subjectId: number) => Promise<ProductCodesResponse>;
  removeCode?: (
    subjectId: number,
    request: RemoveProductCodeRequest,
  ) => Promise<RemovedProductCode>;
  /** PO transaction currency + the store base — an FX-rate field shows only when they differ. */
  currency: string;
  baseCurrency: string;
  /** A rate to start the FX field from (the last one recorded for this currency), to confirm. */
  initialFxRate?: string | null;
  pending: boolean;
  /** The count as the server holds it, by subject id — seeded from, and folded in on every refresh. */
  counts: Record<number, CountLine | undefined>;
  initialNote?: string;
  /** The note as the server last answered it — shown when this worker is not editing their own. */
  serverNote?: string | null;
  /** Whether the order is in reception. Lines counted before it opened are sent again once it has. */
  receiving: boolean;
  /** Write one line. Received null clears it; `version` is the one this screen last showed. */
  onStageLine?: (
    subjectId: number,
    received: number | null,
    damaged: number,
    version: number | null,
  ) => Promise<StageLineResult>;
  /** Add scanned units to one line — sent as an increment, never retried (a retry could count twice). */
  onAddLine?: (subjectId: number, units: number) => Promise<AddLineResult>;
  /** Save the note — sent when the field is left with a changed note. */
  onSaveNote?: (note: string) => void;
  /** The grid's quick filter changed to look a product up: the moment to refresh the count. */
  onLookup?: () => void;
  /** The worker moved onto an editable cell of another line: refresh if anyone else is counting. */
  onLineFocus?: () => void;
  /** Full receipt: commit what arrived (every line received in full). `fxRate` = the captured delivery
   *  rate (base per PO-currency unit) when the PO currency differs from base, else null. */
  onConfirm: (rows: ReceiveRow[], note: string, fxRate: string | null) => void;
  /** Short receipt: ≥1 line under the ordered qty. The parent opens the close-short reason modal
   *  FIRST and only commits (receipt + write-off) once confirmed — nothing irreversible on click. */
  onCloseShort: (rows: ReceiveRow[], note: string, fxRate: string | null) => void;
  /** Empty session (nothing received): drop the staged WIP and leave reception — no receipt is logged
   *  and no keep-open event is recorded. The parent transitions the PO back to its pre-receive state. */
  onCancel: () => void;
  /** Keep the PO open for the next delivery: commit the staged receipt and park in partially_received.
   *  The parent posts /receive then transitions to partially_received (base behavior). */
  onKeepOpen: (rows: ReceiveRow[], note: string, fxRate: string | null) => void;
  /** Governance cap: may finalize (confirm / close short) WITHOUT counting every line. Without it, the
   *  worker must address every line first (a staged value — incl. 0 — or nothing outstanding). */
  canLax: boolean;
  /** Governance cap: may finish the order on less than was ordered. Server-enforced; mirrored here
   *  so the action is disabled rather than offered and then refused. */
  canCloseShort: boolean;
}): JSX.Element {
  // The figures on screen. Filled from the server's count by the fold below, which runs at mount as
  // well as on every refresh.
  const [received, setReceived] = createSignal<Record<number, number | null>>({});
  const [damaged, setDamaged] = createSignal<Record<number, number | null>>({});
  const [note, setNote] = createSignal(props.initialNote ?? '');

  // FX capture — one rate per delivery, only when the PO currency differs from the store base (the
  // trivial identity case is hidden and treated as 1.0). Empty to start — a deliberate entry, not an
  // assumption (a reference-rate pre-fill can populate it later) — and REQUIRED before a foreign receipt
  // commits. The committed rate converts line costs to base at the WAC boundary.
  const needsFx = (): boolean => props.currency.toUpperCase() !== props.baseCurrency.toUpperCase();
  // Offered, not imposed: the last rate recorded for this currency, shown as such until changed.
  const offeredRate = (): string =>
    null === (props.initialFxRate ?? null) ? '' : String(Number(props.initialFxRate));
  const [fxRate, setFxRate] = createSignal(offeredRate());
  const [fxError, setFxError] = createSignal(false);
  let fxEl: HTMLInputElement | undefined;
  // Resolve the rate to commit, or block the commit: null when no rate is needed (identity currency), the
  // trimmed value when a positive rate is present, or `undefined` when a foreign receipt is missing its
  // rate — flags the field + focuses it so the caller aborts.
  const resolveFx = (): string | null | undefined => {
    if (!needsFx()) return null;
    const v = fxRate().trim();
    if ('' === v || !(Number(v) > 0)) {
      setFxError(true);
      fxEl?.focus();
      return undefined;
    }
    return v;
  };

  // Single-line note that grows with its content (no scrollbar, no manual resize handle).
  const autoGrowNote = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const recvFor = (id: number): number | null => received()[id] ?? null;
  const dmgFor = (id: number): number | null => damaged()[id] ?? null;

  // Lines counted here that the server does not hold yet — the multi-worker fold leaves them alone.
  const unsaved = createUnsavedLines();

  // Lines whose write stored nothing because the reception was not open yet.
  const heldUntilOpen = new Set<number>();

  // What each line owes the server: a typed figure, or scanned units (see lineSync). One write per
  // line is out at a time; whatever changed meanwhile goes next, so writes land in order.
  const sync = createLineSync();
  const figureOwed = (id: number): boolean => sync.owes(id) && 0 === sync.unitsOwed(id);
  const sendLine = (id: number): void => {
    const write = sync.take(id);
    if (null === write) return;
    const upTo = unsaved.checkpoint();
    const next = (): void => {
      sync.settled(id);
      sendLine(id);
    };
    if ('add' === write.kind) {
      void sendUnits(id, write.units, upTo).finally(next);
      return;
    }
    if (!props.onStageLine) {
      next();
      return;
    }
    const rec = recvFor(id);
    const dmg = null === rec ? 0 : Math.min(rec, dmgFor(id) ?? 0);
    void props
      .onStageLine(id, rec, dmg, props.counts[id]?.version ?? null)
      .then((result) => {
        if ('saved' === result.outcome) {
          // Nothing stored (a zero before the reception opened) stays unsaved, to go once it has.
          if (null === result.line) heldUntilOpen.add(id);
          else unsaved.settleLine(id, upTo);
          return;
        }
        if ('stale' === result.outcome) {
          // Someone else changed this line since this screen showed it. Theirs stands; show it, and
          // say what happened to ours. Entering ours again replaces theirs, knowingly.
          unsaved.settleLine(id, upTo);
          if (sync.owes(id)) return; // a newer local change goes next, against their version
          const theirs = result.line.staged;
          setReceived((m) => ({ ...m, [id]: theirs?.received ?? null }));
          setDamaged((m) => ({ ...m, [id]: theirs && theirs.damaged > 0 ? theirs.damaged : null }));
          toast.error(staleNotice(id, rec, result.line));
        }
      })
      .finally(next);
  };

  // A scan's units, sent as an increment. Its answer is the line's new total, coworkers' units
  // included, which the box takes — plus any units scanned here since. A failed increment is never
  // retried: whether it landed is unknown, and a retry of one that did would count twice. Its units
  // come back off the box instead, and the worker is told to scan them again.
  const sendUnits = (id: number, units: number, upTo: number): Promise<void> => {
    if (!props.onAddLine) return Promise.resolve();
    return props.onAddLine(id, units).then((result) => {
      if ('saved' === result.outcome) {
        if (!sync.owes(id)) unsaved.settleLine(id, upTo);
        if (figureOwed(id)) return; // a typed figure goes next and replaces this total anyway
        const theirs = result.line.staged;
        setReceived((m) => ({ ...m, [id]: (theirs?.received ?? 0) + sync.unitsOwed(id) }));
        setDamaged((m) => ({ ...m, [id]: theirs && theirs.damaged > 0 ? theirs.damaged : null }));
        return;
      }
      setReceived((m) => {
        const left = (m[id] ?? 0) - units;
        return {
          ...m,
          [id]: left > 0 || null !== (props.counts[id]?.staged ?? null) ? Math.max(0, left) : null,
        };
      });
      toast.error(
        sprintf(
          /* translators: 1: how many barcode scans, 2: product name. */
          _n(
            '%1$d scan on %2$s was not counted. Scan it again.',
            '%1$d scans on %2$s were not counted. Scan them again.',
            units,
          ),
          units,
          lineName(id),
        ),
      );
    });
  };
  const lineName = (id: number): string =>
    props.lines.find((l) => l.subjectId === id)?.productLabel ?? `#${id}`;
  const staleNotice = (id: number, ours: number | null, theirs: CountLine): string => {
    const figure = theirs.staged
      ? String(theirs.staged.received)
      : _x('blank', 'goods receipt: a count line someone cleared');
    return null === theirs.countedBy
      ? sprintf(
          /* translators: 1: product name, 2: the count now on the line, 3: the count this worker entered. */
          __(
            '%1$s was changed to %2$s by someone else; your %3$s was not saved. Enter it again to replace theirs.',
          ),
          lineName(id),
          figure,
          null === ours ? '—' : String(ours),
        )
      : sprintf(
          /* translators: 1: product name, 2: a coworker's name, 3: the count now on the line, 4: the count this worker entered. */
          __(
            '%1$s was changed to %3$s by %2$s; your %4$s was not saved. Enter it again to replace theirs.',
          ),
          lineName(id),
          theirs.countedBy,
          figure,
          null === ours ? '—' : String(ours),
        );
  };

  // Lines counted before the reception opened were not stored (a zero opens nothing). Once it has,
  // send every line still waiting.
  createEffect(
    on(
      () => props.receiving,
      (now, before) => {
        if (!now || before) return;
        for (const id of [...heldUntilOpen]) {
          heldUntilOpen.delete(id);
          if (!unsaved.has(id)) continue;
          sync.edited(id);
          sendLine(id);
        }
      },
      { defer: true },
    ),
  );

  // The note goes when the field is left, and only when it changed. A coworker's note arrives with a
  // refresh and replaces this one only while this worker has nothing of their own unsent and is not in
  // the field — the last edit wins, but never under someone's cursor.
  let lastSavedNote = props.initialNote ?? '';
  let noteEl: HTMLTextAreaElement | undefined;
  const saveNote = (): void => {
    if (note() === lastSavedNote) return;
    lastSavedNote = note();
    props.onSaveNote?.(note());
  };
  createEffect(
    on(
      () => props.serverNote,
      (incoming) => {
        if (null === incoming || undefined === incoming) return;
        // The page renders in a shadow root, so focus is asked of the field's own root.
        const root = noteEl?.getRootNode() as Document | ShadowRoot | undefined;
        if (note() !== lastSavedNote || (undefined !== noteEl && root?.activeElement === noteEl))
          return;
        lastSavedNote = incoming;
        setNote(incoming);
        if (noteEl) requestAnimationFrame(() => noteEl && autoGrowNote(noteEl));
      },
      { defer: true },
    ),
  );

  const setRecv = (id: number, v: number | null): void => {
    setReceived((m) => ({ ...m, [id]: v }));
    // Damaged is a subset of received. The editor/+- caps only guard *entry*; lowering (or clearing)
    // received afterwards would strand an over-shooting damaged above it. Pull damaged back down to the
    // new received here — clearing received clears damaged too (no damage without a count).
    setDamaged((m) => {
      const d = m[id] ?? null;
      if (null === d) return m;
      if (null === v) return { ...m, [id]: null };
      return d > v ? { ...m, [id]: v } : m;
    });
    unsaved.mark(id);
    sync.edited(id);
    sendLine(id);
  };
  const setDmg = (id: number, v: number | null): void => {
    setDamaged((m) => ({ ...m, [id]: v }));
    unsaved.mark(id);
    sync.edited(id);
    sendLine(id);
  };
  // A scan: one more unit on screen at once, sent as an increment.
  const addRecv = (id: number, units: number): void => {
    if (!props.onAddLine) {
      setRecv(id, (recvFor(id) ?? 0) + units);
      return;
    }
    setReceived((m) => ({ ...m, [id]: (m[id] ?? 0) + units }));
    unsaved.mark(id);
    sync.added(id, units);
    sendLine(id);
  };

  // Multi-worker sync: whenever the server's count changes (the first load, a refresh, a write's
  // answer), fold it into every line — restoring counted values (incl 0) and clearing lines another
  // worker cleared. A computed rather than an effect, so it runs as the form mounts: the first render
  // already shows what the server holds. A line this screen is still sending keeps its figure: a
  // refresh landing between a scan and its write carries the older count, and taking it would undo
  // the scan.
  createComputed(
    on(
      () => props.counts,
      (incoming) => {
        const out = foldCounts(
          { received: received(), damaged: damaged() },
          incoming,
          props.lines.map((l) => l.subjectId),
          (id) => unsaved.has(id) || sync.busy(id) || sync.owes(id),
        );
        setReceived(out.received);
        setDamaged(out.damaged);
      },
    ),
  );

  // Every *counted* line (received entered, including 0).
  const wipRows = (): ReceiveRow[] =>
    props.lines
      .filter((l) => null !== recvFor(l.subjectId))
      .map((l) => ({
        subjectId: l.subjectId,
        received: recvFor(l.subjectId) ?? 0,
        damaged: Math.min(recvFor(l.subjectId) ?? 0, dmgFor(l.subjectId) ?? 0),
      }));

  // Confirm shape: only lines that actually received units (0-count lines record no receipt line).
  const confirmRows = (): ReceiveRow[] => wipRows().filter((r) => r.received > 0);

  const anyReceived = (): boolean => confirmRows().length > 0;
  // Nothing entered at all — the count is untouched, so Cancel is the only thing to offer. A staged 0
  // is not nothing: it says "checked, none arrived", which is exactly what a close-short rests on, so
  // it turns the finish options on even though no receipt would be logged.
  const anyCounted = (): boolean => props.lines.some((l) => null !== recvFor(l.subjectId));
  const sessionEmpty = (): boolean => !anyCounted();
  // Whether an earlier delivery already landed — what makes finishing short on nothing a real outcome.
  const hasEarlierReceipts = (): boolean => props.lines.some((l) => l.qtyReceived > 0);
  // Good qty for a line this session (what reaches stock).
  const goodThisSession = (l: PoLine): number =>
    Math.max(0, (recvFor(l.subjectId) ?? 0) - (dmgFor(l.subjectId) ?? 0));
  // Review discipline: every line that can still receive must be explicitly counted before finalizing —
  // 0 is a valid count ("checked, none arrived"); a blank cell gates the receipt. Lines with nothing open
  // (already fully received on an earlier delivery, or a zero-qty line) need no count — they can't take
  // more. The `invflux_gr_close_short_lax` cap (props.canLax) waives the gate for trusted roles.
  const allCounted = (): boolean =>
    props.lines.every((l) => 0 === l.qtyOpen || null !== recvFor(l.subjectId));
  const gateAllCounted = (): boolean => props.canLax || allCounted();
  // A line is "short" when its CUMULATIVE good (received-so-far + this session) is below the ordered qty —
  // matching the server's qty_open, so the pre-confirm hint agrees with the prompt. A line fully received
  // across earlier deliveries is NOT short even if this session adds nothing to it.
  const shortLines = (): number =>
    props.lines.filter((l) => l.qtyReceived + goodThisSession(l) < orderedQty(l)).length;
  const isShort = (): boolean => shortLines() > 0;

  // The three finalize effects. Each resolves FX first (a missing required rate flags + focuses the
  // field and aborts), then calls the matching parent handler with the committed rows/note/rate.
  // Keeping a PO open across deliveries is base behavior — no tier gate here.
  const runWithFx = (
    effect: (rows: ReceiveRow[], note: string, fxRate: string | null) => void,
  ): void => {
    const fx = resolveFx();
    if (undefined === fx) return; // foreign receipt missing its rate — blocked + flagged
    effect(confirmRows(), note(), fx);
  };
  const doConfirm = (): void => runWithFx(props.onConfirm);
  const doKeepOpen = (): void => runWithFx(props.onKeepOpen);
  const doCloseShort = (): void => runWithFx(props.onCloseShort);

  // Live context the split button resolves against each render — reactive, so the headline promotes
  // (keep-open when short) and the gated items disable/enable as the staged counts change.
  const actionCtx = (): PoReceiveActionContext => ({
    isShort: isShort(),
    shortCount: shortLines(),
    gateOk: gateAllCounted(),
    canCloseShort: props.canCloseShort,
    anyReceived: anyReceived(),
    hasEarlierReceipts: hasEarlierReceipts(),
    busy: props.pending,
    onConfirm: doConfirm,
    onKeepOpen: doKeepOpen,
    onCloseShort: doCloseShort,
  });

  return (
    <div>
      <p class="mb-1 text-sm text-slate-500">
        {__(
          'Enter what arrived per line — and how many are damaged — then confirm. Nothing is added to stock until you confirm the receipt.',
        )}
      </p>

      <PoReceiveGrid
        poId={props.poId}
        lines={props.lines}
        received={received}
        damaged={damaged}
        setRecv={setRecv}
        setDmg={setDmg}
        onLookup={props.onLookup}
        onLineFocus={props.onLineFocus}
        addRecv={addRecv}
        productLink={props.productLink}
        lookupCodes={props.lookupCodes}
        fetchCodes={props.fetchCodes}
        removeCode={props.removeCode}
      />

      <label class="mt-4 block text-sm">
        <span class="mb-1 block font-medium text-slate-600">{__('Note (optional)')}</span>
        <Textarea
          rows="1"
          noResize
          // Only size seeded content, and only after paint (scrollHeight is 0 pre-layout — that's the
          // "height: 0px" bug). An empty note keeps rows="1" with NO inline height; typing grows it.
          ref={(el) => {
            noteEl = el;
            if ('' !== note()) requestAnimationFrame(() => autoGrowNote(el));
          }}
          // `overflow-hidden` is this field's own: the auto-grow keeps the box at content height, so
          // a scrollbar would only ever appear for the instant before it resizes.
          class="w-full overflow-hidden"
          placeholder={__('e.g. wrong item received, mis-pick, packaging issue…')}
          value={note()}
          onInput={(e) => {
            setNote(e.currentTarget.value);
            autoGrowNote(e.currentTarget);
          }}
          onBlur={saveNote}
        />
      </label>

      {/* FX capture — foreign-currency PO only, between the note and the commit buttons. One rate for
          this delivery; converts line costs to base at the WAC boundary when the receipt commits.
          Required: an empty rate blocks the commit (the field flags + focuses). */}
      <Show when={needsFx()}>
        <div class="flex justify-end mt-4">
          <div class="flex flex-col gap-1">
            <p class="text-xs text-text-muted">
              {sprintf(
                __('1 %1$s = this many %2$s — applied to line costs at receipt'),
                props.currency,
                props.baseCurrency,
              )}
            </p>
            <div class="flex items-center gap-3 justify-end">
              <label for="gr-fx-rate" class="text-sm font-medium text-slate-600">
                {sprintf(__('FX rate (%1$s → %2$s)'), props.currency, props.baseCurrency)}
              </label>
              <input
                id="gr-fx-rate"
                ref={(el) => (fxEl = el)}
                type="number"
                min="0"
                step="0.00000001"
                required
                aria-invalid={fxError()}
                class="w-30 rounded border px-2 py-1.5 text-right text-sm focus:outline-none"
                classList={{
                  'border-red-400 focus:border-red-500': fxError(),
                  'border-slate-300 focus:border-primary': !fxError(),
                }}
                value={fxRate()}
                placeholder={props.baseCurrency + ' / ' + props.currency}
                onInput={(e) => {
                  setFxRate(e.currentTarget.value);
                  if (fxError()) setFxError(false);
                }}
              />
            </div>
            <Show when={fxError()}>
              <p class="text-right text-xs text-red-600">
                {__('Enter the FX rate for this delivery before confirming.')}
              </p>
            </Show>
            <Show when={!fxError() && '' !== offeredRate() && fxRate() === offeredRate()}>
              <p class="text-right text-xs text-text-muted" data-testid="gr-fx-offered">
                {sprintf(
                  /* translators: %s is a currency code, e.g. "USD". */
                  __('The last rate recorded for %s. Check it against today’s before confirming.'),
                  props.currency,
                )}
              </p>
            </Show>
          </div>
        </div>
      </Show>

      <div class="mt-4 flex items-center justify-end gap-3">
        {/* Review discipline: when NOT short, the finalize (Confirm receipt) needs every open line counted
            (0 valid). When short, the split button's headline is the ungated keep-open, so the inline
            nudge isn't shown — the gated Close short carries its reason as a disabled-item tooltip. */}
        <Show when={!sessionEmpty() && !isShort() && !props.canLax && !allCounted()}>
          <span class="text-xs text-text-muted">
            {__('Enter a received quantity on every open line (0 is fine) to finalize.')}
          </span>
        </Show>
        <Show when={!sessionEmpty() && !anyReceived()}>
          <span class="text-xs text-amber-600">
            {__(
              'Nothing arrived on the counted lines — cancel the count, or close the order short.',
            )}
          </span>
        </Show>
        <Show when={anyReceived() && isShort()}>
          <span class="text-xs text-amber-600">
            {sprintf(
              _n(
                '%d line is short of the ordered quantity — keep the PO open for the next delivery, or close the remainder short.',
                '%d lines are short of the ordered quantity — keep the PO open for the next delivery, or close the remainder short.',
                shortLines(),
              ),
              shortLines(),
            )}
          </span>
        </Show>
        {/* Empty session → Cancel (drop the WIP, leave reception). Otherwise the finalize split button:
            not short → "Confirm receipt" headlines; short → "Receive & keep open" headlines (the
            non-destructive default), with "Close short" (destructive) and a disabled "Confirm receipt"
            in the overflow. All three are base — no tier gate. */}
        {/* Cancel stays beside the finish options while nothing has been received: a count of zeroes
            may end in a close-short, or just be abandoned. */}
        <Show when={!anyReceived()}>
          <Button
            variant="secondary"
            class="py-2"
            title={__('Nothing received — discard this reception')}
            disabled={props.pending}
            onClick={() => props.onCancel()}
          >
            {__('Cancel reception')}
          </Button>
        </Show>
        <Show when={!sessionEmpty()}>
          <SplitActionButton<PoReceiveActionContext>
            scope={PO_RECEIVE_ACTIONS_SCOPE}
            ctx={actionCtx()}
            overflowLabel={__('More finish options')}
          />
        </Show>
      </div>
    </div>
  );
}
