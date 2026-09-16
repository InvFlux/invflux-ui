import type { JSX } from 'solid-js';
import type { ComboboxOption } from './Combobox';
import type { FilterDescriptor } from './filters';

/*
 * ┌─ ADDING A NEW GRID FILTER? Read this. ───────────────────────────────────────────────────────────┐
 * │ Always round-trip a filter's URL state through the helpers below                                 │
 * │ (readUnreservedFilterValuesFromParams / writeFilterValuesToParams / read+writeFilterModifiers…)  │
 * │ — never hand-roll `new URLSearchParams().getAll("myfilter[]")`.                                  │
 * │                                                                                                  │
 * │ WHY (a WordPress peculiarity that already bit us once): we write multi-value params in the       │
 * │ PHP "next index" form `?supplier[]=3&supplier[]=1`, but on a full admin page load WordPress      │
 * │ RESERIALISES array query-args to the explicit-index form `?supplier[0]=3&supplier[1]=1`. A       │
 * │ parser that only matches `[]` then finds nothing on reload and the chip silently fails to        │
 * │ restore. The helpers here accept BOTH forms (see ARRAY_PARAM_KEY), so reusing them makes any     │
 * │ new filter immune. Modifiers ride a namespaced `fmod[{id}][{key}]` bag (associative, unaffected).│
 * └────────────────-----─────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Server-emitted filter metadata — the read-side mirror of a grid column
 * The server's `GridFilterRegistry` serialises one of
 * these per declared filter into the page payload; this bridge turns them into {@link FilterDescriptor}s
 * for {@link FilterBar}. Surface-neutral: workbench, dispatch, and procurement all consume the same
 * shape, so a filter declared once on the server renders identically in every SPA.
 *
 * `id` doubles as the URL param key — repeated for multi-value filters (`?{id}[]=v1&{id}[]=v2`).
 * `options` arrive already resolved (the server resolves `server`-sourced lists), so the bridge
 * needs no async loader; async controls remain possible via an `optionsFor` override that wires
 * `loadOptions` onto the descriptor.
 */
export interface GridFilterMeta {
  id: string;
  label: string;
  /** Control type resolved via `filterControlRegistry` ('select' | 'multiselect' | add-on types). */
  type: string;
  optionsSource: 'none' | 'static' | 'server';
  /** Options resolved server-side (for 'static'/'server'); empty for 'none' / client-supplied. */
  options: ComboboxOption[];
  /** Chip / add-filter-menu order; lower = earlier. */
  priority: number;
  /**
   * Optional match-logic choices (e.g. any/all/none) rendered as a segmented toggle in the chip
   * popover; the picked value rides to the server as the `mode` modifier (`fmod[id][mode]`).
   */
  modes?: ComboboxOption[];
  /** Pre-selected mode value (defaults to the first mode when absent). */
  defaultMode?: string;
  /** For a multiselect whose empty value already matches everything: the control shows ALL options
   *  checked when empty, and re-checking all collapses back to empty (inactive). */
  emptyMeansAll?: boolean;
  /**
   * Optional multi-select adjunct for a filter whose constraint needs a "what over?" answer as well
   * as a value — a stock-level band has to say which slots it measures. Distinct from {@link modes},
   * which is single-choice match logic. The selection rides to the server comma-joined, as the
   * `scopes` modifier (`fmod[id][scopes]`).
   */
  scopes?: ComboboxOption[];
  /** Scope values pre-selected when the chip is added (defaults to all of them when absent). */
  defaultScopes?: string[];
}

export interface GridFilterBridgeOptions {
  /** Override the chip summary (default: up to two labels, else "first +N"). `meta` lets a host
   *  format type-specific summaries (e.g. a `range` filter as "10 – 50"). */
  summarize?: (values: string[], options: ComboboxOption[], meta: GridFilterMeta) => string;
  /** Override/augment the option list for a filter (e.g. a client-side or async source). */
  optionsFor?: (meta: GridFilterMeta) => ComboboxOption[];
  /** Reactive source of the host's per-filter modifier map (`{ [id]: { mode: "all" } }`). */
  modifiers?: () => Record<string, Record<string, string>>;
  /** Persist a single modifier (`mode`, …) for a filter. */
  setModifier?: (id: string, key: string, value: string) => void;
  /**
   * Render the chip's mode toggle. Kept as an injected hook so this module stays DOM-free (and
   * node-testable); the host passes a one-liner wiring the shared `FilterModeToggle` component.
   */
  extraFor?: (args: {
    meta: GridFilterMeta;
    mode: () => string;
    setMode: (value: string) => void;
    scopes: () => string[];
    setScopes: (value: string[]) => void;
  }) => JSX.Element;
}

