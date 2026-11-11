import type { JSX } from 'solid-js';
import type { FieldMeta, TaxonomySpace } from '../types';
import { canonicalDataType, INTEGER, QUANTITY } from './dataTypeNames';

/**
 * Datatype-keyed component registries (§5). A column's `dataType` slug selects which
 * view/edit/drilldown component renders it; multiple components can register for the same
 * slug and a merchant choice (future) picks one, otherwise the declared default is used.
 *
 * Resolution walks a parent chain (§5.4): the exact slug, then the slug with its
 * `:variant` stripped (`decimal:money` → `decimal`), then `:`-less namespace fallbacks,
 * letting `decimal:money` reuse a `decimal` renderer and unknown slugs fall through to a
 * caller-provided universal fallback (`text`).
 */

/** Shared, read-only lookups a component may need beyond the cell value. */
export interface ComponentContext {
  taxonomySpace?: TaxonomySpace;
  /** The grid's cell wrap mode — lets a multi-item view (e.g. supplier pills) stay on a single line
   *  in no-wrap display mode instead of wrapping to new rows. Absent → treat as "wrap". */
  wrap?: 'wrap' | 'no-wrap';
}

export interface ViewProps {
  value: unknown;
  row: unknown;
  column: FieldMeta;
  ctx: ComponentContext;
}

export type ViewComponent = (props: ViewProps) => JSX.Element;

/** Direction to move the active cell after committing an edit (Enter → down, Shift+Enter → up, Tab → right). */
export type EditMove = 'down' | 'up' | 'right' | 'left' | null;

export interface EditProps {
  value: unknown;
  column: FieldMeta;
  ctx: ComponentContext;
  /** Seed text when edit was entered by typing a character (vs F2/double-click). */
  initialText?: string;
  onCommit: (value: unknown, move: EditMove) => void;
  onCancel: () => void;
}

export type EditComponent = (props: EditProps) => JSX.Element;

interface Registration<C> {
  defaultId: string | null;
  byId: Map<string, C>;
  labels: Map<string, string>;
}

/** Options when registering a component: mark it the datatype default and give it a human label. */
export interface RegisterOpts {
  default?: boolean;
  /** Human label for the component-choice settings UI (§5.6). Falls back to the id. */
  label?: string;
}

