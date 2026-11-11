import { describe, expect, it, vi } from 'vitest';
import {
  CODE_LOOKUP_GAP_MS,
  codeRefresher,
  registerReceiveScanHandler,
  resolveReceiveScan,
  scanNamesLine,
  type ReceiveScanContext,
  type ScanLine,
} from './receiveScan';

const line = (over: Partial<ScanLine> = {}): ScanLine => ({
  subjectId: 1,
  sku: 'TEA-CHAI',
  supplierSku: 'Y-4402',
  gtin: '4012824402553',
  codes: ['4012824402553'],
  ...over,
});

describe('scanNamesLine', () => {
  it('matches a whole code, SKU or supplier SKU', () => {
    expect(scanNamesLine(line(), '4012824402553')).toBe(true);
    expect(scanNamesLine(line(), 'tea-chai')).toBe(true);
    expect(scanNamesLine(line(), 'Y-4402')).toBe(true);
  });

  it('never matches part of a code', () => {
    expect(scanNamesLine(line(), '4402553')).toBe(false);
    expect(scanNamesLine(line({ sku: 'SKU-12345' }), '1234')).toBe(false);
  });

  it('compares digits without their zero padding, so a UPC matches its EAN form', () => {
    expect(scanNamesLine(line({ codes: ['021245565307'], gtin: null }), '0021245565307')).toBe(
      true,
    );
  });

  it('matches an extra code the line carries', () => {
    expect(scanNamesLine(line({ codes: ['4012824402553', 'OLD-EAN-9'] }), 'OLD-EAN-9')).toBe(true);
  });
});

describe('resolveReceiveScan', () => {
  const ctx = (over: Partial<ReceiveScanContext> = {}): ReceiveScanContext => ({
    gridId: 'po.receive',
    code: '4012824402553',
    source: 'wedge',
    lines: [line()],
    matches: [line()],
    received: () => null,
    setReceived: vi.fn(),
    addReceived: vi.fn(),
    showMatches: vi.fn(),
    clearFilter: vi.fn(),
    focusFilter: vi.fn(),
    focusLine: vi.fn(),
    ...over,
  });

  it('narrows to the matches and goes to the one line, as Enter does', () => {
    const c = ctx();
    expect(resolveReceiveScan(c)).toBeUndefined();
    expect(c.showMatches).toHaveBeenCalledOnce();
    expect(c.focusLine).toHaveBeenCalledWith(1);
  });

  it('only narrows when the code names no line or several, and says nothing', () => {
    const none = ctx({ matches: [] });
    expect(resolveReceiveScan(none)).toBeUndefined();
    expect(none.showMatches).toHaveBeenCalledOnce();
    expect(none.focusLine).not.toHaveBeenCalled();

    const two = ctx({ matches: [line(), line({ subjectId: 2 })] });
    resolveReceiveScan(two);
    expect(two.focusLine).not.toHaveBeenCalled();
  });

  it('lets an enabled contributed handler claim the scan, and the base take it otherwise', () => {
    const handle = vi.fn(() => ({ refused: 'Not on this order.' }));
    let on = false;
    registerReceiveScanHandler({ name: 'test.count', enabled: () => on, handle });

    const off = ctx();
    resolveReceiveScan(off);
    expect(handle).not.toHaveBeenCalled();
    expect(off.showMatches).toHaveBeenCalledOnce();

    on = true;
    const claimed = ctx();
    expect(resolveReceiveScan(claimed)).toEqual({ refused: 'Not on this order.' });
    expect(claimed.showMatches).not.toHaveBeenCalled();

    registerReceiveScanHandler({ name: 'test.count', handle: () => false });
    const declined = ctx();
    resolveReceiveScan(declined);
    expect(declined.showMatches).toHaveBeenCalledOnce();
  });
});

describe('codeRefresher', () => {
  const fresh = [{ subjectId: 1, codes: ['00-02408C'], gtin: null }];

  it('asks nothing for a code a line already names', () => {
    const fetch = vi.fn(() => Promise.resolve(fresh));
    expect(codeRefresher(fetch, vi.fn()).before(true)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the codes again for an unknown code, and applies them before the scan resolves', async () => {
    const apply = vi.fn();
    const pending = codeRefresher(() => Promise.resolve(fresh), apply).before(false);

    expect(pending).toBeInstanceOf(Promise);
    await pending;
    expect(apply).toHaveBeenCalledWith(fresh);
  });

  it('shares one lookup between unknown codes scanned while it is out, and lets a known one through', async () => {
    let answer: (lines: typeof fresh) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<typeof fresh>((resolve) => (answer = resolve)));
    const refresher = codeRefresher(fetch, vi.fn());

    const first = refresher.before(false);
    expect(refresher.before(false)).toBe(first);
    expect(refresher.before(true)).toBeUndefined();
    answer(fresh);
    await first;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not ask again within the gap, and does after it', async () => {
    let clock = 1_000;
    const fetch = vi.fn(() => Promise.resolve(fresh));
    const refresher = codeRefresher(fetch, vi.fn(), () => clock);

    await refresher.before(false);
    clock += CODE_LOOKUP_GAP_MS - 1;
    expect(refresher.before(false)).toBeUndefined();
    clock += 1;
    await refresher.before(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('settles on a failed lookup, so the scan resolves against the codes already held', async () => {
    const apply = vi.fn();
    await expect(
      codeRefresher(() => Promise.reject(new Error('offline')), apply).before(false),
    ).resolves.toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });
});
