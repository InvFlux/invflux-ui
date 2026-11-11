import { __ } from '@invflux/i18n';
import { type JSX, onCleanup, Show } from 'solid-js';
import { createFold, FoldChevron } from './fold';
import { menuItemClass } from './primitives';
import { useSettingsSections } from './settingsSections';

export interface SettingsSectionProps {
  /** Section heading (uppercase, muted — matches the settings-panel style). */
  title: string;
  /**
   * What the section is remembered by: its fold state and its place in the gear. Defaults to the
   * title, which is translated, so a section that wants its arrangement to survive a change of
   * language names itself here.
   */
  id?: string;
  /** Whether the section starts expanded. Default: expanded. */
  defaultOpen?: boolean;
  /** Optional trailing badge/count rendered right of the title (e.g. a hit count). */
  badge?: JSX.Element;
  children: JSX.Element;
}

/**
 * A foldable settings section: a chevron header that collapses its body. Used to group the surface
 * gear popover's settings — core sections (Display, Cell components) and each add-on / third-party
 * contribution get one, so a tall panel stays manageable inside the popover's vertical scroll.
 *
 * Inside the gear, the reader's arrangement sticks: whether a section is open, and where it sits
 * among the others (a grip at the right of the heading, shown on hover, drags it; see
 * {@link SettingsSectionsProvider}). Outside it, the fold is local and uncontrolled — each section
 * remembers its own open/closed within the panel's lifetime. Keyboard-accessible (the header is a
 * real `<button>` with `aria-expanded` + `aria-controls`); the grip is a pointer affordance for a
 * rare rearrangement and is not a tab stop.
 *
 * The **popover** fold. Its page-panel sibling is `FoldingSection`; the behaviour they share lives
 * in {@link createFold}, and why they stay two components is argued there.
 */
export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const host = useSettingsSections();
  // Read once: a section's identity does not change while it is mounted.
  // eslint-disable-next-line solid/reactivity
  const id = props.id ?? props.title;
  const fold = createFold({
    defaultOpen: props.defaultOpen ?? true,
    open: () => host?.openState(id),
    onOpenChange: (open) => host?.setOpen(id, open),
  });
  if (undefined !== host) onCleanup(host.register(id));
  // A drag in progress shows every section folded; the stored state is untouched.
  const shown = (): boolean => fold.open() && !(host?.folding() ?? false);
  const rank = (): number => host?.rank(id) ?? -1;
  let headerRow: HTMLDivElement | undefined;

  return (
    <div
      class="group/section relative"
      classList={{
        'border-b border-border last:border-b-0': undefined === host,
        'border-t border-border': undefined !== host && rank() > 0,
        'opacity-50': host?.isDragging(id) ?? false,
      }}
      style={undefined === host ? undefined : { order: rank() }}
      onDragOver={(event) => {
        if (undefined === host || !host.reorderable()) return;
        // Only a drag this host started is droppable here: the grip sets the drag data, and a file or
        // a text selection dragged across the popover is none of its business.
        if (!event.dataTransfer?.types.includes('application/x-invflux-gear-section')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        host.dragOver(id);
      }}
      onDrop={(event) => {
        if (undefined === host) return;
        if (!event.dataTransfer?.types.includes('application/x-invflux-gear-section')) return;
        event.preventDefault();
        host.drop(id);
      }}
    >
      <Show when={host?.dropEdge(id)}>
        {(edge) => (
          <div
            class="pointer-events-none absolute inset-x-0 h-0.5 rounded bg-primary"
            classList={{ '-top-px': 'before' === edge(), '-bottom-px': 'after' === edge() }}
          />
        )}
      </Show>
      <div class="flex items-center" ref={headerRow}>
        <button
          type="button"
          class={menuItemClass(
            false,
            false,
            'min-w-0 flex-1 px-0 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          )}
          aria-expanded={shown()}
          aria-controls={fold.bodyId}
          onClick={fold.toggle}
        >
          <FoldChevron open={shown()} />
          <span class="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {props.title}
          </span>
          <Show when={props.badge}>
            <span class="ml-auto">{props.badge}</span>
          </Show>
        </button>
        <Show when={host?.reorderable()}>
          <span
            class="flex w-5 shrink-0 cursor-grab select-none items-center justify-center text-text-muted opacity-0 transition-opacity hover:opacity-100! group-hover/section:opacity-50"
            draggable="true"
            title={__('Drag to reorder')}
            aria-hidden="true"
            onDragStart={(event) => {
              if (undefined === host || !event.dataTransfer) return;
              event.dataTransfer.setData('application/x-invflux-gear-section', id);
              event.dataTransfer.effectAllowed = 'move';
              // The ghost is the heading, not the grip that was grabbed.
              if (undefined !== headerRow) event.dataTransfer.setDragImage(headerRow, 16, 12);
              host.startDrag(id);
            }}
            onDragEnd={() => host?.endDrag()}
          >
            ⋮⋮
          </span>
        </Show>
      </div>
      <Show when={shown()}>
        <div id={fold.bodyId} class="pb-3">
          {props.children}
        </div>
      </Show>
    </div>
  );
}
