import { __, _x, _n, sprintf } from '@invflux/i18n';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  Button,
  Modal,
  Pill,
  ProPill,
  PaletteSwatchPicker,
  ESC_LOCAL_ATTR,
  HighlightMatch,
  IconButton,
  PencilIcon,
  filterControlRegistry,
  iconButtonClass,
  menuItemClass,
  slotRegistry,
  fuzzyScore,
  matchScore,
  tagColor,
  tagHatch,
  tagInk,
  tagArchivedFill,
  type TagColor,
  type FilterControlProps,
} from '@invflux/ui';
import {
  useBulkAssignTagsMutation,
  useOrderTagMutations,
  useTagAdminMutations,
  useArchivedTagNamesQuery,
  useArchivedTagsQuery,
  useTagsQuery,
} from '../queries';
import { useDispatch } from '../context';
import { TagWriteError } from '../api';
import type { ArchivedTagName, DispatchOrderSummary, GovernanceFlag, ManageAuthority, TagSummary } from '../types';

/** Named priority presets → fixed values (§2.2); gaps let admins slot custom ints. */
const PRIORITY_PRESETS = (): { label: string; value: number }[] => [
  { label: _x('High', 'priority preset'), value: 30 },
  { label: _x('Medium', 'priority preset'), value: 20 },
  { label: _x('Low', 'priority preset'), value: 10 },
  { label: _x('Default', 'priority preset'), value: 0 },
  { label: _x('Backburner', 'priority preset'), value: -20 },
];

/** Behaviour flags — what the tag *does* (§2.1). Access flags live in ACCESS below. */
const BEHAVIOR_FLAG_META = (): { flag: GovernanceFlag; label: string; hint: string }[] => [
  // Translate this pair together with the "Withheld" workflow-state filter that selects the orders
  // it produces: the flag names the instruction, the filter names the resulting condition, and a
  // locale that renders them from unrelated roots reads as two unrelated features.
  { flag: 'SuppressActive', label: __('Withhold from queue'), hint: __('Carrying orders drop out of the active dispatch queue until the tag comes off.') },
  // The pair reads as one decision, so they sit together: a tag that flags a problem usually wants
  // the note on the way *out* (removing it asserts the problem is settled), not on the way in.
  { flag: 'RequireNoteOnAdd', label: __('Require a note when applied'), hint: __('Applying this tag demands a note, stamped on the order as an annotation.') },
  { flag: 'RequireNoteOnRemove', label: __('Require a note when removed'), hint: __('Taking this tag off demands a note — the record of how the issue it flagged was resolved.') },
  { flag: 'PromotedAffordance', label: __('Dedicated button'), hint: __('This tag earns a prominent toggle on the order, not just a menu item.') },
  { flag: 'HidePicker', label: __('Hide from tag menu'), hint: __('Keep this tag out of the generic "+ Tag" menu — for tags with their own button.') },
];

const AUTHORITY_META = (): { value: ManageAuthority; label: string; hint: string }[] => [
  { value: 'Anyone', label: __('Anyone'), hint: __('Any dispatch operator may apply and remove this tag.') },
  { value: 'Managed', label: __('Managed'), hint: __('Applying and removing require the tag-authority permission.') },
  { value: 'System', label: __('System'), hint: __('Platform-managed — no one applies or removes it by hand.') },
];

/** Whether a tag carries any Pro governance behaviour (mirrors core Tag::isGovernance). */
function isGovernanceTag(t: TagSummary): boolean {
  return t.governanceFlags.length > 0 || t.priority !== 0 || t.manageAuthority !== 'Anyone';
}

/** Whether the current user may hand-apply this tag (mirrors the server assign gate). */
export function canApplyTag(t: TagSummary, governTags: boolean): boolean {
  if (t.manageAuthority === 'System') return false;
  if (t.manageAuthority === 'Managed') return governTags;
  return true;
}

/** Whether the current user may hand-remove this tag (mirrors the server removal gate). */
export function canRemoveTag(t: TagSummary, governTags: boolean): boolean {
  if (t.manageAuthority === 'System') return false;
  if (t.manageAuthority === 'Managed' || t.governanceFlags.includes('LockRemoval')) return governTags;
  return true;
}

/**
 * Slot an add-on contributes the **interactive** tag-settings editor into. The Essentials build
 * ships no working editor — only the inert {@link TagSettingsPreview}; the add-on's
 * contribution replaces it here when the governance-tags feature is entitled.
 */
export const TAG_SETTINGS_EDITOR_SLOT = 'dispatch.tag-settings.editor';

/**
 * Controlled contract the host hands the editor: the current governance values plus change
 * callbacks. The host owns *state and persistence* (the create payload, or the update
 * mutation); the contribution owns only the interactive UI. Mirrored add-on-side.
 */
export interface TagSettingsEditorProps {
  flags: GovernanceFlag[];
  priority: number;
  authority: ManageAuthority;
  onFlags: (f: GovernanceFlag[]) => void;
  onPriority: (v: number) => void;
  onAuthority: (v: ManageAuthority) => void;
}

/** Disabled preview of the queue-priority presets + raw int (no handlers — pure picture). */
function PriorityPreview(props: { value: number }): JSX.Element {
  return (
    <div class="flex items-center gap-2">
      <div class="inline-flex overflow-hidden rounded border border-gray-200">
        <For each={PRIORITY_PRESETS()}>
          {(p) => (
            <span
              class="px-1.5 py-0.5 text-2xs leading-none"
              classList={{ 'bg-gray-800 text-white': props.value === p.value, 'text-gray-600': props.value !== p.value }}
            >
              {p.label}
            </span>
          )}
        </For>
      </div>
      <input
        type="number"
        class="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs tabular-nums"
        value={props.value}
        disabled
        aria-label={__('Queue priority value')}
      />
    </div>
  );
}

