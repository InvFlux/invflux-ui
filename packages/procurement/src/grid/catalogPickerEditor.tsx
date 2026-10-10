import { __, sprintf } from '@invflux/i18n';
import {
  editRegistry,
  type EditProps,
  fuzzyScore,
  SearchSelect,
  type SearchSelectOption,
} from '@invflux/ui';
import { type JSX, onCleanup, onMount } from 'solid-js';
import type { AddOption } from '../sections/purchase-orders/AddPicker';

/** Per-cell config the host injects via resolveEditorMeta (the editor never sees the row itself). */
interface CatalogAddConfig {
  /** Addable catalog products (supplier catalog minus products already on the PO). */
  addOptions?: () => AddOption[];
  /**
   * Called when the picker opens, so the host can fetch the catalog it needs.
   *
   * The catalog is not loaded with the page: most purchase orders are generated and never have a
   * product added by hand, so it was thousands of rows fetched for nothing. Opening this editor is
   * the first moment anybody actually needs it.
   */
  onNeeded?: () => void;
  /** Whether that fetch is still in flight — the empty list means "wait", not "none left". */
  loading?: () => boolean;
  /** Portal target for the dropdown (escapes the cell's overflow clip). */
  portalRoot?: HTMLElement;
  /** Supplier display/nickname — for the "all products added" empty state. */
  supplierLabel?: string;
  /**
   * Catalog products left out of {@link addOptions} because they are already on the document, and
   * what to say when the typed text finds only those. Without it a merchant typing the name of a
   * product they already added is told it does not match, and goes looking for it elsewhere.
   */
  taken?: () => AddOption[];
  takenMessage?: string;
}

/**
 * The draft PO append-row's product picker, as a grid cell **editor** — so the "add a product" cell
 * behaves like every other editable cell (click → Enter/F2/type to open, borderless inline). A thin
 * wrapper over the shared {@link SearchSelect} in `fuzzy` mode: catalog-scoped fuzzy search, ranked
 * best-first with matched characters highlighted and the top result pre-selected (Enter adds it
 * straight away). Escape / blur cancel back to the "＊ Add a product ＊" display.
 *
 * The catalog/portal/supplier arrive through `editorConfig` (injected per-row via resolveEditorMeta);
 * the committed value is the picked {@see SearchSelectOption} (value = subjectId).
 */
function CatalogPickerEditor(props: EditProps): JSX.Element {
  const cfg = (): CatalogAddConfig => props.column.editorConfig as CatalogAddConfig;
  let committed = false;
  let rootEl: HTMLDivElement | undefined;

  const options = (): SearchSelectOption[] =>
    (cfg().addOptions?.() ?? []).map((o) => ({ value: String(o.subjectId), label: o.label }));
  const emptyMessage = (query: string): string => {
    // An empty list while the catalog is still arriving is not "none left" — saying so would be
    // a confident wrong answer, and the merchant would stop looking.
    if (true === cfg().loading?.()) return __('Loading the supplier catalog…');

    const takenMessage = cfg().takenMessage;
    if (
      undefined !== takenMessage &&
      '' !== query.trim() &&
      (cfg().taken?.() ?? []).some((o) => null !== fuzzyScore(query, o.label))
    ) {
      return takenMessage;
    }

    const label = cfg().supplierLabel ?? '';

    return 0 === (cfg().addOptions?.() ?? []).length
      ? sprintf(
          __('All %s products added, no more available'),
          '' === label ? __('supplier') : label,
        )
      : __('No matching products to add');
  };

  const commit = (val: string | null): void => {
    if (null === val) {
      props.onCancel();
      return;
    }
    committed = true;
    const label = options().find((o) => o.value === val)?.label ?? '';
    props.onCommit({ value: val, label } satisfies SearchSelectOption, 'down');
  };

  // Opening the picker is what makes the catalog worth fetching; ask for it now.
  onMount(() => cfg().onNeeded?.());

  // Escape cancels the edit — capture so it beats Kobalte's own "Escape closes the dropdown".
  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ('Escape' === e.key) {
        e.stopPropagation();
        props.onCancel();
      }
    };
    rootEl?.addEventListener('keydown', onKey, true);
    onCleanup(() => rootEl?.removeEventListener('keydown', onKey, true));
  });

  return (
    <div
      ref={rootEl}
      class="h-full w-full"
      onFocusOut={(e) => {
        // Focus left the cell entirely (not into the combobox itself) → cancel, unless we just committed.
        const next = e.relatedTarget as Node | null;
        if (rootEl && null !== next && rootEl.contains(next)) return;
        queueMicrotask(() => {
          if (!committed) props.onCancel();
        });
      }}
    >
      <SearchSelect
        fuzzy
        autoFocus
        options={options()}
        value={null}
        onChange={commit}
        initialQuery={props.initialText}
        emptyMessage={emptyMessage}
        mount={cfg().portalRoot}
        controlClass="flex h-full w-full items-center gap-1 bg-surface px-1 ring-2 ring-inset ring-blue-500"
        ariaLabel={__('Add a product')}
        placeholder={__('Add a product…')}
      />
    </div>
  );
}

let registered = false;

/** Register the `text:catalog-add` editor once (idempotent). Its codec falls back to `text`. */
export function registerCatalogPickerEditor(): void {
  if (registered) {
    return;
  }
  registered = true;
  editRegistry.register('text:catalog-add', 'invflux.catalog-add', CatalogPickerEditor, {
    default: true,
  });
}
