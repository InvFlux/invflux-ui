import { PencilIcon } from './icons';
import { For, Show, type JSX } from 'solid-js';
import { __, _x, sprintf } from '@invflux/i18n';
import { EventTime, timelineRowRegistry, type TimelineRowProps } from './Timeline';
import type { AnnotationThread } from './annotations';
import { isThreadDeleted, latestLiveVersion } from './annotations';
import { paletteInk, paletteStyle } from './tagPalette';
import { Pill } from './Pill';

/**
 * Timeline row for an annotation (`@invflux/ui`) — the shared renderer both the dispatch
 * (`OrderEvent`) and procurement (`PoEvent`) timelines use when a note thread is interleaved
 * into the event stream. The host builds a synthetic {@link AnnotationTimelineEvent} per thread
 * (payload below) and merges it by `occurredAt`; full version-nav + diff live in the
 * `AnnotationsPanel`, so this row stays read-only and compact: the current text, an
 * "edited · vN/M" marker, and the author line.
 *
 * Registered against the `annotation` type slug (+ `annotation.note`), so a host's synthetic
 * events resolve here via the registry's parent-chain fallback.
 */

/** Resolved display metadata for a tag id — the host supplies it so this SPA-agnostic row can
 * render a tag-change delta as coloured pills. Returns undefined for an unknown/retired-but-absent id. */
export type TagPillResolver = (tagId: number) => { name: string; colorId: number } | undefined;

/** @deprecated Renamed to {@link TagPillResolver} — the badge family is `*Pill`. */
export type TagChipResolver = TagPillResolver;

/** The `payload` shape a host puts on a synthetic annotation `TimelineEvent`. */
export interface AnnotationTimelinePayload {
  thread: AnnotationThread;
  /** Resolves a tag id → {name, colorId} so a tag-delta annotation renders as pills. */
  resolveTag?: TagPillResolver;
}

/**
 * One tag-delta pill. An **addition** renders as the normal solid tag pill; a **removal** mirrors
 * the order-detail apply affordance (colour outline) with a strike-through — same visual language:
 * solid = present, outline = actionable/absent, struck outline = just removed.
 *
 * Built on `Pill` at `tone="none"`: the colour is per-tag *data* from the palette, so it arrives
 * through `style` while `Pill` owns the shape and metrics.
 */
function DeltaPill(props: {
  tagId: number;
  resolve?: TagPillResolver;
  removed?: boolean;
}): JSX.Element {
  const meta = (): { name: string; colorId: number } | undefined => props.resolve?.(props.tagId);
  const label = (): string => meta()?.name ?? `#${props.tagId}`;
  return (
    <Pill
      tone="none"
      size="xs"
      shape="full"
      class={props.removed ? 'line-through' : undefined}
      style={
        props.removed
          ? {
              'box-shadow': `inset 0 0 0 1px ${paletteInk(meta()?.colorId ?? 0)}`,
              color: paletteInk(meta()?.colorId ?? 0),
            }
          : paletteStyle(meta()?.colorId ?? 0)
      }
      title={props.removed ? sprintf(__('removed %s'), label()) : sprintf(__('added %s'), label())}
    >
      {label()}
    </Pill>
  );
}

/**
 * A tag-change delta as pills — additions (solid) then removals (struck outline). Shared by
 * the timeline row and the notes panel so a tag apply/remove reads identically in both. Renders
 * nothing when the delta is empty.
 */
export function TagDeltaPills(props: {
  added?: number[];
  removed?: number[];
  resolve?: TagPillResolver;
}): JSX.Element {
  return (
    <Show when={(props.added?.length ?? 0) > 0 || (props.removed?.length ?? 0) > 0}>
      <div class="flex flex-wrap gap-1">
        <For each={props.added ?? []}>
          {(id) => <DeltaPill tagId={id} resolve={props.resolve} />}
        </For>
        <For each={props.removed ?? []}>
          {(id) => <DeltaPill tagId={id} resolve={props.resolve} removed />}
        </For>
      </div>
    </Show>
  );
}

