import { __ } from '@invflux/i18n';
import {
  createSearchFailure,
  SearchSelectAsync,
  usePortalRootOptional,
  type SearchSelectOption,
} from '@invflux/ui';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import type { ReceivableProduct, ReceivableProductsResponse } from './types';

/** Below this a query is not a search — the server answers empty and we never ask. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/**
 * The product cell of one receiving row: a type-ahead over the products stock can be received
 * against (governed, and stockable — the server decides which, so the list cannot offer a row that
 * would be refused on submission).
 *
 * Each row owns its own search state rather than sharing one at the form level: two rows are filled
 * one after another, and a shared `options` array would leave the previous row's results showing
 * under the next row's cursor for as long as the fetch takes.
 */
export function ProductPickerCell(props: {
  selected: ReceivableProduct | null;
  onPick: (product: ReceivableProduct | null) => void;
  /** Flagged by the server — this product cannot take stock (ungoverned). */
  invalid?: boolean;
}): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const portalRoot = usePortalRootOptional();

  const [query, setQuery] = createSignal('');
  const [found, setFound] = createSignal<ReceivableProduct[]>([]);
  const [loading, setLoading] = createSignal(false);
  // A failed lookup that read as "no matching products" would tell the operator the goods in their
  // hands are not in the catalogue, and send them off to create a duplicate.
  const searchFailed = createSearchFailure();

  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const runSearch = (text: string): void => {
    setQuery(text);
    clearTimeout(timer);
    const q = text.trim();
    if (q.length < MIN_QUERY) {
      setFound([]);
      searchFailed.clear();
      setLoading(false);
      return;
    }
    setLoading(true);
    timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.get<ReceivableProductsResponse>('/receiving/subjects', { q });
          setFound(res.products);
          searchFailed.clear();
        } catch (e: unknown) {
          setFound([]);
          searchFailed.record(e);
        } finally {
          setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);
  };

  const label = (p: ReceivableProduct): string => ('' === p.sku ? p.name : `${p.name} · ${p.sku}`);
  const options = (): SearchSelectOption[] =>
    found().map((p) => ({ value: String(p.subjectId), label: label(p) }));
  const selectedOption = (): SearchSelectOption | null =>
    null === props.selected
      ? null
      : { value: String(props.selected.subjectId), label: label(props.selected) };

  return (
    <SearchSelectAsync
      ariaLabel={__('Product')}
      options={options()}
      value={selectedOption()}
      onChange={(option) =>
        props.onPick(
          null === option
            ? null
            : (found().find((p) => String(p.subjectId) === option.value) ?? props.selected),
        )
      }
      onSearch={runSearch}
      loading={loading()}
      highlight
      autoFocusFirst
      mount={portalRoot}
      class={props.invalid ? 'border-red-400' : undefined}
      placeholder={__('Search by name or SKU…')}
      emptyMessage={
        searchFailed.line() ??
        (query().trim().length < MIN_QUERY
          ? __('Type to search products')
          : __('No product InvFlux manages matches that'))
      }
    />
  );
}
