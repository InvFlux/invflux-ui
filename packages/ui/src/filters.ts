import type { JSX } from 'solid-js';
import { _n, sprintf } from '@invflux/i18n';
import type { ComboboxOption } from './Combobox';
import { createComponentRegistry, type ComponentRegistry } from './datatypes/registry';

/**
 * Filter-control registry
 * — the client half of the filter contract. A declared filter carries a `type`
 * (`select` | `multiselect` | add-on types); this registry resolves the type to the control that
 * renders it inside a filter chip's edit popover, with the same parent-chain fallback as the
 * datatype component registry. SPA-agnostic (lives in @invflux/ui) so any SPA renders a filter
 * type identically and add-ons can register new types once.
 *
 * This module is DOM-free (it only declares the registry + types); the built-in controls live in
 * `filters-builtins.tsx` and register on import of @invflux/ui.
 */

/** Props a filter control receives from the host shell. Values are option-id strings. */
export interface FilterControlProps {
  /** Currently-selected option ids (single-select uses a 0-or-1-length array). */
  value: string[];
  /** The options to choose from (already resolved/ordered by the host). */
  options: ComboboxOption[];
  placeholder?: string;
  /** Open/focus on mount (the chip popover just revealed it). */
  autoFocus?: boolean;
  onChange: (value: string[]) => void;
  /**
   * Dismiss the chip popover. Optional — most controls don't need it (the host already wires
   * Escape and outside-click to close); the `numeric_ids` textarea uses it for Ctrl/Cmd+Enter
   * because plain Enter inserts a newline rather than committing.
   */
  onClose?: () => void;

  // ── Default vs. deliberate selection ──────────────────────────
  //
  // A multi-select has three states, not two: at *default* nobody has expressed a preference and
  // `value` is whatever the surface applies on a silent URL; once the operator picks, the same
  // `value` is a *deliberate* choice. The two are different facts and must not share a rendering —
  // conflating them is how a filter's meaning comes to depend on another filter's default with
  // nothing written down.

  /**
   * `value` is the filter's **default**, not a choice. A control honouring this renders those
   * options as defaulted (a dot, never a dimmed checkmark — a faded check still reads as "checked",
   * and checked things are additive by every convention an operator brings) and treats the first
   * click as a **replace**: adding to a non-choice is incoherent.
   */
  isDefault?: boolean;
  /**
   * Return the filter to its default — what unchecking the last remaining option means. It never
   * means "match nothing": nobody asks a queue for nothing, and honouring it literally manufactures
   * an empty result.
   */
  onRevertToDefault?: () => void;

  // ── Async-search hooks (consumed by `multiselect:async` only) ──
  //
  // Built-in `select` / `multiselect` ignore these; the
  // `multiselect:async` control reads them to drive a debounced
  // server search. Add-on controls registering a new type
  // (`multiselect:async-with-bulk-paste`, …) opt in similarly.

  /** Fetch options for a typed query. The control owns debounce + min-char gating. */
  loadOptions?: (query: string) => Promise<ComboboxOption[]>;
  /** Minimum query length before `loadOptions` fires. Default 3. */
  minQueryLength?: number;
  /** Keystroke-to-fetch debounce window. Default 300 ms. */
  debounceMs?: number;
  /**
   * Snapshot of labels for currently-selected values, kept alive by
   * the host across popover close-and-reopen so the dropdown's
   * pinned section can render "SKU — Name" instead of just the raw
   * value. The async control feeds this to its Combobox; the sync
   * controls ignore it (their `options` already carry the labels).
   */
  selectedOptions?: ComboboxOption[];
}

export type FilterControl = (props: FilterControlProps) => JSX.Element;

/**
 * A parameter map as a surface puts it on the URL and a saved view stores it.
 *
 * Values are already in the surface's own encoding — dispatch joins with commas, the workbench
 * registry repeats `id[]`, a paste-list dash-joins — because only the filter knows how it writes
 * itself. See {@link FilterDescriptor.params}.
 */
