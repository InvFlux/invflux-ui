import type { JSX } from 'solid-js';
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
  clear: () => void;
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

/** The app-wide filter-control registry. Built-ins register at module load (filters-builtins.tsx). */
export const filterControlRegistry: ComponentRegistry<FilterControl> =
  createComponentRegistry<FilterControl>();
