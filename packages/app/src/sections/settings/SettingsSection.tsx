import { PortalCtx } from '@invflux/ui';
// Reuse the standalone admin Settings SPA wholesale (strangler-fig, like WorkbenchSection): the
// unified app imports the @invflux/admin `App` and renders it as a lazy route, so the legacy admin
// page keeps working untouched and there is zero duplication of SettingsView. Deep-import into the
// package src (no `exports` map) — a temporary coupling to its internal path, fine while it is still
// an app package.
import { App as AdminApp } from '@invflux/admin/src/App';
import type { AdminContext } from '@invflux/admin/src/types';
import { useSearchParams } from '@solidjs/router';
import { type JSX, onCleanup, useContext } from 'solid-js';
import { useApp } from '../../context';
import { mirroredSearchParam, settingsDeepLink } from './deepLink';

/**
 * System-wide **Settings** surface (stage c). Opened from the
 * launcher and the gear's "All Settings" — config, not a dwell-in workflow, so it renders via a
 * direct `/settings` route (like the Ledger detail view), **not** a `nav.section`, and never appears
 * in the center singleton tab strip.
 *
 * The admin Settings SPA owns no router, so there is no nested-router concern (§12.3) — it embeds as
 * cleanly as the Workbench. It has its own QueryClient today; a later pass can hand it the shell's
 * shared client if Settings ever needs to share cache with another surface.
 */
export default function SettingsSection(): JSX.Element {
  const app = useApp();
  const portalRoot = useContext(PortalCtx);
  const [params, setParams] = useSearchParams();

  // `?q=` mirrors the search box, so a filtered view is shareable, bookmarkable and survives a
  // reload. Written with `replace` and on a short timer, for two separate reasons: pushed per
  // keystroke it would turn the back button into an undo-by-letter walk out of the merchant's own
  // search, and Safari rate-limits `replaceState`, so a write per keypress can simply be dropped.
  //
  // The timer means the URL ALWAYS LAGS the box during typing, which is a condition the inbound
  // half has to tolerate rather than race — see `followUrlSearch`. Do not remove the debounce to
  // "fix" a field that wipes itself; that was the symptom, not the cause.
  let mirror: ReturnType<typeof setTimeout> | undefined;
  const mirrorSearch = (term: string): void => {
    clearTimeout(mirror);
    mirror = setTimeout(() => {
      // Dropped rather than left empty: `?q=` with nothing after it is noise in a shared link.
      setParams({ q: mirroredSearchParam(term) }, { replace: true });
    }, 250);
  };
  onCleanup(() => clearTimeout(mirror));

  const context: AdminContext = {
    apiRoot: app.apiRoot,
    nonce: app.nonce,
    capabilities: {
      manageSettings: app.capabilities.manageSettings ?? false,
    },
    // `#/settings?decisions=1` opens with the "needs a decision" filter applied — the first-run
    // screen's count links here, and a count that dropped you into the full list would leave the
    // merchant hunting for the settings it just counted. The embedded SPA owns no router, so the
    // shell reads the param and hands down the intent rather than the URL.
    // A getter, not a value: the shell keeps this section mounted and only toggles visibility, so a
    // link arriving while Settings has already been visited never re-runs this component. Read at
    // access time instead, and the effect on the other side sees the change.
    get startOnDecisions(): boolean {
      return settingsDeepLink(params).decisions;
    },
    // Getters for the same reason as above: this section stays mounted, so a second arrival by a
    // link must be read at access time rather than captured when the component first ran.
    get startSearch(): string {
      return settingsDeepLink(params).search;
    },
    // `?section=` carries an outline KEY, not a search term — a term would be the section's
    // translated label, so a link minted on an English install would match nothing in French.
    get revealSection(): string | undefined {
      return settingsDeepLink(params).revealSection;
    },
    onSearchChange: mirrorSearch,
  };

  return <AdminApp context={context} portalRoot={portalRoot as HTMLElement} />;
}
