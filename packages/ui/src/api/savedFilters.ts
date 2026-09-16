import type { InvFluxApi } from './client';
import { ns, path } from './client';
import type { FilterConstraint, FilterDescriptor } from '../filters';
import { describeConstraint } from '../filters';

/**
 * Saved filters — named, complete filter sets for one grid.
 *
 * SPA-agnostic and built once, against the one shape every surface already round-trips: a URL
 * parameter map. Dispatch joins with commas, the workbench repeats `id[]`, procurement has its own
 * catalogue — but all three put their state on the URL, so that is what a saved filter stores.
 *
 * Under `api/` rather than in the package barrel because a surface's query layer imports it, and
 * the barrel pulls the whole component tree in behind it — the same reason the REST client lives
 * here. The one dependency on a component-side type (`FilterDescriptor`) is a `import type`, which
 * erases.
 */

/** A saved filter as the server returns it. */
export interface SavedFilter {
  id: number;
  name: string;
  /** The resolved query — every parameter the view depends on, defaults included. */
  query: SavedFilterQuery;
  /** Rendered on the surface's toolbar, where an ad-hoc button would have been. */
  pinned: boolean;
  /** Ordering among a surface's pinned filters. */
  position: number;
  /** Index into the shared chip palette — the view's identity on the toolbar, never its state. */
  colorId: number;
  /** Provisioned by the plugin rather than authored here. */
  seeded: boolean;
}

/** The stored query: what a URL can carry, and nothing else. */
export type SavedFilterQuery = Record<string, string | string[]>;

/**
 * A surface's saved filters, plus whether this caller may change them.
 *
 * The permission rides with the list because it is a property of *this caller on this surface*, not
 * of the session: an operator may work the dispatch queue without being allowed to edit the shared
 * chrome every other operator sees.
 */
export interface SavedFilterIndex {
  savedFilters: SavedFilter[];
  canManage: boolean;
}

/** What a saved filter can be created or updated with. */
export interface SavedFilterInput {
  name?: string;
  query?: SavedFilterQuery;
  pinned?: boolean;
  position?: number;
  colorId?: number;
}

/**
 * Resolve the live filter state into the explicit query a saved filter stores.
 *
 * This is the whole difference between a saved filter and a bookmark, and it is one rule:
 * **a stored set carries every value it depends on, including the ones that merely equal today's
 * default.** A live URL may leave a defaulted filter out — that absence means "whatever the default
 * is", which is exactly what must not be preserved. Stored that way, the view silently re-aims the
 * day the default moves, and nothing about it looks wrong.
 *
 * So: start from what the URL already says, then ask every filter still sitting at its default to
 * spell out what it is currently constraining. Only the filter knows its own encoding, so it is
 * asked rather than guessed at.
 *
 * A deliberate filter is left alone — the URL already carries it, and re-deriving it here would let
 * a rounding difference between two encoders change what was saved.
 */
