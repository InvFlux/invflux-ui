import { createInvFluxApi } from '@invflux/ui/api';
import type { AdminContext } from './types';

/** One projected setting from `GET invflux/v1/settings` (mirrors SettingsCatalogProjector::project). */
export interface SettingRow {
  name: string;
  dataType: string;
  config: Record<string, unknown>;
  title: string | null;
  description: string | null;
  group: string | null;
  order: number;
  tier: string | null;
  scopes: string[];
  value: unknown;
  defaultValue: unknown;
  effectivePolicy: 'local' | 'replicated';
  policyLocked: boolean;
  merchantChoice: string | null;
  gate: 'open' | 'locked';
  /**
   * Advice about the value this setting currently holds, or `null` when it needs none. `kind`
   * separates a value with a defect (`wrong_value`) from one nobody has chosen yet (`undecided`) —
   * they clear identically, but must not be worded alike. `severity` says whether it asks for a
   * decision (counted, and listed by the needs-a-decision filter) or is a `note` — shown on the row,
   * never counted, because it informs a choice the merchant may be right to make.
   */
  advisory: {
    kind: 'wrong_value' | 'undecided';
    message: string;
    severity: 'decision' | 'note';
  } | null;
}

export interface SettingChange {
  name: string;
  value: unknown;
}

export interface CommitResult {
  ok: boolean;
  status: number;
  applied: string[];
  errors: Record<string, string>;
}

/** One Woo order-status → InvFlux semantics row (mirrors WooOrderStatusPolicyStore::allPolicies). */
export interface OrderStatusPolicy {
  status_slug: string;
  label: string;
  stock_bucket: string;
  dispatch_status: string;
  is_core: boolean;
  requires_review: boolean;
  /**
   * Merchant-chosen palette entry for this status's pill, or `null` to draw the shipped default.
   *
   * Null and "the default's index" are different facts: only a null follows a later change to the
   * defaults, so the settings UI must round-trip the null rather than resolving it on read.
   */
  color_id: number | null;
  /**
   * Set on the rows that are not statuses but things WooCommerce does to an order — trashing it,
   * deleting it. `derived_value` is what InvFlux currently does (a trash policy, or `release` for a
   * deletion); `derived_from` names the setting that decides it, or is null while none does. Both are
   * null on a stored status row. A derived row is read-only here: its setting is its only editor.
   */
  derived_from?: string | null;
  derived_value?: string | null;
}

/** One third-party stock-plugin policy row (mirrors PluginMetaPolicyStore::listInstalled). */
export interface PluginPolicyRow {
  plugin_slug: string;
  plugin_name: string;
  policy: string;
  acknowledged: boolean;
  last_seen_at: string | null;
}

export interface PluginPolicyData {
  installed: PluginPolicyRow[];
  available: Record<string, string>;
  knownSlugs: string[];
}

/** One manual payment gateway's answer (mirrors PaymentGatewayPolicyStore::allPolicies). */
export interface PaymentGatewayPolicy {
  gateway_id: string;
  label: string;
  /** An order on this gateway moving to Processing means it was paid. */
  processing_means_paid: boolean;
  /** An order on this gateway moving to Completed means it was paid; always true when Processing does. */
  completed_means_paid: boolean;
  /** Found installed, never answered: read as "not paid" until the merchant decides. */
  requires_review: boolean;
  /** Switched on in WooCommerce → Settings → Payments. */
  enabled: boolean;
  /** Refunds through its API, so it confirms its own payments: nothing to answer, read-only. */
  confirms_own_payments: boolean;
}

const ROUTE = 'invflux/v1/settings';
const ROUTE_ORDER_STATUS = 'invflux/v1/policies/order-status';
const ROUTE_PLUGIN_META = 'invflux/v1/policies/plugin-meta';
const ROUTE_PAYMENT_GATEWAYS = 'invflux/v1/policies/payment-gateways';

/**
 * Bound per call rather than held: `AdminContext` is a prop here, not a module singleton, and the
 * client is a closure over two strings.
 *
 * The URL handling this file used to own — the `?rest_route=` form the adapter localizes *and* the
 * `/wp-json/` form a dev context serves — moved into the shared client, which was the only place it
 * existed. Every other client handled one form and would have broken on the other.
 */
const api = (ctx: AdminContext): ReturnType<typeof createInvFluxApi> =>
  createInvFluxApi({ apiRoot: ctx.apiRoot, nonce: ctx.nonce });

export async function fetchSettings(ctx: AdminContext): Promise<SettingRow[]> {
  const data = await api(ctx).get<{ settings?: SettingRow[] }>(ROUTE);

  return data.settings ?? [];
}

/**
 * A settings write answers per-key, not pass/fail — three of five may apply while two are rejected.
 * `partial()` preserves that: throwing on a non-2xx here would report a blanket failure over a save
 * that mostly landed, and lose which keys were the problem.
 */
export function commitSettings(ctx: AdminContext, changes: SettingChange[]): Promise<CommitResult> {
  return api(ctx).partial('PUT', ROUTE, { changes });
}

export async function fetchOrderStatusPolicies(ctx: AdminContext): Promise<OrderStatusPolicy[]> {
  const data = await api(ctx).get<{ policies?: OrderStatusPolicy[] }>(ROUTE_ORDER_STATUS);

  return data.policies ?? [];
}

/** @param policies slug → { stock_bucket, dispatch_status } for custom (non-core) statuses. */
export function saveOrderStatusPolicies(
  ctx: AdminContext,
  policies: Record<
    string,
    { stock_bucket: string; dispatch_status: string; color_id: number | null }
  >,
): Promise<CommitResult> {
  return api(ctx).partial('POST', ROUTE_ORDER_STATUS, { policies });
}

export async function fetchPaymentGatewayPolicies(
  ctx: AdminContext,
): Promise<PaymentGatewayPolicy[]> {
  const data = await api(ctx).get<{ policies?: PaymentGatewayPolicy[] }>(ROUTE_PAYMENT_GATEWAYS);

  return data.policies ?? [];
}

/** A gateway's two answers, as the settings table stages and saves them. */
export type PaymentGatewayAnswer = Pick<
  PaymentGatewayPolicy,
  'processing_means_paid' | 'completed_means_paid'
>;

/** @param policies gateway id → its answers */
export function savePaymentGatewayPolicies(
  ctx: AdminContext,
  policies: Record<string, PaymentGatewayAnswer>,
): Promise<CommitResult> {
  return api(ctx).partial('POST', ROUTE_PAYMENT_GATEWAYS, { policies });
}

export async function fetchPluginPolicies(ctx: AdminContext): Promise<PluginPolicyData> {
  const data = await api(ctx).get<Partial<PluginPolicyData>>(ROUTE_PLUGIN_META);

  return {
    installed: data.installed ?? [],
    available: data.available ?? {},
    knownSlugs: data.knownSlugs ?? [],
  };
}

export function savePluginPolicies(
  ctx: AdminContext,
  policies: Record<string, { policy: string; acknowledged: boolean }>,
  register?: string,
): Promise<CommitResult> {
  return api(ctx).partial(
    'POST',
    ROUTE_PLUGIN_META,
    register ? { register, policies } : { policies },
  );
}