/** @deprecated Renamed to {@link TagDeltaPills} — the badge family is `*Pill`. */
export const TagDeltaChips = TagDeltaPills;

export function AnnotationTimelineRow(props: TimelineRowProps): JSX.Element {
  const payload = (): AnnotationTimelinePayload | null => {
    const p = props.event.payload;
    return p && typeof p === 'object' && 'thread' in p ? (p as AnnotationTimelinePayload) : null;
  };
  const thread = (): AnnotationThread | null => payload()?.thread ?? null;
  const deleted = (): boolean => {
    const t = thread();
    return !!t && isThreadDeleted(t);
  };
  const live = () => {
    const t = thread();
    return t ? latestLiveVersion(t) : null;
  };
  const total = (): number => thread()?.versions.length ?? 0;
  const resolveTag = (): TagChipResolver | undefined => payload()?.resolveTag;
  const added = (): number[] => live()?.tagActions?.added ?? [];
  const removed = (): number[] => live()?.tagActions?.removed ?? [];
  const hasDelta = (): boolean => added().length > 0 || removed().length > 0;
  const hasBody = (): boolean => !!live()?.body && live()!.body!.trim() !== '';
  // A pure tag change (delta, no note text) reads as "Tags", not an empty "Note".
  const headerLabel = (): string => (hasDelta() && !hasBody() ? __('Tags') : __('Note'));

  /**
   * The version the author is read from.
   *
   * `live()` is null once a thread is deleted, and the person who wrote a note is still known
   * after it is removed — falling through to the last recorded version is what keeps a deleted
   * entry saying who, rather than degrading to a bare id.
   */
  const authorVersion = () => {
    const t = thread();
    return live() ?? (t ? (t.versions[t.versions.length - 1] ?? null) : null);
  };

  const actorLabel = (): string => {
    const name = authorVersion()?.authorName;
    if (name) return name;
    const r = props.event.actor.ref;
    return r ? sprintf(_x('user #%s', 'timeline actor'), r) : '';
  };

  return (
    <div class="flex items-start gap-3">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 bg-amber-50 text-amber-700 ring-amber-100 text-xs font-medium">
        <PencilIcon class="h-3.5 w-3.5" />
      </span>
      <div class="min-w-0 flex-1">
        {/* Same header shape as every other timeline entry: what, who, when. A note row that
            ordered them differently would read as a different kind of thing, which it is not. */}
        <div class="flex items-baseline gap-2 text-sm">
          <span class="font-medium text-gray-800">{headerLabel()}</span>
          <Show when={actorLabel()}>
            <span class="text-2xs text-text-muted shrink-0 truncate">
              {sprintf(_x('by %s', 'timeline event author'), actorLabel())}
            </span>
          </Show>
          <EventTime at={props.event.occurredAt} />
          <Show when={total() > 1}>
            <span class="text-2xs text-text-muted">
              {sprintf(__('edited · v%1$d/%2$d'), live()?.version ?? total(), total())}
            </span>
          </Show>
          {/* A deleted note has no body, so the fact of the deletion belongs where the body would
              have started reading — on the header, not alone on a line of its own. */}
          <Show when={deleted()}>
            <span class="text-2xs italic text-text-muted shrink-0">{__('Note deleted.')}</span>
          </Show>
        </div>

        <Show when={!deleted()}>
          <Show when={hasBody()}>
            <div class="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap break-words">
              {live()?.body}
            </div>
          </Show>
          <Show when={hasDelta()}>
            <div class="mt-1">
              <TagDeltaChips added={added()} removed={removed()} resolve={resolveTag()} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// Register against the `annotation` namespace + the concrete `annotation.note` slug so a host's
// synthetic events resolve here (the registry's parent-chain also lets `annotation.*` fall back).
timelineRowRegistry.register('annotation', 'core.annotation', AnnotationTimelineRow, {
  default: true,
});
timelineRowRegistry.register('annotation.note', 'core.annotation.note', AnnotationTimelineRow, {
  default: true,
});
