import { __ } from '@invflux/i18n';
import { Button } from '../Button';
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import type { SearchSelectOption } from '../SearchSelect';
import { SearchSelectAsync } from '../SearchSelectAsync';
import type { DrilldownProps } from './registry';
import { drilldownRegistry } from './registry';
import { iconButtonClass } from '../primitives';
import { ErrorBanner } from '../ErrorBanner';
import { createSearchFailure } from '../searchFailure';

/**
 * Built-in per-cell drill-down components (§11.7), keyed by datatype slug and registered into
 * drilldownRegistry on import. Each receives the `detail` payload returned by the column's
 * server-side drill-down handler.
 */

interface StockSlot {
  loc: string;
  stt: string;
  qty: number;
}
interface StockBreakdown {
  subject_id: number;
  total: number;
  slots: StockSlot[];
}

function isStockBreakdown(detail: unknown): detail is StockBreakdown {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    Array.isArray((detail as { slots?: unknown }).slots)
  );
}

/** Human label for a known state (`stt`) code; unknown codes show verbatim. */
function stateLabel(stt: string): string {
  switch (stt) {
    case 'atp':
      return __('Available (ATP)');
    case 'res':
      return __('Reserved');
    case 'ctd':
      return __('Committed');
    default:
      return stt;
  }
}

/**
 * Stock breakdown for the `number:stock` datatype (the `atp` column): the per-slot
 * (location × state) split that sums to the cell's on-hand total. Forward-shaped — a single
 * location collapses to a per-state list; multiple locations group naturally once they exist.
 */
