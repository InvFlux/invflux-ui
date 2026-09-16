import { createSignal, createResource, createEffect, Show, For } from 'solid-js';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import { Portal } from 'solid-js/web';
import {
  Button,
  ConfirmModal,
  ToastRegion,
  useHostNav,
  buttonClass,
  WorkbenchLinkIcon,
} from '@invflux/ui';
import type { WorkbenchHandles } from '@invflux/ui';
import { fetchInventorySettings, saveInventorySettings } from './api';
import { EmbeddedWorkbench } from './EmbeddedWorkbench';
import type { ProductTabContext, SavePayload } from './types';

interface AppProps {
  context: ProductTabContext;
  productId: number;
  /** Document-body div where modals + toasts render so they escape WC's transformed ancestors. */
  portalRoot: HTMLElement;
}

/** Tri-state stock governance, matching the server payload + the workbench "Managed by" column. */
type StockState = 'invflux' | 'external' | 'none';

/**
 * Segment metadata for the tri-state control (order = display order). Labels match the workbench
 * "Managed by" column so both surfaces speak the same vocabulary; "InvFlux" is a brand literal, so it
 * is never translated.
 *
 * A **function**, not a module-scope constant: the host binds the text domain at boot, and a `__()`
 * evaluated while the module is being imported resolves before that binding and is stuck in English
 * for the life of the page. Building the list on read keeps it inside the render.
 */
const stockSegments = (): ReadonlyArray<{ value: StockState; label: string; hint: string }> => [
  {
    value: 'invflux',
    label: 'InvFlux',
    hint: __('InvFlux manages this product’s stock'),
  },
  {
    value: 'external',
    /* translators: One option in a 3-way stock-management control, between "InvFlux" and "Not
       tracked". Means "someone other than InvFlux — WooCommerce or another plugin — tracks this
       product's quantity". Pick the clearest short word for an "external / someone else" option; it
       must stay short (it sits inline in the toggle). The tooltip carries the full explanation. */
    label: _x('Other', 'stock management state'),
    hint: __('WooCommerce (or another plugin) manages the quantity'),
  },
  {
    value: 'none',
    label: _x('Not tracked', 'stock management state'),
    hint: __('Stock is not tracked'),
  },
];

const labelClass = 'min-w-40 font-semibold text-text';
const rowClass = 'flex items-center gap-3 py-2';
const errorBoxClass =
  'mb-3 rounded border-l-4 border-error-border bg-error-bg px-3 py-2 text-error-text';

