import { type JSX, Show } from 'solid-js';
import { FoldChevron, createFold } from './fold';
import { menuItemClass } from './primitives';

export interface SettingsSectionProps {
  /** Section heading (uppercase, muted — matches the settings-panel style). */
  title: string;
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
 * Fold state is local + uncontrolled (each section remembers its own open/closed within the panel's
 * lifetime). Keyboard-accessible (the header is a real `<button>` with `aria-expanded` + `aria-controls`).
 *
 * The **popover** fold. Its page-panel sibling is `FoldingSection`; the behaviour they share lives
 * in {@link createFold}, and why they stay two components is argued there.
 */
export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const { open, toggle, bodyId } = createFold({ defaultOpen: props.defaultOpen ?? true });

  return (
    <div class="border-b border-border last:border-b-0">
      <button
        type="button"
        class={menuItemClass(false, false, 'px-0 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary')}
        aria-expanded={open()}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <FoldChevron open={open()} />
        <span class="text-xs font-semibold uppercase tracking-wide text-text-muted">{props.title}</span>
        <Show when={props.badge}>
          <span class="ml-auto">{props.badge}</span>
        </Show>
      </button>
      <Show when={open()}>
        <div id={bodyId} class="pb-3">
          {props.children}
        </div>
      </Show>
    </div>
  );
}