function StockBreakdownDrilldown(props: DrilldownProps) {
  const data = (): StockBreakdown | null => (isStockBreakdown(props.detail) ? props.detail : null);

  return (
    <div class="min-w-80">
      <Show
        when={data() && data()!.slots.length > 0}
        fallback={<p class="text-sm text-text-muted">{__('No stock on hand.')}</p>}
      >
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-text-muted">
            <tr>
              <th class="px-2 py-1 text-left">{__('Location')}</th>
              <th class="px-2 py-1 text-left">{__('State')}</th>
              <th class="px-2 py-1 text-right">{__('Qty')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={data()!.slots}>
              {(slot) => (
                <tr class="border-t border-border">
                  <td class="px-2 py-1">{slot.loc || '—'}</td>
                  <td class="px-2 py-1">{stateLabel(slot.stt)}</td>
                  <td class="px-2 py-1 text-right tabular-nums">{slot.qty}</td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-border font-semibold">
              <td class="px-2 py-1" colspan="2">
                {__('Total')}
              </td>
              <td class="px-2 py-1 text-right tabular-nums">{data()!.total}</td>
            </tr>
          </tfoot>
        </table>
      </Show>
    </div>
  );
}

drilldownRegistry.register('number:stock', 'core.stock-breakdown', StockBreakdownDrilldown, {
  default: true,
});

interface Constituent {
  post_id: number;
  name: string;
  sku: string;
  /** 'variation' (of a variable product) | 'child' (of a grouped product). */
  kind: string;
}
interface ConstituentsDetail {
  subject_id: number;
  parent_type: string;
  constituents: Constituent[];
}

function isConstituentsDetail(detail: unknown): detail is ConstituentsDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    Array.isArray((detail as { constituents?: unknown }).constituents)
  );
}

/**
 * Constituent products for the `text:product-type` datatype (the Type column): the variations of a
 * variable product, or the child products of a grouped one — a non-destructive peek that doesn't
 * shift grid rows the way inline fold does. Simple products have none → empty state.
 *
 * **Editable for grouped products** when the host wires a `save` callback: a grouped product's
 * members are a plain ordered id list (no pivot data), so add (via the product picker) / remove /
 * reorder map straight onto `WC_Product_Grouped::set_children()` — no stock side effects. Variable
 * (variations) + external stay read-only. The degraded shape here is the seed for the richer
 * kit/bundle BOM drill-down (qty + version) later.
 */
function ConstituentsDrilldown(props: DrilldownProps) {
  const data = (): ConstituentsDetail | null =>
    isConstituentsDetail(props.detail) ? props.detail : null;
  const kindLabel = (kind: string): string =>
    kind === 'variation' ? __('Variation') : __('Product');

  // Editable iff the host wired a save callback AND this is a grouped product.
  const editable = (): boolean => props.save !== undefined && data()?.parent_type === 'grouped';

  // Working copy of the member list, refreshed from the server detail on load and after each save.
  const [members, setMembers] = createSignal<Constituent[]>([]);

  const dirty = createMemo(() => {
    const orig = (data()?.constituents ?? []).map((c) => c.post_id).join(',');
    return (
      orig !==
      members()
        .map((c) => c.post_id)
        .join(',')
    );
  });

  // …but never on top of unsaved edits. Any refetch — a window-focus revalidation, an invalidation
  // triggered from somewhere else in the app — re-runs this, and without a guard it would silently
  // replace a reordering the user had not saved yet with the server's order. Reordering is slow,
  // deliberate work; losing it invisibly is the worst way to lose it.
  //
  // The guard is `edited`, set by the add/remove/reorder handlers, and NOT `dirty`. They read the
  // same on a populated list and opposite on an empty one: before the first load `members` is `[]`
  // while the server has members, so `dirty` is already true and a `dirty` guard blocks the very
  // population it is meant to protect — every list renders as "no constituents". Only the user
  // touching the list means "do not overwrite"; a difference from the server does not.
  //
  // Read through `untrack` so this effect depends on the server data alone.
  const [edited, setEdited] = createSignal(false);

  createEffect(() => {
    const d = data();
    if (untrack(edited)) return;
    setMembers(d ? d.constituents.map((c) => ({ ...c })) : []);
  });

  const [options, setOptions] = createSignal<SearchSelectOption[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const searchFailed = createSearchFailure();

  let searchSeq = 0;
  const onSearch = async (text: string): Promise<void> => {
    const q = text.trim();
    if (!props.searchOptions || q === '') {
      setOptions([]);
      searchFailed.clear();
      return;
    }
    const seq = ++searchSeq;
    setSearching(true);
    try {
      const res = await props.searchOptions(q);
      if (seq === searchSeq) {
        setOptions(res);
        searchFailed.clear();
      }
    } catch (e: unknown) {
      // Previously uncaught. The caller invokes this as `void onSearch(t)`, so a rejection became
      // an unhandled promise rejection AND skipped `setOptions` — leaving the PREVIOUS query's
      // results on screen under the new text. Showing stale matches as if they answered what was
      // just typed is worse than showing none.
      if (seq === searchSeq) {
        setOptions([]);
        searchFailed.record(e);
      }
    } finally {
      if (seq === searchSeq) setSearching(false);
    }
  };

  const addMember = (opt: SearchSelectOption | null): void => {
    if (!opt) return;
    const id = Number(opt.value);
    if (!Number.isFinite(id) || id <= 0 || members().some((m) => m.post_id === id)) return;
    setMembers([...members(), { post_id: id, name: opt.label, sku: '', kind: 'child' }]);
    setEdited(true);
    setOptions([]);
  };

  const removeMember = (id: number): void => {
    setMembers(members().filter((m) => m.post_id !== id));
    setEdited(true);
  };

  // Drag-to-reorder — same native-DnD mechanism as the column-picker Reorder tab (drop indicator
  // renders above the target row, so a drop inserts the dragged member immediately before it).
  const [draggingId, setDraggingId] = createSignal<number | null>(null);
  const [dropTargetId, setDropTargetId] = createSignal<number | null>(null);

  const reorder = (sourceId: number, targetId: number): void => {
    if (sourceId === targetId) return;
    const src = members().find((m) => m.post_id === sourceId);
    if (!src) return;
    const list = members().filter((m) => m.post_id !== sourceId);
    const targetIdx = list.findIndex((m) => m.post_id === targetId);
    if (targetIdx < 0) return;
    list.splice(targetIdx, 0, src);
    setMembers(list);
    setEdited(true);
  };

  const onSave = async (): Promise<void> => {
    if (!props.save || !dirty() || saving()) return;
    setSaving(true);
    setError(null);
    try {
      // Host persists then refreshes props.detail → the effect resets `members` to the saved list.
      await props.save({ child_ids: members().map((m) => m.post_id) });
      // The edits are now the server's state, so stop guarding against being overwritten by it —
      // otherwise the first edit of a session freezes the working copy for good.
      setEdited(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="min-w-80 space-y-3">
      <Show
        when={members().length > 0}
        fallback={<p class="text-sm text-text-muted">{__('No constituent products.')}</p>}
      >
        <Show
          when={editable()}
          fallback={
            <table class="w-full text-sm">
              <thead class="text-xs uppercase text-text-muted">
                <tr>
                  <th class="px-2 py-1 text-left">{__('Name')}</th>
                  <th class="px-2 py-1 text-left">{__('SKU')}</th>
                  <th class="px-2 py-1 text-left">{__('Kind')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={members()}>
                  {(c) => (
                    <tr class="border-t border-border">
                      <td class="px-2 py-1">{c.name || `#${c.post_id}`}</td>
                      <td class="px-2 py-1 tabular-nums">{c.sku || '—'}</td>
                      <td class="px-2 py-1">{kindLabel(c.kind)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          }
        >
          {/* Drag-to-reorder list — mirrors the column-picker Reorder tab. */}
          <ul class="space-y-1">
            <For each={members()}>
              {(c) => (
                <>
                  <Show when={dropTargetId() === c.post_id && draggingId() !== c.post_id}>
                    <li class="h-0.5 rounded bg-primary" aria-hidden="true" />
                  </Show>
                  <li
                    class="flex cursor-move items-center gap-2 rounded border border-border px-2 py-1 text-sm hover:bg-gray-100"
                    classList={{ 'opacity-50': draggingId() === c.post_id }}
                    draggable="true"
                    onDragStart={(event) => {
                      setDraggingId(c.post_id);
                      event.dataTransfer?.setData('text/plain', String(c.post_id));
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                      setDropTargetId(c.post_id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId =
                        draggingId() ?? Number(event.dataTransfer?.getData('text/plain'));
                      if (sourceId && sourceId !== c.post_id) reorder(sourceId, c.post_id);
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                  >
                    <span class="w-4 select-none text-text-muted" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span class="min-w-0 flex-1 truncate">{c.name || `#${c.post_id}`}</span>
                    <span class="tabular-nums text-text-muted">{c.sku || '—'}</span>
                    <button
                      type="button"
                      class={iconButtonClass('xs', true, 'w-auto px-1')}
                      aria-label={__('Remove member')}
                      onClick={() => removeMember(c.post_id)}
                    >
                      ✕
                    </button>
                  </li>
                </>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={editable()}>
        <div class="space-y-2">
          <Show when={props.searchOptions}>
            <SearchSelectAsync
              options={options()}
              value={null}
              onChange={addMember}
              onSearch={(t) => void onSearch(t)}
              loading={searching()}
              placeholder={__('Search products to add…')}
              emptyMessage={searchFailed.line() ?? __('Type to search products')}
              ariaLabel={__('Add a member product')}
              autoFocusFirst
              highlight
            />
          </Show>
          <Show when={error()}>
            <ErrorBanner class="text-sm">{error()}</ErrorBanner>
          </Show>
          <div class="flex justify-end">
            <Button disabled={!dirty() || saving()} onClick={() => void onSave()}>
              {saving() ? __('Saving…') : __('Save members')}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}

drilldownRegistry.register('text:product-type', 'core.constituents', ConstituentsDrilldown, {
  default: true,
});