export type FilterQuery = Record<string, string | string[]>;

/**
 * One line of a filter set's self-description: what a single filter constrains, in words.
 *
 * A saved view is a promise about what you will see. Rendered as a name alone it is only a
 * promise; rendered with its constituents it is a statement that can be checked *before* anyone
 * applies it — which is what stops a view from quietly meaning something else than it says.
 */
export interface FilterConstraint {
  /** The declaring filter's id. */
  id: string;
  /** Its label, exactly as the operator knows it from the bar. */
  label: string;
  /** What it constrains to — translated, and collapsed when the list is long. */
  value: string;
  /**
   * Stored values this install can no longer resolve: a deleted tag, a worksheet that is gone, an
   * add-on's workflow state after the add-on was deactivated. Carried rather than dropped, because
   * a clause that vanishes silently returns rows nobody asked for while the name still promises
   * the old cut. Rendering them is what makes §1.2's degradation loud.
   */
  unresolved?: string[];
}

/** Above this many selected values, a description collapses to "N of M" rather than listing them. */
const COLLAPSE_AT = 3;

/**
 * Build a filter's description from its own option list — the default every simple filter gets.
 *
 * Takes the resolved pieces rather than the descriptor so a filter declaring its own
 * {@link FilterDescriptor.describe} can call it from inside its own declaration, where the
 * descriptor does not exist yet.
 *
 * Returns `null` for an empty selection: a filter that constrains nothing earns no line, which is
 * the same inclusion rule the chip uses (§2.3). A filter whose *deliberate* value is "no
 * restriction" — the queue's widened state floor, say — is not that case and declares its own
 * {@link FilterDescriptor.describe}, because saying so out loud is then the whole point.
 */
export function describeConstraint(
  filter: { id: string; label: string; options: ComboboxOption[] },
  values: string[],
): FilterConstraint | null {
  if (values.length === 0) return null;

  const options = filter.options;
  const labelFor = new Map(options.map((o) => [o.value, o.label]));
  // Only a filter that *has* an option list can judge a value unresolvable. A free-text or
  // paste-list filter answers for anything, so nothing it carries is unknown.
  const unresolved = options.length > 0 ? values.filter((v) => !labelFor.has(v)) : [];

  const value =
    values.length > COLLAPSE_AT && options.length > 0
      ? sprintf(
          /* translators: 1: number of selected options, 2: number available */
          _n('%1$d of %2$d', '%1$d of %2$d', values.length),
          values.length,
          options.length,
        )
      : values.map((v) => labelFor.get(v) ?? v).join(', ');

  return unresolved.length > 0
    ? { id: filter.id, label: filter.label, value, unresolved }
    : { id: filter.id, label: filter.label, value };
}

/** Built-in filter-control type keys (add-ons may register more). */
export const FILTER_CONTROL_SELECT = 'select';
export const FILTER_CONTROL_MULTISELECT = 'multiselect';
/**
 * Multi-select with server-side option resolution — type ≥
 * `minQueryLength` characters, results stream in after the
 * `debounceMs` window. Selected items pin to the top of the
 * dropdown so the operator sees their picks across queries.
 */
export const FILTER_CONTROL_MULTISELECT_ASYNC = 'multiselect:async';
/**
 * Numeric min/max range. The value is positional `[min, max]` (either may be "" for an open bound);
 * an all-empty range collapses to `[]` (inactive). Ignores `options`.
 */
export const FILTER_CONTROL_RANGE = 'range';
/**
 * Date from/to window. Like {@link FILTER_CONTROL_RANGE} but with `<input type=date>` bounds — the
 * value is positional `[from, to]` (ISO `YYYY-MM-DD`; either may be "" for an open bound); an
 * all-empty window collapses to `[]` (inactive). Ignores `options`.
 */
