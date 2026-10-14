import { createStore } from 'solid-js/store';
import type { ReceivingSessionRow } from './types';

/**
 * A close-short's shortfall, as the prompt captures it: per part of what is written off, why it did
 * not come and who answers for it. The vocabulary and each cause's default party come from the server
 * (`GET /receiving/purchase-orders/{id}/shortfall`); the quantities from the counts, never the operator.
 */
export type ShortfallPart = 'unconfirmed' | 'undelivered' | 'in_transit' | 'damaged';

export interface ShortfallVocabulary {
  incoterm: string | null;
  parts: {
    part: ShortfallPart;
    label: string;
    causes: { cause: string; label: string; party: string }[];
  }[];
  parties: { party: string; label: string }[];
  /** Each open line's split as it stands now. */
  open: { subjectId: number; parts: Partial<Record<ShortfallPart, number>> }[];
  recorded: RecordedShortfall[];
}

export interface RecordedShortfall {
  subjectId: number;
  part: ShortfallPart;
  partLabel: string;
  qty: number;
  cause: string;
  causeLabel: string;
  party: string;
  partyLabel: string;
  partyInferred: boolean;
  note: string | null;
  at: string | null;
}

export type ShortfallSplit = Record<number, Partial<Record<ShortfallPart, number>>>;

/**
 * Mirror of core's `ShortfallSplit::split()`: of what is open, `unconfirmed` = ordered − confirmed,
 * `damaged` = the damaged units, `undelivered` the rest, each capped so the parts add up to `open`.
 * The server re-derives it at the close; this is what the prompt shows beforehand.
 */
export function splitLine(
  open: number,
  ordered: number,
  confirmed: number | null,
  damaged: number,
): Partial<Record<ShortfallPart, number>> {
  const left = Math.max(0, open);
  const unconfirmed = Math.min(left, Math.max(0, ordered - (confirmed ?? ordered)));
  const damagedPart = Math.min(left - unconfirmed, Math.max(0, damaged));
  const undelivered = left - unconfirmed - damagedPart;
  const out: Partial<Record<ShortfallPart, number>> = {};
  if (unconfirmed > 0) out.unconfirmed = unconfirmed;
  if (undelivered > 0) out.undelivered = undelivered;
  if (damagedPart > 0) out.damaged = damagedPart;
  return out;
}

/** The order's lines as a reception holds them, and what a count would add to them. */
export interface ShortfallLine {
  subjectId: number;
  qtyRequested: number | null;
  qtyExpected: number | null;
  qtyDamagedSoFar: number;
  qtyOpen: number;
}

/** The split the remainder will have once these counts are posted (none: as it stands now). */
export function projectedSplit(
  lines: ShortfallLine[],
  rows: ReceivingSessionRow[] = [],
): ShortfallSplit {
  const counted = new Map(rows.map((r) => [r.subjectId, r]));
  const out: ShortfallSplit = {};
  for (const line of lines) {
    const row = counted.get(line.subjectId);
    const good = null === row || undefined === row ? 0 : Math.max(0, row.received - row.damaged);
    const split = splitLine(
      line.qtyOpen - good,
      line.qtyRequested ?? 0,
      line.qtyExpected,
      line.qtyDamagedSoFar + (row?.damaged ?? 0),
    );
    if (Object.keys(split).length > 0) out[line.subjectId] = split;
  }
  return out;
}

/** The parts present across the order, with their total quantity, in the vocabulary's order. */
export function partsPresent(split: ShortfallSplit): Partial<Record<ShortfallPart, number>> {
  const totals: Partial<Record<ShortfallPart, number>> = {};
  for (const parts of Object.values(split)) {
    for (const [part, qty] of Object.entries(parts) as [ShortfallPart, number][]) {
      totals[part] = (totals[part] ?? 0) + qty;
    }
  }
  return totals;
}

interface Choice {
  cause: string;
  /** Null: the server's suggestion for this cause under the order's Incoterm. */
  party: string | null;
}

/**
 * What the operator is saying about one close: a cause (and maybe a party) per part on the header,
 * per-line overrides, and the note.
 */
export function createShortfallState() {
  const [state, setState] = createStore<{
    parts: Partial<Record<ShortfallPart, Choice>>;
    lines: Record<number, Partial<Record<ShortfallPart, Choice>>>;
    note: string;
    /** Confirms tried so far: from the first, a missing value shows on its field. */
    attempts: number;
  }>({ parts: {}, lines: {}, note: '', attempts: 0 });

  const choiceFor = (subjectId: number, part: ShortfallPart): Choice | undefined =>
    state.lines[subjectId]?.[part] ?? state.parts[part];

  /**
   * What still keeps the close from being recorded: the parts some line has no cause for, and
   * whether the note is required and empty ("not known yet" needs one).
   */
  const issues = (split: ShortfallSplit): { causes: ShortfallPart[]; note: boolean } => {
    const causes = new Set<ShortfallPart>();
    let unknown = false;
    for (const [subjectId, parts] of Object.entries(split)) {
      for (const part of Object.keys(parts) as ShortfallPart[]) {
        const choice = choiceFor(Number(subjectId), part);
        if (undefined === choice || '' === choice.cause) causes.add(part);
        else if ('unknown' === choice.cause) unknown = true;
      }
    }
    return { causes: [...causes], note: unknown && '' === state.note.trim() };
  };

  return {
    state,
    setPart: (part: ShortfallPart, choice: Choice | undefined) => setState('parts', part, choice),
    setLine: (subjectId: number, part: ShortfallPart, choice: Choice | undefined) =>
      setState('lines', subjectId, (prev) => ({ ...(prev ?? {}), [part]: choice })),
    setNote: (note: string) => setState('note', note),
    reset: () => setState({ parts: {}, lines: {}, note: '', attempts: 0 }),

    issues,

    /**
     * A confirm: true when the close can be recorded. Otherwise the fields show what is missing, each
     * on itself, until it is filled — the prompt stays open, the record is the point.
     */
    attempt(split: ShortfallSplit): boolean {
      setState('attempts', (n) => n + 1);
      const { causes, note } = issues(split);
      return 0 === causes.length && !note;
    },

    /** The `shortfall` the close-short routes take, for the parts present. */
    body(split: ShortfallSplit): {
      parts: Partial<Record<ShortfallPart, { cause: string; party?: string }>>;
      lines: Record<number, Partial<Record<ShortfallPart, { cause: string; party?: string }>>>;
    } {
      const wire = (c: Choice) =>
        null === c.party ? { cause: c.cause } : { cause: c.cause, party: c.party };
      const present = partsPresent(split);
      const parts: Partial<Record<ShortfallPart, { cause: string; party?: string }>> = {};
      for (const part of Object.keys(present) as ShortfallPart[]) {
        const c = state.parts[part];
        if (undefined !== c && '' !== c.cause) parts[part] = wire(c);
      }
      const lines: Record<
        number,
        Partial<Record<ShortfallPart, { cause: string; party?: string }>>
      > = {};
      for (const [subjectId, overrides] of Object.entries(state.lines)) {
        for (const [part, c] of Object.entries(overrides) as [
          ShortfallPart,
          Choice | undefined,
        ][]) {
          if (undefined === c || '' === c.cause || undefined === split[Number(subjectId)]?.[part])
            continue;
          (lines[Number(subjectId)] ??= {})[part] = wire(c);
        }
      }
      return { parts, lines };
    },
  };
}

export type ShortfallState = ReturnType<typeof createShortfallState>;
