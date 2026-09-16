/**
 * Splitting one bulk apply into the requests that carry it.
 *
 * A large apply is slow because each product's write goes through the host's per-object CRUD, so
 * the way to stop it blocking the grid is to send it as several requests instead of one. Which rows
 * may be split apart is not a free choice, and the constraint is not the obvious one.
 *
 * **Partition by ROW, never by column.** Two column families behave differently under retry: an
 * *absolute* column writes the value it was given (a price, a SKU, a visibility) and may be sent
 * again harmlessly, while a *delta* column derives a change from the prior state — the on-hand
 * correction sends `new − original` as a stock movement, so applying it twice invents stock.
 *
 * The tempting partition is therefore "chunk the absolute columns, send the delta ones whole". That
 * is wrong, and it breaks a rule the apply dispatcher already enforces: a seed cost must land before
 * the on-hand correction that snapshots it, or the movement is left uncosted. Seed cost is absolute
 * and the correction is delta, so splitting by column puts a merchant who seeds a cost and corrects
 * a count in one gesture into two unordered requests — reintroducing, in the transport, exactly the
 * ordering bug `applyPriority` exists to prevent.
 *
 * So the unit is the row:
 *
 * - a row touching **any** column that is not retry-safe goes in the single serial request, with
 *   all of that row's edits, and is never retried;
 * - a row touching only retry-safe columns may be chunked and sent concurrently;
 * - **a row's edits are never split across requests.**
 *
 * Serial rows are not chunked at any count. They go through InvFlux's own bulk paths rather than
 * the host's per-object CRUD, so they are already fast, and chunking them would only add per-request
 * fixed cost. They are also rare at scale: a merchant editing thousands of rows wants a stock take,
 * not ad-hoc correction.
 */

/** One row's staged edit, reduced to what the partition needs. */
export interface ApplyRowShape {
  subjectId: number;
  /** The columns this row has staged edits for. */
  columnIds: Iterable<string>;
}

export interface ApplyPartition {
  /**
   * Rows that must travel together in one request that is never retried, because at least one of
   * their columns derives its write from the prior state.
   */
  serial: number[];
  /** Retry-safe rows, grouped into independently-sendable chunks. Order is the caller's order. */
  chunks: number[][];
}

/**
 * Group staged rows into the requests that will carry them.
 *
 * `isRetrySafe` answers per column id; a column the caller knows nothing about must come back
 * `false`, so that an unrecognised column is merely slower rather than silently retried.
 *
 * `chunkSize` is clamped to at least 1 — a zero or negative size would otherwise produce either an
 * infinite loop or a silently empty plan, and dropping a merchant's edits is worse than sending
 * them one at a time.
 */
export function partitionApplyRows(
  rows: Iterable<ApplyRowShape>,
  isRetrySafe: (columnId: string) => boolean,
  chunkSize: number,
): ApplyPartition {
  const size = Math.max(1, Math.floor(chunkSize));
  const serial: number[] = [];
  const parallel: number[] = [];

  for (const row of rows) {
    let hasAny = false;
    let allSafe = true;
    for (const columnId of row.columnIds) {
      hasAny = true;
      if (!isRetrySafe(columnId)) {
        allSafe = false;
        break;
      }
    }
    // A row with no staged edit is not a request; sending it would ask the server to apply nothing.
    if (!hasAny) continue;
    (allSafe ? parallel : serial).push(row.subjectId);
  }

  const chunks: number[][] = [];
  for (let i = 0; i < parallel.length; i += size) chunks.push(parallel.slice(i, i + size));

  return { serial, chunks };
}

/** The part of an apply row {@link applyBatches} reads: who it is for, and which columns it edits. */
export interface ApplyBatchRow {
  subject_id: number;
  edits: ReadonlyArray<{ column_id: string }>;
}

/**
 * The requests one apply is sent as, in sending order: the serial rows first, together in one
 * request, then each retry-safe chunk (see {@link partitionApplyRows} for which is which).
 *
 * Rows come back whole — every edit of a row travels in the one request that carries it — and in the
 * caller's order within each request. A row with no edit is not a request and is left out.
 */
