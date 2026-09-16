import { describe, expect, it, vi } from 'vitest';
import {
  applyBatches,
  partitionApplyRows,
  cellsToClearAfterApply,
  sendConcurrently,
  splitSubmittableRows,
  type ApplyRowShape,
} from './applyPartition';

/** Absolute columns are retry-safe; `total` (the on-hand correction) derives a movement. */
const SAFE = new Set(['price', 'sale_price', 'sku', 'featured']);
const isRetrySafe = (columnId: string): boolean => SAFE.has(columnId);

const row = (subjectId: number, ...columnIds: string[]): ApplyRowShape => ({
  subjectId,
  columnIds,
});

describe('partitionApplyRows', () => {
  it('an empty input produces an empty plan', () => {
    expect(partitionApplyRows([], isRetrySafe, 10)).toEqual({ serial: [], chunks: [] });
  });

  it('rows editing only retry-safe columns are chunked', () => {
    const plan = partitionApplyRows(
      [row(1, 'price'), row(2, 'sku'), row(3, 'featured', 'sale_price')],
      isRetrySafe,
      2,
    );
    expect(plan.serial).toEqual([]);
    expect(plan.chunks).toEqual([[1, 2], [3]]);
  });

  it('a row touching a non-retry-safe column goes serial', () => {
    const plan = partitionApplyRows([row(1, 'price'), row(2, 'total')], isRetrySafe, 10);
    expect(plan.serial).toEqual([2]);
    expect(plan.chunks).toEqual([[1]]);
  });

  it('one unsafe column sends the WHOLE row serially', () => {
    // The row-not-column rule. A row seeding a cost and correcting a count must not be split into
    // two unordered requests: the cost has to land before the correction that snapshots it, or the
    // movement is left uncosted. Keeping the row whole is what preserves that ordering.
    const plan = partitionApplyRows([row(1, 'wac', 'total'), row(2, 'price')], isRetrySafe, 10);
    expect(plan.serial).toEqual([1]);
    expect(plan.chunks).toEqual([[2]]);
  });

  it('an unknown column is treated as unsafe', () => {
    // A column the client has no metadata for must not be quietly retried. Slower, never wrong.
    const plan = partitionApplyRows([row(1, 'contributed_by_an_addon')], isRetrySafe, 10);
    expect(plan.serial).toEqual([1]);
    expect(plan.chunks).toEqual([]);
  });

  it('serial rows are never chunked, however many there are', () => {
    const rows = [1, 2, 3, 4, 5].map((id) => row(id, 'total'));
    const plan = partitionApplyRows(rows, isRetrySafe, 2);
    expect(plan.serial).toEqual([1, 2, 3, 4, 5]);
    expect(plan.chunks).toEqual([]);
  });

  it('chunks split exactly on the boundary', () => {
    const rows = [1, 2, 3, 4].map((id) => row(id, 'price'));
    expect(partitionApplyRows(rows, isRetrySafe, 2).chunks).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('a row with no staged edits is not sent at all', () => {
    const plan = partitionApplyRows([row(1), row(2, 'price')], isRetrySafe, 10);
    expect(plan.serial).toEqual([]);
    expect(plan.chunks).toEqual([[2]]);
  });

  it('input order is preserved within the plan', () => {
    const plan = partitionApplyRows(
      [row(9, 'price'), row(4, 'total'), row(7, 'sku'), row(2, 'total')],
      isRetrySafe,
      10,
    );
    expect(plan.serial).toEqual([4, 2]);
    expect(plan.chunks).toEqual([[9, 7]]);
  });

  it('a non-positive chunk size degrades to one row per chunk, never to nothing', () => {
    // Dropping the merchant's edits would be far worse than sending them one at a time.
    for (const size of [0, -1, 0.4]) {
      const plan = partitionApplyRows([row(1, 'price'), row(2, 'price')], isRetrySafe, size);
      expect(plan.chunks).toEqual([[1], [2]]);
    }
  });

  it('a fractional chunk size floors rather than producing ragged chunks', () => {
    const rows = [1, 2, 3, 4, 5].map((id) => row(id, 'price'));
    expect(partitionApplyRows(rows, isRetrySafe, 2.9).chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('every staged row lands in exactly one request', () => {
    // The invariant that matters most: no row silently dropped, none sent twice.
    const rows = [
      row(1, 'price'),
      row(2, 'total'),
      row(3, 'sku', 'featured'),
      row(4, 'price', 'total'),
      row(5, 'sale_price'),
    ];
    const plan = partitionApplyRows(rows, isRetrySafe, 2);
    const sent = [...plan.serial, ...plan.chunks.flat()].sort((a, b) => a - b);
    expect(sent).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('splitSubmittableRows', () => {
  const pendingRows =
    (...ids: number[]) =>
    (id: number) =>
      ids.includes(id);

  it('sends everything when nothing is outstanding', () => {
    expect(splitSubmittableRows([1, 2, 3], pendingRows())).toEqual({ send: [1, 2, 3], held: [] });
  });

  it('holds a row whose previous save has not answered yet', () => {
    // The correctness boundary: re-sending it would derive a stock movement from a baseline the
    // server has not confirmed, and write the wrong one with no error.
    expect(splitSubmittableRows([1, 2, 3], pendingRows(2))).toEqual({ send: [1, 3], held: [2] });
  });

  it('holds rather than drops, so the caller can report them', () => {
    const { send, held } = splitSubmittableRows([7, 8], pendingRows(7, 8));
    expect(send).toEqual([]);
    expect(held).toEqual([7, 8]);
  });

  it('preserves the caller order on both sides', () => {
    const { send, held } = splitSubmittableRows([5, 1, 4, 2], pendingRows(1, 2));
    expect(send).toEqual([5, 4]);
    expect(held).toEqual([1, 2]);
  });
});

describe('cellsToClearAfterApply', () => {
  const cell = (subjectId: number, columnId: string) => ({ subjectId, columnId });

  it('clears the cells that were sent and accepted', () => {
    const sent = [cell(1, 'price'), cell(2, 'sku')];
    expect(cellsToClearAfterApply(sent, new Set())).toEqual(sent);
  });

  it('keeps a conflicted row cells staged so they can be retried', () => {
    const sent = [cell(1, 'price'), cell(2, 'sku')];
    expect(cellsToClearAfterApply(sent, new Set([2]))).toEqual([cell(1, 'price')]);
  });

  it('never clears a cell this submission did not carry', () => {
    // The one that matters once the save stops blocking the grid: a pending cell is locked but the
    // REST of its row stays editable, so the row can hold edits this request never saw. Clearing by
    // row would discard them — work the server never saw, gone with no error.
    const sent = [cell(1, 'price')];
    const cleared = cellsToClearAfterApply(sent, new Set());
    expect(cleared).toEqual([cell(1, 'price')]);
    expect(cleared.some((c) => c.columnId === 'weight')).toBe(false);
  });

  it('clears nothing when every sent row conflicted', () => {
    expect(cellsToClearAfterApply([cell(4, 'price'), cell(5, 'sku')], new Set([4, 5]))).toEqual([]);
  });
});

describe('applyBatches', () => {
  const apply = (subjectId: number, ...columnIds: string[]) => ({
    subject_id: subjectId,
    edits: columnIds.map((columnId) => ({ column_id: columnId })),
  });
  const ids = (batches: Array<Array<{ subject_id: number }>>): number[][] =>
    batches.map((batch) => batch.map((row) => row.subject_id));

  it('sends the serial rows first, together, then each retry-safe chunk', () => {
    const batches = applyBatches(
      [
        apply(1, 'price'),
        apply(2, 'total'),
        apply(3, 'sku'),
        apply(4, 'price', 'total'),
        apply(5, 'featured'),
      ],
      isRetrySafe,
      2,
    );
    expect(ids(batches)).toEqual([[2, 4], [1, 3], [5]]);
  });

  it('keeps every edit of a row in the one request that carries it', () => {
    // A seed cost and an on-hand correction on one row: split, they would reach the server as two
    // unordered requests and leave the movement uncosted.
    const row = apply(7, 'wac', 'total');
    expect(applyBatches([row], isRetrySafe, 10)).toEqual([[row]]);
  });

  it('sends no serial request when every row is retry-safe', () => {
    expect(ids(applyBatches([apply(1, 'price'), apply(2, 'sku')], isRetrySafe, 100))).toEqual([
      [1, 2],
    ]);
  });

  it('leaves out a row with no edit', () => {
    expect(ids(applyBatches([apply(1), apply(2, 'price')], isRetrySafe, 100))).toEqual([[2]]);
  });

  it('sends nothing for nothing', () => {
    expect(applyBatches([], isRetrySafe, 100)).toEqual([]);
  });
});

describe('sendConcurrently', () => {
  /** A send whose every call waits until the test settles it by batch. */
  const controlled = () => {
    const started: string[] = [];
    const waiting = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
    let inFlight = 0;
    let peak = 0;
    const send = (batch: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        started.push(batch);
        peak = Math.max(peak, ++inFlight);
        const done = () => inFlight--;
        waiting.set(batch, {
          resolve: () => (done(), resolve()),
          reject: (e) => (done(), reject(e)),
        });
      });
    return { started, waiting, send, peak: () => peak };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('keeps at most `limit` in flight and starts them in list order', async () => {
    const c = controlled();
    const run = sendConcurrently(['a', 'b', 'c', 'd', 'e'], 3, c.send);
    await tick();
    expect(c.started).toEqual(['a', 'b', 'c']);
    for (const b of ['a', 'b', 'c', 'd', 'e']) {
      c.waiting.get(b)?.resolve();
      await tick();
    }
    await run;
    expect(c.started).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(c.peak()).toBe(3);
  });

  it('refills a slot as soon as a call settles, so a slow request holds up only itself', async () => {
    const c = controlled();
    const run = sendConcurrently(['slow', 'b', 'c'], 2, c.send);
    await tick();
    c.waiting.get('b')!.resolve();
    await tick();
    // `slow` is still out; `c` did not wait for it.
    expect(c.started).toEqual(['slow', 'b', 'c']);
    c.waiting.get('c')!.resolve();
    c.waiting.get('slow')!.resolve();
    await run;
  });

  it('a non-positive or fractional bound degrades to whole slots, never to nothing', async () => {
    for (const limit of [0, -2, 1.9]) {
      const c = controlled();
      const run = sendConcurrently(['a', 'b'], limit, c.send);
      await tick();
      expect(c.started).toEqual(['a']);
      c.waiting.get('a')!.resolve();
      await tick();
      c.waiting.get('b')!.resolve();
      await run;
      expect(c.peak()).toBe(1);
    }
  });

  it('sends nothing for nothing', async () => {
    const c = controlled();
    await sendConcurrently([], 3, c.send);
    expect(c.started).toEqual([]);
  });

  it('staggers only the opening sends; a freed slot refills at once', async () => {
    vi.useFakeTimers();
    try {
      const c = controlled();
      const run = sendConcurrently(['a', 'b', 'c', 'd'], 3, c.send, 100);
      await vi.advanceTimersByTimeAsync(0);
      expect(c.started).toEqual(['a']);
      await vi.advanceTimersByTimeAsync(100);
      expect(c.started).toEqual(['a', 'b']);
      // `a` answers before the third slot opens: its slot takes the next batch without waiting.
      c.waiting.get('a')!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(c.started).toEqual(['a', 'b', 'c']);
      await vi.advanceTimersByTimeAsync(100);
      expect(c.started).toEqual(['a', 'b', 'c', 'd']);
      for (const b of ['b', 'c', 'd']) c.waiting.get(b)!.resolve();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejected call stops new sends, lets the in-flight ones settle, then rejects', async () => {
    const c = controlled();
    let settled = false;
    const run = sendConcurrently(['a', 'b', 'c', 'd'], 2, c.send).finally(() => (settled = true));
    await tick();
    c.waiting.get('a')!.reject(new Error('boom'));
    await tick();
    expect(c.started).toEqual(['a', 'b']);
    expect(settled).toBe(false);
    c.waiting.get('b')!.resolve();
    await expect(run).rejects.toThrow('boom');
    expect(c.started).toEqual(['a', 'b']);
  });
});
