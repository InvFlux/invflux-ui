import { __, sprintf } from '@invflux/i18n';
import { Button, GearIcon, iconButtonClass, surfaceSettingsRegistry, usePortalRootOptional } from '@invflux/ui';
import * as Popover from '@kobalte/core/popover';
import { useNavigate } from '@solidjs/router';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { humanize, surfaceCatalog } from '../surfaceCatalog';

/**
 * The gear, top-right beside the surface tabs, is **contextual**: clicking it opens the *current*
 * surface's settings **inline** as an anchored popover (no backdrop, top-right under the gear) — the
 * gear *is* the settings surface, not a menu pointing at a modal. A surface declares its panel via the
 * shared `surfaceSettingsRegistry` (§11.4); the popover mounts the active surface's panel(s), each
 * rendering its own foldable {@link SettingsSection} groups inside a single vertical scroll, so many
 * add-on / third-party sections stay manageable. An **"All Settings →"** header link opens the
 * system-wide Settings surface; a surface with no panel shows an honest empty hint.
 */
export function GearMenu(props: {
  activeId: () => string;
  /** Optional controlled open state — lets a surface open the gear (e.g. the DataGrid's Ctrl+,). */
  open?: () => boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const mount = usePortalRootOptional();
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = (): boolean => props.open?.() ?? internalOpen();
  const setOpen = (v: boolean): void => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };

  /** Caption of the active surface — the popover header + the empty-state hint. */
  const activeLabel = (): string => {
    const active = surfaceCatalog().find((s) => s.id === props.activeId());
    return active?.label ?? humanize(props.activeId());
  };
  const panels = (): ReturnType<typeof surfaceSettingsRegistry.for> =>
    surfaceSettingsRegistry.for(props.activeId()).filter((p) => p.enabled?.() ?? true);

  const openAllSettings = (): void => {
    setOpen(false);
    navigate('/settings');
  };

  return (
    <Popover.Root open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6} modal={false}>
      <Popover.Trigger
        aria-label={__('Settings')}
        // Kobalte owns this element, so it takes the class builder rather than <IconButton> — the
        // suite's look and its cursor rule without us controlling the tag.
        class={iconButtonClass('md')}
      >
        <GearIcon class="h-5 w-5" />
      </Popover.Trigger>
      <Popover.Portal mount={mount ?? undefined}>
        <Popover.Content class="z-50 w-80 max-w-[92vw] rounded-lg border border-border bg-surface text-text shadow-xl focus:outline-none">
          {/* Header — surface name + a right-aligned link to the system-wide Settings surface. */}
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span class="text-sm font-semibold text-text">{activeLabel()}</span>
            <Button variant="link" size="xs" class="shrink-0 font-medium" onClick={openAllSettings}>
              {__('All Settings')} →
            </Button>
          </div>
          {/* Body — the active surface's panel(s), each with its own foldable sections, in one scroll. */}
          <div class="max-h-[70vh] overflow-y-auto px-4 py-1">
            <Show
              when={panels().length > 0}
              fallback={
                <p class="py-4 text-sm text-text-muted">
                  {sprintf(
                    /* translators: %s = current surface name. */
                    __('No settings for %s yet.'),
                    activeLabel(),
                  )}
                </p>
              }
            >
              <For each={panels()}>
                {(panel) => <Dynamic component={panel.component} onRequestClose={() => setOpen(false)} />}
              </For>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
