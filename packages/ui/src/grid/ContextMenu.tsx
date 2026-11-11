import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { __ } from '@invflux/i18n';
import { menuItemClass } from '../primitives';

/** A context-menu item the host contributes (e.g. Save / Revert / domain actions). */
export interface DataGridMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip — typically the reason a `disabled` item is disabled. */
  title?: string;
  /** Renders the same `✓` the grid marks its own current-state items with. For an item that names a
   *  setting's value (one arm of a three-way choice), not for a command. */
  checked?: boolean;
  /** The key that does the same, shown at the item's end (`Backspace`). Not shown on a `checked` item. */
  shortcut?: string;
  /**
   * `editing`: placed with the grid's editing commands (Edit, Copy, Cut, Paste, Clear), after the last
   * of them shown, rather than after the grid's own items. A cell-menu option only.
   */
  placement?: 'editing';
  /** Leaf action. Omit for a submenu parent (carries `children`); a parent with BOTH runs on click. */
  run?: () => void;
  /** Present ⇒ this item is a submenu parent (hover-opens `children`). */
  children?: DataGridMenuItem[];
}

/** Role a datatype component plays — mirrors @invflux/ui's ComponentRole. */

export interface ContextMenuItem {
  key: string;
  label: string;
  shortcut?: string;
  /** Leaf action. Omitted for a submenu parent (which carries `children` instead). */
  run?: () => void;
  /** Present ⇒ this item is a submenu parent (hover-opens a flyout of `children`); `run` is ignored. */
  children?: ContextMenuItem[];
  /** Disabled items render grayed, don't run, and show `title` as a tooltip (e.g. a Pro upgrade hint). */
  disabled?: boolean;
  title?: string;
}

/**
 * A host-contributed {@link DataGridMenuItem} as an internal menu item. Recursive, so an extra may be
 * a submenu parent. Shared by the cell menu and the header menu — the two differ in *what* they hand
 * the host, never in how a contribution is rendered.
 *
 * `checked` becomes the same `✓` the grid's own three-way choices use, rather than exposing the
 * internal `shortcut` slot: a host contributing a settings-style submenu should get the grid's mark,
 * not have to spell a glyph into its label and hope it lines up.
 */
export function toContextMenuItem(m: DataGridMenuItem): ContextMenuItem {
  return {
    key: m.id,
    label: m.label,
    disabled: m.disabled,
    title: m.title,
    shortcut: m.checked === true ? '✓' : m.shortcut,
    run: m.run,
    children: m.children?.map(toContextMenuItem),
  };
}

/**
 * A right-click menu: a backdrop that dismisses it, and a list of items placed at the pointer, with
 * submenus that open to a flyout (on the left when the menu sits in the right part of the viewport).
 * Escape, a resize and any click outside close it; what to do on scrolling is the host's to say.
 *
 * It takes the keyboard when it opens: the first item has focus; Up / Down, Home / End move between
 * the items of a list; Right, Enter or Space on a submenu parent opens it on its first item; Left or
 * Escape closes a submenu back to its parent, and Escape on the top list closes the menu, as Tab
 * does. Hovering an item focuses it, so the keyboard carries on from where the pointer is. When the
 * menu goes away, focus goes back to where it was if the menu still had it.
 *
 * Shared by the grid's cell and header menus and by the read-only table's header menu.
 */
