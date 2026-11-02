import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { pollingTransport, type LiveUpdatesTransportConfig } from './liveUpdates';
import type { RowPatch } from './workbenchGridTypes';

/**
 * The default polling transport against the server's poll route: where it asks, from which cursor,
 * and what it does with each kind of answer.
 */

const SUB = '0192abcd-ef01-2345-6789-abcdef012345';
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(overrides: Partial<LiveUpdatesTransportConfig> = {}) {
  const updates: RowPatch[][] = [];
  const gone = vi.fn();
  const errors = vi.fn();
  let loadedAt = 'C0';
  const config: LiveUpdatesTransportConfig = {
    apiRoot: 'https://shop.test/wp-json/',
    nonce: 'n',
    subscriptionId: () => SUB,
    cursor: () => loadedAt,
    enabled: () => true,
    onUpdate: (patches) => updates.push(patches),
    onGone: gone,
    onError: errors,
    ...overrides,
  };
  const stop = pollingTransport({ intervalMs: 1_000 })(config);
  return { updates, gone, errors, stop, reload: (c: string) => (loadedAt = c) };
}

const urlOf = (fetchMock: ReturnType<typeof vi.fn>, call: number): URL =>
  fetchMock.mock.calls[call][0] as URL;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pollingTransport', () => {
  it('asks the subscription route from the loaded snapshot, patches the totals, then moves on', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          cursor: 'C1',
          updates: [{ subjectId: 7, atp: 3, res: 1, ctd: 2, total: 6 }],
          resync: [],
        }),
      )
      .mockResolvedValue(json({ cursor: 'C1', updates: [], resync: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness();

    await vi.advanceTimersByTimeAsync(0);
    expect(urlOf(fetchMock, 0).pathname).toBe(
      `/wp-json/invflux/v1/workbench/subscriptions/${SUB}/updates`,
    );
    expect(urlOf(fetchMock, 0).searchParams.get('cursor')).toBe('C0');
    expect(h.updates).toEqual([
      [{ subject_id: 7, fields: { atp: 3, res: 1, ctd: 2, total: 6 }, cursor: 'C1' }],
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(urlOf(fetchMock, 1).searchParams.get('cursor')).toBe('C1');
    h.stop();
  });

  it('keeps the route under plain permalinks, where the API root carries ?rest_route=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ cursor: 'C0', updates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness({ apiRoot: 'https://shop.test/index.php?rest_route=/' });

    await vi.advanceTimersByTimeAsync(0);
    const url = urlOf(fetchMock, 0);
    expect(url.searchParams.get('rest_route')).toBe(
      `/invflux/v1/workbench/subscriptions/${SUB}/updates`,
    );
    expect(url.searchParams.get('cursor')).toBe('C0');
    h.stop();
  });

  it('waits while the rows have no snapshot yet — an empty cursor would replay their whole history', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const h = harness({ cursor: () => '' });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).not.toHaveBeenCalled();
    h.stop();
  });

  it('asks nothing while switched off', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const h = harness({ enabled: () => false });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).not.toHaveBeenCalled();
    h.stop();
  });

  it('reports a subscription the server no longer knows as gone, not as an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 'subscription_gone' }, 410))
      .mockResolvedValue(json({ cursor: 'C1', updates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness();

    await vi.advanceTimersByTimeAsync(0);
    expect(h.gone).toHaveBeenCalledOnce();
    expect(h.errors).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);

    // Retried from the same cursor: a 410 moves nothing.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(urlOf(fetchMock, 1).searchParams.get('cursor')).toBe('C0');
    h.stop();
  });

  it('drops an answer that a reload overtook, and starts over from the new snapshot', async () => {
    let answer: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockResolvedValue(json({ cursor: 'C9', updates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness();

    await vi.advanceTimersByTimeAsync(0);
    h.reload('C5');
    answer(json({ cursor: 'C1', updates: [{ subjectId: 7, atp: 0, res: 0, ctd: 0, total: 0 }] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.updates).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(urlOf(fetchMock, 1).searchParams.get('cursor')).toBe('C5');
    h.stop();
  });

  it('turns subjects to re-read into patches with no fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ cursor: 'C1', updates: [], resync: [9] })),
    );
    const h = harness();

    await vi.advanceTimersByTimeAsync(0);
    expect(h.updates).toEqual([[{ subject_id: 9, fields: {} }]]);
    h.stop();
  });

  it('does not poll a hidden page, and catches up as soon as it is shown again', async () => {
    const listeners: Array<() => void> = [];
    const page = {
      visibilityState: 'hidden',
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('document', page);
    const fetchMock = vi.fn().mockResolvedValue(json({ cursor: 'C1', updates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).not.toHaveBeenCalled();

    page.visibilityState = 'visible';
    for (const fn of listeners) fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    h.stop();
    expect(page.removeEventListener).toHaveBeenCalledWith('visibilitychange', listeners[0]);
  });

  it('keeps its cursor through a failed poll', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValue(json({ cursor: 'C1', updates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const h = harness();

    await vi.advanceTimersByTimeAsync(0);
    expect(h.errors).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(urlOf(fetchMock, 1).searchParams.get('cursor')).toBe('C0');
    h.stop();
  });
});