/** Disabled preview of the access-tier control (Anyone / Managed / System). */
function AuthorityPreview(props: { value: ManageAuthority }): JSX.Element {
  return (
    <div class="inline-flex overflow-hidden rounded border border-gray-200">
      <For each={AUTHORITY_META()}>
        {(a) => (
          <span
            class="px-1.5 py-0.5 text-2xs leading-none"
            classList={{ 'bg-gray-800 text-white': props.value === a.value, 'text-gray-600': props.value !== a.value }}
            title={a.hint}
          >
            {a.label}
          </span>
        )}
      </For>
    </div>
  );
}

/**
 * Inert preview of the tag-settings editor — the Essentials upsell body. It renders the same two
 * groups the working editor does — **Behaviour** (what the tag does) and **Access** (who may
 * apply/remove it) — but every control is disabled and carries no change handler: a picture of
 * what the feature unlocks, never a flag-flip away from working. The working editor is
 * contributed by an add-on and replaces this through {@link TAG_SETTINGS_EDITOR_SLOT}.
 *
 * **Kept in visual sync by hand:** this markup deliberately mirrors the add-on's interactive
 * editor, which lives in a separate bundle (they can't share a component — the Essentials build must
 * ship no working editor). When a control is added, removed or relabelled on the editor, update
 * this preview to match. Minor drift is harmless (it's only a picture), but avoid it.
 */
function TagSettingsPreview(props: { flags: GovernanceFlag[]; priority: number; authority: ManageAuthority }): JSX.Element {
  const has = (f: GovernanceFlag): boolean => props.flags.includes(f);
  return (
    <div class="pointer-events-none select-none space-y-3 opacity-60">
      {/* Behaviour */}
      <div class="space-y-1.5">
        <div class="text-2xs font-semibold uppercase tracking-wide text-text-muted">{__('Behaviour')}</div>
        <div class="grid grid-cols-2 space-y-1.5">
          <For each={BEHAVIOR_FLAG_META()}>
            {(m) => (
              <label class="flex items-center gap-2 text-2xs text-gray-600" title={m.hint}>
                <input type="checkbox" checked={has(m.flag)} disabled />
                {m.label}
              </label>
            )}
          </For>
        </div>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <span class="text-2xs text-gray-500">{__('Queue priority')}</span>
          <PriorityPreview value={props.priority} />
        </div>
      </div>
      {/* Access */}
      <div class="space-y-1.5">
        <div class="text-2xs font-semibold uppercase tracking-wide text-text-muted">{__('Access')}</div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-2xs text-gray-500">{__('Who may apply / remove')}</span>
          <AuthorityPreview value={props.authority} />
        </div>
        <label class="flex items-center gap-2 text-2xs text-gray-600">
          <input type="checkbox" checked={has('LockRemoval')} disabled />
          {__('Lock removal (escalation)')}
        </label>
      </div>
    </div>
  );
}

/**
 * The tag-settings body: an add-on's interactive editor when the governance-tags feature is
 * entitled **and** contributed to {@link TAG_SETTINGS_EDITOR_SLOT}, otherwise the inert
 * {@link TagSettingsPreview}. Gating on the entitlement (not merely on the contribution's
 * presence) keeps the upsell showing for an add-on-present-but-feature-unlicensed install.
 * The editor is controlled, so the Essentials build ships no working editor — only this seam.
 */
function TagSettingsSlot(props: TagSettingsEditorProps): JSX.Element {
  const ctx = useDispatch();
  const entitled = (): boolean => ctx.entitlements.governanceTags;
  const contribution = slotRegistry.get<TagSettingsEditorProps>(TAG_SETTINGS_EDITOR_SLOT)[0];
  return (
    <Show
      when={entitled() && contribution}
      fallback={<TagSettingsPreview flags={props.flags} priority={props.priority} authority={props.authority} />}
    >
      <Dynamic
        component={contribution!.component}
        flags={props.flags}
        priority={props.priority}
        authority={props.authority}
        onFlags={props.onFlags}
        onPriority={props.onPriority}
        onAuthority={props.onAuthority}
      />
    </Show>
  );
}

/**
 * Foldable "Tag settings (Pro)" block for the create form. At Pro it collapses /
 * expands and edits freely. At Essentials it stays open with every control locked and a
 * {@link ProPill} on the header — the upsell (never a hard error).
 */
function TagSettingsSection(props: {
  flags: GovernanceFlag[];
  priority: number;
  authority: ManageAuthority;
  onFlags: (f: GovernanceFlag[]) => void;
  onPriority: (v: number) => void;
  onAuthority: (v: ManageAuthority) => void;
}): JSX.Element {
  const ctx = useDispatch();
  const entitled = (): boolean => ctx.entitlements.governanceTags;
  // Always a normal collapsible section, folded by default, at any tier. At Essentials the
  // header carries the Pro pill and the inner controls are disabled — the fold itself
  // keeps working so the upsell never wedges the section open.
  const [open, setOpen] = createSignal(false);
  return (
    <div>
      <Button
        variant="quiet"
        size="xs"
        class="mt-2 gap-1"
        onClick={() => setOpen((v) => !v)}
      >
        <span class="inline-block w-3">{open() ? '▾' : '▸'}</span>
        {__('Tag settings')}
        <Show when={!entitled()}>
          <ProPill class="ml-1" />
        </Show>
      </Button>
      <Show when={open()}>
        <div class="mt-1.5 rounded border border-gray-100 bg-gray-50/60 p-2">
          <TagSettingsSlot
            flags={props.flags}
            priority={props.priority}
            authority={props.authority}
            onFlags={props.onFlags}
            onPriority={props.onPriority}
            onAuthority={props.onAuthority}
          />
        </div>
      </Show>
    </div>
  );
}

