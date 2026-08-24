import { createMemo, type JSX } from 'solid-js';
import { AnnotationsPanel, type ComposerTag, type NoteTagDelta, type TagChipResolver } from '@invflux/ui';
import { useDispatch } from '../context';
import { canApplyTag, canRemoveTag } from './OrderTags';
import type { TagSummary } from '../types';
import {
  useOrderAnnotationsQuery,
  useCreateOrderAnnotationMutation,
  useEditOrderAnnotationMutation,
  useDeleteOrderAnnotationMutation,
  useTagsQuery,
} from '../queries';

/**
 * Dispatch wrapper that binds the reusable `@invflux/ui` `AnnotationsPanel` to the order
 * annotations query + mutations. Presentation (composer, version nav, diff toggle, tag picker)
 * lives in the shared component; this owns the data layer so procurement can bind its own.
 *
 * A note can carry a tag delta (§5 unification): the composer picker pre-selects the order's
 * current tags — toggling one off removes it, a new one on adds it, all in the note's write.
 */
export function OrderNotesPanel(props: { orderHexId: string; orderTags?: TagSummary[] }): JSX.Element {
  const ctx = useDispatch();
  const governTags = (): boolean => ctx.capabilities.governTags;
  // Notes are cheap and also feed the timeline interleave, so fetch eagerly (not gated on expand).
  const query = useOrderAnnotationsQuery(() => props.orderHexId, () => true);
  const create = useCreateOrderAnnotationMutation(() => props.orderHexId);
  const edit = useEditOrderAnnotationMutation(() => props.orderHexId);
  const remove = useDeleteOrderAnnotationMutation(() => props.orderHexId);

  const threads = createMemo(() => query.data?.threads ?? []);
  const tagsQuery = useTagsQuery();

  // Resolve a tag id → {name, colorId} so a note carrying a tag delta renders its chips.
  const resolveTag: TagChipResolver = (id) => {
    const t = (tagsQuery.data ?? []).find((tag) => tag.id === id);
    return t ? { name: t.name, colorId: t.colorId } : undefined;
  };

  // The composer picker shows the order's current tags (removable) plus every assignable tag the
  // operator may add — including note-required ones like Parked (the composer *is* the note, so it
  // can satisfy the requirement). Each pill carries its note-required flags so toggling it, in
  // either direction, gates Save on text.
  const currentTags = (): TagSummary[] => props.orderTags ?? [];
  const currentTagIds = createMemo(() => currentTags().map((t) => t.id));
  const composerTags = createMemo<ComposerTag[]>(() => {
    const currentIds = new Set(currentTagIds());
    const removable = currentTags().filter((t) => canRemoveTag(t, governTags()));
    const addable = (tagsQuery.data ?? []).filter((t) => !currentIds.has(t.id) && canApplyTag(t, governTags()));
    return [...removable, ...addable].map((t) => ({
      id: t.id,
      name: t.name,
      colorId: t.colorId,
      requiresNote: t.governanceFlags.includes('RequireNoteOnAdd'),
      requiresNoteOnRemove: t.governanceFlags.includes('RequireNoteOnRemove'),
    }));
  });

  return (
    <AnnotationsPanel
      threads={threads()}
      loading={query.isLoading}
      error={query.isError ? (query.error?.message ?? 'unknown error') : null}
      canAdd={ctx.capabilities.dispatchOrders}
      resolveTag={resolveTag}
      tags={composerTags()}
      currentTagIds={currentTagIds()}
      onAdd={(body, tags: NoteTagDelta) => create.mutateAsync({ body, addTags: tags.addTags, removeTags: tags.removeTags })}
      onEdit={(threadId, body) => edit.mutateAsync({ threadId, body })}
      onDelete={(threadId) => remove.mutateAsync(threadId)}
    />
  );
}