export const FILTER_CONTROL_DATERANGE = 'daterange';
/**
 * Paste-friendly list of numeric IDs (e.g. WC post IDs). Operators paste arbitrary text
 * with delimiters/labels/whitespace and the control extracts every digit-run, drops the rest.
 * Values are kept as digit-only strings; the URL encoding is dash-joined (`?id=1036-1037-1038`)
 * because dashes are URL-safe and produce shorter shareable links than the indexed array form.
 * Ignores `options`.
 */
export const FILTER_CONTROL_NUMERIC_IDS = 'numeric_ids';

/**
 * One filter as the {@link FilterBar} consumes it. The host SPA builds these from its own query +
 * options state; the bar renders them as chips (active) or Add-filter entries (inactive) and
 * resolves each `type` to a control from {@link filterControlRegistry}.
 *
 * `value`/`options` are **accessors** (not snapshots): the open control reads them live, so a
 * selection reflects immediately without the popover remounting. `active`/`summary` are plain —
 * the chip list re-renders from the reactive `filters` source on every change.
 */
export interface FilterDescriptor {
  id: string;
  label: string;
  /** Control type resolved via {@link filterControlRegistry} (`select` | `multiselect` | …). */
  type: string;
  /** Whether the filter currently has a value (chip) vs. is offered under "Add filter". */
  active: boolean;
  /** Compact chip summary of the current value. */
  summary: string;
  /** Live selected option ids (single-select uses a 0-or-1-length array). */
  value: () => string[];
  /** Live options to choose from. */
  options: () => ComboboxOption[];
  placeholder?: string;
  onChange: (value: string[]) => void;
  /**
   * Return the filter to its default. This is the whole reset affordance — the chip's `[×]`, and
   * what a control calls when the operator unchecks the last option — so a host whose filter has a
   * defaulted value must clear the *override*, not the value.
   */
  clear: () => void;
  /**
   * Live: `value()` is the unexpressed **default** rather than a deliberate choice. Drives the
   * control's dot rendering and first-click-replaces (see {@link FilterControlProps.isDefault}),
   * and marks the chip as explaining an absence rather than reporting a choice.
   */
  isDefault?: () => boolean;
  /**
   * Live: how the value this filter *returns to* on reset renders — empty when that is "no filter
   * at all". It is what lets the reset affordance say which of the two it does: dismissing a
   * deliberate `Workflow: Closed` restores `Active`, and calling that "remove" would be the same
   * quiet dishonesty a default nobody can see already is.
   */
  defaultSummary?: () => string;
  /**
   * Live: the URL parameters this filter's **current effective value** implies — including when
   * that value is only a default and the live URL therefore omits it entirely.
   *
   * This is what a saved filter needs and a bookmark does not. A live URL may legitimately leave a
   * defaulted filter out, meaning "whatever the default is"; a stored one may not, or it silently
   * re-aims the day that default moves. Only the filter knows its own encoding — dispatch joins
   * with commas, the registry repeats `id[]`, a paste-list dash-joins — so it is asked rather than
   * guessed at.
   *
   * A filter that does not implement it contributes nothing to a saved query beyond what the live
   * URL already carries, which is correct for one that has no default to make explicit.
   */
  params?: () => FilterQuery;
  /**
   * The URL parameters this filter owns — what {@link params} writes and what the surface reads
   * back into this filter's value.
   *
   * Declaring them is what lets a *stored* query be read back into words: a saved view is a
   * parameter map with no idea which filter wrote which key, and a lookup table in the saved-view
   * UI would render an add-on's filter as raw JSON. A filter that declares none simply contributes
   * no line, rather than being described wrongly by something that does not own it.
   */
  paramKeys?: string[];
  /**
   * Describe what this filter constrains **in the given parameter map** — a stored view's query,
   * not necessarily the live one — or `null` when it constrains nothing there.
   *
   * Optional: a filter declaring {@link paramKeys} gets the default rendering (its first key's
   * comma-separated values, labelled from `options()`, collapsed when long). Declare this when the
   * filter's encoding is its own — several keys, a dash-joined list, a sentinel that means "no
   * restriction" and has to say so rather than be omitted.
   *
   * Like a label it must be a **closure** evaluated at render time: built eagerly it would call
   * `__()` before `init` and trip WP's just-in-time-textdomain notice.
   */
  describe?: (query: FilterQuery) => FilterConstraint | null;
  /** Optional adjunct rendered in the popover below the control (e.g. an "exclude" toggle). */
  extra?: () => JSX.Element;
  /**
   * Live snapshot of labels for currently-selected values — handed
   * down to the control so async dropdowns can render "Value — Label"
   * in the pinned section across popover open/close cycles.
   */
  selectedOptions?: () => ComboboxOption[];

