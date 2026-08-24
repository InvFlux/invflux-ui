// Shared annotation types + a dependency-free text-diff used by the reusable AnnotationsPanel
// (and any surface rendering the append-only note history). One immutable annotation event on a
// document — a note version, a tag change, or both — mirrors the server's wire shape
// Diffs are computed at render time from
// adjacent versions' `body`; the server never stores them.

/** Tag delta applied at a version: ids of `invflux_tags` added / removed. */
export interface AnnotationTagActions {
  added?: number[];
  removed?: number[];
}

/** One immutable version row of a note thread. */
export interface AnnotationVersion {
  id: string;
  threadId: string;
  version: number;
  action: 'created' | 'edited' | 'deleted';
  /** Full note text at this version; null for a pure tag change or a delete marker. */
  body: string | null;
  tagActions: AnnotationTagActions | null;
  authorActorId: number | null;
  /** Resolved display name of the author (WP user display_name, or an actor-type label). */
  authorName: string | null;
  /** ISO 8601 (UTC). */
  occurredAt: string | null;
  recordedAt: string | null;
}

/** A note thread — its ordered versions plus whether the viewer may edit/delete it. */
export interface AnnotationThread {
  threadId: string;
  /** Server-computed: viewer is the v1 author or a moderator. Gates edit/delete controls. */
  canEdit: boolean;
  /** Ascending by `version`. */
  versions: AnnotationVersion[];
}

/** The 3-state diff toggle a thread row cycles through. */
export type DiffMode = 'plain' | 'words' | 'lines';

export interface DiffSegment {
  value: string;
  kind: 'equal' | 'add' | 'del';
}

/** The live (non-deleted) latest version of a thread, or null if it ends deleted / is empty. */
export function latestLiveVersion(thread: AnnotationThread): AnnotationVersion | null {
  if (thread.versions.length === 0) return null;
  const last = thread.versions[thread.versions.length - 1];
  return last.action === 'deleted' ? null : last;
}

/** True when the thread's newest version is a delete marker. */
export function isThreadDeleted(thread: AnnotationThread): boolean {
  const last = thread.versions[thread.versions.length - 1];
  return !!last && last.action === 'deleted';
}

/**
 * Word/line diff between two texts as a segment list. Dependency-free LCS (Longest Common
 * Subsequence) over tokens — O(n·m), which is ample for note-sized bodies. Tokenisation keeps
 * separators so joining the segment values reconstructs each side exactly:
 *   - `words`: splits on whitespace runs, keeping the whitespace as its own tokens.
 *   - `lines`: splits on newlines, keeping the `\n` tokens.
 */
export function diffTokens(prev: string, next: string, mode: 'words' | 'lines'): DiffSegment[] {
  const a = tokenize(prev, mode);
  const b = tokenize(next, mode);
  const segments = coalesce(lcsDiff(a, b));
  // Word mode: token-LCS can't see that two whitespace-separated tokens share characters
  // (e.g. "here" vs "here..."), so a one-word edit strikes/adds the whole token. Refine each
  // adjacent delete→add pair by peeling off the common character prefix + suffix, which keeps a
  // genuine word swap clean (no shared affix) while surfacing sub-word edits.
  return mode === 'words' ? coalesce(refineAdjacentEdits(segments)) : segments;
}

/**
 * For every adjacent (delete, add) pair — in either order — factor out the common leading and
 * trailing characters into `equal` runs, leaving only the truly-changed middle as del/add.
 */
function refineAdjacentEdits(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const nxt = segments[i + 1];
    const isPair =
      nxt &&
      ((cur.kind === 'del' && nxt.kind === 'add') || (cur.kind === 'add' && nxt.kind === 'del'));
    if (!isPair) {
      out.push(cur);
      continue;
    }
    const del = (cur.kind === 'del' ? cur : nxt).value;
    const add = (cur.kind === 'del' ? nxt : cur).value;

    let p = 0;
    while (p < del.length && p < add.length && del[p] === add[p]) p++;
    let s = 0;
    while (
      s < del.length - p &&
      s < add.length - p &&
      del[del.length - 1 - s] === add[add.length - 1 - s]
    ) {
      s++;
    }

    const prefix = del.slice(0, p);
    const delMid = del.slice(p, del.length - s);
    const addMid = add.slice(p, add.length - s);
    const suffix = del.slice(del.length - s);

    if (prefix) out.push({ value: prefix, kind: 'equal' });
    if (delMid) out.push({ value: delMid, kind: 'del' });
    if (addMid) out.push({ value: addMid, kind: 'add' });
    if (suffix) out.push({ value: suffix, kind: 'equal' });
    i++; // consumed both cur and nxt
  }
  return out;
}

function tokenize(text: string, mode: 'words' | 'lines'): string[] {
  if (text === '') return [];
  if (mode === 'lines') {
    // Capturing split keeps the `\n` delimiters as their own tokens, so equal newlines don't get
    // mis-attributed to an add/del run.
    return text.split(/(\n)/).filter((t) => t !== '');
  }
  // Word mode: tokenize on word boundaries — a run of letters/digits, a run of whitespace, or a
  // run of punctuation is each its own token. So "here..." splits into "here" + "...", letting the
  // LCS keep the shared word instead of restriking it. Unicode-aware (\p{L}\p{N}) so accented
  // words (fr/de) stay whole rather than fragmenting on the ASCII \w boundary.
  return text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}\s]+/gu) ?? [];
}

function lcsDiff(a: string[], b: string[]): DiffSegment[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ value: a[i], kind: 'equal' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ value: a[i], kind: 'del' });
      i++;
    } else {
      out.push({ value: b[j], kind: 'add' });
      j++;
    }
  }
  while (i < n) out.push({ value: a[i++], kind: 'del' });
  while (j < m) out.push({ value: b[j++], kind: 'add' });
  return out;
}

/** Merge adjacent same-kind segments so the rendered output has minimal spans. */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === seg.kind) prev.value += seg.value;
    else out.push({ ...seg });
  }
  return out;
}