export function applyBatches<R extends ApplyBatchRow>(
  rows: readonly R[],
  isRetrySafe: (columnId: string) => boolean,
  chunkSize: number,
): R[][] {
  const byId = new Map(rows.map((row) => [row.subject_id, row]));
  const plan = partitionApplyRows(
    rows.map((row) => ({
      subjectId: row.subject_id,
      columnIds: row.edits.map((edit) => edit.column_id),
    })),
    isRetrySafe,
    chunkSize,
  );
  const pick = (ids: number[]): R[] => ids.map((id) => byId.get(id)!);

  return [...(plan.serial.length > 0 ? [pick(plan.serial)] : []), ...plan.chunks.map(pick)];
}

/**
 * Run `send` over `batches` with at most `limit` calls in flight, starting them in list order —
 * so the serial request {@link applyBatches} puts first is always the first to go out.
 *
 * A slot is refilled as soon as a call settles, rather than in waves of `limit`, so one slow request
 * holds up only itself. `limit` is clamped to at least 1: a zero or negative bound would otherwise
 * send nothing, and dropping a merchant's edits is worse than sending them one at a time.
 *
 * `staggerMs` spaces out only the *first* call of each slot (slot `n` opens `n × staggerMs` in), so
 * the opening requests do not reach the host in the same instant and then answer in lockstep;
 * refills are never delayed.
 *
 * `send` is expected to handle its own failure: the pool does not retry, and one rejected call
 * rejects the whole run once the calls already in flight have settled, leaving the rest unsent.
 */
export async function sendConcurrently<T>(
  batches: readonly T[],
  limit: number,
  send: (batch: T) => Promise<void>,
  staggerMs = 0,
): Promise<void> {
  const slots = Math.min(Math.max(1, Math.floor(limit)), batches.length);
  let next = 0;
  let failed = false;
  const worker = async (slot: number): Promise<void> => {
    if (slot > 0 && staggerMs > 0) await new Promise((r) => setTimeout(r, slot * staggerMs));
    while (!failed && next < batches.length) {
      const batch = batches[next++]!;
      try {
        await send(batch);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: slots }, (_, slot) => worker(slot)),
  );
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected !== undefined) throw rejected.reason;
}

/** What one submission may send, and what it must leave alone. */
export interface SubmissionSplit {
  /** Subject ids this submission sends. */
  send: number[];
  /** Subject ids held back because a previous submission has not answered for them yet. */
  held: number[];
}

/**
 * Split the staged rows into the ones this submission may send and the ones it must hold.
 *
 * **A row with a request outstanding is never re-sent.** The reason is correctness, not politeness:
 * a delta column derives its movement from `original`, so re-submitting a row whose baseline the
 * server has not confirmed writes the wrong movement — silently, with no error anywhere. The save
 * unit is the row (columns validate against each other and a row's edits travel together), so the
 * hold is per row even when the cell being saved is itself free.
 *
 * Held rows stay staged and are reported, never dropped: they are still the operator's intent, and
 * they can be sent again once the outstanding request settles.
 */
export function splitSubmittableRows(
  subjectIds: Iterable<number>,
  isRowPending: (subjectId: number) => boolean,
): SubmissionSplit {
  const send: number[] = [];
  const held: number[] = [];
  for (const subjectId of subjectIds) (isRowPending(subjectId) ? held : send).push(subjectId);

  return { send, held };
}

/** One (subject, column) cell a submission carried. */
export interface SubmittedCell {
  subjectId: number;
  columnId: string;
}

/**
 * The cells a settled submission may clear from the dirty model: the ones it actually carried, minus
 * the rows the server refused.
 *
 * **The unit is the cell, not the row**, and that is the whole point. A pending cell is locked, but
 * the rest of its row stays editable — so by the time a submission comes back, the same row may hold
 * edits it never carried. Clearing the row would drop them: work the server never saw, discarded
 * with no error, and the operator's own next keystrokes are what triggers it.
 *
 * The row is still the unit for *refusal*: a conflict is reported per row (columns validate against
 * each other), so a conflicted row keeps everything it sent, staged and retryable.
 */
export function cellsToClearAfterApply(
  submitted: Iterable<SubmittedCell>,
  conflicted: ReadonlySet<number>,
): SubmittedCell[] {
  const out: SubmittedCell[] = [];
  for (const cell of submitted) if (!conflicted.has(cell.subjectId)) out.push(cell);

  return out;
}
