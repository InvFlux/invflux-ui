import { For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cx } from './primitives';
import * as Menu from '@kobalte/core/dropdown-menu';
import type { IconComponent } from './icons';
import { usePortalRootOptional } from './portal';

/**
 * One entry in a {@link DropdownMenu}. A `run` leaf is an action; `children` makes it a submenu
 * (Kobalte `Menu.Sub`) — nestable to any depth. `disabled` greys + inerts the item.
 */
export interface DropdownMenuItem {
  id: string;
  label: string;
  /** Optional leading icon component, rendered before the label. */
  icon?: IconComponent;
  disabled?: boolean;
  /** Render a divider immediately above this item (e.g. before a destructive group). */
  separatorBefore?: boolean;
  /** Native tooltip (`title`) — typically explains WHY a `disabled` item is disabled (an unmet
   *  precondition or an upgrade prompt). Shows on hover; disabled items keep pointer events so it does. */
  tooltip?: string;
  run?: () => void;
  children?: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  items: DropdownMenuItem[];
  /** Trigger content (the caller styles the trigger via `triggerClass`). */
  trigger: JSX.Element;
  triggerClass?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Portal target for the panels (the SPA's light-DOM portalRoot — mirrors SearchSelectAsync). */
  mount?: HTMLElement;
}

const CONTENT =
  'z-popover min-w-[11rem] rounded border border-border bg-surface py-1 text-sm shadow-xl focus:outline-none';

const ITEM =
  'flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-sm text-text outline-none ' +
  'data-[highlighted]:bg-primary data-[highlighted]:text-white ' +
  // NB: no `pointer-events-none` on disabled — Kobalte already inerts selection/keyboard-nav via
  // aria-disabled, and keeping pointer events lets the native `title` tooltip surface on hover so a
  // disabled item can explain its unmet precondition.
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';

const SEPARATOR = 'my-1 h-px bg-border';

/** A leading icon, fixed-width so labels align whether or not siblings have icons. */
const ICON = 'h-4 w-4 shrink-0';

/**
 * Shared action menu on `@kobalte/core/dropdown-menu` (keyboard + ARIA + shadow-DOM portal handled by
 * Kobalte). Supports nested submenus via {@link DropdownMenuItem.children} — e.g. a bulk-action menu
 * with "Export ▸ Excel / CSV". Wrap-don't-reach (arch-ui-principles §4.2): SPAs use this, not Kobalte.
 */
export function DropdownMenu(props: DropdownMenuProps): JSX.Element {
  const ctxMount = usePortalRootOptional();
  const mount = (): HTMLElement | undefined => props.mount ?? ctxMount;

  const renderItems = (items: DropdownMenuItem[]): JSX.Element => (
    <For each={items}>
      {(item) => (
        <Show
          when={item.children && item.children.length > 0}
          fallback={
            <>
              <Show when={item.separatorBefore}>
                <Menu.Separator class={SEPARATOR} />
              </Show>
              <Menu.Item class={ITEM} disabled={item.disabled} title={item.tooltip} onSelect={() => item.run?.()}>
                <Show when={item.icon}>
                  {(Icon) => <Dynamic component={Icon()} class={ICON} />}
                </Show>
                <span class="flex-1 truncate">{item.label}</span>
              </Menu.Item>
            </>
          }
        >
          <Menu.Sub>
            <Show when={item.separatorBefore}>
              <Menu.Separator class={SEPARATOR} />
            </Show>
            <Menu.SubTrigger class={ITEM} disabled={item.disabled} title={item.tooltip}>
              <Show when={item.icon}>
                {(Icon) => <Dynamic component={Icon()} class={ICON} />}
              </Show>
              <span class="flex-1 truncate">{item.label}</span>
              <span class="text-text-muted" aria-hidden="true">
                ▸
              </span>
            </Menu.SubTrigger>
            <Menu.Portal mount={mount()}>
              <Menu.SubContent class={CONTENT}>{renderItems(item.children!)}</Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </Show>
      )}
    </For>
  );

  return (
    <Menu.Root>
      {/*
        The trigger is a clickable affordance, so `cursor-pointer` (and the disabled counterpart) is
        the component's job, not each caller's — `triggerClass` styles the *look*, and callers kept
        forgetting the cursor. It goes first so a caller's own class still wins on conflict.
      */}
      <Menu.Trigger
        class={cx('cursor-pointer disabled:cursor-not-allowed', props.triggerClass)}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
      >
        {props.trigger}
      </Menu.Trigger>
      <Menu.Portal mount={mount()}>
        <Menu.Content class={CONTENT}>{renderItems(props.items)}</Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