/** Whether applying this tag demands a note (governance `RequireNoteOnAdd`). */
export function tagNeedsNote(t: TagSummary): boolean {
  return t.governanceFlags.includes('RequireNoteOnAdd');
}

/** Whether *removing* this tag demands a note (governance `RequireNoteOnRemove`). */
export function tagNeedsRemovalNote(t: TagSummary): boolean {
  return t.governanceFlags.includes('RequireNoteOnRemove');
}

/**
 * A small modal collecting a mandatory note, for either direction.
 *
 * The two read differently and should: applying a tag asks *why you are raising this*, removing one
 * asks *how it was settled* — which is the whole point of the removal flag, since taking the tag off
 * is the claim that the thing it flagged is done.
 */
export function NoteModal(props: {
  tag: TagSummary;
  purpose?: 'add' | 'remove';
  onSubmit: (note: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [note, setNote] = createSignal('');
  const submit = (): void => {
    const n = note().trim();
    if (n !== '') props.onSubmit(n);
  };
  return (
    <Modal onClose={props.onClose} label={__('Add a note')} backdropClass="bg-black/30 flex items-center justify-center p-6">
      <div class="w-[22rem] max-w-full rounded-lg bg-white p-4 shadow-xl">
        <h2 class="mb-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Show when={'remove' === props.purpose} fallback={<>{__('Tag')} <TagPill tag={props.tag} /> {__('needs a note')}</>}>
            {__('Removing')} <TagPill tag={props.tag} /> {__('needs a note')}
          </Show>
        </h2>
        <textarea
          class="h-24 w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder={'remove' === props.purpose
            ? __('How was this resolved? (Ctrl+Enter to remove)')
            : __('Why are you applying this tag? (Ctrl+Enter to apply)')}
          value={note()}
          onInput={(e) => setNote(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
        <div class="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onClose}
          >
            {__('Cancel')}
          </Button>
          <Button
            size="sm"
            disabled={note().trim() === ''}
            onClick={submit}
          >
            {__('Apply tag')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A single tag pill — fixed-palette bg/fg, no border.
 *
 * A thin derivation of the shared `Pill` primitive at `tone="none"`: a tag's colour is *data*
 * (its palette entry), not a design choice, so it arrives through `style` while `Pill` owns the
 * shape, metrics and the dismiss affordance.
 *
 * An **archived** tag keeps the solid fill — it is still attached to this order — and takes a
 * diagonal hatch over it, the one chip channel not already carrying a meaning (solid = present,
 * outline = appliable, struck = just removed). Since the hatch is decoration a screen reader never
 * reaches, the `title` carries the same fact in words.
 */
export function TagPill(props: { tag: TagSummary; onRemove?: () => void; count?: number; title?: string }): JSX.Element {
  const c = (): TagColor => tagColor(props.tag.colorId);
  const archived = (): boolean => true === props.tag.archived;
  return (
    <Pill
      tone="none"
      shape="full"
      style={{
        'background-color': archived() ? tagArchivedFill(c()) : c().bg,
        color: c().fg,
        ...(archived() ? { 'background-image': tagHatch(c()) } : {}),
      }}
      title={props.title ?? (archived()
        ? sprintf(__('%s — archived label, no longer affects the queue'), props.tag.name)
        : props.tag.name)}
      onRemove={props.onRemove}
      removeLabel={sprintf(__('Remove %s'), props.tag.name)}
    >
      {props.tag.name}{props.count !== undefined ? ` (${props.count})` : ''}
    </Pill>
  );
}

/** @deprecated Renamed to {@link TagPill} — the badge family is `*Pill` ("chip" reads as something
 * larger and richer than a tag renders as). Kept so co-edited callers keep compiling. */
export const TagChip = TagPill;

/** A small colour dot for a tag (used in the assign menus). */
function TagDot(props: { colorId: number }): JSX.Element {
  return <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={{ 'background-color': tagColor(props.colorId).bg }} />;
}

/** Read-only pill row for queue cards. Renders nothing when there are no tags. */
export function TagPillRow(props: { tags?: TagSummary[] }): JSX.Element {
  return (
    <Show when={(props.tags?.length ?? 0) > 0}>
      <div class="flex flex-wrap gap-1">
        <For each={props.tags}>{(t) => <TagPill tag={t} />}</For>
      </div>
    </Show>
  );
}

/** @deprecated Renamed to {@link TagPillRow}. */
export const TagChipRow = TagPillRow;

/**
 * Reusable pill-grid tag picker — the shared surface behind the right-click
 * "Add tag" menu and the queue tag-filter. Renders tags as clickable
 * TagPill} pills in a `flex-wrap`; `selectedIds` members get a selection ring
 * (filter/multi-select), and `showCount` appends each tag's order-usage count.
 */
export function TagPickerPills(props: {
  tags: TagSummary[];
  selectedIds?: Set<number>;
  onPick: (tag: TagSummary) => void;
  showCount?: boolean;
  emptyText?: string;
}): JSX.Element {
  return (
    <Show
      when={props.tags.length > 0}
      fallback={<div class="px-1 py-1 text-2xs text-text-muted">{props.emptyText ?? __('No tags')}</div>}
    >
      <div class="flex flex-wrap gap-1.5">
        <For each={props.tags}>
          {(t) => {
            const selected = (): boolean => props.selectedIds?.has(t.id) ?? false;
            return (
              <button
                type="button"
                class="cursor-pointer rounded-full transition hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                classList={{ 'ring-2 ring-offset-1 ring-gray-700': selected() }}
                title={selected() ? sprintf(__('%s (selected)'), t.name) : t.name}
                onClick={() => props.onPick(t)}
              >
                <TagPill tag={t} count={props.showCount ? t.orderCount : undefined} />
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

/** Filter-control type key for the tag filter (registered below). */
export const FILTER_CONTROL_TAGS = 'tags';

/**
 * The dispatch tag-filter editor — the same {@link TagPickerPills} the right-click
 * menu uses, in multi-select mode. Reads the live tag list itself (with colours +
 * counts) rather than the host's plain `{value,label}` options. `value` is the
 * selected tag-id strings; clicking a pill toggles it.
 */
function TagFilterControl(props: FilterControlProps): JSX.Element {
  const tags = useTagsQuery();
  const selectedIds = createMemo(() => new Set(props.value.map((v) => Number(v))));
  const toggle = (tag: TagSummary): void => {
    const idStr = String(tag.id);
    const next = props.value.includes(idStr)
      ? props.value.filter((v) => v !== idStr)
      : [...props.value, idStr];
    props.onChange(next);
  };
  return (
    <div class="w-[260px] max-w-[80vw] p-2">
      <TagPickerPills
        tags={tags.data ?? []}
        selectedIds={selectedIds()}
        showCount
        emptyText={__('No tags yet')}
        onPick={toggle}
      />
    </div>
  );
}

filterControlRegistry.register(FILTER_CONTROL_TAGS, 'dispatch.tags', TagFilterControl);

/**
 * Order-detail tag bar: assigned chips (removable) + an "+ Tag" menu listing the
 * unassigned tags, with a "Manage tags…" entry into the {@link TagManagerModal}.
 */
export function OrderTagsBar(props: { orderHexId: string; tags?: TagSummary[] }): JSX.Element {
  const ctx = useDispatch();
  const governTags = (): boolean => ctx.capabilities.governTags;
  const allTags = useTagsQuery();
  const mutations = useOrderTagMutations(() => props.orderHexId);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [managerOpen, setManagerOpen] = createSignal(false);
  // Carries the direction too: the same modal serves both, and the copy differs.
  const [noteFor, setNoteFor] = createSignal<{ tag: TagSummary; purpose: 'add' | 'remove' } | null>(null);

  const assignedIds = createMemo(() => new Set((props.tags ?? []).map((t) => t.id)));
  // The generic "+ Tag" menu excludes tags the user can't hand-apply (System /
  // Managed-without-authority) and HidePicker tags (which have their own surface).
  const assignable = createMemo(() =>
    (allTags.data ?? []).filter(
      (t) =>
        !assignedIds().has(t.id) &&
        !t.governanceFlags.includes('HidePicker') &&
        canApplyTag(t, governTags()),
    ),
  );
  // Tags with a dedicated affordance (PromotedAffordance), e.g. Parked — surfaced
  // as prominent apply buttons rather than buried in the "+ Tag" menu. Hidden once
  // assigned (the chip above carries the tag + its removal ×) or when the user
  // lacks authority to apply them.
  const buttonTags = createMemo(() =>
    (allTags.data ?? []).filter(
      (t) =>
        t.governanceFlags.includes('PromotedAffordance') &&
        !assignedIds().has(t.id) &&
        canApplyTag(t, governTags()),
    ),
  );

  /** Apply a tag: if it demands a note, open the note modal first; else assign directly. */
  const applyTag = (t: TagSummary): void => {
    if (tagNeedsNote(t)) {
      setNoteFor({ tag: t, purpose: 'add' });
      return;
    }
    mutations.assign.mutate({ tagIds: [t.id] });
  };

  /** Remove a tag: one that demands an explanation on the way out asks for it first. */
  const removeTag = (t: TagSummary): void => {
    if (tagNeedsRemovalNote(t)) {
      setNoteFor({ tag: t, purpose: 'remove' });
      return;
    }
    mutations.unassign.mutate({ tagId: t.id });
  };

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={props.tags}>
        {(t) => (
          <TagPill
            tag={t}
            onRemove={canRemoveTag(t, governTags()) ? () => removeTag(t) : undefined}
          />
        )}
      </For>

      {/* Dedicated-affordance (PromotedAffordance) tags as prominent apply buttons.
          Once applied they vanish here — the chip above carries the tag + removal. */}
      <For each={buttonTags()}>
        {(t) => {
          const c = (): TagColor => tagColor(t.colorId);
          return (
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2 py-1 text-2xs font-medium leading-none opacity-70 transition hover:opacity-100"
              style={{ 'border-color': tagInk(c()), color: tagInk(c()) }}
              title={sprintf(__('Apply %s'), t.name)}
              onClick={() => applyTag(t)}
            >
              + {t.name}
            </button>
          );
        }}
      </For>

      <div class="relative">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-1 text-2xs text-gray-500 hover:border-gray-400 hover:text-gray-700"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {__('+ Tag')}
        </button>
        <Show when={menuOpen()}>
          {/* click-away backdrop */}
          <div class="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div class="absolute left-0 top-full z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            <For
              each={assignable()}
              fallback={<div class="px-3 py-1.5 text-2xs text-text-muted">{__('No more tags')}</div>}
            >
              {(t) => (
                <button
                  type="button"
                  class={menuItemClass(false, false, 'text-xs')}
                  onClick={() => {
                    applyTag(t);
                    setMenuOpen(false);
                  }}
                >
                  <TagDot colorId={t.colorId} />
                  <span class="truncate">{t.name}</span>
                  <Show when={isGovernanceTag(t)}>
                    <span class="ml-auto text-2xs text-text-muted" title={__('Governance tag')}>⚑</span>
                  </Show>
                </button>
              )}
            </For>
            <div class="my-1 border-t border-gray-100" />
            <button
              type="button"
              class={menuItemClass(false, false, 'text-2xs font-medium')}
              onClick={() => {
                setMenuOpen(false);
                setManagerOpen(true);
              }}
            >
              {__('Manage tags…')}
            </button>
          </div>
        </Show>
      </div>

      <Show when={managerOpen()}>
        <TagManagerModal onClose={() => setManagerOpen(false)} />
      </Show>

      <Show when={noteFor()}>
        {(pending) => (
          <NoteModal
            tag={pending().tag}
            purpose={pending().purpose}
            onClose={() => setNoteFor(null)}
            onSubmit={(note) => {
              if ('remove' === pending().purpose) {
                mutations.unassign.mutate({ tagId: pending().tag.id, note });
              } else {
                mutations.assign.mutate({ tagIds: [pending().tag.id], note });
              }
              setNoteFor(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** Create / rename / recolour / delete tag definitions. */
/**
 * Derive the slug the server will derive, so the Add button can refuse a name the API would refuse.
 *
 * Mirrors WordPress's `sanitize_title` closely enough for names: fold accents, lowercase, and
 * collapse anything that is not alphanumeric into single dashes. It is an *approximation on
 * purpose* — the server stays the authority, and a disagreement costs only a 409 that the modal
 * already handles gracefully. Getting it roughly right is what keeps the merchant from typing a
 * name, pressing Add, and being told no.
 */
function deriveSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Rank an existing tag name against what is being typed, or null when it is not worth showing.
 *
 * Two matchers, because they fail in opposite directions and the merchant needs both:
 *
 *  - `fuzzyScore` is a **subsequence** match, which is what makes a partial name useful — three
 *    letters into "Retour client" it already matches. It cannot help once the typed name is
 *    *longer* than the existing one, since the extra characters break the subsequence: typing
 *    "Cadeaux" does not match "Cadeau" at all.
 *  - `matchScore` is **symmetric similarity**, which catches exactly that — "Cadeaux" scores 0.86
 *    against "Cadeau" — but scores a short prefix against a long name near zero by design, so it is
 *    useless while a name is half-typed.
 *
 * A tag shows if either speaks up. Similarity leads the sort so a near-identical name surfaces
 * above a merely prefix-matching one — that is the one the merchant most needs to see before
 * creating a duplicate.
 */
function rankAgainst(query: string, name: string): { similarity: number; typed: number } | null {
  const typed = fuzzyScore(query, name);
  const similarity = matchScore(query, name);
  if (null === typed && similarity < 0.5) return null;
  return { similarity, typed: typed?.score ?? 0 };
}

function sortByRank<T>(rows: { row: T; rank: { similarity: number; typed: number } }[]): T[] {
  return rows
    .sort((a, b) => b.rank.similarity - a.rank.similarity || b.rank.typed - a.rank.typed)
    .map((r) => r.row);
}

export function TagManagerModal(props: { onClose: () => void }): JSX.Element {
  const tags = useTagsQuery();
  const archivedNames = useArchivedTagNamesQuery();
  const admin = useTagAdminMutations();
  const [newName, setNewName] = createSignal('');
  const [newColorId, setNewColorId] = createSignal(7); // a saturated blue as the default pick
  const [newFlags, setNewFlags] = createSignal<GovernanceFlag[]>([]);
  const [newPriority, setNewPriority] = createSignal(0);
  const [newAuthority, setNewAuthority] = createSignal<ManageAuthority>('Anyone');
  const [error, setError] = createSignal<string | null>(null);
  const [showArchived, setShowArchived] = createSignal(false);
  // Only fetched once the section is opened — by the merchant, or by a name collision opening it
  // for them. An archive nobody asked about never crosses the wire.
  const archivedTags = useArchivedTagsQuery(showArchived);

  let nameInputEl: HTMLInputElement | undefined;
  // Creating is what this modal is for; anything else here is maintenance.
  onMount(() => nameInputEl?.focus());

  const query = (): string => newName().trim();
  const filtering = (): boolean => query() !== '';

  const liveMatches = createMemo<TagSummary[]>(() => {
    const q = query();
    const all = tags.data ?? [];
    if ('' === q) return all;
    const ranked: { row: TagSummary; rank: { similarity: number; typed: number } }[] = [];
    for (const row of all) {
      const rank = rankAgainst(q, row.name);
      if (rank) ranked.push({ row, rank });
    }
    return sortByRank(ranked);
  });

  /** Archived near-matches, from the names the tag list carried — no extra request. */
  const archivedMatches = createMemo<ArchivedTagName[]>(() => {
    const q = query();
    const all = archivedNames.data ?? [];
    if ('' === q) return all;
    const ranked: { row: ArchivedTagName; rank: { similarity: number; typed: number } }[] = [];
    for (const row of all) {
      const rank = rankAgainst(q, row.name);
      if (rank) ranked.push({ row, rank });
    }
    return sortByRank(ranked);
  });

  /**
   * The name already belongs to a tag — live or archived — so creating it would fail. Compared on
   * the derived *slug*, which is what the server actually enforces: "Retour client" and
   * "retour-client" are one name as far as the API is concerned.
   */
  const collision = createMemo<{ archived: boolean; id: number; name: string } | null>(() => {
    const slug = deriveSlug(query());
    if ('' === slug) return null;
    const live = (tags.data ?? []).find((t) => t.slug === slug);
    if (live) return { archived: false, id: live.id, name: live.name };
    const gone = (archivedNames.data ?? []).find((t) => t.slug === slug);
    if (gone) return { archived: true, id: gone.id, name: gone.name };
    return null;
  });

  // A collision with something invisible is the dead end this whole section exists to remove: open
  // the archived list so the tag — and its Restore button — are on screen, not merely described.
  createEffect(() => {
    if (collision()?.archived) setShowArchived(true);
  });

  const addDisabledReason = createMemo<string | null>(() => {
    if ('' === query()) return null;
    const c = collision();
    if (!c) return null;
    return c.archived
      ? sprintf(__('An archived tag is already named "%s". Restore it instead of creating a second one — it still has its settings and its history.'), c.name)
      : sprintf(__('A tag is already named "%s".'), c.name);
  });

  const create = (): void => {
    const name = query();
    if (name === '' || addDisabledReason() !== null) return;
    setError(null);
    admin.create.mutate(
      {
        name,
        colorId: newColorId(),
        governanceFlags: newFlags(),
        priority: newPriority(),
        manageAuthority: newAuthority(),
      },
      {
        onSuccess: () => {
          setNewName('');
          setNewFlags([]);
          setNewPriority(0);
          setNewAuthority('Anyone');
          nameInputEl?.focus();
        },
        onError: (e) => {
          setError(e.message);
          // The server saw an archived collision the client could not (its name list was stale).
          if (e instanceof TagWriteError && 'invflux_tag_name_taken_by_archived' === e.code) {
            setShowArchived(true);
          }
        },
      },
    );
  };

  return (
    <Modal onClose={props.onClose} label={__('Manage tags')} backdropClass="bg-black/30 flex items-center justify-center p-6">
      <div class="w-[26rem] max-w-full rounded-lg bg-white p-5 shadow-xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-800">{__('Manage order tags')}</h2>
          <Button
            variant="quiet"
            size="xs"
            aria-label={__('Close')}
            onClick={props.onClose}
          >
            ×
          </Button>
        </div>

        {/* Create */}
        <div class="mb-4 rounded-md border border-gray-200 p-3">
          <div class="mb-2 flex items-center gap-2">
            <input
              ref={nameInputEl}
              class="min-w-0 flex-1 rounded border border-gray-300 px-2 text-sm"
              placeholder={__('New tag name')}
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <Button
              size="sm"
              disabled={query() === '' || admin.create.isPending || addDisabledReason() !== null}
              title={addDisabledReason() ?? undefined}
              onClick={create}
            >
              {__('Add')}
            </Button>
          </div>

          <Show when={addDisabledReason()}>
            {(reason) => <p class="-mt-1 mb-2 text-2xs text-amber-700">{reason()}</p>}
          </Show>
          <Show when={error()}>
            <p class="-mt-1 mb-2 text-2xs text-rose-600">{error()}</p>
          </Show>

          <PaletteSwatchPicker value={newColorId()} onPick={setNewColorId} ariaLabel={__('Tag colour')} />

          {/* Tag settings (Pro): behaviour + access beyond a plain label. */}
          <TagSettingsSection
            flags={newFlags()}
            priority={newPriority()}
            authority={newAuthority()}
            onFlags={setNewFlags}
            onPriority={setNewPriority}
            onAuthority={setNewAuthority}
          />
        </div>

        {/* Existing / matching */}
        <div class="max-h-72 space-y-1.5 overflow-y-auto">
          <h3 class="sticky top-0 z-10 bg-white pb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {filtering() ? __('Matching tags') : __('Existing tags')}
          </h3>
          <For
            each={liveMatches()}
            fallback={
              <p class="py-2 text-center text-xs text-text-muted">
                {filtering() ? __('No tag matches that name.') : __('No tags yet.')}
              </p>
            }
          >
            {(t) => <TagManagerRow tag={t} query={query()} />}
          </For>

          {/* Archived — folded, and only loaded when opened. */}
          <Show when={(archivedNames.data ?? []).length > 0}>
            <div class="mt-2 rounded-md bg-gray-50 p-2">
              <button
                type="button"
                class="flex w-full cursor-pointer items-center justify-between text-2xs font-semibold uppercase tracking-wide text-text-muted hover:text-gray-600"
                aria-expanded={showArchived()}
                onClick={() => setShowArchived((v) => !v)}
              >
                <span>
                  {filtering() ? __('Matching archived tags') : __('Archived tags')}
                  {` (${filtering() ? archivedMatches().length : (archivedNames.data ?? []).length})`}
                </span>
                <span aria-hidden="true">{showArchived() ? '▾' : '▸'}</span>
              </button>

              <Show when={showArchived()}>
                <div class="mt-1.5 space-y-1.5">
                  <Show
                    when={!archivedTags.isPending}
                    fallback={<p class="py-2 text-center text-xs text-text-muted">{__('Loading…')}</p>}
                  >
                    <For
                      each={(archivedTags.data ?? []).filter(
                        (t) => !filtering() || archivedMatches().some((m) => m.id === t.id),
                      )}
                      fallback={
                        <p class="py-2 text-center text-xs text-text-muted">
                          {filtering() ? __('No archived tag matches that name.') : __('None.')}
                        </p>
                      }
                    >
                      {(t) => (
                        <ArchivedTagRow
                          tag={t}
                          query={query()}
                          highlighted={collision()?.archived === true && collision()?.id === t.id}
                        />
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One archived tag: what it looked like, how many orders still carry it, and the way back.
 *
 * Read-only apart from Restore. An archived tag is out of circulation — renaming or recolouring one
 * in place would be editing something the merchant cannot see the effects of; bring it back first.
 */
function ArchivedTagRow(props: { tag: TagSummary; query: string; highlighted?: boolean }): JSX.Element {
  const admin = useTagAdminMutations();
  return (
    <div
      class="flex items-center gap-2 py-0.5"
      classList={{ 'rounded border border-amber-300 bg-amber-50 px-2 py-1.5': true === props.highlighted }}
    >
      <TagPill tag={props.tag} />
      <span class="min-w-0 flex-1 truncate text-xs text-gray-500">
        <HighlightMatch text={props.tag.name} query={props.query} />
        <Show when={undefined !== props.tag.orderCount}>
          <span class="ml-1 text-text-muted">{sprintf(_n('%d order', '%d orders', props.tag.orderCount ?? 0), props.tag.orderCount ?? 0)}</span>
        </Show>
      </span>
      <Button
        size="xs"
        variant="quiet"
        disabled={admin.restore.isPending}
        title={__('Bring this tag back, with its settings and the orders still carrying it')}
        onClick={() => admin.restore.mutate(props.tag.id)}
      >
        {__('Restore')}
      </Button>
    </div>
  );
}

/** One editable row in the manager: inline rename, colour swatch, delete, + a
 * collapsible Tag settings (Pro) section for behaviour flags, priority + access. */
function TagManagerRow(props: { tag: TagSummary; query?: string }): JSX.Element {
  const ctx = useDispatch();
  const entitled = (): boolean => ctx.entitlements.governanceTags;
  const admin = useTagAdminMutations();
  const [name, setName] = createSignal(props.tag.name);
  const [editingColor, setEditingColor] = createSignal(false);
  const [editingName, setEditingName] = createSignal(false);
  let nameInputEl: HTMLInputElement | undefined;
  const [showGov, setShowGov] = createSignal(false);
  // Local mirrors so the controls feel responsive; each change persists immediately.
  const [flags, setFlags] = createSignal<GovernanceFlag[]>(props.tag.governanceFlags);
  const [priority, setPriority] = createSignal(props.tag.priority);
  const [authority, setAuthority] = createSignal<ManageAuthority>(props.tag.manageAuthority);

  const saveName = (): void => {
    const n = name().trim();
    if (n !== '' && n !== props.tag.name) admin.update.mutate({ id: props.tag.id, name: n });
  };
  const saveFlags = (f: GovernanceFlag[]): void => {
    setFlags(f);
    admin.update.mutate({ id: props.tag.id, governanceFlags: f });
  };
  const savePriority = (p: number): void => {
    setPriority(p);
    admin.update.mutate({ id: props.tag.id, priority: p });
  };
  const saveAuthority = (a: ManageAuthority): void => {
    setAuthority(a);
    admin.update.mutate({ id: props.tag.id, manageAuthority: a });
  };

  return (
    <div class={showGov() ? 'rounded-md border border-gray-200 bg-gray-50 p-2' : ''}>
      <div class="relative flex items-center gap-2">
        {/* Render the tag exactly as it appears on an order (live preview of the
            edited name/colour) — quicker to identify by width + colour + text.
            Clicking it opens the colour picker. */}
        <button type="button" class="shrink-0 cursor-pointer" aria-label={__('Change colour')} onClick={() => setEditingColor((v) => !v)}>
          <TagPill tag={{ ...props.tag, name: name().trim() === '' ? props.tag.name : name() }} />
        </button>
        {/* Renaming is behind a pencil rather than living in an always-editable input. Two reasons,
            and the second is why it changed: a row is read far more often than it is renamed, and an
            input cannot carry the match highlight — so with the list doubling as a search result,
            the name has to be able to render as marked-up text. Find a tag by typing above, click
            the pencil on the one you meant. */}
        <Show
          when={editingName()}
          fallback={
            <span class="min-w-0 flex-1 truncate px-1 py-0.5 text-sm text-gray-600">
              <HighlightMatch text={props.tag.name} query={props.query ?? ''} />
            </span>
          }
        >
          <input
            ref={nameInputEl}
            // This input owns Escape — it cancels the rename. Without the marker the modal's
            // capture-phase handler would close the whole manager instead, taking the list and the
            // filter with it.
            {...{ [ESC_LOCAL_ATTR]: '' }}
            class="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm text-gray-600"
            value={name()}
            aria-label={__('Rename tag')}
            onInput={(e) => setName(e.currentTarget.value)}
            onBlur={() => {
              saveName();
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                // Abandon the edit rather than committing whatever is half-typed, and stay in the
                // manager: the merchant cancelled a rename, not the whole session.
                e.stopPropagation();
                setName(props.tag.name);
                setEditingName(false);
              }
            }}
          />
        </Show>
        <Show when={!editingName()}>
          <IconButton
            label={sprintf(__('Rename %s'), props.tag.name)}
            size="xs"
            onClick={() => {
              setEditingName(true);
              // The input does not exist until this flips, so focus on the next frame.
              queueMicrotask(() => nameInputEl?.focus());
            }}
          >
            <PencilIcon class="h-3.5 w-3.5" />
          </IconButton>
        </Show>
        <button
          type="button"
          class="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-2xs"
          classList={{
            'text-indigo-600 bg-indigo-50': isGovernanceTag(props.tag),
            'text-text-muted hover:bg-gray-50': !isGovernanceTag(props.tag),
          }}
          title={__('Tag settings (Pro): queue behaviour, required note, dedicated button, access')}
          onClick={() => setShowGov((v) => !v)}
        >
          ⚑
        </button>
        <button
          type="button"
          class={iconButtonClass('xs', true, 'w-auto shrink-0 px-1.5 text-rose-500')}
          onClick={() => admin.remove.mutate(props.tag.id)}
          title={__('Retire tag (hidden from the picker; existing orders keep it, and history stays readable)')}
        >
          {__('Retire')}
        </button>
        <Show when={editingColor()}>
          <div class="absolute right-2 top-full z-30 mt-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
            <PaletteSwatchPicker
              ariaLabel={__('Tag colour')}
              value={props.tag.colorId}
              onPick={(c) => {
                admin.update.mutate({ id: props.tag.id, colorId: c });
                setEditingColor(false);
              }}
            />
          </div>
        </Show>
      </div>

      <Show when={showGov()}>
        <div class="mt-1.5 border-t border-gray-100 pt-1.5">
          <Show when={!entitled()}>
            <div class="mb-2 flex items-center gap-1.5 text-2xs text-gray-500">
              <ProPill />
              <span>{__('Upgrade to configure tag behaviour & access.')}</span>
            </div>
          </Show>
          <TagSettingsSlot
            flags={flags()}
            priority={priority()}
            authority={authority()}
            onFlags={saveFlags}
            onPriority={savePriority}
            onAuthority={saveAuthority}
          />
        </div>
      </Show>
    </div>
  );
}

/**
 * Bulk tag-assign popover for a selection of queue orders. Renders a button
 * showing the selection count; opening it lists tags to apply to all selected.
 */
export function BulkTagAssign(props: { orderIds: string[]; onDone?: () => void }): JSX.Element {
  const ctx = useDispatch();
  const governTags = (): boolean => ctx.capabilities.governTags;
  const allTags = useTagsQuery();
  const bulk = useBulkAssignTagsMutation();
  const [open, setOpen] = createSignal(false);
  const [noteFor, setNoteFor] = createSignal<TagSummary | null>(null);
  // Same apply-gate + picker-hide as the per-order menus.
  const bulkAssignable = createMemo(() =>
    (allTags.data ?? []).filter(
      (t) => !t.governanceFlags.includes('HidePicker') && canApplyTag(t, governTags()),
    ),
  );

  const apply = (tagId: number, note?: string): void => {
    bulk.mutate(
      { orderIds: props.orderIds, tagIds: [tagId], note },
      { onSuccess: () => props.onDone?.() },
    );
  };
  // A note-required tag opens the note modal first (one shared batch note stamped per order).
  const pick = (t: TagSummary): void => {
    setOpen(false);
    if (tagNeedsNote(t)) {
      setNoteFor(t);
      return;
    }
    apply(t.id);
  };

  return (
    <div class="relative">
      <Button
        variant="secondary"
        size="sm"
        class="gap-1"
        disabled={props.orderIds.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        {sprintf(_n('Tag %d order', 'Tag %d orders', props.orderIds.length), props.orderIds.length)}
      </Button>
      <Show when={open()}>
        <div class="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div class="absolute left-0 top-full z-20 mt-1 max-h-64 w-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 shadow-lg">
          <TagPickerPills tags={bulkAssignable()} showCount onPick={pick} />
        </div>
      </Show>
      <Show when={noteFor()}>
        {(tag) => (
          <NoteModal
            tag={tag()}
            onClose={() => setNoteFor(null)}
            onSubmit={(note) => {
              apply(tag().id, note);
              setNoteFor(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * Right-click context menu for a queue row. A tag-assign surface ("Add tag" →
 * the order's unassigned tags as pills, one click to assign) plus a "Manage
 * tags…" entry. **Presentational** — the actual assign mutation + manager modal
 * are owned by the parent (so they survive this menu unmounting on close; a
 * component-scoped mutation would be disposed before it dispatched).
 */
export function RowContextMenu(props: {
  order: DispatchOrderSummary;
  x: number;
  y: number;
  onPick: (tag: TagSummary) => void;
  onManage: () => void;
  onClose: () => void;
}): JSX.Element {
  const ctx = useDispatch();
  const governTags = (): boolean => ctx.capabilities.governTags;
  const allTags = useTagsQuery();
  const assignedIds = createMemo(() => new Set((props.order.tags ?? []).map((t) => t.id)));
  const assignable = createMemo(() =>
    (allTags.data ?? []).filter(
      (t) =>
        !assignedIds().has(t.id) &&
        !t.governanceFlags.includes('HidePicker') &&
        canApplyTag(t, governTags()),
    ),
  );

  // Clamp to the viewport so the menu never opens off-screen.
  const MENU_W = 240;
  const left = (): number => Math.min(props.x, window.innerWidth - MENU_W - 8);
  const top = (): number => Math.min(props.y, window.innerHeight - 320);

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <>
      {/* click-away backdrop */}
      <div class="fixed inset-0 z-40" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }} />
      <div
        class="fixed z-50 w-[240px] overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-sm shadow-xl"
        style={{ left: `${left()}px`, top: `${top()}px` }}
      >
        <div class="px-3 py-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
          {__('Add tag')}
        </div>
        <div class="max-h-56 overflow-y-auto px-2 pb-1">
          <TagPickerPills
            tags={assignable()}
            showCount
            emptyText={__('All tags applied')}
            onPick={(t) => props.onPick(t)}
          />
        </div>
        <div class="my-1 border-t border-gray-100" />
        <button
          type="button"
          class={menuItemClass(false, false, 'text-2xs font-medium')}
          onClick={() => props.onManage()}
        >
          {__('Manage tags…')}
        </button>
      </div>
    </>
  );
}
