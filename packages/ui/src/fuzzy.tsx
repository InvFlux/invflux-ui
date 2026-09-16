import type { JSX } from 'solid-js';

/** A scored fuzzy match against one label: the matched character positions + a quality score. */
export interface FuzzyScore {
  score: number;
  /** Indices into the ORIGINAL `label` matched by the needle, in order (for highlighting). */
  indices: number[];
}

const isWordStart = (text: string, i: number): boolean =>
  0 === i || /[\s\-_./·,()[\]]/.test(text[i - 1] ?? '');

/**
 * Score a needle against a label (subsequence match, case-insensitive). Returns null when the needle's
 * characters don't all appear in order. Higher is better; ranking favours contiguous runs, matches at
 * word starts, and earlier positions — so the best match sorts first. An empty needle scores 0 (all
 * labels match equally, original order preserved). Indices are into the ORIGINAL label (for highlight).
 */
export function fuzzyScore(needle: string, label: string): FuzzyScore | null {
  const q = needle.toLowerCase().trim();
  if ('' === q) return { score: 0, indices: [] };
  const t = label.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    let hit = -1;
    for (let j = from; j < t.length; j++) {
      if (t[j] === ch) {
        hit = j;
        break;
      }
    }
    if (-1 === hit) return null;
    let s = 1;
    if (hit === prev + 1) s += 5; // contiguous run
    if (isWordStart(label, hit)) s += 8; // start of a word
    s -= hit * 0.02; // mild preference for earlier matches
    score += s;
    indices.push(hit);
    prev = hit;
    from = hit + 1;
  }
  return { score, indices };
}

/**
 * Render `text` with the characters that fuzzy-match `query` emphasised. Designed to read on a
 * highlighted (selected) dropdown row too: when an ancestor carries the `group` class and Kobalte's
 * `data-highlighted`, the emphasis flips from the accent colour to an underline on inherited text.
 */
export function HighlightMatch(props: { text: string; query: string }): JSX.Element {
  const hit = (): Set<number> => new Set(fuzzyScore(props.query, props.text)?.indices ?? []);
  return (
    <>
      {(() => {
        const set = hit();
        return Array.from(props.text, (ch, i) =>
          set.has(i) ? (
            <span class="font-semibold text-primary group-data-[highlighted]:text-inherit group-data-[highlighted]:underline">
              {ch}
            </span>
          ) : (
            ch
          ),
        );
      })()}
    </>
  );
}
