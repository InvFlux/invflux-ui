import { createInvFluxApi, ns, path } from '@invflux/ui/api';
import type {
  InventorySettings,
  SavePayload,
  StockAdjustPayload,
  StockAdjustResponse,
} from './types';

/**
 * The product tab mounts inside WooCommerce's own product screen rather than the admin SPA, so it
 * receives `apiRoot` and `nonce` per call instead of holding a context. Binding the shared client
 * per call is free — it is a closure over those two strings — and keeps these signatures stable for
 * the callers.
 */
const api = (apiRoot: string, nonce: string): ReturnType<typeof createInvFluxApi> =>
  createInvFluxApi({ apiRoot, nonce });

const settingsRoute = (productId: number): string =>
  ns(path`/products/${productId}/inventory-settings`);

export function fetchInventorySettings(
  apiRoot: string,
  productId: number,
  nonce: string,
): Promise<InventorySettings> {
  return api(apiRoot, nonce).get<InventorySettings>(settingsRoute(productId));
}

export function saveInventorySettings(
  apiRoot: string,
  productId: number,
  nonce: string,
  payload: SavePayload,
): Promise<InventorySettings> {
  return api(apiRoot, nonce).post<InventorySettings>(settingsRoute(productId), payload);
}

/**
 * Single-subject stock adjustment via the workbench-apply dispatcher.
 *
 * The route is shared with the Central Workbench's bulk apply flow; the `surface` field on the body
 * tells the dispatcher — and the on-hand correction record it writes — that this adjustment came
 * from the product inventory tab rather than the grid.
 */
export function adjustStock(
  apiRoot: string,
  nonce: string,
  payload: StockAdjustPayload,
): Promise<StockAdjustResponse> {
  return api(apiRoot, nonce).post<StockAdjustResponse>(ns('/workbench/apply'), payload);
}
