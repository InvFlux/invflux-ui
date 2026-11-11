/**
 * What each line of a count owes the server, and in what order it goes.
 *
 * A line changes two ways. A **typed figure** (a cell, the +/- keys) says what the line holds now; it
 * is sent whole, naming the version the screen last saw. A **scan** says one more unit arrived; it is
 * sent as an increment, which names no version and so cannot be refused against a coworker's scan of
 * the same product.
 *
 * One write per line is in flight at a time. While it is out:
 *  - scans add up, and go as one increment;
 *  - a typed figure supersedes any scans still owed — they are already in the figure on screen — and
 *    goes whole.
 * Once a typed figure is owed, later scans ride on it: they change the figure on screen, and the
 * figure is what goes.
 */
export type LineWrite = { kind: 'figure' } | { kind: 'add'; units: number };

export interface LineSync {
  /** A typed figure changed this line. */
  edited: (subjectId: number) => void;
  /** Scans added units to this line. */
  added: (subjectId: number, units: number) => void;
  /** Whether a write for this line is out. */
  busy: (subjectId: number) => boolean;
  /** Units scanned and not yet sent — what the screen shows on top of the server's figure. */
  unitsOwed: (subjectId: number) => number;
  /** Whether anything for this line is waiting to go. */
  owes: (subjectId: number) => boolean;
  /** The write this line owes next, now marked as out; null when it owes nothing or one is out. */
  take: (subjectId: number) => LineWrite | null;
  /** The write that was out has come back, whatever its outcome. */
  settled: (subjectId: number) => void;
}

export function createLineSync(): LineSync {
  const figureOwed = new Set<number>();
  const unitsOwed = new Map<number, number>();
  const out = new Set<number>();

  return {
    edited: (id) => {
      figureOwed.add(id);
      unitsOwed.delete(id);
    },
    added: (id, units) => {
      if (figureOwed.has(id)) return;
      unitsOwed.set(id, (unitsOwed.get(id) ?? 0) + units);
    },
    busy: (id) => out.has(id),
    unitsOwed: (id) => unitsOwed.get(id) ?? 0,
    owes: (id) => figureOwed.has(id) || (unitsOwed.get(id) ?? 0) > 0,
    take: (id) => {
      if (out.has(id)) return null;
      if (figureOwed.delete(id)) {
        out.add(id);
        return { kind: 'figure' };
      }
      const units = unitsOwed.get(id) ?? 0;
      if (units > 0) {
        unitsOwed.delete(id);
        out.add(id);
        return { kind: 'add', units };
      }
      return null;
    },
    settled: (id) => {
      out.delete(id);
    },
  };
}
