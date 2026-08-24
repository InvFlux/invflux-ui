import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import { formatRelative as formatRelativeTime, formatWallClock } from './Timeline';
import { TagDeltaPills, type TagPillResolver } from './AnnotationTimelineRow';
import { tagColor, tagInk, type TagColor } from './tagPalette';
import { Button } from './Button';
import { FoldingSection } from './FoldingSection';
import {
  diffTokens,
  isThreadDeleted,
  type AnnotationThread,
  type AnnotationVersion,
  type DiffMode,
  type DiffSegment,
} from './annotations';

/** Pickable tag in the composer — id + display metadata. */
export interface ComposerTag {
  id: number;
  name: string;
  colorId: number;
  /** When true, *adding* this tag requires the note to carry text (governance RequireNoteOnAdd). */
  requiresNote?: boolean;
  /** When true, *removing* this tag requires the note to carry text (governance RequireNoteOnRemove). */
  requiresNoteOnRemove?: boolean;
}

/** A tag delta a note carries: order-tag ids to attach / detach in the same act. */
export interface NoteTagDelta {
  addTags: number[];
  removeTags: number[];
}

/**
 * Toggle-pill tag editor: selected tags render as solid pills, the rest as colour outlines
 * (click toggles). SPA-agnostic + reusable — the note composer uses it, and the order-detail
 * "+ Tag" affordance can adopt it for one consistent tag-editing surface.
 */