/**
 * Collapse a `URLSearchParams` into the saved-filter parameter map: a key repeated more than once
 * becomes a list, a key appearing once stays a scalar.
 *
 * The distinction is not cosmetic — it is what the surface reads back. A single-valued repeated
 * param (`?id[]=7`) has to stay a list, or replaying it drops the array shape the reader expects,
 * so the key's own spelling decides rather than how many values happen to be present today.
 */
function paramsToMap(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = key.endsWith('[]') ? [value] : value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }

  return out;
}

/** Default chip summary: up to two labels joined, else "first +N". */
function defaultSummary(
  values: string[],
  options: ComboboxOption[],
  _meta?: GridFilterMeta,
): string {
  if (values.length === 0) return '';
  const labelFor = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
  if (values.length <= 2) return values.map(labelFor).join(', ');
  return `${labelFor(values[0])} +${values.length - 1}`;
}

/**
 * Map server-emitted filter metadata to {@link FilterDescriptor}s bound to a host-owned value map.
 * The host supplies a reactive `values` accessor (`{ [filterId]: string[] }`) and a `setValue`
 * setter; call this inside a memo so the descriptors recompute when either the metadata or the
 * values change. Descriptors are returned ordered by `priority` then `id`.
 */
export function gridFiltersToDescriptors(
  metas: GridFilterMeta[],
  values: () => Record<string, string[]>,
  setValue: (id: string, next: string[]) => void,
  opts: GridFilterBridgeOptions = {},
): FilterDescriptor[] {
  const summarize = opts.summarize ?? defaultSummary;

  return [...metas]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((meta): FilterDescriptor => {
      const optionsFor = (): ComboboxOption[] => opts.optionsFor?.(meta) ?? meta.options;
      const selected = values()[meta.id] ?? [];

      const hasModes = (meta.modes?.length ?? 0) > 0;
      const fallbackMode = meta.defaultMode ?? meta.modes?.[0]?.value ?? '';
      const mode = (): string => opts.modifiers?.()[meta.id]?.mode ?? fallbackMode;
      const setMode = (value: string): void => opts.setModifier?.(meta.id, 'mode', value);

      // Scopes ride as one comma-joined modifier rather than a repeated param, so they fit the
      // existing scalar `fmod[id][key]` bag without the URL codec learning a new shape.
      const hasScopes = (meta.scopes?.length ?? 0) > 0;
      const fallbackScopes = meta.defaultScopes ?? meta.scopes?.map((s) => s.value) ?? [];
      const scopes = (): string[] => {
        const raw = opts.modifiers?.()[meta.id]?.scopes;
        if (raw === undefined) return fallbackScopes;
        return raw.split(',').filter((v) => v !== '');
      };
      // Never persist an empty selection: the server reads "no scopes" as "measure everything", so
      // an empty chip would silently widen rather than narrow. Unchecking the last scope restores
      // the default instead.
      const setScopes = (value: string[]): void =>
        opts.setModifier?.(
          meta.id,
          'scopes',
          (value.length > 0 ? value : fallbackScopes).join(','),
        );

      // Prefix the summary with the active non-default mode label ("None: ACME") so a chip is
      // unambiguous about include vs exclude vs intersection logic.
      const base = summarize(selected, optionsFor(), meta);
      const currentMode = mode();
      const modeLabel =
        hasModes && currentMode !== fallbackMode
          ? meta.modes?.find((m) => m.value === currentMode)?.label
          : undefined;
      // A band on its own ("1 – 20") doesn't say what it measures, so the chip names the slots.
      const scopeLabel = hasScopes
        ? scopes()
            .map((v) => meta.scopes?.find((s) => s.value === v)?.label ?? v)
            .join(' + ')
        : undefined;

      // `emptyMeansAll`: an empty value already matches everything, so the control shows ALL options
      // marked when empty, and selecting all collapses back to empty (the inactive "no filter" state).
      // active/summary key off the RAW value (empty = inactive, no chip); only the control's displayed
      // marks use the all-when-empty value.
      //
      // That all-marked state is a DEFAULT, not a choice: nobody picked those options. So it renders
      // as dots rather than checkmarks and the first click replaces it — the case the contract most
      // needs, since a default that is *all* checked otherwise makes the first click appear to do
      // nothing but clear. It earns no chip either: the chip's job is to explain an absence, and a
      // default matching everything hides nothing.
      const emptyAll = meta.emptyMeansAll === true;
      const isDefault = (): boolean => emptyAll && (values()[meta.id] ?? []).length === 0;
      const displayValue = (): string[] => {
        const raw = values()[meta.id] ?? [];
        return emptyAll && raw.length === 0 ? optionsFor().map((o) => o.value) : raw;
      };
      const onChange = (next: string[]): void => {
        // Selecting every option is equivalent to "no constraint" → store it as empty (inactive),
        // so re-checking all collapses the chip back to the unfiltered default.
        setValue(meta.id, emptyAll && next.length >= optionsFor().length ? [] : next);
      };

      return {
        id: meta.id,
        label: meta.label,
        type: meta.type,
        active: selected.length > 0,
        summary: ((): string => {
          if (base === '') return base;
          const prefix = modeLabel ?? scopeLabel;
          return prefix ? `${prefix}: ${base}` : base;
        })(),
        value: emptyAll ? displayValue : () => values()[meta.id] ?? [],
        options: optionsFor,
        onChange: emptyAll ? onChange : (next) => setValue(meta.id, next),
        clear: () => setValue(meta.id, []),
        isDefault,
        // Encoded through the same writer that puts this filter on the URL, rather than assembled
        // here: `numeric_ids` dash-joins into a bare key while everything else repeats `id[]`, and
        // a saved filter that guessed the shape would store something the surface cannot replay.
        params: () => {
          const params = new URLSearchParams();
          writeFilterValuesToParams(params, { [meta.id]: displayValue() }, [meta]);

          return paramsToMap(params);
        },
        extra:
          (hasModes || hasScopes) && opts.extraFor
            ? () => opts.extraFor!({ meta, mode, setMode, scopes, setScopes })
            : undefined,
      };
    });
}

