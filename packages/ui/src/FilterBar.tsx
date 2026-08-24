import { createEffect, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { __ } from '@invflux/i18n';
import { filterControlRegistry, type FilterDescriptor } from './filters';
import { usePortalRootOptional } from './portal';
import { SearchSelect, type SearchSelectOption } from './SearchSelect';

/**
 * Generic filter chip bar —
 * SPA-agnostic, reused by any grid surface (workbench, dispatch, procurement). Renders:
 *
 *   ＋ Add filter ▾   [Label: summary ✕] [Label: summary ✕] …
 *
 * Only active filters show as chips; the rest live behind "Add filter". Clicking a chip (or
 * picking one from the menu) opens an editor popover whose control is resolved from
 * {@link filterControlRegistry} by the filter's `type`. The open control is mounted once (keyed
 * popover) so it survives the host's data refetches — the dropdown stays open across picks.
 *
 * The host owns state + URL sync: it passes a reactive `filters` accessor (its descriptors) and
 * the bar calls each descriptor's `onChange`/`clear`. Search lives outside the bar (it's
 * SPA-specific) — render it adjacent.
 */

export interface FilterBarProps {
  /** Reactive source of the host's filter descriptors. */
  filters: () => FilterDescriptor[];
  /** Called when a filter's editor popover closes (e.g. so the host can return focus to the grid). */
  onEditorClosed?: () => void;
  /** Called when Escape exits the filter bar (the host returns focus to the grid). */
  onExit?: () => void;
  /**
   * Optional host element to scope the keyboard cycle to (defaults to the bar itself). When given,
   * the Tab/Shift+Tab ring spans this element: host-marked `[data-fb-cycle]` focusables (e.g. the
   * search input, display toggles) plus the Add-filter slot and chips, in DOM order. Accessor so it
   * can resolve a parent ref that's only assigned after this child's effects run.
   */
  cycleScope?: () => HTMLElement | undefined;
}

export function FilterBar(props: FilterBarProps) {
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  let barRef: HTMLDivElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  // A control's listbox (Kobalte combobox) portals OUT of barRef to the light-DOM portal root, so a
  // click on an option isn't under barRef/popoverRef — treat clicks inside the portal root as "in"
  // so they don't dismiss the popover before the selection lands.
  const portalRoot = usePortalRootOptional();

  createEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const path = event.composedPath();
      const inPortal = portalRoot !== undefined && path.includes(portalRoot);

      // Outside the bar entirely → close the popover and the add-menu (the open popover and its
      // Combobox dropdown are descendants of barRef, so they don't count as "outside").
      if (barRef && !path.includes(barRef) && !inPortal) {
        setOpenId(null);
        setAddMenuOpen(false);
        return;
      }

      // Inside the bar but outside the open popover → close it too, UNLESS the click landed on a
      // chip (its own onClick toggles/switches the popover) or in the portaled listbox. Lets a click
      // on empty bar space, the "Add filter" button, or another chip dismiss the current editor.
      if (openId() && popoverRef && !path.includes(popoverRef) && !inPortal) {
        const onChip = path.some(
          (el) => el instanceof Element && el.closest('[data-filter-id]') !== null,
        );
        if (!onChip) setOpenId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown, { capture: true }));
  });

  // Page-wide Ctrl/Cmd+Shift+F → open the Add-filter combobox (the SearchSelect autoFocuses).
  createEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
        event.preventDefault();
        event.stopPropagation();
        setOpenId(null);
        setAddMenuOpen(true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Notify the host when a filter's editor popover closes (set → null), so it can refocus the grid.
  let prevOpenId: string | null = null;
  createEffect(() => {
    const current = openId();
    if (prevOpenId !== null && current === null) props.onEditorClosed?.();
    prevOpenId = current;
  });

  const visible = () => props.filters().filter((f) => f.active || openId() === f.id);
  const offered = () => props.filters().filter((f) => !f.active && openId() !== f.id);
  const offeredOptions = (): SearchSelectOption[] => offered().map((f) => ({ value: f.id, label: f.label }));

  // Anchor the (single, keyed) editor popover under the chip that's open, rather than the bar's left
  // edge. The popover stays at the bar level so its Kobalte control survives the host's refetches
  // (a per-chip popover inside the <For> would remount on every refetch); we just shift its `left`.
  const [popoverLeft, setPopoverLeft] = createSignal(0);
  createEffect(() => {
    const id = openId();
    if (id === null || !barRef) return;
    const chip = barRef.querySelector<HTMLElement>(`[data-filter-id="${CSS.escape(id)}"]`);
    if (chip) setPopoverLeft(chip.offsetLeft);
  });

  function openFilter(id: string | null): void {
    if (id === null) return;
    setOpenId(id);
    setAddMenuOpen(false);
  }

  // Contained keyboard cycle (capture phase, so we own Tab before Kobalte/native handling):
  // Tab/Shift+Tab loop through the ring and wrap; Escape closes an open editor / add-menu first,
  // otherwise exits the bar (host returns focus to the grid). Tab is NOT intercepted while focus is
  // inside an open editor popover — there the user is editing values, so Tab/Kobalte behave normally.
  //
  // The ring spans `cycleScope` (the host toolbar) when provided — host-marked `[data-fb-cycle]`
  // members (e.g. the search input, display toggles) plus the Add-filter slot and the chips, in DOM
  // order — so the whole search bar is one keyboard loop. Falls back to the bar alone.
  createEffect(() => {
    const scope = props.cycleScope?.() ?? barRef;
    if (!scope) return;
    const activeEl = (): HTMLElement | null =>
      ((scope.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement | null);

    // Ring members in DOM order: host opt-ins + the Add-filter slot (collapsed button OR open
    // typeahead) + each chip. Focusing the open typeahead targets its inner combobox input.
    const ringEls = (): HTMLElement[] =>
      Array.from(
        scope.querySelectorAll<HTMLElement>('[data-fb-cycle], [data-fb-add], [data-fb-addbox], button[data-fb-chip]'),
      );
    const focusRing = (el: HTMLElement): void => {
      (el.matches('[data-fb-addbox]') ? el.querySelector<HTMLElement>('[role="combobox"]') : el)?.focus();
    };
    const focusChip = (id: string): void =>
      scope.querySelector<HTMLElement>(`button[data-fb-chip][data-filter-id="${CSS.escape(id)}"]`)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        const id = openId();
        if (id !== null) {
          event.preventDefault();
          event.stopPropagation();
          setOpenId(null);
          focusChip(id); // editor → its chip
          return;
        }
        if (addMenuOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setAddMenuOpen(false);
          queueMicrotask(() => scope.querySelector<HTMLElement>('[data-fb-add]')?.focus());
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        props.onExit?.();
        return;
      }

      if (event.key !== 'Tab') return;
      // Inside an open editor popover → let Tab/Kobalte handle it (value editing), don't cycle.
      if (popoverRef && (popoverRef === event.target || popoverRef.contains(event.target as Node))) return;

      const ring = ringEls();
      if (ring.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const active = activeEl();
      const idx = ring.findIndex((el) => el === active || el.contains(active));
      const next =
        idx === -1
          ? event.shiftKey
            ? ring.length - 1
            : 0
          : (idx + (event.shiftKey ? -1 : 1) + ring.length) % ring.length;
      // Leaving the open Add-filter typeahead → collapse it so it doesn't linger (the reported
      // Ctrl+Shift+F-then-Tab case). Selection-by-click is unaffected.
      if (addMenuOpen() && !ring[next].matches('[data-fb-addbox]')) setAddMenuOpen(false);
      focusRing(ring[next]);
    };

    scope.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => scope.removeEventListener('keydown', onKeyDown, true));
  });

  return (
    <div ref={barRef} class="relative flex flex-1 flex-wrap items-end gap-2 self-stretch">
      {/* Add filter — a typeahead combobox: type the filter name, Enter (or click) activates it,
          opening that filter's editor popover. Collapsed to a dashed pill until opened (click or the
          Ctrl/Cmd+Shift+F shortcut). */}
      <div class="relative">
        <Show
          when={addMenuOpen()}
          fallback={
            <button
              type="button"
              data-fb-add
              class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed border-border px-3 py-5 text-sm text-text-muted hover:border-primary hover:text-primary"
              onClick={() => setAddMenuOpen(true)}
            >
              ＋ {__('Add filter')}
            </button>
          }
        >
          <div class="w-56" data-fb-addbox>
            <SearchSelect
              options={offeredOptions()}
              value={null}
              onChange={openFilter}
              autoFocus
              ariaLabel={__('Add filter')}
              placeholder={
                offeredOptions().length === 0
                  ? __('All filters added')
                  : __('Filter name…')
              }
            />
          </div>
        </Show>
      </div>

      {/* Active (and just-opened) filters as chips. */}
      <For each={visible()}>
        {(f) => (
          <span
            data-filter-id={f.id}
            class={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm focus-within:ring-2 focus-within:ring-primary ${
              f.active
                ? 'border-blue-300 bg-blue-50 text-blue-900'
                : 'border-dashed border-border bg-surface text-text-muted'
            }`}
          >
            <button
              type="button"
              data-fb-chip
              data-filter-id={f.id}
              class="flex cursor-pointer flex-col items-start leading-tight focus:outline-none"
              onClick={() => setOpenId(openId() === f.id ? null : f.id)}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  if (openId() === f.id) setOpenId(null);
                  f.clear();
                  queueMicrotask(() => barRef?.querySelector<HTMLElement>('[data-fb-add]')?.focus());
                }
              }}
            >
              <span class="text-2xs font-semibold uppercase tracking-wide opacity-70">{f.label}</span>
              <span class="inline-flex items-center gap-1">
                <Show when={f.summary} fallback={<span class="italic">{__('set…')}</span>}>
                  <span>{f.summary}</span>
                </Show>
                <span class="opacity-60">▾</span>
              </span>
            </button>
            <button
              type="button"
              tabindex={-1}
              class="-mr-1.5 flex cursor-pointer items-center self-stretch rounded px-2 text-base leading-none hover:bg-blue-200"
              aria-label={`${__('Remove filter')}: ${f.label}`}
              onClick={() => {
                f.clear();
                if (openId() === f.id) setOpenId(null);
              }}
            >
              ×
            </button>
          </span>
        )}
      </For>

      {/* Single editor popover for the open filter. Keyed on the id + untracked lookup → the
          control mounts once and persists across the host's refetches. */}
      <Show when={openId()} keyed>
        {(id) => {
          const f = untrack(() => props.filters().find((d) => d.id === id));
          if (!f) return null;
          const Ctl = filterControlRegistry.resolve(f.type);
          return (
            <div
              ref={popoverRef}
              class="absolute top-full z-40 mt-1 min-w-64 rounded border border-border bg-surface p-3 shadow-xl"
              style={{ left: `${popoverLeft()}px` }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpenId(null);
              }}
            >
              {/* Title row: label left, the filter's set-operation modifier (e.g. the
                  any/all/none or in/not-in toggle) right-aligned here so it stays visible above the
                  control's dropdown instead of being covered by it. */}
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase text-text-muted">{f.label}</div>
                <Show when={f.extra}>{f.extra!()}</Show>
              </div>
              <Show when={Ctl}>
                {(C) => (
                  <Dynamic
                    component={C()}
                    value={f.value()}
                    options={f.options()}
                    placeholder={f.placeholder}
                    autoFocus
                    onChange={f.onChange}
                    onClose={() => setOpenId(null)}
                    loadOptions={f.loadOptions}
                    minQueryLength={f.minQueryLength}
                    debounceMs={f.debounceMs}
                    selectedOptions={f.selectedOptions?.()}
                  />
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
