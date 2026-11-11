/**
 * Fold the server's view of a count into the figures on screen.
 *
 * Every line takes the server's figure — counted values (0 included), and blank where the line was
 * never counted or a coworker cleared it — except the lines `keep` names: those hold a change this
 * screen has not finished sending, and taking the server's older figure would undo it. Damaged 0 shows
 * blank (no damage).
 *
 * Used for the first render as much as for every refresh, so what a reload shows and what a refresh
 * shows can never disagree.
 */
export interface CountedFigure {
  staged: { received: number; damaged: number } | null;
}

export interface FoldedFigures {
  received: Record<number, number | null>;
  damaged: Record<number, number | null>;
}

export function foldCounts(
  local: FoldedFigures,
  counts: Record<number, CountedFigure | undefined>,
  subjectIds: readonly number[],
  keep: (subjectId: number) => boolean,
): FoldedFigures {
  const received = { ...local.received };
  const damaged = { ...local.damaged };
  for (const id of subjectIds) {
    if (keep(id)) continue;
    const staged = counts[id]?.staged ?? null;
    received[id] = staged?.received ?? null;
    damaged[id] = staged && staged.damaged > 0 ? staged.damaged : null;
  }
  return { received, damaged };
}