/** One registered component's identity, for the component-choice settings UI. */
export interface RegistrationInfo {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface ComponentRegistry<C> {
  register(dataType: string, id: string, component: C, opts?: RegisterOpts): void;
  /** Resolve a component for `dataType`, preferring `chosenId`, then the datatype's default, walking the parent chain. Returns null if nothing matches. */
  resolve(dataType: string, chosenId?: string): C | null;
  has(dataType: string): boolean;
  /** Registrations made directly on `dataType` (not the parent chain) — for the chooser UI. */
  list(dataType: string): RegistrationInfo[];
  /** Every datatype slug with at least one direct registration. */
  dataTypes(): string[];
}

/**
 * Parent chain for a datatype slug, most-specific first.
 * `decimal:money` → `['decimal:money', 'decimal']`;
 * `myplugin.barcode:ean13` → `['myplugin.barcode:ean13', 'myplugin.barcode']`.
 * A quantity ends in `integer`, which shows and edits it until a quantity has components of its own:
 * `quantity:stock` → `['quantity:stock', 'quantity', 'integer']`.
 */
export function datatypeChain(dataType: string): string[] {
  const chain = [dataType];
  const colon = dataType.indexOf(':');
  if (colon > 0) {
    chain.push(dataType.slice(0, colon));
  }
  if (chain[chain.length - 1] === QUANTITY) chain.push(INTEGER);

  return chain;
}

/** Options for a registry. */
export interface ComponentRegistryOpts {
  /**
   * Reads a slug under the name it is registered and resolved by, so an earlier name reaches
   * today's registrations (the datatype registries pass `canonicalDataType`). Default: as given.
   */
  canonical?: (dataType: string) => string;
}

export function createComponentRegistry<C>(
  registryOpts: ComponentRegistryOpts = {},
): ComponentRegistry<C> {
  const byDataType = new Map<string, Registration<C>>();
  const named = registryOpts.canonical ?? ((dataType: string) => dataType);

  return {
    register(slug, id, component, opts = {}) {
      const dataType = named(slug);
      const reg = byDataType.get(dataType) ?? {
        defaultId: null,
        byId: new Map<string, C>(),
        labels: new Map<string, string>(),
      };
      reg.byId.set(id, component);
      if (opts.label !== undefined) reg.labels.set(id, opts.label);
      if (opts.default === true || reg.defaultId === null) {
        reg.defaultId = id;
      }
      byDataType.set(dataType, reg);
    },

    resolve(dataType, chosenId) {
      for (const candidate of datatypeChain(named(dataType))) {
        const reg = byDataType.get(candidate);
        if (reg === undefined) continue;
        if (chosenId !== undefined && reg.byId.has(chosenId)) {
          return reg.byId.get(chosenId) ?? null;
        }
        if (reg.defaultId !== null) {
          return reg.byId.get(reg.defaultId) ?? null;
        }
      }

      return null;
    },

    has(dataType) {
      return datatypeChain(named(dataType)).some((candidate) => byDataType.has(candidate));
    },

    list(dataType) {
      const reg = byDataType.get(named(dataType));
      if (reg === undefined) return [];
      return [...reg.byId.keys()].map((id) => ({
        id,
        label: reg.labels.get(id) ?? id,
        isDefault: id === reg.defaultId,
      }));
    },

    dataTypes() {
      return [...byDataType.keys()];
    },
  };
}

/** The app-wide view registry. Built-ins register into it at module load (see views.tsx). */
export const viewRegistry: ComponentRegistry<ViewComponent> =
  createComponentRegistry<ViewComponent>({ canonical: canonicalDataType });

/**
 * Datatype codec: the round-trippable text representation for clipboard copy/paste (§11.5).
 * `format` turns a cell value into the string Excel/Sheets paste into a cell; `parse` turns
 * pasted text back into a value, returning null on a type-strict failure (§11.10.1). Codecs
 * MUST satisfy parse(format(x)) === x for every accepted value (round-trip identity).
 */
export interface CodecContext {
  /** The column's editorConfig (e.g. { taxonomy }, { min, max }). */
  config: Record<string, unknown>;
  taxonomySpace?: TaxonomySpace;
  /**
   * Where the text came from. `typed` is someone typing into a field: a decimal codec then reads it
   * strictly (one separator, no grouping, nothing repaired) and, when the column declares a `scale`,
   * enforces it. Absent or `paste` is text from another system (a clipboard, a file), which the
   * decimal codecs read tolerantly because it may carry any locale's grouping and a currency sign.
   */
  source?: 'typed' | 'paste';
}

export interface Codec {
  format(value: unknown, ctx: CodecContext): string;
  parse(text: string, ctx: CodecContext): unknown | null;
  /**
   * Why typed text was refused, in words for the person typing — the one thing `parse`'s `null`
   * cannot say. Absent for a codec that has nothing more specific to tell.
   */
  reject?(text: string, ctx: CodecContext): string | null;
}

/** The app-wide codec registry. Built-ins register at module load (see codecs.ts). */
export const codecRegistry: ComponentRegistry<Codec> = createComponentRegistry<Codec>({
  canonical: canonicalDataType,
});

/** The app-wide edit-component registry. Built-ins register at module load (see editors.tsx). */
export const editRegistry: ComponentRegistry<EditComponent> =
  createComponentRegistry<EditComponent>({ canonical: canonicalDataType });

/**
 * Optional per-datatype diff renderer for the save-review modal (§11.10.3). When a column's
 * datatype has no registered preview, the modal falls back to a bare old-above-new line using
 * `codec.format`. Registered components opt into richer diffs — a git-style word/line merge for
 * `text:long`, thumbnail pairs for `image:url`, unit annotations for `quantity`, etc.
 */
export interface DiffPreviewProps {
  column: FieldMeta;
  oldValue: unknown;
  newValue: unknown;
  ctx: ComponentContext;
}

export type DiffPreviewComponent = (props: DiffPreviewProps) => JSX.Element;

/** The app-wide diff-preview registry. Empty by default; plug-ins / future built-ins register into it. */
export const diffPreviewRegistry: ComponentRegistry<DiffPreviewComponent> =
  createComponentRegistry<DiffPreviewComponent>({ canonical: canonicalDataType });

/**
 * Per-datatype drill-down renderer (§11.7). A cell whose column declares a drill-down
 * (`meta.hasDrilldown`) opens a detail view on double-click (read-only cells) / Alt+Enter /
 * the context menu; the SPA fetches `GET /workbench/drilldown/{col}/{subject}` and renders the
 * returned `detail` payload via the component resolved here for the column's datatype.
 */
export interface DrilldownProps {
  detail: unknown;
  column: FieldMeta;
  subjectId: number;
  ctx: ComponentContext;
  /** Persist an edit for this drill-down (POST). Present only for writable drill-downs the user may
   *  edit; the host refreshes `detail` from the response. Absent → the drill-down is read-only. */
  save?: (payload: unknown) => Promise<void>;
  /** Async option source for a picker inside the drill-down (e.g. product search). Present only when
   *  the host wires one. */
  searchOptions?: (query: string) => Promise<Array<{ value: string; label: string }>>;
}

export type DrilldownComponent = (props: DrilldownProps) => JSX.Element;

/** The app-wide drill-down registry. Built-ins register at module load (see drilldowns.tsx). */
export const drilldownRegistry: ComponentRegistry<DrilldownComponent> =
  createComponentRegistry<DrilldownComponent>({ canonical: canonicalDataType });
