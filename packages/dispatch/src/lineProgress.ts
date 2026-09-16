/**
 * An order's staging progress over the work that remains, as `done / remaining`.
 *
 * `stagedCount` counts a line with nothing left to do — fully corrected, or fully shipped — as
 * staged. That is right for readiness ("is all remaining work staged?") and wrong for a readout: an
 * order of five lines, two corrected away and three staged, is 3 of 3 done, not 5 of 5. So settled
 * lines leave both numbers. `remaining === 0` means there is nothing left to stage at all, which a
 * reader shows as absent rather than as `0/0`.
 */
export function remainingProgress(
  staged: number,
  lines: number,
  settled: number,
): { done: number; remaining: number } {
  const s = Math.max(0, settled);

  return { done: Math.max(0, staged - s), remaining: Math.max(0, lines - s) };
}
