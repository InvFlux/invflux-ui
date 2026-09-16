import { createMemo, createSignal, For, Show } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import { Button } from './Button';
import { buttonClass } from './primitives';
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu';
import { Input } from './Input';
import { PaletteSwatchPicker } from './PaletteSwatchPicker';
import { paletteInk, paletteStyle } from './tagPalette';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';
import type { FilterConstraint, FilterDescriptor } from './filters';
import {
  describeSavedQuery,
  queryContains,
  queryMatches,
  resolveSavedQuery,
  type ExtraDescriber,
  type SavedFilter,
  type SavedFilterQuery,
} from './api/savedFilters';

/**
 * Saved filters on a grid's toolbar — the pinned ones as buttons, the rest behind a menu.
 *
 * SPA-agnostic: a surface supplies its live query, its filter descriptors and a way to apply a
 * query, and gets the whole affordance. Nothing here knows what a workflow state or a product type
 * is.
 *
 * **The copy says "shared", and that is not decoration.** At Essentials a saved filter is
 * install-wide: pinning one changes the toolbar every other operator sees, and deleting one takes
 * it away from them. Labelling these "your filters" would be a plain lie, and the seam where that
 * stops being true — per-role and per-user scopes — is the paid tier's, not something to imply
 * here.
 *
 * A caller who may read but not write gets the list and the pinned buttons, and no write
 * affordances at all: the server answers `canManage` on the same check its write routes gate on,
 * so what is offered and what is permitted cannot drift.
 */
export interface SavedFilterControlProps {
  /** The saved filters of this surface, in the server's order — pinned first. */
  savedFilters: () => SavedFilter[];
  /** Whether this caller may create, pin or delete. */
  canManage: () => boolean;
  /** The live filter state, as this surface would put it on the URL. */
  currentQuery: () => SavedFilterQuery;
  /** This surface's filter descriptors — what makes a defaulted filter explicit at save time. */
  filters: () => FilterDescriptor[];
  /** Replace the surface's filter state with a saved query — the menu's "go to this view". */
  onApply: (query: SavedFilterQuery) => void;
  /**
   * Add or remove exactly these parameters, leaving the rest of the filter state alone — what a
   * pinned view's button does. A pinned view stands where an ad-hoc toggle button did, so it
   * toggles: applying it must not discard a search the operator has already typed, and releasing it
   * must not clear the rest of the queue's filters along with its own.
   */
  onToggle: (query: SavedFilterQuery, on: boolean) => void;
  onCreate: (name: string, query: SavedFilterQuery, colorId: number) => Promise<unknown>;
  onSetPinned: (filter: SavedFilter, pinned: boolean) => Promise<unknown>;
  /** Recolour a view. Identity only — a colour never says whether the view is in effect. */
  onSetColor: (filter: SavedFilter, colorId: number) => Promise<unknown>;
  onDelete: (filter: SavedFilter) => Promise<unknown>;
  /**
   * Filter parameters this surface owns from outside the bar — the search box, typically.
   *
   * Without them a stored `search` would be described as a parameter nothing can account for,
   * which is the loud rendering reserved for a clause this install genuinely cannot resolve.
   */
  describeExtra?: () => ExtraDescriber[];
  /** A save/pin/delete that failed, for the host to surface however it surfaces errors. */
  onError?: (message: string) => void;
}