export function TagTogglePicker(props: {
  tags: ComposerTag[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div class="flex flex-wrap gap-1.5">
      <For each={props.tags}>
        {(t) => {
          const on = (): boolean => props.selected.has(t.id);
          const c = (): TagColor => tagColor(t.colorId);
          return (
            <button
              type="button"
              disabled={props.disabled}
              class="inline-flex cursor-pointer items-center rounded-full px-2 py-0.5 text-2xs font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-40"
              classList={{ 'opacity-75 hover:opacity-100': !on() }}
              style={
                on()
                  ? { 'background-color': c().bg, color: c().fg }
                  : { 'box-shadow': `inset 0 0 0 1px ${tagInk(c())}`, color: tagInk(c()) }
              }
              title={on() ? sprintf(__('Remove %s'), t.name) : sprintf(__('Add %s'), t.name)}
              onClick={() => props.onToggle(t.id)}
            >
              {t.name}
            </button>
          );
        }}
      </For>
    </div>
  );
}

/**
 * Reusable notes/annotations panel (`@invflux/ui`) — presentational + callback-driven so it
 * mounts on any document surface (orders now, purchase orders next) with the host owning the
 * data layer (fetch + mutations). Each thread renders its *latest* version with the append-only
 * history reachable in-row: an "edited · vN/M" marker cycles a 3-state diff toggle
 * (plain → word-diff → line-diff vs the previous version) and ‹ › step through versions.
 *
 * Notes-only for now — the tag picker in the composer lands with the polymorphic tag migration
 * with the polymorphic tag migration.
 */
export interface AnnotationsPanelProps {
  threads: AnnotationThread[];
  loading?: boolean;
  error?: string | null;
  /** Show the composer (host gates on the write capability). */
  canAdd?: boolean;
  /** Open a new note thread, optionally with a tag delta (§5). Rejects → the composer surfaces
   * the error and keeps the draft. */
  onAdd: (body: string, tags: NoteTagDelta) => Promise<unknown> | void;
  /** Append the next version of a thread. Editing is text-only — changing the order's tags is an
   * operational act (done on a *new* note), not a correction of recorded information. */
  onEdit: (threadId: string, body: string) => Promise<unknown> | void;
  /** Soft-delete a thread (append a delete marker). */
  onDelete: (threadId: string) => Promise<unknown> | void;
  /** Resolves a tag id → {name, colorId} so tag-delta annotations render as chips (notes carrying
   * a tag change). Omit on surfaces without tags. */
  resolveTag?: TagPillResolver;
  /** The pickable tag vocabulary for the composer. Omit to render a notes-only composer (no picker). */
  tags?: ComposerTag[];
  /** The document's current tag ids — the composer picker's pre-selected baseline; toggling a
   * pill off removes it, a new pill on adds it, and the note carries the resulting delta. */
  currentTagIds?: number[];
  /** Panel heading. Default "Notes". */
  title?: string;
  /** Wrap in a collapsible section (default true). When false, always-expanded, no header chrome. */
  collapsible?: boolean;
  defaultExpanded?: boolean;
}


export function AnnotationsPanel(props: AnnotationsPanelProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);
  const [composing, setComposing] = createSignal(false);
  // At most one thread is editable at a time — while a note is open for edit, every other row's
  // Edit affordance is hidden (a single focused edit, no accidental parallel edits).
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const collapsible = (): boolean => props.collapsible ?? true;

  const liveCount = createMemo(
    () => props.threads.filter((t) => !isThreadDeleted(t)).length,
  );

  // Reveal the composer (expanding the panel if collapsed so it's visible).
  const startComposing = (): void => {
    setExpanded(true);
    setComposing(true);
  };

  // Count folded into the title: "2 Notes" / "1 Note" / "Notes" (0). A custom title keeps its
  // own wording with the count appended.
  const headerLabel = (): string => {
    const n = liveCount();
    if (props.title) return n > 0 ? `${props.title} (${n})` : props.title;
    return n > 0
      ? sprintf(_n('%d Note', '%d Notes', n), n)
      : __('Notes');
  };

  const newNoteButton = (): JSX.Element => (
    <Show when={props.canAdd && !composing()}>
      <Button
        variant="success"
        weight="outline"
        size="xs"
        onClick={startComposing}
      >
        {__('+ New note')}
      </Button>
    </Show>
  );

  return (
    <FoldingSection
      title={headerLabel()}
      actions={newNoteButton()}
      actionsAlign="title"
      collapsible={collapsible()}
      open={expanded()}
      onOpenChange={setExpanded}
    >
      <Show when={props.canAdd && composing()}>
        <Composer
          onAdd={props.onAdd}
          onClose={() => setComposing(false)}
          tags={props.tags}
          currentTagIds={props.currentTagIds}
        />
      </Show>

      <Show when={props.loading}>
        <div class="py-3 text-xs text-text-muted">{__('Loading notes…')}</div>
      </Show>
      <Show when={props.error}>
        <div class="py-3 text-xs text-red-700">
          {sprintf(__('Notes failed to load: %s'), props.error ?? '')}
        </div>
      </Show>

      <Show when={!props.loading && !props.error}>
        <Show
          when={props.threads.length > 0}
          fallback={
            <div class="py-4 text-center text-xs text-text-muted">
              {__('No notes on this order yet.')}
            </div>
          }
        >
          <ul class="divide-y divide-gray-100">
            <For each={props.threads}>
              {(thread) => (
                <li class="py-2">
                  <ThreadRow
                    thread={thread}
                    resolveTag={props.resolveTag}
                    editingId={editingId}
                    setEditingId={setEditingId}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </FoldingSection>
  );
}

/**
 * New-note composer, shown only after "+ New note" is clicked. Saves on Save note (or
 * ⌘/Ctrl+Enter), keeps the draft on error, and closes on success or Cancel.
 */
function Composer(props: {
  onAdd: (body: string, tags: NoteTagDelta) => Promise<unknown> | void;
  onClose: () => void;
  tags?: ComposerTag[];
  currentTagIds?: number[];
}): JSX.Element {
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const baseline = (): Set<number> => new Set(props.currentTagIds ?? []);
  const [selected, setSelected] = createSignal(baseline());
  const toggle = (id: number): void => {
    const next = new Set(selected());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };
  const delta = (): NoteTagDelta => {
    const base = baseline();
    const sel = selected();
    return {
      addTags: [...sel].filter((id) => !base.has(id)),
      removeTags: [...base].filter((id) => !sel.has(id)),
    };
  };
  const hasDelta = (): boolean => delta().addTags.length > 0 || delta().removeTags.length > 0;
  // Which tags force the note to carry text, split by the direction that demands it. Removal counts
  // as much as application: taking the tag off is the claim that whatever it flagged is settled, and
  // that claim is exactly what the flag asks to be written down.
  const noteDemands = createMemo(() => {
    const tags = props.tags ?? [];
    const named = (id: number): string => tags.find((t) => t.id === id)?.name ?? String(id);
    const d = delta();

    return {
      adding: d.addTags.filter((id) => tags.find((t) => t.id === id)?.requiresNote).map(named),
      removing: d.removeTags
        .filter((id) => tags.find((t) => t.id === id)?.requiresNoteOnRemove)
        .map(named),
    };
  });
  const noteRequired = (): boolean =>
    noteDemands().adding.length > 0 || noteDemands().removing.length > 0;

  /**
   * The placeholder names *which* tags demand the note, and for which act. A bare "(required)"
   * leaves the merchant to work out which of the pills they just toggled caused it — and since one
   * tag can demand a note going on and a different one coming off, the two are worth telling apart.
   *
   * The tag name is quoted per name rather than the whole list, so a list of several stays readable
   * and multi-word names don't blur into the sentence. The quote characters live in a translatable
   * string because they are not the same in every language.
   */
  const quoted = (name: string): string => sprintf(_x('“%s”', 'quoted tag name'), name);
  const placeholder = (): string => {
    const { adding, removing } = noteDemands();
    const list = (names: string[]): string => names.map(quoted).join(', ');

    if (adding.length > 0 && removing.length > 0) {
      return sprintf(
        __('Add a note… (required when adding %1$s and removing %2$s)'),
        list(adding),
        list(removing),
      );
    }
    if (adding.length > 0) return sprintf(__('Add a note… (required when adding %s)'), list(adding));
    if (removing.length > 0) return sprintf(__('Add a note… (required when removing %s)'), list(removing));

    return __('Add a note…');
  };
  const canSubmit = (): boolean => {
    const body = text().trim();
    if (busy()) return false;
    if (noteRequired()) return body !== '';
    return body !== '' || hasDelta();
  };

  const submit = async (): Promise<void> => {
    const body = text().trim();
    if (!canSubmit()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onAdd(body, delta());
      setText('');
      setSelected(baseline());
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="mb-3">
      <textarea
        ref={(el) => queueMicrotask(() => el.focus())}
        class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        rows={2}
        placeholder={placeholder()}
        value={text()}
        disabled={busy()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Keep keystrokes out of the app's global single-key shortcuts (e.g. "C" =
          // create-correction): while typing a note, no ancestor handler should see the key.
          e.stopPropagation();
          // Ctrl/Cmd+Enter submits (Enter alone keeps newlines — notes are multi-line).
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            props.onClose();
          }
        }}
      />
      <Show when={(props.tags?.length ?? 0) > 0}>
        <div class="mt-1.5 flex flex-wrap items-center gap-2">
          <span class="text-2xs font-semibold uppercase tracking-wide text-text-muted">{__('Tags')}</span>
          <TagTogglePicker
            tags={props.tags!}
            selected={selected()}
            onToggle={toggle}
            disabled={busy()}
          />
        </div>
      </Show>
      <div class="mt-1.5 flex items-center gap-2">
        <Button
          variant="success"
          size="sm"
          disabled={!canSubmit()}
          onClick={() => void submit()}
        >
          {busy() ? __('Saving…') : __('Save note')}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          disabled={busy()}
          onClick={() => props.onClose()}
        >
          {__('Cancel')}
        </Button>
        <span class="text-2xs text-text-muted">{__('⌘/Ctrl + Enter')}</span>
        <Show when={error()}>
          <span class="text-2xs text-red-700">{error()}</span>
        </Show>
      </div>
    </div>
  );
}

/**
 * One thread row: the current version's body, an "edited · vN/M" marker that cycles the diff
 * mode, ‹ › version nav, and owner/moderator edit + delete controls. A deleted thread shows a
 * muted tombstone (its history is still navigable).
 */
function ThreadRow(props: {
  thread: AnnotationThread;
  resolveTag?: TagPillResolver;
  editingId: () => string | null;
  setEditingId: (id: string | null) => void;
  onEdit: (threadId: string, body: string) => Promise<unknown> | void;
  onDelete: (threadId: string) => Promise<unknown> | void;
}): JSX.Element {
  const versions = (): AnnotationVersion[] => props.thread.versions;
  const total = (): number => versions().length;
  const deleted = createMemo(() => isThreadDeleted(props.thread));

  // Editing is coordinated by the panel: this row is in edit mode iff it owns the shared
  // editingId; another row editing hides this row's Edit button.
  const editing = (): boolean => props.editingId() === props.thread.threadId;
  const setEditing = (on: boolean): void => props.setEditingId(on ? props.thread.threadId : null);
  const someoneElseEditing = (): boolean => props.editingId() !== null && !editing();

  // Default to the newest version (or the last non-deleted one if the tail is a delete marker).
  const initialIdx = (): number => {
    const v = versions();
    if (v.length === 0) return 0;
    const last = v[v.length - 1];
    return last.action === 'deleted' && v.length > 1 ? v.length - 2 : v.length - 1;
  };
  const [idx, setIdx] = createSignal(initialIdx());
  const [diffMode, setDiffMode] = createSignal<DiffMode>('plain');
  const [editText, setEditText] = createSignal('');
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const current = (): AnnotationVersion => versions()[Math.min(idx(), total() - 1)];
  const isEdited = (): boolean => total() > 1;
  // Tags are set when the note is created and never touched by an edit, so the delta is immutable
  // and lives on whichever version carried it. Surface it at all times — not gated on the version
  // being viewed — so a later text edit never buries the operational tag change.
  const deltaVersion = (): AnnotationVersion | undefined =>
    versions().find(
      (v) => (v.tagActions?.added?.length ?? 0) > 0 || (v.tagActions?.removed?.length ?? 0) > 0,
    );

  const cycleDiff = (): void => {
    setDiffMode((m) => (m === 'plain' ? 'words' : m === 'words' ? 'lines' : 'plain'));
  };

  const diffSegments = createMemo<DiffSegment[] | null>(() => {
    const mode = diffMode();
    if (mode === 'plain') return null;
    const i = Math.min(idx(), total() - 1);
    if (i <= 0) return null; // v1 has no predecessor to diff against
    const prev = versions()[i - 1].body ?? '';
    const next = versions()[i].body ?? '';
    return diffTokens(prev, next, mode);
  });

  const startEdit = (): void => {
    setEditText(current().body ?? '');
    setError(null);
    setEditing(true);
  };

  const saveEdit = async (): Promise<void> => {
    const body = editText().trim();
    if (body === '' || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onEdit(props.thread.threadId, body);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onDelete(props.thread.threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="text-sm">
      <Show
        when={!editing()}
        fallback={
          <div>
            <textarea
              // Autofocus on open so focus lands in the field (not the "Edit" button) — else a
              // global single-key shortcut like "C" fires instead of typing into the note.
              ref={(el) => queueMicrotask(() => el.focus())}
              class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              rows={2}
              value={editText()}
              disabled={busy()}
              onInput={(e) => setEditText(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Keep keystrokes out of the app's global single-key shortcuts while editing.
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
            <div class="mt-1.5 flex items-center gap-2">
              <Button
                variant="success"
                size="sm"
                disabled={busy() || editText().trim() === ''}
                onClick={() => void saveEdit()}
              >
                {busy() ? __('Saving…') : __('Save')}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy()}
                onClick={() => setEditing(false)}
              >
                {__('Cancel')}
              </Button>
              <Show when={error()}>
                <span class="text-2xs text-red-700">{error()}</span>
              </Show>
            </div>
          </div>
        }
      >
        <Show
          when={!deleted() || idx() < total() - 1}
          fallback={
            <div class="italic text-text-muted">{__('Note deleted.')}</div>
          }
        >
          <Show when={current().body}>
            <div class="whitespace-pre-wrap break-words text-gray-800">
              <Show when={diffSegments()} fallback={<span>{current().body}</span>}>
                <For each={diffSegments()!}>
                  {(seg) => (
                    <span
                      classList={{
                        'bg-emerald-100 text-emerald-800': seg.kind === 'add',
                        'bg-red-100 text-red-700 line-through': seg.kind === 'del',
                        // Line mode: stack each changed line as its own block row (unified-diff
                        // style) so old (struck) and new (added) lines don't run together inline.
                        block: diffMode() === 'lines' && seg.kind !== 'equal',
                      }}
                    >
                      {seg.value}
                    </span>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </Show>
        {/* The immutable tag delta the note carried (add/remove tags done in the note's act). Shown
            at all times — independent of the version being viewed or a later text edit. */}
        <Show when={deltaVersion()}>
          {(v) => (
            <div class="mt-1">
              <TagDeltaPills added={v().tagActions?.added} removed={v().tagActions?.removed} resolve={props.resolveTag} />
            </div>
          )}
        </Show>

        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-text-muted">
          <span title={formatWallClock(current().occurredAt)} class="tabular-nums">
            {formatRelativeTime(current().occurredAt)}
            <Show when={current().authorName}>
              <span> {sprintf(__('by %s'), current().authorName ?? '')}</span>
            </Show>
          </span>

          <Show when={isEdited()}>
            <span class="text-gray-300">·</span>
            {/* The "edited · vN/M" marker doubles as the diff-mode toggle. */}
            <Button
              variant="quiet"
              size="xs"
              class="gap-1"
              title={__('Toggle diff: plain → words → lines')}
              onClick={cycleDiff}
            >
              <span>
                {sprintf(
                  __('edited · v%1$d/%2$d'),
                  current().version,
                  total(),
                )}
              </span>
              <Show when={diffMode() !== 'plain'}>
                <span class="rounded bg-gray-100 px-1 text-gray-500">
                  {diffMode() === 'words' ? __('words') : __('lines')}
                </span>
              </Show>
            </Button>
            {/* Version stepper. */}
            <span class="inline-flex items-center gap-0.5">
              <Button
                variant="quiet"
                size="xs"
                class="px-1"
                disabled={idx() <= 0}
                title={__('Previous version')}
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
              >
                ‹
              </Button>
              <Button
                variant="quiet"
                size="xs"
                class="px-1"
                disabled={idx() >= total() - 1}
                title={__('Next version')}
                onClick={() => setIdx((i) => Math.min(total() - 1, i + 1))}
              >
                ›
              </Button>
            </span>
          </Show>

          <Show when={props.thread.canEdit && !deleted() && !someoneElseEditing()}>
            <span class="text-gray-300">·</span>
            <Button
              variant="quiet"
              size="xs"
              disabled={busy()}
              onClick={startEdit}
            >
              {__('Edit')}
            </Button>
            {/* Two-step delete: a note delete is an immutable append, so guard the destructive
                click behind an explicit confirm rather than firing on the first (fat-fingerable)
                press. The confirm sits apart (ml-auto) from Edit. */}
            <Show
              when={confirmingDelete()}
              fallback={
                <Button
                  variant="quiet"
                  size="xs"
                  class="ml-auto hover:text-red-600"
                  disabled={busy()}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {__('Delete')}
                </Button>
              }
            >
              <span class="ml-auto inline-flex items-center gap-2">
                <span class="text-gray-500">{__('Delete this note?')}</span>
                <Button
                  variant="danger"
                  size="xs"
                  disabled={busy()}
                  onClick={() => void remove()}
                >
                  {busy() ? __('Deleting…') : __('Delete')}
                </Button>
                <Button
                  variant="quiet"
                  size="xs"
                  disabled={busy()}
                  onClick={() => setConfirmingDelete(false)}
                >
                  {__('Cancel')}
                </Button>
              </span>
            </Show>
          </Show>

          <Show when={error() && !editing()}>
            <span class="text-red-700">{error()}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
