import { __, _n, sprintf } from '@invflux/i18n';
import { useHostNav } from '@invflux/ui';
import type { DrilldownProps } from '@invflux/ui';
import { type JSX, Show } from 'solid-js';

/**
 * `/on-order` response: the aggregate summary always; the per-PO breakdown (`pos`) is returned only
 * to an entitled install and rendered by an add-on-contributed drill-down, so it is not part of this
 * base shape.
 */
export interface OnOrderResponse {
  locked: boolean;
  summary: { totalQty: number; poCount: number };
}

/** Upgrade page slug (mirrors @invflux/ui FeatureGate's default target); the host resolves the URL. */
const UPGRADE_PAGE = 'invflux-upgrade-pro';

/**
 * Base drill-down body behind a draft line's "On order" figure (double-click the green **+N**): the
 * aggregate — how much stock is inbound across how many open POs — plus an upgrade prompt. The
 * per-PO breakdown (which POs, suppliers and ETAs) is an add-on contribution registered for the same
 * `number:on-order` datatype; when that add-on is present it overrides this body, and the backend
 * returns the detail rows only to an entitled install. Rendered inside the DataGrid's own drill-down
 * Modal, so there is no wrapper/Modal here — just the body. Registered as the `core.on-order` default
 * in {@link ./purchase-orders/PoDraftGrid}.
 */
export function OnOrderDrilldown(props: DrilldownProps): JSX.Element {
  const hostNav = useHostNav();
  const data = (): OnOrderResponse | null => (props.detail as OnOrderResponse | null) ?? null;

  return (
    <Show when={data()} fallback={<p class="py-2 text-center text-sm text-text-muted">{__('Nothing on order.')}</p>}>
      <div class="py-1 text-center">
        <p class="text-sm text-slate-700">
          {sprintf(
            _n(
              '%1$s on order across %2$d open purchase order.',
              '%1$s on order across %2$d open purchase orders.',
              data()?.summary.poCount ?? 0,
            ),
            (data()?.summary.totalQty ?? 0).toLocaleString(),
            data()?.summary.poCount ?? 0,
          )}
        </p>
        <p class="mt-2 text-xs text-slate-500">
          {__('Upgrade to Pro to see which POs, suppliers and ETAs are bringing this stock.')}
        </p>
        <a
          class="mt-3 inline-block rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          href={hostNav.pageHref(UPGRADE_PAGE) ?? undefined}
          rel="noopener"
        >
          {__('Upgrade to Pro')}
        </a>
      </div>
    </Show>
  );
}
