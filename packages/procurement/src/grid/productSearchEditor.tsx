import { __ } from '@invflux/i18n';
import {
  createSearchFailure,
  editRegistry,
  type EditProps,
  SearchSelectAsync,
  type SearchSelectOption,
} from '@invflux/ui';
import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

const MIN_QUERY = 2;

/** Per-cell config the host injects via resolveEditorMeta (the editor never sees the row itself). */
interface ProductSearchConfig {
  /** Server product search — the host wraps the REST call + maps hits to options. */
  search?: (query: string) => Promise<SearchSelectOption[]>;
  /** Portal target for the dropdown (escapes the cell's overflow clip). */
  portalRoot?: HTMLElement;
}

/**
 * Append-row product picker that searches **all** WC products server-side — the catalogue's "add a
 * product" cell, as a grid cell editor (click → Enter/F2/type to open, borderless inline). Wraps the
 * shared {@link SearchSelectAsync} with `highlight` + `autoFocusFirst` (the server owns matching +
 * ranking; we only emphasise the match and pre-select the top hit). Picking commits the chosen
 * {@see SearchSelectOption} (value = WC post id); Escape / blur cancels.
 *
 * The search fn + portal arrive through `editorConfig` (injected per-row via resolveEditorMeta).
 */
function ProductSearchEditor(props: EditProps): JSX.Element {
  const cfg = (): ProductSearchConfig => props.column.editorConfig as ProductSearchConfig;
  const [query, setQuery] = createSignal(props.initialText ?? '');
  const [options, setOptions] = createSignal<SearchSelectOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  // A buyer adding lines to a PO: a failed lookup that read as "no matching products" would tell
  // them the product is not in the catalogue, and they would go and create a duplicate.
  const searchFailed = createSearchFailure();
  let committed = false;
  let rootEl: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Debounced server search; below MIN_QUERY we clear without a round-trip.
  const runSearch = (text: string): void => {
    setQuery(text);
    clearTimeout(timer);
    const q = text.trim();
    if (q.length < MIN_QUERY) {
      setOptions([]);
      searchFailed.clear();
      setLoading(false);
      return;
    }
    setLoading(true);
    timer = setTimeout(() => {
      void (async () => {
        try {
          setOptions(await (cfg().search?.(q) ?? Promise.resolve([])));
          searchFailed.clear();
        } catch (e: unknown) {
          setOptions([]);
          searchFailed.record(e);
        } finally {
          setLoading(false);
        }
      })();
    }, 250);
  };

  // Escape cancels (capture, to beat Kobalte's own Escape-closes-dropdown).
  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ('Escape' === e.key) {
        e.stopPropagation();
        props.onCancel();
      }
    };
    rootEl?.addEventListener('keydown', onKey, true);
    onCleanup(() => {
      rootEl?.removeEventListener('keydown', onKey, true);
      clearTimeout(timer);
    });
  });

  return (
    <div
      ref={rootEl}
      class="h-full w-full"
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (rootEl && null !== next && rootEl.contains(next)) return;
        queueMicrotask(() => {
          if (!committed) props.onCancel();
        });
      }}
    >
      <SearchSelectAsync
        ariaLabel={__('Add a product')}
        options={options()}
        value={null}
        onChange={(o) => {
          if (null === o) {
            props.onCancel();
            return;
          }
          committed = true;
          props.onCommit(o, 'down');
        }}
        onSearch={runSearch}
        loading={loading()}
        autoFocus
        highlight
        autoFocusFirst
        initialQuery={props.initialText}
        mount={cfg().portalRoot}
        placeholder={__('Search products…')}
        emptyMessage={
          searchFailed.line() ??
          (query().trim().length < MIN_QUERY
            ? __('Type to search products')
            : __('No matching products'))
        }
      />
    </div>
  );
}

let registered = false;

/** Register the `text:product-search` editor once (idempotent). Its codec falls back to `text`. */
export function registerProductSearchEditor(): void {
  if (registered) {
    return;
  }
  registered = true;
  editRegistry.register('text:product-search', 'invflux.product-search', ProductSearchEditor, {
    default: true,
  });
}
