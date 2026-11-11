import { __, _x, sprintf } from '@invflux/i18n';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Button } from '../Button';
import { ErrorBanner } from '../ErrorBanner';
import type { DrilldownProps } from './registry';

/** One barcode a product answers to, as `GET /products/{subject}/codes` lists it. */
export interface ProductCodeEntry {
  /** The kind: `gtin`, `extra_gtin`, `supplier_barcode`, or another barcode type. */
  type: string;
  /** The kind's stored name, for a kind this screen has no label of its own for. */
  kindName: string;
  value: string;
  supplierId: number | null;
  supplierName: string | null;
  primary: boolean;
  /** The GTIN in the store's own product field. */
  storeGtin: boolean;
  /** A case's code: it stands for several units, so a scan never counts it as one. */
  pack: boolean;
  /** What removing it does: `delete` when it was added within the last day, `retire` after. */
  removal: 'delete' | 'retire';
}

/** A product's codes, the drill-down's `detail`. */
export interface ProductCodesDetail {
  codes: ProductCodeEntry[];
  /** Whether this user may take a code off. */
  canRemove: boolean;
}

/** What the drill-down asks its host to save: take this code off the product. */
export interface RemoveProductCodeRequest {
  action: 'remove';
  type: string;
  value: string;
  supplierId: number | null;
}

function isProductCodesDetail(detail: unknown): detail is ProductCodesDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    Array.isArray((detail as { codes?: unknown }).codes)
  );
}

/** The kind, in words a person reads. */
function kindLabel(code: ProductCodeEntry): string {
  if (code.storeGtin) return __('GTIN, in the product’s store field');
  switch (code.type) {
    case 'gtin':
      return __('GTIN');
    case 'extra_gtin':
      return __('Extra GTIN');
    case 'supplier_barcode':
      return null === code.supplierName
        ? __('Supplier barcode')
        : sprintf(
            /* translators: %s: the supplier's name */
            __('%s barcode'),
            code.supplierName,
          );
    default:
      return code.kindName || code.type;
  }
}

/** What removing a code will do, said before it is done. */
function consequence(code: ProductCodeEntry): string {
  const what =
    'delete' === code.removal
      ? __('It was added less than a day ago, so it is taken for a mistake and deleted.')
      : __(
          'Scans will no longer find this product by it. The record keeps that the product had it until now.',
        );
  return code.storeGtin
    ? `${what} ${__('The GTIN field of the product in the store is emptied too.')}`
    : what;
}

/**
 * Every barcode a product answers to, with its kind and supplier, and for a user who may remove
 * codes a Remove on each. Removing asks first, in the row, saying what it will do: a code added in
 * the last day is deleted as a mistake, an older one stops matching and stays on record, and the
 * store's GTIN is also emptied in the store. The product's other codes stay as they are.
 */
export function ProductCodesDrilldown(props: DrilldownProps): JSX.Element {
  const data = (): ProductCodesDetail | null =>
    isProductCodesDetail(props.detail) ? props.detail : null;
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const keyOf = (c: ProductCodeEntry): string => `${c.type}|${c.supplierId ?? ''}|${c.value}`;
  const removable = (): boolean => true === data()?.canRemove && undefined !== props.save;

  const remove = async (code: ProductCodeEntry): Promise<void> => {
    if (!props.save || removing()) return;
    setRemoving(true);
    setError(null);
    try {
      const request: RemoveProductCodeRequest = {
        action: 'remove',
        type: code.type,
        value: code.value,
        supplierId: code.supplierId,
      };
      await props.save(request);
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div class="min-w-96 space-y-3" data-testid="product-codes">
      <Show
        when={(data()?.codes.length ?? 0) > 0}
        fallback={<p class="text-sm text-text-muted">{__('This product has no barcode.')}</p>}
      >
        <ul class="divide-y divide-border">
          <For each={data()?.codes ?? []}>
            {(code) => (
              <li class="py-2" data-testid="product-codes-row" data-code={code.value}>
                <div class="flex items-center gap-3">
                  <span class="min-w-0 flex-1">
                    <span class="block font-mono text-sm">{code.value}</span>
                    <span class="block text-xs text-text-muted">
                      {kindLabel(code)}
                      <Show when={code.pack}>
                        {' · '}
                        {_x('case', 'a barcode that stands for a case of several units')}
                      </Show>
                    </span>
                  </span>
                  <Show when={removable() && confirming() !== keyOf(code)}>
                    <Button
                      size="xs"
                      variant="secondary"
                      data-testid="product-codes-remove"
                      onClick={() => {
                        setError(null);
                        setConfirming(keyOf(code));
                      }}
                    >
                      {_x('Remove', 'take a barcode off a product')}
                    </Button>
                  </Show>
                </div>
                <Show when={confirming() === keyOf(code)}>
                  <div class="mt-2 space-y-2 rounded border border-border bg-surface-raised p-2 text-sm">
                    <p>{consequence(code)}</p>
                    <div class="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={removing()}
                        data-testid="product-codes-keep"
                        onClick={() => setConfirming(null)}
                      >
                        {_x('Keep', 'leave a barcode on the product')}
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        disabled={removing()}
                        data-testid="product-codes-confirm"
                        onClick={() => void remove(code)}
                      >
                        {removing()
                          ? __('Removing…')
                          : sprintf(
                              /* translators: %s: the barcode being removed */
                              __('Remove %s'),
                              code.value,
                            )}
                      </Button>
                    </div>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={error()}>
        <ErrorBanner class="text-sm">{error()}</ErrorBanner>
      </Show>
    </div>
  );
}
