import { PortalCtx } from '@invflux/ui';
// Reuse the standalone admin Settings SPA wholesale (strangler-fig, like WorkbenchSection): the
// unified app imports the @invflux/admin `App` and renders it as a lazy route, so the legacy admin
// page keeps working untouched and there is zero duplication of SettingsView. Deep-import into the
// package src (no `exports` map) — a temporary coupling to its internal path, fine while it is still
// an app package.
import { App as AdminApp } from '@invflux/admin/src/App';
import type { AdminContext } from '@invflux/admin/src/types';
import { type JSX, useContext } from 'solid-js';
import { useApp } from '../../context';

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

  const context: AdminContext = {
    apiRoot: app.apiRoot,
    nonce: app.nonce,
    capabilities: {
      manageSettings: app.capabilities.manageSettings ?? false,
    },
  };

  return <AdminApp context={context} portalRoot={portalRoot as HTMLElement} />;
}
