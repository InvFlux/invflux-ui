/**
 * The REST transport, exported as `@invflux/ui/api` rather than through the package barrel.
 *
 * The barrel pulls in the whole component tree — Kobalte, the grid, everything — so importing a
 * `fetch` wrapper through it costs a consumer the entire UI library, and breaks outright in a
 * node-environment unit test that has no Solid renderer. A client is not a component; it gets its
 * own entry point, the same way `./nav` already does.
 */
export { createInvFluxApi, path, ns } from './client';
export type { ApiContext, InvFluxApi, RequestOptions, PartialResult } from './client';
export { ApiError, isRetryable } from './errors';

// Query-key vocabulary + the cross-surface invalidation groups. Here rather than per package
// because invalidation crosses surfaces: procurement cannot invalidate a workbench key it cannot
// name, which is exactly why the grid was never told that receiving a PO had moved stock.
export { qk, STOCK_MOVED } from './queryKeys';
export type { Key } from './queryKeys';
