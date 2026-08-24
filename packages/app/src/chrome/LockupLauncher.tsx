import { __, _x } from '@invflux/i18n';
import { usePortalRootOptional } from '@invflux/ui';
import * as Popover from '@kobalte/core/popover';
import { useNavigate } from '@solidjs/router';
import { createSignal, For, type JSX } from 'solid-js';
import lockupHorizontal from '@invflux/ui/assets/invflux-lockup-horizontal.svg?raw';
import { isOpen, isPinned, pinTab, unpinTab } from '../openTabs';
import { surfaceCatalog } from '../surfaceCatalog';
import { surfaceHref } from '../surfaceRouter';

/**
 * The InvFlux lockup, top-left, is the **launcher**: it drops **every** available surface plus
 * system-wide Settings and Licenses. Each row opens its surface on click; a pin toggle on the right
 * shows and flips its current status — **pinned** (a permanent tab), **open** (an unpinned tab), or
 * **none** (closed). So the tab bar never has to double as a nav menu, and pinning is reachable both
 * here and by right-clicking a tab.
 *
 * A row's surface link resumes where the surface left off (`surfaceHref`, keep-alive). Built on
 * Kobalte Popover rather than the action-menu DropdownMenu, because a menu item can't carry a trailing
 * toggle that leaves the menu open.
 */

type PinState = 'pinned' | 'open' | 'none';

interface Row {
  path: string;
  label: string;
  href: string;
}

/** A pushpin, filled when pinned, outlined otherwise; colour carries the three-state status. */
function PinGlyph(props: { state: PinState }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      class="h-4 w-4"
      aria-hidden="true"
      fill={'pinned' === props.state ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" />
      <line x1="12" y1="14" x2="12" y2="20" />
    </svg>
  );
}

export function LockupLauncher(): JSX.Element {
  const navigate = useNavigate();
  const mount = usePortalRootOptional();
  const [open, setOpen] = createSignal(false);

  const rows = (): Row[] => [
    ...surfaceCatalog().map((s) => ({ path: `/${s.id}`, label: s.label, href: surfaceHref(s.id) })),
    { path: '/settings', label: __('Settings'), href: '/settings' },
    { path: '/licenses', label: __('Licenses & Add-ons'), href: '/licenses' },
  ];

  const stateOf = (path: string): PinState => (isPinned(path) ? 'pinned' : isOpen(path) ? 'open' : 'none');

  const togglePin = (row: Row): void => {
    if (isPinned(row.path)) unpinTab(row.path);
    else pinTab({ path: row.path, title: row.label });
  };

  return (
    <Popover.Root open={open()} onOpenChange={setOpen} placement="bottom-start" gutter={4}>
      <Popover.Trigger
        class="flex cursor-pointer items-center rounded px-2 py-1.5 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={__('Open a surface')}
      >
        {/* eslint-disable-next-line solid/no-innerhtml -- build-time `?raw` SVG import, not user or server data. */}
        <span class="inline-flex items-center [&_svg]:h-5 [&_svg]:w-auto" innerHTML={lockupHorizontal} />
      </Popover.Trigger>
      <Popover.Portal mount={mount}>
        <Popover.Content class="z-popover min-w-[15rem] rounded border border-slate-200 bg-white py-1 text-sm shadow-xl focus:outline-none">
          <For each={rows()}>
            {(row) => {
              const state = (): PinState => stateOf(row.path);
              return (
                <div class="flex items-center gap-1 pr-1 hover:bg-slate-100">
                  {/* Open / navigate to the surface (closes the launcher). */}
                  <button
                    type="button"
                    class="flex-1 truncate px-3 py-1.5 text-left text-slate-700"
                    onClick={() => {
                      navigate(row.href);
                      setOpen(false);
                    }}
                  >
                    {row.label}
                  </button>
                  {/* Pin toggle — stays open so several can be pinned in one visit. */}
                  <button
                    type="button"
                    class="shrink-0 rounded p-1 hover:bg-slate-200"
                    classList={{
                      'text-primary': 'pinned' === state(),
                      'text-slate-500': 'open' === state(),
                      'text-slate-300': 'none' === state(),
                    }}
                    aria-pressed={'pinned' === state()}
                    title={
                      'pinned' === state()
                        ? _x('Unpin', 'tab: detach this surface from the pinned row')
                        : _x('Pin', 'tab: pin this surface as a permanent tab')
                    }
                    onClick={() => togglePin(row)}
                  >
                    <PinGlyph state={state()} />
                  </button>
                </div>
              );
            }}
          </For>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