/**
 * Matches a numeric-or-empty array param key: `id[]` (PHP "next index" form) OR `id[0]`, `id[1]`, …
 * (explicit-index form). WordPress reserialises admin array query-args to the indexed form on a full
 * page load (`?supplier[]=3&supplier[]=1` → `?supplier[0]=3&supplier[1]=1`), so the read side must
 * accept both. Bracketed-NAME params (`tax_filters[brand][]`, `fmod[supplier][mode]`) never match.
 */
const ARRAY_PARAM_KEY = /^([a-z][a-z0-9_]*)\[\d*\]$/;

/**
 * Filter types with bespoke URL encodings — anything not listed here uses the default array shape
 * (`?id[]=v1&id[]=v2`). Keep the table tiny and the dispatch local; a future {@link filterEncodingRegistry}
 * can lift these into a registered strategy once a third encoding lands.
 */
const NUMERIC_IDS_TYPE = 'numeric_ids';

/** Read a dash-joined numeric-id param (`?id=1036-1037-1038`) into a list of digit-only strings. */
function readDashJoinedNumericIds(params: URLSearchParams, id: string): string[] {
  const raw = params.get(id);
  if (raw === null || raw === '') return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split('-')) {
    if (/^\d+$/.test(part) && !seen.has(part)) {
      seen.add(part);
      ids.push(part);
    }
  }
  return ids;
}

/**
 * Read repeated `{id}[]` / `{id}[n]` params into a value map, EXCLUDING `reservedIds` (a surface's
 * bespoke array params such as `stock_status`). Lets registry filters prime from the URL on first
 * load, before their server metadata has arrived — the ids aren't known yet, so we capture any
 * unreserved array param. Values keep their URL order (entries() is order-preserving).
 *
 * `metas` is optional: when omitted (typical first-load case before server metadata arrives), only
 * the array encoding is read. When provided, filter types with bespoke encodings (`numeric_ids` →
 * dash-joined) are read via their own decoder instead — so the post-meta sync picks up
 * `?post_ids=1036-1037-1038`-shape params the array-only first pass missed.
 */
