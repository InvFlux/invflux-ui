import { __, sprintf } from '@invflux/i18n';
import { editRegistry, type EditProps, SearchSelect, type SearchSelectOption } from '@invflux/ui';
import { type JSX, onCleanup, onMount } from 'solid-js';
import type { AddOption } from '../sections/purchase-orders/AddPicker';

/** Per-cell config the host injects via resolveEditorMeta (the editor never sees the row itself). */
interface CatalogueAddConfig {
  /** Addable catalogue products (supplier catalogue minus products already on the PO). */
  addOptions?: () => AddOption[];
  /** Portal target for the dropdown (escapes the cell's overflow clip). */
  portalRoot?: HTMLElement;
  /** Supplier display/nickname — for the "all products added" empty state. */
  supplierLabel?: string;
}

/**
 * The draft PO append-row's product picker, as a grid cell **editor** — so the "add a product" cell
 * behaves like every other editable cell (click → Enter/F2/type to open, borderless inline). A thin
 * wrapper over the shared {@link SearchSelect} in `fuzzy` mode: catalogue-scoped fuzzy search, ranked
 * best-first with matched characters highlighted and the top result pre-selected (Enter adds it
 * straight away). Escape / blur cancel back to the "＊ Add a product ＊" display.
 *
 * The catalogue/portal/supplier arrive through `editorConfig` (injected per-row via resolveEditorMeta);
 * the committed value is the picked {@see SearchSelectOption} (value = subjectId).
 */
function CataloguePickerEditor(props: EditProps): JSX.Element {
  const cfg = (): CatalogueAddConfig => props.column.editorConfig as CatalogueAddConfig;
  let committed = false;
  let rootEl: HTMLDivElement | undefined;

  const options = (): SearchSelectOption[] =>
    (cfg().addOptions?.() ?? []).map((o) => ({ value: String(o.subjectId), label: o.label }));
  const emptyMessage = (): string => {
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
        emptyMessage={emptyMessage()}
        mount={cfg().portalRoot}
        controlClass="flex h-full w-full items-center gap-1 bg-surface px-1 ring-2 ring-inset ring-blue-500"
        ariaLabel={__('Add a product')}
        placeholder={__('Add a product…')}
      />
    </div>
  );
}

let registered = false;

/** Register the `text:catalogue-add` editor once (idempotent). Its codec falls back to `text`. */
export function registerCataloguePickerEditor(): void {
  if (registered) {
    return;
  }
  registered = true;
  editRegistry.register('text:catalogue-add', 'invflux.catalogue-add', CataloguePickerEditor, {
    default: true,
  });
}
