import { __ } from '@invflux/i18n';
import {
  createSearchFailure,
  editRegistry,
  type EditProps,
  SearchSelectAsync,
  type SearchSelectOption,
  wordMatch,
  wordQueryNarrows,
} from '@invflux/ui';
import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

const MIN_QUERY = 2;

/**
 * One server answer. `complete` is the server saying these are *all* the products the query matches
 * by words (not cut at a page size or a candidate window) — the condition for narrowing it here.
 */
export interface ProductSearchAnswer {
  options: SearchSelectOption[];
  complete: boolean;
  /** Hits the host left out because they are already on the document — see `takenMessage`. */
  taken?: SearchSelectOption[];
}

/** Per-cell config the host injects via resolveEditorMeta (the editor never sees the row itself). */
interface ProductSearchConfig {
  /** Server product search — the host wraps the REST call + maps hits to options. */
  search?: (query: string) => Promise<ProductSearchAnswer>;
  /** Portal target for the dropdown (escapes the cell's overflow clip). */
  portalRoot?: HTMLElement;
  /**
   * Shown instead of "no matching products" when the only hits are ones already on the document —
   * otherwise a merchant typing a product they already added is told it does not exist.
   */
  takenMessage?: string;
}

/**
 * Append-row product picker that searches **all** WC products server-side — the catalog's "add a
 * product" cell, as a grid cell editor (click → Enter/F2/type to open, borderless inline). Wraps the
 * shared {@link SearchSelectAsync} with `highlight` + `autoFocusFirst` (the server owns matching +
 * ranking; we only emphasise the match and pre-select the top hit). Typing on from an answer the
 * server marked complete is answered here, by the same word rule, without another request. Picking commits the chosen
 * {@see SearchSelectOption} (value = WC post id); Escape / blur cancels.
 *
 * The search fn + portal arrive through `editorConfig` (injected per-row via resolveEditorMeta).
 */
function ProductSearchEditor(props: EditProps): JSX.Element {
  const cfg = (): ProductSearchConfig => props.column.editorConfig as ProductSearchConfig;
  const [query, setQuery] = createSignal(props.initialText ?? '');
  const [options, setOptions] = createSignal<SearchSelectOption[]>([]);
  const [taken, setTaken] = createSignal<SearchSelectOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  // A buyer adding lines to a PO: a failed lookup that read as "no matching products" would tell
  // them the product is not in the catalog, and they would go and create a duplicate.
  const searchFailed = createSearchFailure();
  let committed = false;
  let rootEl: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The last answer the server said was complete, kept to narrow without asking again.
  let complete: {
    query: string;
    options: SearchSelectOption[];
    taken: SearchSelectOption[];
  } | null = null;
  // Only the newest keystroke's answer may land: a slow response must not overwrite a newer list.
  let seq = 0;

  // Debounced server search; below MIN_QUERY we clear without a round-trip. A query that only
  // narrows a complete answer is filtered here, by the server's own rule, and never sent.
  const runSearch = (text: string): void => {
    setQuery(text);
    clearTimeout(timer);
    const mine = ++seq;
    const q = text.trim();
    if (q.length < MIN_QUERY) {
      setOptions([]);
      setTaken([]);
      searchFailed.clear();
      setLoading(false);
      return;
    }
    if (null !== complete && wordQueryNarrows(complete.query, q)) {
      const matching = (o: SearchSelectOption): boolean => null !== wordMatch(q, o.label);
      setOptions(complete.options.filter(matching));
      setTaken(complete.taken.filter(matching));
      searchFailed.clear();
      setLoading(false);
      return;
    }
    setLoading(true);
    timer = setTimeout(() => {
      void (async () => {
        try {
          const answer: ProductSearchAnswer = await (cfg().search?.(q) ??
            Promise.resolve({ options: [], complete: false }));
          if (mine !== seq) return;
          const answerTaken = answer.taken ?? [];
          complete = answer.complete
            ? { query: q, options: answer.options, taken: answerTaken }
            : null;
          setOptions(answer.options);
          setTaken(answerTaken);
          searchFailed.clear();
        } catch (e: unknown) {
          if (mine !== seq) return;
          setOptions([]);
          setTaken([]);
          searchFailed.record(e);
        } finally {
          if (mine === seq) setLoading(false);
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
            : taken().length > 0 && undefined !== cfg().takenMessage
              ? (cfg().takenMessage ?? '')
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
