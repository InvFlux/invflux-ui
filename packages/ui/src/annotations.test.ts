import { describe, expect, it } from 'vitest';
import {
  diffTokens,
  isThreadDeleted,
  latestLiveVersion,
  type AnnotationThread,
  type AnnotationVersion,
} from './annotations';

function version(over: Partial<AnnotationVersion> = {}): AnnotationVersion {
  return {
    id: 'v',
    threadId: 't',
    version: 1,
    action: 'created',
    body: null,
    tagActions: null,
    authorActorId: 1,
    authorName: null,
    occurredAt: '2026-07-19T10:00:00Z',
    recordedAt: '2026-07-19T10:00:00Z',
    ...over,
  };
}

function thread(versions: AnnotationVersion[]): AnnotationThread {
  return { threadId: 't', canEdit: true, versions };
}

describe('diffTokens (words)', () => {
  it('marks a replaced word as del + add and keeps the rest equal', () => {
    const segs = diffTokens('waiting on restock', 'waiting on delivery', 'words');
    const joinedDel = segs.filter((s) => s.kind !== 'add').map((s) => s.value).join('');
    const joinedAdd = segs.filter((s) => s.kind !== 'del').map((s) => s.value).join('');
    // Reconstruct each side exactly from its visible (non-opposite) segments.
    expect(joinedDel).toBe('waiting on restock');
    expect(joinedAdd).toBe('waiting on delivery');
    expect(segs.some((s) => s.kind === 'del' && s.value.includes('restock'))).toBe(true);
    expect(segs.some((s) => s.kind === 'add' && s.value.includes('delivery'))).toBe(true);
  });

  it('is all-equal when texts are identical', () => {
    const segs = diffTokens('same text here', 'same text here', 'words');
    expect(segs.every((s) => s.kind === 'equal')).toBe(true);
    expect(segs.map((s) => s.value).join('')).toBe('same text here');
  });

  it('keeps a middle-word swap clean (no sub-word bleed)', () => {
    const segs = diffTokens('asdf asdf asdf', 'asdf foo asdf', 'words');
    const dels = segs.filter((s) => s.kind === 'del').map((s) => s.value).join('');
    const adds = segs.filter((s) => s.kind === 'add').map((s) => s.value).join('');
    expect(dels).toBe('asdf'); // exactly the middle word, not "asdff" etc.
    expect(adds).toBe('foo');
    // both sides still reconstruct exactly
    expect(segs.filter((s) => s.kind !== 'add').map((s) => s.value).join('')).toBe('asdf asdf asdf');
    expect(segs.filter((s) => s.kind !== 'del').map((s) => s.value).join('')).toBe('asdf foo asdf');
  });

  it('retains a common prefix when punctuation is appended to a word', () => {
    const segs = diffTokens("Let's try adding a note here", "Let's try adding a note here... or there", 'words');
    const dels = segs.filter((s) => s.kind === 'del').map((s) => s.value).join('');
    const adds = segs.filter((s) => s.kind === 'add').map((s) => s.value).join('');
    expect(dels).toBe(''); // nothing removed — "here" is retained via the common prefix
    expect(adds).toBe('... or there');
  });

  it('treats appended punctuation as a clean add (word boundary tokenization)', () => {
    const segs = diffTokens('done', 'done!', 'words');
    expect(segs.filter((s) => s.kind === 'del').map((s) => s.value).join('')).toBe('');
    expect(segs.filter((s) => s.kind === 'add').map((s) => s.value).join('')).toBe('!');
  });

  it('does not fragment accented words on the ASCII word boundary', () => {
    // "café" must diff as a whole word, not caf|é — else fr/de content mis-diffs.
    const segs = diffTokens('un café serré', 'un café allongé', 'words');
    expect(segs.filter((s) => s.kind !== 'add').map((s) => s.value).join('')).toBe('un café serré');
    expect(segs.filter((s) => s.kind !== 'del').map((s) => s.value).join('')).toBe('un café allongé');
    // "café" is unchanged; only the third word differs.
    expect(segs.some((s) => s.kind === 'equal' && s.value.includes('café'))).toBe(true);
  });

  it('handles pure insertion at the end', () => {
    const segs = diffTokens('hello', 'hello world', 'words');
    expect(segs.filter((s) => s.kind === 'equal').map((s) => s.value).join('')).toBe('hello');
    expect(segs.some((s) => s.kind === 'add' && s.value.includes('world'))).toBe(true);
    expect(segs.some((s) => s.kind === 'del')).toBe(false);
  });
});

describe('diffTokens (lines)', () => {
  it('diffs by line, keeping newlines as tokens', () => {
    const segs = diffTokens('a\nb\nc', 'a\nB\nc', 'lines');
    // The unchanged first + last lines survive as equal; the middle line differs.
    expect(segs.filter((s) => s.kind === 'del').map((s) => s.value).join('')).toContain('b');
    expect(segs.filter((s) => s.kind === 'add').map((s) => s.value).join('')).toContain('B');
    expect(segs.filter((s) => s.kind !== 'add').map((s) => s.value).join('')).toBe('a\nb\nc');
    expect(segs.filter((s) => s.kind !== 'del').map((s) => s.value).join('')).toBe('a\nB\nc');
  });
});

describe('thread helpers', () => {
  it('latestLiveVersion returns the newest non-deleted version', () => {
    const t = thread([version({ version: 1, body: 'first' }), version({ version: 2, action: 'edited', body: 'second' })]);
    expect(latestLiveVersion(t)?.body).toBe('second');
    expect(isThreadDeleted(t)).toBe(false);
  });

  it('a deleted tail yields null live version and isThreadDeleted true', () => {
    const t = thread([
      version({ version: 1, body: 'temp' }),
      version({ version: 2, action: 'deleted', body: null }),
    ]);
    expect(latestLiveVersion(t)).toBeNull();
    expect(isThreadDeleted(t)).toBe(true);
  });
});