  // ── Async-search hooks (`multiselect:async` controls only) ────
  //
  // The bar passes these straight through to the resolved control;
  // sync controls (`select` / `multiselect`) ignore them. A descriptor
  // declaring `type: "multiselect:async"` MUST also set `loadOptions`
  // — that's the function whose result populates the dropdown.

  /** Fetch options for a typed query. The control owns debounce + min-char gating. */
  loadOptions?: (query: string) => Promise<ComboboxOption[]>;
  /** Minimum query length before `loadOptions` fires. Default 3. */
  minQueryLength?: number;
  /** Keystroke-to-fetch debounce window. Default 300 ms. */
  debounceMs?: number;
}

/**
 * What a multi-select filter's click means, once default and deliberate are distinguishable.
 * `revert` returns the filter to its default; `select` is a deliberate value.
 */
export type FilterSelectionChange = { kind: 'select'; value: string[] } | { kind: 'revert' };

/**
 * Resolve a multi-select's raw next-selection into the tri-state default-vs-deliberate contract
 * described on `FilterControlProps`. Pure (no DOM) so the built-in controls stay thin and the
 * transitions are unit-testable — the controls themselves wrap a DOM combobox and cannot load in
 * the node env.
 *
 * Three transitions, in the order they are decided:
 *
 * - **At default, any click replaces.** Adding to a non-choice is incoherent: clicking `Closed` on
 *   a default-`Active` filter means "show me closed orders", not "also show me closed orders". A
 *   single click reaches us as exactly one value differing between `current` and `next` — ticking
 *   an unmarked option *adds* it, clicking one that carries a dot *removes* it — and both readings
 *   collapse to the same answer: that option alone, deliberately. In particular clicking a dotted
 *   option **promotes it**, it never toggles off; "yes, I mean this one" is the only sensible
 *   reading of clicking a mark nobody chose.
 * - **Emptying a deliberate selection reverts to default.** It does not mean "match nothing" —
 *   nobody asks a queue for nothing, and honouring it literally manufactures an empty result,
 *   which is indistinguishable from a filter that can no longer resolve.
 * - Anything else is the deliberate selection as given.
 *
 * A change that moves more than one value at once (an async result set churning under the control)
 * is not a click, so it is taken at face value rather than collapsed to a single option.
 */
export function resolveFilterSelection(
  current: string[],
  next: string[],
  isDefault: boolean,
): FilterSelectionChange {
  if (isDefault) {
    const inCurrent = new Set(current);
    const inNext = new Set(next);
    const clicked = [
      ...next.filter((v) => !inCurrent.has(v)),
      ...current.filter((v) => !inNext.has(v)),
    ];
    return { kind: 'select', value: clicked.length === 1 ? clicked : next };
  }
  if (next.length === 0) return { kind: 'revert' };

  return { kind: 'select', value: next };
}

/** The app-wide filter-control registry. Built-ins register at module load (filters-builtins.tsx). */
export const filterControlRegistry: ComponentRegistry<FilterControl> =
  createComponentRegistry<FilterControl>();
