import { __, _n, sprintf } from '@invflux/i18n';
import { createEffect, createSignal, type JSX, on, onCleanup, Show } from 'solid-js';
import { Button, SplitActionButton } from '@invflux/ui';
import { PoReceiveGrid } from './PoReceiveGrid';
import { PO_RECEIVE_ACTIONS_SCOPE, type PoReceiveActionContext, registerPoReceiveActions } from './poReceiveActions';
import type { PoLine, ReceivingSessionRow } from './types';

/** A staged receipt line the parent posts to /receive on confirm (alias of the persisted WIP row). */
export type ReceiveRow = ReceivingSessionRow;

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
 */
export function PoReceiveForm(props: {
  poId: number;
  lines: PoLine[];
  /** PO transaction currency + the store base — an FX-rate field shows only when they differ. */
  currency: string;
  baseCurrency: string;
  pending: boolean;
  /** Persisted WIP to rehydrate from (survives a page reload). */
  initial?: ReceiveRow[];
  initialNote?: string;
  /** Debounced autosave of the staged WIP — the parent PUTs it to /receiving-session. */
  onPersist?: (rows: ReceiveRow[], note: string) => void;
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
   *  The parent posts /receive then transitions to partially_received (base behaviour). */
  onKeepOpen: (rows: ReceiveRow[], note: string, fxRate: string | null) => void;
  /** Governance cap: may finalize (confirm / close short) WITHOUT counting every line. Without it, the
   *  worker must address every line first (a staged value — incl. 0 — or nothing outstanding). */
  canLax: boolean;
}): JSX.Element {
  // Seed the staged state once from any persisted WIP (keyed by PO-line id). A WIP row exists only
  // for a *counted* line, so its `received` is restored verbatim — including 0 ("checked, none
  // arrived"); lines absent from the WIP stay blank (uncounted). Damaged 0 is left blank (no damage).
  const seedRecv: Record<number, number> = {};
  const seedDmg: Record<number, number> = {};
  for (const r of props.initial ?? []) {
    seedRecv[r.poLineId] = r.received;
    if (r.damaged > 0) seedDmg[r.poLineId] = r.damaged;
  }
  const [received, setReceived] = createSignal<Record<number, number | null>>(seedRecv);
  const [damaged, setDamaged] = createSignal<Record<number, number | null>>(seedDmg);
  const [note, setNote] = createSignal(props.initialNote ?? '');

  // FX capture — one rate per delivery, only when the PO currency differs from the store base (the
  // trivial identity case is hidden and treated as 1.0). Empty to start — a deliberate entry, not an
  // assumption (a reference-rate pre-fill can populate it later) — and REQUIRED before a foreign receipt
  // commits. The committed rate converts line costs to base at the WAC boundary.
  const needsFx = (): boolean => props.currency.toUpperCase() !== props.baseCurrency.toUpperCase();
  const [fxRate, setFxRate] = createSignal('');
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

  // Debounced WIP persistence — fired from edits, never on mount (the seed is already on the server).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedulePersist = (): void => {
    if (!props.onPersist) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => props.onPersist?.(wipRows(), note()), 700);
  };
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

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
    schedulePersist();
  };
  const setDmg = (id: number, v: number | null): void => {
    setDamaged((m) => ({ ...m, [id]: v }));
    schedulePersist();
  };

  // Multi-worker sync: only when background polling delivers a *new* persisted WIP (props.initial
  // changes) do we fold it into every line — restoring counted values (incl 0) and clearing lines
  // another worker dropped. `defer` skips mount (the seed handles that). A cell mid-edit is shielded by
  // the grid editor's own in-flight value, so no special-casing of a "focused" line is needed here.
  createEffect(
    on(
      () => props.initial,
      (incoming) => {
        const map = new Map((incoming ?? []).map((r) => [r.poLineId, r]));
        setReceived((m) => {
          const next = { ...m };
          for (const l of props.lines) {
            const r = map.get(l.id);
            next[l.id] = r ? r.received : null;
          }
          return next;
        });
        setDamaged((m) => {
          const next = { ...m };
          for (const l of props.lines) {
            const r = map.get(l.id);
            next[l.id] = r && r.damaged > 0 ? r.damaged : null;
          }
          return next;
        });
      },
      { defer: true },
    ),
  );

  // Autosave shape: every *counted* line (received entered, including 0), so an explicit 0 persists
  // and a line cleared back to blank drops out — a reload restores exactly what was on screen.
  const wipRows = (): ReceiveRow[] =>
    props.lines
      .filter((l) => null !== recvFor(l.id))
      .map((l) => ({ poLineId: l.id, received: recvFor(l.id) ?? 0, damaged: Math.min(recvFor(l.id) ?? 0, dmgFor(l.id) ?? 0) }));

  // Confirm shape: only lines that actually received units (0-count lines record no receipt line).
  const confirmRows = (): ReceiveRow[] => wipRows().filter((r) => r.received > 0);

  const anyReceived = (): boolean => confirmRows().length > 0;
  // Nothing actually received this session (every line blank or a staged 0) — there's no receipt to log,
  // so the session cancels rather than finalizes. Drives the [Cancel reception] affordance.
  const sessionEmpty = (): boolean => !anyReceived();
  // Good qty for a line this session (what reaches stock).
  const goodThisSession = (l: PoLine): number => Math.max(0, (recvFor(l.id) ?? 0) - (dmgFor(l.id) ?? 0));
  // Review discipline: every line that can still receive must be explicitly counted before finalizing —
  // 0 is a valid count ("checked, none arrived"); a blank cell gates the receipt. Lines with nothing open
  // (already fully received on an earlier delivery, or a zero-qty line) need no count — they can't take
  // more. The `invflux_gr_close_short_lax` cap (props.canLax) waives the gate for trusted roles.
  const allCounted = (): boolean => props.lines.every((l) => 0 === l.qtyOpen || null !== recvFor(l.id));
  const gateAllCounted = (): boolean => props.canLax || allCounted();
  // A line is "short" when its CUMULATIVE good (received-so-far + this session) is below the ordered qty —
  // matching the server's qty_open, so the pre-confirm hint agrees with the prompt. A line fully received
  // across earlier deliveries is NOT short even if this session adds nothing to it.
  const shortLines = (): number => props.lines.filter((l) => l.qtyReceived + goodThisSession(l) < l.requestedQty).length;
  const isShort = (): boolean => shortLines() > 0;

  // The three finalize effects. Each resolves FX first (a missing required rate flags + focuses the
  // field and aborts), then calls the matching parent handler with the committed rows/note/rate.
  // Keeping a PO open across deliveries is base behaviour — no tier gate here.
  const runWithFx = (effect: (rows: ReceiveRow[], note: string, fxRate: string | null) => void): void => {
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
    busy: props.pending,
    onConfirm: doConfirm,
    onKeepOpen: doKeepOpen,
    onCloseShort: doCloseShort,
  });

  return (
    <div>
      <p class="mb-3 text-sm text-slate-500">
        {__('Enter what arrived per line — and how many are damaged — then confirm. Nothing is added to stock until you confirm the receipt.')}
      </p>

      <PoReceiveGrid poId={props.poId} lines={props.lines} received={received} damaged={damaged} setRecv={setRecv} setDmg={setDmg} />

      <label class="mt-4 block text-sm">
        <span class="mb-1 block font-medium text-slate-600">{__('Note (optional)')}</span>
        <textarea
          rows="1"
          // Only size seeded content, and only after paint (scrollHeight is 0 pre-layout — that's the
          // "height: 0px" bug). An empty note keeps rows="1" with NO inline height; typing grows it.
          ref={(el) => {
            if ('' !== note()) requestAnimationFrame(() => autoGrowNote(el));
          }}
          class="w-full resize-none overflow-hidden rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          placeholder={__('e.g. wrong item received, mis-pick, packaging issue…')}
          value={note()}
          onInput={(e) => {
            setNote(e.currentTarget.value);
            autoGrowNote(e.currentTarget);
            schedulePersist();
          }}
        />
      </label>

      {/* FX capture — foreign-currency PO only, between the note and the commit buttons. One rate for
          this delivery; converts line costs to base at the WAC boundary when the receipt commits.
          Required: an empty rate blocks the commit (the field flags + focuses). */}
      <Show when={needsFx()}>
        <div class="flex justify-end mt-4">
          <div class="flex flex-col gap-1">
            <p class="text-xs text-text-muted">
              {sprintf(__('1 %1$s = this many %2$s — applied to line costs at receipt'), props.currency, props.baseCurrency)}
            </p>
            <div class='flex items-center gap-3 justify-end'>
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
                placeholder={props.currency + ' / ' + props.baseCurrency}
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
        <Show when={!sessionEmpty() && isShort()}>
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
        <Show
          when={!sessionEmpty()}
          fallback={
            <Button
              variant="secondary"
              class="py-2"
              title={__('Nothing received — discard this reception')}
              disabled={props.pending}
              onClick={() => props.onCancel()}
            >
              {__('Cancel reception')}
            </Button>
          }
        >
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