export function App(props: AppProps) {
  const hostNav = useHostNav();
  const { apiRoot, nonce } = props.context;

  const [settings, { refetch }] = createResource(() =>
    fetchInventorySettings(apiRoot, props.productId, nonce),
  );

  // sku / gtin / reorder_threshold / backorders are grid-owned (edited in the embedded WorkbenchGrid
  // below), so the form exposes no inputs for them. They're read off `settings()` for the
  // hidden-WC-input sync + the save payload; the grid's onApplied refetch keeps `settings()` current.
  //
  // `_stock` / `_stock_status` are not InvFlux's either: when tracking is on InvFlux projects them,
  // and when it's off WooCommerce's own (un-suppressed) stock-status field owns them, saved with WC's
  // Update button. So the form's only writable field is the tracking flip itself.
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  /** The grid's imperative handles, captured on mount — used to reload it after a tracking flip. */
  let gridApi: WorkbenchHandles | undefined;

  /**
   * The pending governance change awaiting confirmation, or null. A segment click that needs a
   * confirmation records the **target** state plus which modal to show; the modal commits the target
   * on confirm, so the displayed segments always reflect the *persisted* state (no dirty state):
   *   - 'enabling' : → invflux (adopt WC's `_stock` as the for-sale quantity)
   *   - 'disabling': invflux → external/none, unlocked (data-loss-style warning; message per target)
   *   - 'override' : invflux → external/none while the Pro lock is enforced (doubles as override gate)
   * Benign external↔none flips carry no governance change and commit directly, without a modal.
   */
  const [pendingChange, setPendingChange] = createSignal<{
    target: StockState;
    kind: 'enabling' | 'disabling' | 'override';
  } | null>(null);

  // --- Hidden-WC-input sync ------------------------------------------------
  //
  // WC renders the native inventory inputs (_manage_stock, _sku, _global_unique_id,
  // _low_stock_amount) into the page form on page load. We CSS-suppress them visually,
  // but they're still in the form. WP's autosave (~60s on the post edit screen) and
  // any accidental form submit (e.g. Enter in a focused input) post these hidden values
  // verbatim. Without the syncs below, a successful InvFlux save would be silently
  // reverted by the next autosave posting the page-load values:
  //
  //   1. We move a product to None → DB updated (_manage_stock=no), InvFlux UI shows None
  //   2. Hidden #_manage_stock is still `checked` (we never touched the page-load input)
  //   3. Autosave fires → POSTs _manage_stock=yes → WC writes 'yes' → the product silently
  //      becomes External again (WC manages the quantity), reverting our None choice
  //   4. Reload → the control is back on External
  //
  // Syncing every InvFlux signal to its hidden WC counterpart keeps the form payload honest.
  // `_manage_stock` follows `stock_management !== 'none'` (on for InvFlux + External). Governance
  // itself is never touched by these WC writes — the interceptor does not mirror _manage_stock into
  // ivfx_governed; only our REST endpoint sets governance. A WC
  // write is still blocked from un-managing a governed / ledger-bearing product by the interceptor's
  // protection guard, which is correct.

  createEffect(() => {
    const d = settings();
    const el = document.getElementById('_manage_stock') as HTMLInputElement | null;
    // WC's `_manage_stock` is on for BOTH InvFlux and External (someone tracks the quantity), off only
    // for None — so it follows `stock_management !== 'none'`, not governance. Keeping the hidden input
    // honest stops WC autosave from reverting an External product to unmanaged.
    const managed = d ? d.stock_management !== 'none' : false;
    if (d && el && el.checked !== managed) {
      el.checked = managed;
    }
  });

  // sku / gtin / reorder_threshold are grid-owned; sync their hidden WC inputs from the persisted
  // `settings()` (refreshed by the grid's onApplied refetch) rather than from a form signal, so an
  // edit made in the grid propagates to the hidden inputs and WC autosave posts the current value.
  createEffect(() => {
    const d = settings();
    const el = document.getElementById('_sku') as HTMLInputElement | null;
    if (d && el && el.value !== d.sku) {
      el.value = d.sku;
    }
  });

  createEffect(() => {
    const d = settings();
    const el = document.getElementById('_global_unique_id') as HTMLInputElement | null;
    if (d && el && el.value !== d.gtin) {
      el.value = d.gtin;
    }
  });

  createEffect(() => {
    const d = settings();
    const el = document.getElementById('_low_stock_amount') as HTMLInputElement | null;
    const value = d && d.reorder_threshold !== null ? String(d.reorder_threshold) : '';
    if (d && el && el.value !== value) {
      el.value = value;
    }
  });

  createEffect(() => {
    const d = settings();
    const el = document.getElementById('_backorders') as HTMLSelectElement | null;
    if (d && el && el.value !== d.backorders) {
      el.value = d.backorders;
    }
  });

  // WC-native `.stock_fields` (quantity / backorders / low-stock) is suppressed by default (InvFlux
  // owns it while governing), but in the **External** state WooCommerce manages `_stock`, so its own
  // quantity field must show. This class lifts the CSS suppression for External only; WC's own
  // manage-stock show/hide then drives the actual visibility. (Governed / None stay suppressed.)
  createEffect(() => {
    const d = settings();
    const panel = document.getElementById('inventory_product_data');
    if (panel) {
      panel.classList.toggle('invflux-shows-wc-stock', d?.stock_management === 'external');
    }
  });

  /** The persisted governance state (defaults to 'none' until settings load). */
  const current = (): StockState => settings()?.stock_management ?? 'none';

  /** Whether the Pro lock forbids this user from un-governing (badge shown; non-InvFlux segments
   *  disabled). Only bites while InvFlux currently governs — you can't un-govern what isn't governed. */
  const lockedForUser = (): boolean => {
    const d = settings();
    return (
      d !== undefined &&
      d.enforce_tracking &&
      d.stock_management === 'invflux' &&
      !d.can_override_lock
    );
  };

  /**
   * Commit a governance state change. The endpoint is a full overwrite, so the grid-owned fields
   * (sku/gtin/reorder_threshold/backorders) are echoed back from the persisted `settings()` —
   * untouched — while this saves the governance state.
   *
   * After a successful save: re-read settings, nudge WooCommerce to re-evaluate its own native
   * field visibility (it binds a `change` handler on `#_manage_stock`, and a programmatic
   * `.checked` assignment doesn't fire it), and reload the grid so the Total cell's read-only
   * state — which follows governance — updates immediately.
   */
  const persistState = async (next: StockState): Promise<void> => {
    const d = settings();
    if (!d) return;
    setSaveError(null);
    setSaving(true);
    try {
      const payload: SavePayload = {
        stock_management: next,
        reorder_threshold: d.reorder_threshold,
        backorders: d.backorders,
        sku: d.sku,
        gtin: d.gtin,
      };
      await saveInventorySettings(apiRoot, props.productId, nonce, payload);
      await refetch();

      const el = document.getElementById('_manage_stock') as HTMLInputElement | null;
      if (el) {
        el.checked = next !== 'none';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      gridApi?.refreshLiveUpdates();
    } catch (err: unknown) {
      setSaveError(
        err instanceof Error ? err.message : __('Unexpected error saving InvFlux settings.'),
      );
    } finally {
      setSaving(false);
      setPendingChange(null);
    }
  };

  const cancelChange = (): void => {
    setPendingChange(null);
  };

  /**
   * Handle a segment click. Governance transitions (to/from InvFlux) open a confirmation; a benign
   * External↔None flip (no governance change, just WC's own tracking) commits directly.
   */
  const requestStateChange = (target: StockState): void => {
    const d = settings();
    if (!d) return;
    const cur = d.stock_management;
    if (target === cur) return;

    if (target === 'invflux') {
      // Adopt: seed InvFlux from WC's current `_stock`.
      setPendingChange({ target, kind: 'enabling' });
      return;
    }
    if (cur === 'invflux') {
      // Un-govern. Under the Pro lock the confirmation doubles as the override gate (server re-checks);
      // without the lock it's the data-loss-style warning. Message varies by target (External vs None).
      setPendingChange({ target, kind: d.enforce_tracking ? 'override' : 'disabling' });
      return;
    }
    // External ↔ None: no InvFlux governance change — just WC's `_manage_stock`. Commit directly.
    void persistState(target);
  };

  return (
    <div class="px-3 py-3">
      {/* Toasts live in the portal root so they float above the WC admin chrome, not
          inside the inventory tab's transformed ancestor. */}
      <Portal mount={props.portalRoot}>
        <ToastRegion />
      </Portal>

      <Show when={settings.error}>
        <div class={errorBoxClass}>
          {__('Failed to load InvFlux inventory data.')}{' '}
          <Button variant="link" size="sm" onClick={() => void refetch()}>
            {__('Retry')}
          </Button>
        </div>
      </Show>

      <Show when={saveError()}>
        <div class={errorBoxClass}>
          {saveError()}{' '}
          <Button variant="link" size="sm" onClick={() => setSaveError(null)}>
            {__('Dismiss')}
          </Button>
        </div>
      </Show>

      <Show when={settings.loading}>
        <p class="italic text-text-muted">{__('Loading InvFlux inventory data…')}</p>
      </Show>

      <Show when={settings() !== undefined && !settings.loading} fallback={null}>
        {/* SKU / GTIN / low-stock threshold are edited in the grid below (they're grid columns),
            not here — this block is the parent-level policy header (track-stock toggle, backorders,
            unmanaged quantity/status). */}

        {/* Variation: stock-managed is a parent-level policy in InvFlux, so we don't
            expose a per-variation toggle. Show a small note linking back to the parent. */}
        <Show when={settings()!.product_type === 'variation'}>
          <div class={rowClass}>
            <span class={labelClass}>{__('Track stock quantity in InvFlux')}</span>
            <span class="text-sm text-text-muted">
              {__('Configured on the parent product')}
              <Show when={settings()!.parent_post_id !== null}>
                {' '}
                —{' '}
                <a
                  class="text-blue-700 hover:underline"
                  href={`post.php?post=${settings()!.parent_post_id}&action=edit`}
                  title={__('Open parent product')}
                >
                  {_x('edit parent', 'link to the parent product, after a dash')}
                </a>
              </Show>
            </span>
          </div>
        </Show>

        <Show when={settings()!.product_type !== 'variation'}>
          {/* flex-wrap so on a narrow tab the segmented control drops below its label instead of
              overflowing the row. */}
          <div class={`${rowClass} flex-wrap`}>
            <span class={labelClass}>{__('Stock management')}</span>

            {/* Tri-state segmented control (InvFlux / External / None) — matches the workbench "Stock
                managed" column. Each segment requests a transition; governance changes (to/from
                InvFlux) go through a confirmation, so the highlighted segment always reflects the
                persisted state. When the Pro lock forbids un-governing, the non-InvFlux segments are
                disabled (the badge alongside explains why).

                Deliberately NOT the shared SegmentedControl, unlike the other single-select rows.
                Two reasons, both specific to this one: a segment's label carries markup (the brand
                mark beside "InvFlux"), and this control is request-then-confirm — a radio group is
                backed by real `<input type=radio>` elements that the browser checks on click, so a
                declined confirmation would show the segment move and snap back. Revisit if the
                confirm step ever goes away. */}
            <div
              class="inline-flex overflow-hidden rounded border border-border"
              role="group"
              aria-label={__('Stock management')}
            >
              <For each={stockSegments()}>
                {(seg) => {
                  const active = (): boolean => current() === seg.value;
                  const disabled = (): boolean =>
                    saving() || (lockedForUser() && seg.value !== 'invflux');
                  return (
                    <button
                      type="button"
                      /* Two of the three labels are translated, and the middle one is a
                         deliberately short word for "someone other than InvFlux" whose wording is
                         not settled — so the segment's own state id, which is its contract with
                         the settings endpoint, is the stable handle a spec can hold.
                         */
                      data-testid={`product-tab-stock-mode-${seg.value}`}
                      class="cursor-pointer border-0 border-l border-border px-4 py-1.5 text-sm font-medium first:border-l-0 disabled:cursor-not-allowed disabled:opacity-50"
                      classList={{
                        'bg-primary text-white': active(),
                        'bg-transparent text-text hover:bg-gray-100': !active(),
                      }}
                      aria-pressed={active()}
                      title={seg.hint}
                      disabled={disabled()}
                      onClick={() => requestStateChange(seg.value)}
                    >
                      <Show
                        when={seg.value === 'invflux' && props.context.markUrl}
                        fallback={seg.label}
                      >
                        <span class="flex items-center gap-2">
                          <img src={props.context.markUrl} alt="" aria-hidden="true" class="w-5" />
                          {seg.label}
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>

            {/* Pro lock indicator — tracking is enforced store-wide. */}
            <Show when={settings()!.enforce_tracking && current() === 'invflux'}>
              <span
                class="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-text-muted"
                title={
                  settings()!.can_override_lock
                    ? __(
                        'Stock tracking is enforced for this store. You can override the lock to turn it off for this product.',
                      )
                    : __(
                        'Stock tracking is enforced for this store and can only be changed by an administrator.',
                      )
                }
              >
                <span aria-hidden="true">🔒</span>{' '}
                {_x(
                  'Enforced',
                  'badge: the store enforces stock tracking, so it cannot be turned off here',
                )}
              </span>
            </Show>

            <div class="flex-1" />
            <Show when={saving()}>
              <span class="mr-1 text-xs italic text-text-muted">{__('Saving…')}</span>
            </Show>
          </div>
        </Show>
      </Show>

      {/* ── Embedded WorkbenchGrid (embed-alongside) ──
          The form above stays the policy header (tri-state stock-management control + confirmation flows,
          backorders, unmanaged path); the grid below owns per-row stock/catalog editing. Mounted
          only once the product has a resolved subject (pre-resolution the grid would be empty).
          Scoped to this product family via post_ids + bring_children inside EmbeddedWorkbench. */}
      <Show when={settings() && settings()!.subject_id !== null}>
        <hr class="my-4 border-0 border-t border-border" />
        <EmbeddedWorkbench
          context={props.context}
          productId={props.productId}
          portalRoot={props.portalRoot}
          capabilities={{
            viewStock: true,
            onhandCorrect: settings()!.allow_onhand_correct,
            // The product edit screen already gates on WC's edit_products capability.
            editProducts: true,
          }}
          // A grid edit to sku/gtin/threshold persists via the grid's own REST path; refetch so the
          // form's hidden WC-input sync + save payload reflect it (else WC autosave reverts to the
          // stale page-load values).
          onApplied={() => void refetch()}
          apiRef={(api) => {
            gridApi = api;
          }}
          // Variable parent: a link (in the grid toolbar, after the layout toggle) to the full
          // workbench filtered to this product's variations. `post_ids=<id>&bring_children=1`
          // addresses the parent and pulls its variation set as context rows.
          toolbarExtra={
            settings()!.product_type === 'variable' ? (
              <a
                class={buttonClass('secondary', 'md', 'px-2!')}
                href={hostNav.routeHref(
                  '/workbench',
                  `post_ids=${props.productId}&bring_children=1`,
                )}
                title={__('Manage product in workbench')}
                aria-label={__('Manage product in workbench')}
              >
                <WorkbenchLinkIcon class="h-5 w-5" />
              </a>
            ) : undefined
          }
        />
      </Show>

      {/* Adopt confirmation (→ InvFlux). Reachable only when governance is persisted off, so the
          "adopt WC's current stock" promise always reflects reality. */}
      <Show when={pendingChange()?.kind === 'enabling'}>
        <Portal mount={props.portalRoot}>
          <ConfirmModal
            title={__('Let InvFlux manage this product?')}
            confirmLabel={__('InvFlux manages stock')}
            message={
              <Show
                when={settings()!.wc_stock !== null}
                fallback={
                  <p>
                    {__(
                      "InvFlux will adopt WooCommerce's current stock value as the for-sale quantity and start managing this product's stock.",
                    )}
                  </p>
                }
              >
                {(() => {
                  const sentence = __(
                    /* translators: %s: WooCommerce's current stock quantity, shown in bold */
                    "InvFlux will adopt WooCommerce's current stock value (%s) as the for-sale quantity and start managing this product's stock.",
                  );
                  // Split on the placeholder rather than sprintf() it, so the figure keeps its bold.
                  const [before, after] = sentence.split(/%(?:1\$)?s/);
                  return (
                    <p>
                      {before}
                      <span class="font-semibold">{settings()!.wc_stock}</span>
                      {after}
                    </p>
                  );
                })()}
              </Show>
            }
            onConfirm={() => void persistState('invflux')}
            onCancel={cancelChange}
          />
        </Portal>
      </Show>

      {/* Un-govern confirmation (InvFlux → External/None). Portaled so position-fixed is
          viewport-relative (not relative to the tab's transformed ancestor). Message reflects the
          target: External hands the quantity to WooCommerce; None stops tracking altogether. */}
      <Show when={pendingChange()?.kind === 'disabling'}>
        <Portal mount={props.portalRoot}>
          <ConfirmModal
            title={__('Stop InvFlux managing this product?')}
            variant="danger"
            confirmLabel={
              pendingChange()!.target === 'external'
                ? __('Hand over to WooCommerce')
                : __('Stop tracking')
            }
            message={
              <>
                <p>
                  {__("InvFlux will stop managing this product's stock.")}{' '}
                  {pendingChange()!.target === 'external'
                    ? __('WooCommerce will manage the quantity instead.')
                    : __("WooCommerce won't track it either — its stock will be untracked.")}
                </p>
                <Show when={settings()!.ledger_entry_count > 0}>
                  <p class="mt-2 text-text-muted">
                    {sprintf(
                      /* translators: %d: number of stock movements recorded for this product */
                      _n(
                        'This product has %d recorded movement in InvFlux; existing history is preserved.',
                        'This product has %d recorded movements in InvFlux; existing history is preserved.',
                        settings()!.ledger_entry_count,
                      ),
                      settings()!.ledger_entry_count,
                    )}
                  </p>
                </Show>
              </>
            }
            onConfirm={() => void persistState(pendingChange()!.target)}
            onCancel={cancelChange}
          />
        </Portal>
      </Show>

      {/* Override the store-wide enforced tracking lock (Pro) — only reachable by an override-capable
          user. Confirming un-governs via the privileged REST path the server permits; the server
          re-checks the override policy, so this is a UX gate, not the security gate. */}
      <Show when={pendingChange()?.kind === 'override'}>
        <Portal mount={props.portalRoot}>
          <ConfirmModal
            title={__('Override the tracking lock?')}
            variant="danger"
            confirmLabel={__('Override and stop managing')}
            message={
              <>
                <p>
                  <span class="font-semibold">{__('Stock tracking is enforced store-wide.')}</span>{' '}
                  {pendingChange()!.target === 'external'
                    ? __(
                        'Turning it off for this product overrides that policy — WooCommerce will manage the quantity instead.',
                      )
                    : __(
                        "Turning it off for this product overrides that policy — this product's stock will no longer be tracked.",
                      )}
                </p>
                <Show when={settings()!.ledger_entry_count > 0}>
                  <p class="mt-2 text-text-muted">
                    {sprintf(
                      /* translators: %d: number of stock movements recorded for this product */
                      _n(
                        'This product has %d recorded movement; existing history is preserved.',
                        'This product has %d recorded movements; existing history is preserved.',
                        settings()!.ledger_entry_count,
                      ),
                      settings()!.ledger_entry_count,
                    )}
                  </p>
                </Show>
              </>
            }
            onConfirm={() => void persistState(pendingChange()!.target)}
            onCancel={cancelChange}
          />
        </Portal>
      </Show>
    </div>
  );
}