export function SavedFilterControl(props: SavedFilterControlProps) {
  const [savingOpen, setSavingOpen] = createSignal(false);
  const [managingOpen, setManagingOpen] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  const [draftColor, setDraftColor] = createSignal(0);
  /** Which row's colour picker is open in the manage dialog — one at a time, or none. */
  const [recolouring, setRecolouring] = createSignal<number | null>(null);
  const [busy, setBusy] = createSignal(false);

  const pinned = createMemo(() => props.savedFilters().filter((f) => f.pinned));

  /**
   * What saving would store: the live URL state plus every filter still sitting at its default,
   * spelled out. Computed at save time rather than held, so it reflects the view as it is when the
   * operator commits to it.
   *
   * Declared before {@link exact}, which reads it: a `createMemo` body runs eagerly at setup, so
   * the two cannot be written in the other order.
   */
  const resolved = (): SavedFilterQuery => resolveSavedQuery(props.currentQuery(), props.filters());

  /**
   * Whether a given view's constraints are currently **in effect** — containment, not equality.
   *
   * A pinned view is a toggle for its own parameters and says nothing about the rest of the URL, so
   * narrowing further (typing a customer name into the search box) must not switch it off: the
   * operator has not stopped looking at unsettled refunds because they also searched.
   *
   * Compared against the **resolved** query, not the raw URL. A stored view spells out the filters
   * that were merely defaulted when it was saved, so a reader sitting on those same defaults has a
   * bare URL that shares no parameter with it — and would be told they are not looking at the rows
   * in front of them. That a value arrived by default rather than by a click is the *filter
   * control's* distinction to draw; this one is about the result set.
   */
  const isOn = (filter: SavedFilter): boolean => queryContains(resolved(), filter.query);

  /** The view the reader is looking at *exactly* — what the menu's "go to this view" marks. */
  const exact = createMemo(() => {
    const current = resolved();

    return props.savedFilters().find((f) => queryMatches(f.query, current));
  });

  /**
   * Await a write, reporting failure to the host rather than throwing into an event handler.
   *
   * Takes the promise, not a thunk: the call is made in the handler where its reactive reads
   * belong, and every affordance that reaches here is already `disabled={busy()}`, so nothing is
   * gained by re-checking that inside.
   */
  async function guard(work: Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await work;

      return true;
    } catch (error) {
      props.onError?.(error instanceof Error ? error.message : __('That did not work.'));

      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    const name = draftName().trim();
    if (name === '' || busy()) return;
    if (await guard(props.onCreate(name, resolved(), draftColor()))) {
      setDraftName('');
      setDraftColor(0);
      setSavingOpen(false);
    }
  }

  /**
   * What a stored view constrains, in words — read from the filters themselves, never a lookup
   * table here.
   */
  const constraints = (filter: SavedFilter): FilterConstraint[] =>
    describeSavedQuery(filter.query, props.filters(), props.describeExtra?.() ?? []);

  /** The same lines joined, for the places with room for a sentence rather than a list. */
  const describeInline = (filter: SavedFilter): string => {
    const lines = constraints(filter);
    if (lines.length === 0) {
      // A view that constrains nothing is a real thing to save — "everything, unfiltered" is a
      // view — so it says so rather than rendering blank, which reads as a description that failed
      // to load.
      return __('No constraints — every row');
    }

    return lines
      .map((line) =>
        sprintf(
          /* translators: 1: filter name, 2: what it constrains to */
          line.unresolved !== undefined ? __('%1$s: %2$s (unavailable)') : __('%1$s: %2$s'),
          line.label,
          line.value,
        ),
      )
      .join(' · ');
  };

  const menuItems = createMemo<DropdownMenuItem[]>(() => {
    const items: DropdownMenuItem[] = props.savedFilters().map((filter) => ({
      id: `apply-${filter.id}`,
      // A leading mark rather than a colour, so "the one you are looking at" survives a
      // colour-blind reader and a monochrome screenshot.
      label: `${exact()?.id === filter.id ? '• ' : '  '}${filter.name}`,
      // What it will do, before it is applied. A name is a promise; this is the statement that
      // can be checked against it.
      description: describeInline(filter),
      run: () => props.onApply(filter.query),
    }));

    if (items.length === 0) {
      items.push({
        id: 'empty',
        label: __('No saved views yet'),
        disabled: true,
      });
    }

    if (props.canManage()) {
      items.push({
        id: 'save',
        label: __('Save this view…'),
        separatorBefore: true,
        run: () => {
          setDraftName('');
          setDraftColor(0);
          setSavingOpen(true);
        },
      });
      if (props.savedFilters().length > 0) {
        items.push({
          id: 'manage',
          label: __('Manage saved views…'),
          run: () => setManagingOpen(true),
        });
      }
    }

    return items;
  });

  return (
    <>
      {/* Pinned filters render where an ad-hoc toolbar button would have. */}
      <For each={pinned()}>
        {(filter) => (
          <button
            type="button"
            data-saved-filter-id={filter.id}
            data-saved-filter-applied={isOn(filter) ? 'true' : 'false'}
            aria-pressed={isOn(filter) ? 'true' : 'false'}
            // A pinned view is a name on a button with no room to say more, which is the shape §0
            // failed in: the old refund button said "unsettled manual refund" and meant "…that is
            // also still active". Hovering says what it actually constrains.
            title={describeInline(filter)}
            // State is the SHAPE, identity is the colour. Off draws as a dashed outline in the
            // view's ink; on fills with its palette pair and drops the outline. A reader who cannot
            // separate the hues still sees which views are in effect — and a spec can assert it
            // without a style selector, off `data-saved-filter-applied`.
            class={`inline-flex h-9 cursor-pointer items-center self-end rounded-md border px-3 text-sm transition ${
              isOn(filter) ? 'border-transparent' : 'border-dashed opacity-80 hover:opacity-100'
            }`}
            style={
              isOn(filter)
                ? paletteStyle(filter.colorId)
                : { 'border-color': paletteInk(filter.colorId), color: paletteInk(filter.colorId) }
            }
            onClick={() => props.onToggle(filter.query, !isOn(filter))}
          >
            {filter.name}
          </button>
        )}
      </For>

      <DropdownMenu
        items={menuItems()}
        ariaLabel={__('Saved views')}
        triggerClass={buttonClass('secondary', 'sm', 'h-9 self-end')}
        trigger={
          <span>
            {__('Saved views')}
            <span class="ml-1 opacity-60">▾</span>
          </span>
        }
      />

      <Show when={savingOpen()}>
        <Modal onClose={() => setSavingOpen(false)} label={__('Save this view')}>
          <ModalPanel size="sm">
            <ModalHeader title={__('Save this view')} />
            <div class="p-4">
              {/* The honest consequence of an install-wide scope, said before the operator commits
                rather than discovered when a colleague asks who changed their toolbar. */}
              <p class="mb-3 text-sm text-text-muted">
                {__('Saved views are shared with everyone who works this screen.')}
              </p>

              <label class="block text-sm" for="invflux-saved-filter-name">
                {__('Name')}
              </label>
              <Input
                id="invflux-saved-filter-name"
                class="mt-1 w-full"
                value={draftName()}
                autofocus
                onInput={(e) => setDraftName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
              />

              <div class="mt-3">
                <span class="block text-sm">{__('Colour')}</span>
                <div class="mt-1">
                  <PaletteSwatchPicker
                    value={draftColor()}
                    onPick={setDraftColor}
                    ariaLabel={__('Colour for this saved view')}
                  />
                </div>
              </div>

              <p class="mt-3 text-xs text-text-muted">
                {sprintf(
                  /* translators: %s: number of filter settings the saved view will record */
                  _n(
                    'Records %s filter setting, including the ones currently left at their default.',
                    'Records %s filter settings, including the ones currently left at their default.',
                    Object.keys(resolved()).length,
                  ),
                  String(Object.keys(resolved()).length),
                )}
              </p>
            </div>
            <ModalFooter>
              <Button variant="secondary" size="sm" onClick={() => setSavingOpen(false)}>
                {__('Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={draftName().trim() === '' || busy()}
                onClick={() => void save()}
              >
                {__('Save view')}
              </Button>
            </ModalFooter>
          </ModalPanel>
        </Modal>
      </Show>

      <Show when={managingOpen()}>
        <Modal onClose={() => setManagingOpen(false)} label={__('Manage saved views')}>
          <ModalPanel size="lg">
            <ModalHeader
              title={__('Manage saved views')}
              actions={
                // The only dismissal control. A footer "Done" button restated what a click on the
                // backdrop and Escape already do, and sat below a scrolling list where it was the
                // furthest thing from the reader's attention.
                <button
                  type="button"
                  class="shrink-0 cursor-pointer rounded px-2 py-1 text-base leading-none text-text-muted hover:bg-surface-raised"
                  aria-label={__('Close')}
                  onClick={() => setManagingOpen(false)}
                >
                  ✕
                </button>
              }
            />
            <div class="p-4">
              <p class="mb-3 text-sm text-text-muted">
                {__('These are shared. Pinning or deleting one changes it for everyone.')}
              </p>

              <ul class="max-h-80 divide-y divide-border overflow-y-auto">
                <For each={props.savedFilters()}>
                  {(filter) => (
                    <li class="flex flex-col gap-2 py-2" data-saved-filter-row={filter.id}>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="inline-block h-4 w-4 shrink-0 rounded-full border border-current"
                          // The palette pair, exactly as the picker draws it: the entry's background
                          // filled, its foreground as the ring. `paletteStyle` sets `color` to the
                          // foreground, so `border-current` picks it up without naming the variable
                          // twice.
                          style={paletteStyle(filter.colorId)}
                          aria-label={sprintf(
                            /* translators: %s: the saved view's name */
                            __('Change the colour of %s'),
                            filter.name,
                          )}
                          aria-expanded={recolouring() === filter.id ? 'true' : 'false'}
                          onClick={() =>
                            setRecolouring((open) => (open === filter.id ? null : filter.id))
                          }
                        />
                        <span class="grow truncate text-sm">{filter.name}</span>
                        <Show when={filter.seeded}>
                          <span class="rounded bg-surface-raised px-1.5 py-0.5 text-2xs uppercase tracking-wide text-text-muted">
                            {/* This badge says the view came with the plugin. It renders on the
                            dispatch queue too, where a word like "Shipped" would read as an order
                            state, so the English avoids every order-state term. */}
                            {_x(
                              'Built-in',
                              'saved view: provisioned by the plugin, not authored here',
                            )}
                          </span>
                        </Show>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy()}
                          aria-pressed={filter.pinned ? 'true' : 'false'}
                          onClick={() => void guard(props.onSetPinned(filter, !filter.pinned))}
                        >
                          {/* Context-bearing, because the unified app already spends a
                          `_x('Pin', 'tab: …')` on pinning a *surface* as a tab. A bare key here
                          would sit beside it with nothing to tell a translator them apart. */}
                          {filter.pinned
                            ? _x('Unpin', 'saved view: remove this view from the toolbar')
                            : _x('Pin', 'saved view: pin this view to the toolbar')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy()}
                          onClick={() => void guard(props.onDelete(filter))}
                        >
                          {__('Delete')}
                        </Button>
                      </div>

                      {/* The picker is this row's second line, so it opens directly under the swatch
                        that summoned it. Rendered once at the foot of the list it drifted further
                        from its trigger with every saved view, which on a long list put the choice
                        somewhere the operator had to go looking for. */}
                      {/* The constraints as a list, where the row has width for one. Deleting a view
                        is irreversible and a name alone is a poor basis for that decision — this is
                        what the reader checks the name against. */}
                      <ul class="flex flex-wrap gap-x-2 gap-y-1 pl-6 text-2xs text-text-muted">
                        <For
                          each={constraints(filter)}
                          fallback={<li>{__('No constraints — every row')}</li>}
                        >
                          {(line) => (
                            <li
                              data-saved-filter-constraint={line.id}
                              data-unresolved={line.unresolved !== undefined ? 'true' : undefined}
                              // Unresolvable reads as a warning, never as absence: a clause this
                              // install can no longer answer is why the view returns rows the name
                              // does not promise.
                              class={line.unresolved !== undefined ? 'text-warning' : undefined}
                            >
                              <span class="font-medium">{line.label}</span>
                              {': '}
                              {line.value}
                              <Show when={line.unresolved}>
                                {' '}
                                <span>{__('(unavailable)')}</span>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>

                      <Show when={recolouring() === filter.id}>
                        <div class="rounded border border-border p-2">
                          <span class="block text-xs text-text-muted">
                            {sprintf(
                              /* translators: %s: the saved view's name */
                              __('Colour for %s'),
                              filter.name,
                            )}
                          </span>
                          <div class="mt-1">
                            <PaletteSwatchPicker
                              value={filter.colorId}
                              onPick={(colorId) => {
                                setRecolouring(null);
                                void guard(props.onSetColor(filter, colorId));
                              }}
                              ariaLabel={__('Colour for this saved view')}
                            />
                          </div>
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </ModalPanel>
        </Modal>
      </Show>
    </>
  );
}
