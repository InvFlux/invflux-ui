/**
 * Symmetric, length-aware fuzzy string matching — a reusable similarity scorer for pairing free-text
 * labels (spreadsheet headers → import fields, and any other "which of these candidates does this string
 * mean" problem). Framework-agnostic: pure functions, no DOM/Solid deps.
 *
 * NOTE: distinct from `./fuzzy` (a subsequence *highlighter* for typeahead comboboxes). This module
 * answers "how alike are two strings, 0–1" and "which candidate is the best match", not "where do the
 * typed chars land".
 *
 * Design: the score is **symmetric** (normalised by the LONGER side), so a short generic header can't
 * spuriously score 100% against a long specific alias (`"Qty"` vs `"confirmed qty"` ≈ 0.38, not 1.0),
 * and vice-versa — only when *both* strings are well covered does the score approach 1. It blends:
 *   - a char-level term: longest-common-subsequence length ÷ max(len) of the folded keys;
 *   - a token-level term: how well each token finds a partner on the other side ÷ max(token count) —
 *     catches word-order and multi-word variants.
 *
 * The token term matches tokens by **edit distance, not equality**, which is what lets a
 * one-character difference read as one: `"Cadeau"` vs `"Cadeaux"` scores 0.86, where exact-token
 * matching gave 0.43 — a plural is a near-identical name, but shares *no* token, so a set
 * intersection scored it zero and halved the total. Since an exact token pair still scores 1, this
 * only ever raises a score, and never for strings that had a real token in common already.
 */

/** Fold a string to a comparison key: strip accents, lowercase, drop non-alphanumerics. */
export function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Split into folded tokens (on whitespace/punctuation) — e.g. "Unit Cost" → ["unit", "cost"]. */
function tokens(s: string): string[] {
  return s
    .split(/[^\p{L}\p{N}]+/u)
    .map(foldKey)
    .filter((t) => '' !== t);
}

/** Longest-common-subsequence length (classic DP, O(n·m); inputs are short labels). */
function lcsLength(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (0 === n || 0 === m) return 0;
  let prev = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}

/** Levenshtein edit distance (classic DP, O(n·m); inputs are short labels). */
function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (0 === n) return m;
  if (0 === m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1).fill(0);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[m];
}

/**
 * How alike two single tokens are, 0–1: 1 minus the share of the longer one that must change.
 *
 * Edit distance rather than the subsequence measure used for whole strings, because at token scale
 * "how much must change" is the question — `cadeau`/`cadeaux` is one insertion (0.86), while
 * unrelated words of the same length share enough letters in order to score far higher under LCS.
 */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/**
 * Similarity of two strings in [0, 1]. 1 = identical after folding; 0 = nothing in common. Symmetric:
 * `matchScore(a, b) === matchScore(b, a)`.
 */
export function matchScore(a: string, b: string): number {
  const ka = foldKey(a);
  const kb = foldKey(b);
  if ('' === ka || '' === kb) return 0;
  if (ka === kb) return 1;

  const charScore = lcsLength(ka, kb) / Math.max(ka.length, kb.length);

  const ta = [...new Set(tokens(a))];
  const tb = [...new Set(tokens(b))];
  let tokScore = 0;
  if (ta.length > 0 && tb.length > 0) {
    // Pair each token of the shorter side with its closest partner on the longer side, then
    // normalise by the LONGER side's token count — so extra tokens dilute the score exactly as they
    // did when this was a set intersection, and a two-word label can't be fully claimed by one word.
    const [fewer, more] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    let paired = 0;
    for (const t of fewer) {
      paired += Math.max(...more.map((u) => tokenSimilarity(t, u)));
    }
    tokScore = paired / Math.max(ta.length, tb.length);
  }

  return (charScore + tokScore) / 2;
}

export interface BestMatch {
  /** Highest score across the candidates, 0 if none. */
  score: number;
  /** The candidate (verbatim) that produced the score, '' if none. */
  matched: string;
}

/** The best-scoring candidate for `query`. */
export function bestMatch(query: string, candidates: readonly string[]): BestMatch {
  let score = 0;
  let matched = '';
  for (const c of candidates) {
    const s = matchScore(query, c);
    if (s > score) {
      score = s;
      matched = c;
    }
  }
  return { score, matched };
}

/** Default acceptance floor for "this is a real match" (tunable per use site). */
export const DEFAULT_MATCH_THRESHOLD = 0.5;

const NONE: [number, number, number] = [0xff, 0xcc, 0xdd]; // pink — no match
const PARTIAL: [number, number, number] = [0xff, 0xee, 0xcc]; // amber — partial
const EXACT: [number, number, number] = [0xcd, 0xed, 0xe2]; // green — strong match

const lerp = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** A CSS colour for a score: pink (0) → amber (0.5) → green (1). Monotonic gradient. */
export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const c = s <= 0.5 ? lerp(NONE, PARTIAL, s * 2) : lerp(PARTIAL, EXACT, (s - 0.5) * 2);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
