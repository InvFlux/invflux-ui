/**
 * The lines a count has changed on this screen and the server does not yet hold.
 *
 * A reception autosaves after a pause, so for a moment the screen is ahead of the server. A re-read
 * that lands in that moment (the one that follows the save which opened the reception, a refocused
 * window, another worker's change) carries the server's older figure for those lines. Folding it in
 * would undo a count the worker just made, so the fold leaves these lines alone.
 *
 * Every change is numbered. A save remembers the number it was taken at, and when it succeeds it
 * settles the lines changed up to that number — a line changed again while the save was in flight
 * keeps its newer number and stays unsaved until a later save carries it.
 */
export interface UnsavedLines {
  /** Record a change to this line. */
  mark: (subjectId: number) => void;
  /** The number a save taken now covers; pass it to {@link settle} once that save succeeds. */
  checkpoint: () => number;
  /** A save taken at `upTo` succeeded: the lines it carried are on the server. */
  settle: (upTo: number) => void;
  /** A save of this one line, taken at `upTo`, succeeded — or was answered with the server's figure. */
  settleLine: (subjectId: number, upTo: number) => void;
  /** Every line holding a change the server does not have yet. */
  ids: () => number[];
  /** Whether this line holds a change the server does not have yet. */
  has: (subjectId: number) => boolean;
}

export function createUnsavedLines(): UnsavedLines {
  let seq = 0;
  const changedAt = new Map<number, number>();

  return {
    mark: (subjectId) => {
      seq += 1;
      changedAt.set(subjectId, seq);
    },
    checkpoint: () => seq,
    settle: (upTo) => {
      for (const [subjectId, at] of changedAt) {
        if (at <= upTo) changedAt.delete(subjectId);
      }
    },
    settleLine: (subjectId, upTo) => {
      const at = changedAt.get(subjectId);
      if (undefined !== at && at <= upTo) changedAt.delete(subjectId);
    },
    ids: () => [...changedAt.keys()],
    has: (subjectId) => changedAt.has(subjectId),
  };
}