export function readUnreservedFilterValuesFromParams(
  params: URLSearchParams,
  reservedIds: string[],
  metas: ReadonlyArray<{ id: string; type: string }> = [],
): Record<string, string[]> {
  const reserved = new Set(reservedIds);
  const out: Record<string, string[]> = {};
  const bespokeIds = new Set<string>();

  // Bespoke-encoding read pass (only ids we know the type of).
  for (const meta of metas) {
    if (reserved.has(meta.id)) continue;
    if (meta.type === NUMERIC_IDS_TYPE) {
      bespokeIds.add(meta.id);
      const ids = readDashJoinedNumericIds(params, meta.id);
      if (ids.length > 0) out[meta.id] = ids;
    }
  }

  for (const [key, value] of params.entries()) {
    const match = key.match(ARRAY_PARAM_KEY);
    if (!match) continue;
    const id = match[1];
    if (reserved.has(id)) continue;
    // Skip ids decoded under a bespoke encoding — don't mix the two shapes for one filter.
    if (bespokeIds.has(id)) continue;
    (out[id] ??= []).push(value);
  }
  return out;
}

/**
 * Delete every unreserved filter param (the inverse of {@link readUnreservedFilterValuesFromParams}),
 * so a sync pass can rewrite registry-filter params from scratch without stale leftovers. Covers
 * both `{id}[]` / `{id}[n]` (array encoding) and bare `{id}` (bespoke encodings — `numeric_ids` →
 * dash-joined — when `metas` is provided).
 */
export function deleteUnreservedFilterParams(
  params: URLSearchParams,
  reservedIds: string[],
  metas: ReadonlyArray<{ id: string; type: string }> = [],
): void {
  const reserved = new Set(reservedIds);
  for (const key of Array.from(params.keys())) {
    const match = key.match(ARRAY_PARAM_KEY);
    if (match && !reserved.has(match[1])) params.delete(key);
  }
  for (const meta of metas) {
    if (reserved.has(meta.id)) continue;
    if (meta.type === NUMERIC_IDS_TYPE) params.delete(meta.id);
  }
}

/**
 * Append a value map as URL params (empties skipped). Default encoding is repeated `{id}[]`; filter
 * types listed in `metas` with a bespoke encoding use that instead (`numeric_ids` → dash-joined
 * single `?id=v1-v2-v3`).
 */
export function writeFilterValuesToParams(
  params: URLSearchParams,
  values: Record<string, string[]>,
  metas: ReadonlyArray<{ id: string; type: string }> = [],
): void {
  const typeById = new Map(metas.map((m) => [m.id, m.type]));
  for (const [id, vals] of Object.entries(values)) {
    if (vals.length === 0) continue;
    if (typeById.get(id) === NUMERIC_IDS_TYPE) {
      params.set(id, vals.join('-'));
      continue;
    }
    for (const v of vals) params.append(`${id}[]`, v);
  }
}

const MODIFIER_KEY = /^fmod\[([a-z][a-z0-9_]*)\]\[([a-z][a-z0-9_]*)\]$/;

/** Read the namespaced `fmod[{id}][{key}]=value` modifier bag into a per-filter map. */
export function readFilterModifiersFromParams(
  params: URLSearchParams,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [key, value] of params.entries()) {
    const match = key.match(MODIFIER_KEY);
    if (!match) continue;
    const [, id, modKey] = match;
    (out[id] ??= {})[modKey] = value;
  }
  return out;
}

/** Append a modifier map as `fmod[{id}][{key}]=value` params (empties skipped). */
export function writeFilterModifiersToParams(
  params: URLSearchParams,
  modifiers: Record<string, Record<string, string>>,
): void {
  for (const [id, mods] of Object.entries(modifiers)) {
    for (const [key, value] of Object.entries(mods)) {
      if (value !== '') params.append(`fmod[${id}][${key}]`, value);
    }
  }
}

/** Delete every `fmod[{id}][{key}]` param, so a sync pass can rewrite modifiers from scratch. */
export function deleteFilterModifierParams(params: URLSearchParams): void {
  for (const key of Array.from(params.keys())) {
    if (MODIFIER_KEY.test(key)) params.delete(key);
  }
}
