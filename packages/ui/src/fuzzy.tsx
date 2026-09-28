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
 * Lowercase one character and strip its accent, **without ever changing its length**.
 *
 * Length is the whole point: `indices` are promised to address the original label, and
 * `HighlightMatch` marks characters by those indices, so a fold that resizes the string silently
 * highlights the wrong letters. That rules out this package's own {@link foldKey}, which also
 * deletes spaces and punctuation — « Expédition partielle » loses its space and every index past
 * it slides left by one. Folding per character sidesteps the question entirely: each one is
 * replaced by exactly one, or kept as it was, whatever its decomposition turns out to be.
 */
function foldChar(c: string): string {
  const d = c.normalize('NFD');
  // A decomposition only helps when the base is ASCII: é→e, ü→u, ñ→n, ç→c. Anything else (a
  // surrogate half, a script that does not decompose to ASCII) keeps the original character.
  const base = d.length > 1 && d.charCodeAt(0) < 0x80 ? (d[0] ?? c) : c;
  const lower = base.toLowerCase();
  return lower.length === base.length ? lower : base;
}

/** Fold a whole string character by character, so the result indexes like the original. */
const fold = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldChar(s[i] ?? '');
  return out;
};

/**
 * Score a needle against a label (subsequence match, case-insensitive). Returns null when the needle's
 * characters don't all appear in order. Higher is better; ranking favours contiguous runs, matches at
 * word starts, and earlier positions — so the best match sorts first. An empty needle scores 0 (all
 * labels match equally, original order preserved). Indices are into the ORIGINAL label (for highlight).
 *
 * **Accent-insensitive**, because a merchant reading a French label types what is on their keyboard:
 * `exped` has to find « Expédition partielle », and without folding it does not — the subsequence
 * dies on the `é` and the tag disappears at the fifth keystroke, having matched at the fourth.
 */
export function fuzzyScore(needle: string, label: string): FuzzyScore | null {
  const q = fold(needle).trim();
  if ('' === q) return { score: 0, indices: [] };
  const t = fold(label);
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