export function ContextMenu(props: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): JSX.Element {
  // Open submenu key PER DEPTH (0 = top level). Lets an ancestor chain stay open while siblings close,
  // so the context menu supports arbitrary submenu nesting.
  const [openByDepth, setOpenByDepth] = createSignal<Record<number, string>>({});
  const hoverAt = (depth: number, key: string | null): void => {
    setOpenByDepth((prev) => {
      const next: Record<number, string> = {};
      for (const [d, k] of Object.entries(prev)) if (Number(d) < depth) next[Number(d)] = k;
      if (key !== null) next[depth] = key;
      return next;
    });
  };

  let menuEl: HTMLUListElement | undefined;
  // The node the menu was opened from, and the document or shadow root both live in.
  let root: Document | ShadowRoot = document;
  let opener: Element | null = null;
  onMount(() => {
    if (menuEl === undefined) return;
    root = menuEl.getRootNode() as Document | ShadowRoot;
    opener = root.activeElement;
    itemsOf(menuEl)[0]?.focus({ preventScroll: true });
  });
  onCleanup(() => {
    const now = root.activeElement;
    const lost = now === null || now === document.body || (menuEl?.contains(now) ?? false);
    if (lost && opener instanceof HTMLElement && opener.isConnected) {
      opener.focus({ preventScroll: true });
    }
  });

  /** The items of one list, its own and not its submenus'. */
  const itemsOf = (list: Element): HTMLButtonElement[] =>
    Array.from(list.children).flatMap((li) => {
      const button = li.firstElementChild;
      return button instanceof HTMLButtonElement ? [button] : [];
    });
  /** The submenu list a parent item opens, once it is rendered. */
  const submenuOf = (button: HTMLButtonElement): Element | null =>
    button.parentElement?.querySelector(':scope > ul[role="menu"]') ?? null;

  function openSubmenu(button: HTMLButtonElement): void {
    const depth = Number(button.dataset.depth);
    const key = button.dataset.key;
    if (key === undefined) return;
    hoverAt(depth, key);
    queueMicrotask(() => {
      const list = submenuOf(button);
      if (list !== null) itemsOf(list)[0]?.focus({ preventScroll: true });
    });
  }

  /** Close the submenu holding `button` and return to the item that opened it; false at the top. */
  function closeSubmenu(button: HTMLButtonElement): boolean {
    const depth = Number(button.dataset.depth);
    if (depth === 0) return false;
    const parent = button.closest('ul[role="menu"]')?.parentElement?.firstElementChild;
    hoverAt(depth - 1, null);
    if (parent instanceof HTMLButtonElement) parent.focus({ preventScroll: true });
    return true;
  }

  function onMenuKeyDown(e: KeyboardEvent): void {
    const button = root.activeElement;
    if (!(button instanceof HTMLButtonElement) || !(menuEl?.contains(button) ?? false)) return;
    const list = button.closest('ul[role="menu"]');
    if (list === null) return;
    const items = itemsOf(list);
    const at = items.indexOf(button);
    const move = (to: number): void => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus({ preventScroll: true });
    };
    const parent = button.getAttribute('aria-haspopup') === 'true';
    switch (e.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(items.length - 1);
      case 'ArrowRight':
        if (parent && button.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault();
          openSubmenu(button);
        }
        return;
      case 'ArrowLeft':
        if (closeSubmenu(button)) e.preventDefault();
        return;
      case 'Enter':
      case ' ':
        // A pure submenu parent opens on its first item; anything else is the button's own click.
        if (
          parent &&
          button.dataset.runs !== 'true' &&
          button.getAttribute('aria-disabled') !== 'true'
        ) {
          e.preventDefault();
          openSubmenu(button);
        }
        return;
      case 'Tab':
        e.preventDefault();
        props.onClose();
        return;
    }
  }

  createEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const focused = root.activeElement;
        if (
          focused instanceof HTMLButtonElement &&
          (menuEl?.contains(focused) ?? false) &&
          closeSubmenu(focused)
        ) {
          return;
        }
        props.onClose();
      }
    };
    const onResize = (): void => props.onClose();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    });
  });

  // Flyout direction: open submenus to the left when the menu sits in the right ~third of the
  // viewport, so a right-anchored submenu doesn't run off-screen.
  const submenuOnLeft = props.x > window.innerWidth * 0.62;
  // Keep a submenu fully on-screen vertically: shift up by any bottom overflow. Measured in a
  // rAF (not synchronously in the ref) so the flyout's children are laid out and its true height
  // is known; the shift is clamped so a taller-than-viewport submenu doesn't run off the top.
  const positionSubmenu = (el: HTMLUListElement): void => {
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.style.top = '0px';
      const rect = el.getBoundingClientRect();
      const bottomOverflow = rect.bottom - (window.innerHeight - 8);
      if (bottomOverflow > 0) el.style.top = `${-Math.min(bottomOverflow, rect.top - 8)}px`;
    });
  };
  const btnClass = (item: ContextMenuItem): string =>
    menuItemClass(
      false,
      !!item.disabled,
      'justify-between gap-6 outline-none focus-visible:bg-surface-hover',
    );
  const focusOnHover = (e: MouseEvent): void => {
    const button = (e.currentTarget as HTMLElement).firstElementChild;
    if (button instanceof HTMLButtonElement) button.focus({ preventScroll: true });
  };
  // Recursive item render supporting arbitrary submenu nesting (`depth` keys the open state).
  const renderItem = (item: ContextMenuItem, depth: number): JSX.Element => {
    if (!item.children || item.children.length === 0) {
      return (
        <li
          onMouseEnter={(e) => {
            hoverAt(depth, null);
            focusOnHover(e);
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-depth={depth}
            // aria-disabled (not the native attr) so the item still receives hover + `title`.
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.title}
            class={btnClass(item)}
            onClick={() => {
              if (item.disabled) return;
              props.onClose();
              item.run?.();
            }}
          >
            <span>{item.label}</span>
            <Show when={item.shortcut}>
              <span class="text-xs text-text-muted">{item.shortcut}</span>
            </Show>
          </button>
        </li>
      );
    }
    return (
      <li
        class="relative"
        onMouseEnter={(e) => {
          hoverAt(depth, item.key);
          focusOnHover(e);
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={openByDepth()[depth] === item.key ? 'true' : 'false'}
          data-depth={depth}
          data-key={item.key}
          data-runs={item.run ? 'true' : undefined}
          aria-disabled={item.disabled ? 'true' : undefined}
          title={item.title}
          class={btnClass(item)}
          // A parent that ALSO carries `run` (e.g. "Copy") acts on click; a pure parent toggles.
          onClick={() => {
            if (item.disabled) return;
            if (item.run) {
              props.onClose();
              item.run();
            } else {
              hoverAt(depth, openByDepth()[depth] === item.key ? null : item.key);
            }
          }}
        >
          <span>{item.label}</span>
          <span class="flex items-center gap-2">
            <Show when={item.shortcut}>
              <span class="text-xs text-text-muted">{item.shortcut}</span>
            </Show>
            <span class="text-xs text-text-muted" aria-hidden="true">
              ▸
            </span>
          </span>
        </button>
        <Show when={openByDepth()[depth] === item.key}>
          <ul
            role="menu"
            ref={positionSubmenu}
            class={`absolute top-0 z-submenu min-w-44 rounded-md border border-border bg-surface py-1 shadow-lg ${submenuOnLeft ? 'right-full' : 'left-full'}`}
          >
            <For each={item.children}>{(child) => renderItem(child, depth + 1)}</For>
          </ul>
        </Show>
      </li>
    );
  };
  return (
    <>
      {/* Transparent backdrop: any click (or another right-click) dismisses the menu. */}
      <div
        class="fixed inset-0 z-menu-backdrop"
        onMouseDown={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <ul
        ref={menuEl}
        role="menu"
        onKeyDown={onMenuKeyDown}
        class="fixed z-menu min-w-44 rounded-md border border-border bg-surface py-1 text-sm shadow-lg"
        style={{ left: `${props.x}px`, top: `${props.y}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <For
          each={props.items}
          fallback={<li class="px-3 py-1.5 text-text-muted">{__('No actions')}</li>}
        >
          {(item) => renderItem(item, 0)}
        </For>
      </ul>
    </>
  );
}