export function resolveSavedQuery(
  current: SavedFilterQuery,
  filters: readonly FilterDescriptor[],
): SavedFilterQuery {
  const resolved: SavedFilterQuery = { ...current };

  for (const filter of filters) {
    if (filter.isDefault?.() !== true) continue;

    const params = filter.params?.();
    if (params === undefined) continue;

    for (const [key, value] of Object.entries(params)) {
      // The URL wins where the two disagree: it is the state actually in effect, and a filter that
      // reports a default while the URL carries a value is describing something already explicit.
      if (key in resolved) continue;
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Read a stored query back into words — what this view will do, before anyone applies it.
 *
 * A name is a promise; the constituents are the statement that can be checked against it. Rendering
 * them is how "Pending manual refunds" stops being able to quietly mean something narrower than it
 * says, which is §0 restated as a UI obligation.
 *
 * Each filter describes its own parameters ({@link FilterDescriptor.describe}, defaulting to its
 * option labels) — never a lookup table here, or an add-on's filter renders as raw JSON. A
 * parameter no filter claims still earns a line, marked unclaimed rather than dropped: a view
 * carrying a key this install no longer understands is doing *something*, and hiding that is the
 * silent-drop failure one layer up.
 */
export function describeSavedQuery(
  query: SavedFilterQuery,
  filters: readonly FilterDescriptor[],
  extra: readonly ExtraDescriber[] = [],
): FilterConstraint[] {
  const lines: FilterConstraint[] = [];
  const claimed = new Set<string>();

  for (const describer of extra) {
    for (const key of describer.keys) claimed.add(key);
    if (!describer.keys.some((key) => key in query)) continue;
    const line = describer.describe(query);
    if (line !== null) lines.push(line);
  }

  for (const filter of filters) {
    const keys = filter.paramKeys;
    if (keys === undefined || keys.length === 0) continue;
    for (const key of keys) claimed.add(key);
    if (!keys.some((key) => key in query)) continue;

    const line =
      filter.describe !== undefined
        ? filter.describe(query)
        : describeConstraint(
            { id: filter.id, label: filter.label, options: filter.options() },
            splitParam(query[keys[0]]),
          );
    if (line !== null) lines.push(line);
  }

  for (const [key, value] of Object.entries(query)) {
    if (claimed.has(key)) continue;
    const values = splitParam(value);
    lines.push({
      id: key,
      label: key,
      value: values.join(', '),
      // Unclaimed is a kind of unresolved: nothing on this surface can say what it constrains, so
      // the reader is told the view carries it rather than shown a set it cannot account for.
      unresolved: values.length > 0 ? values : [key],
    });
  }

  return lines;
}

/**
 * A filter parameter a surface owns from outside the filter bar.
 *
 * The dispatch queue's search box is the case this exists for: `search` is filter state — a view of
 * one customer's orders is a legitimate thing to save — but it is a text input in the toolbar, not
 * a chip, so no {@link FilterDescriptor} claims it. Without this it would be described as an
 * unclaimed parameter, which is the loud rendering reserved for something the install genuinely
 * cannot account for.
 */
export interface ExtraDescriber {
  keys: string[];
  describe: (query: SavedFilterQuery) => FilterConstraint | null;
}

/** A stored parameter as a value list, in the encoding every simple filter uses. */
function splitParam(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.filter((v) => v !== '');

  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * Whether a saved view's constraints are **in effect** — every parameter it declares present in the
 * current query with the same value.
 *
 * Containment, not equality, because a pinned view is a toggle for its own constraints and not a
 * claim about everything else on the URL. An operator who applies "Pending manual refunds" and then
 * types a customer name into the search box has not stopped looking at unsettled refunds; under
 * equality the view would blink off the moment they narrowed it, which reads as the toggle having
 * silently released.
 *
 * Values still have to match. A view asking for `workflow_state=Active,Closed` is *not* in effect
 * on a queue showing `workflow_state=Closed` — the key is there but the constraint is not, and
 * keying off presence alone is how a control ends up claiming a cut it is not showing.
 */
export function queryContains(current: SavedFilterQuery, view: SavedFilterQuery): boolean {
  return Object.keys(view).every((key) => valueEquals(current[key], view[key]));
}

/**
 * Whether two queries describe exactly the same view — every parameter, both ways.
 *
 * Distinct from {@link queryContains}: this answers "is the reader looking at precisely this",
 * which is what a menu entry meaning *go to this view* compares against.
 *
 * Compared as parameter maps rather than as URL strings: `?a=1&b=2` and `?b=2&a=1` are the same
 * view, and a comparison that said otherwise would mark the filter the reader is *currently looking
 * at* as not applied.
 */
export function queryMatches(a: SavedFilterQuery, b: SavedFilterQuery): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;

  return keys.every((key) => valueEquals(a[key], b[key]));
}

/**
 * Compare one parameter's value.
 *
 * Shape before contents: `?id[]=7` and `?id=7` are different requests, and a surface reading one
 * cannot read the other. Normalising a scalar into a one-element list here would report a filter as
 * applied while the reader is looking at something else.
 */
function valueEquals(
  left: string | string[] | undefined,
  right: string | string[] | undefined,
): boolean {
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => v === right[i]);
  }

  return left === right;
}

/**
 * The saved filters of one surface, ordered as the server returns them — pinned first, in toolbar
 * order. The order is the server's to decide, so nothing here re-sorts it.
 */
export async function fetchSavedFilters(
  api: InvFluxApi,
  surface: string,
  signal?: AbortSignal,
): Promise<SavedFilterIndex> {
  const payload = await api.get<{ savedFilters?: SavedFilter[]; canManage?: boolean }>(
    ns(path`/saved-filters/${surface}`),
    { signal },
  );

  return {
    savedFilters: payload.savedFilters ?? [],
    // Absent means no: a client that assumed permission would offer a save that ends in a 403
    // after the operator has already composed what they wanted to keep.
    canManage: payload.canManage === true,
  };
}

export async function createSavedFilter(
  api: InvFluxApi,
  surface: string,
  input: SavedFilterInput & { name: string; query: SavedFilterQuery },
): Promise<SavedFilter> {
  return api.post<SavedFilter>(ns(path`/saved-filters/${surface}`), input);
}

export async function updateSavedFilter(
  api: InvFluxApi,
  surface: string,
  id: number,
  input: SavedFilterInput,
): Promise<SavedFilter> {
  return api.patch<SavedFilter>(ns(path`/saved-filters/${surface}/${id}`), input);
}

export async function deleteSavedFilter(
  api: InvFluxApi,
  surface: string,
  id: number,
): Promise<void> {
  await api.del<{ deleted: boolean }>(ns(path`/saved-filters/${surface}/${id}`));
}

/** The surface keys this plugin's own grids register. Add-ons contribute their own server-side. */
export const SAVED_FILTER_SURFACE = {
  dispatch: 'dispatch',
  workbench: 'workbench',
  procurementPo: 'procurement.po',
} as const;
