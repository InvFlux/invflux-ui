import { render } from 'solid-js/web';
import { setLocale, setTextDomain } from '@invflux/i18n';
import {
  HostNavCtx,
  keepVisibleDuringModals,
  keepWordPressAnnouncementsAudible,
  registerCssPropertyRules,
  registerThemeRoot,
} from '@invflux/ui';
import { App } from './App';
import { productTabHostNav } from './hostNav';
import type { ProductTabContext } from './types';
import styles from './styles/product-tab.css?inline';

// WordPress binding: bind the text domain the plugin registered via
// wp_set_script_translations(), so the SPA packages never name it themselves.
setTextDomain('invflux-for-woocommerce');

declare global {
  interface Window {
    invfluxProductTab?: ProductTabContext;
  }
}

const host = document.getElementById('invflux-inventory-root');
if (host) {
  const productId = parseInt(host.dataset['productId'] ?? '0', 10);
  const nonce = host.dataset['nonce'] ?? '';

  const context: ProductTabContext = window.invfluxProductTab ?? {
    apiRoot: '/index.php?rest_route=/',
    nonce,
  };

  // The localized context may not include the nonce; the data attribute is the source of truth here.
  if (!context.nonce) {
    context.nonce = nonce;
  }

  // Bind WordPress's locale beside the text domain, before anything renders: both are the host's to
  // decide, and without it every date and number in the tab follows the browser instead.
  setLocale(context.locale);

  if (productId > 0) {
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];
    // See the unified app's mount: `@property` registration is document-scoped, so the rules have to
    // be hoisted out of the shadow root or Tailwind v4's border/transform/shadow utilities go inert.
    registerCssPropertyRules(sheet);

    // Portal root mounted directly on document.body so modals + toasts can escape the
    // tab's containing block. WC admin's inventory tab puts transforms / containment on
    // ancestor elements, which would break `position: fixed` for descendants of the
    // shadow root — the modal would render inline under the form fields instead of
    // floating above them.
    //
    // A shadow root of its own, not a light-DOM div carrying a `<style>`: a `<style>` element
    // styles the whole document wherever it sits, so the mirror made every utility rule live
    // across wp-admin. Adopting the sheet into a second shadow root keeps the same styling with
    const portalHost = document.createElement('div');
    portalHost.id = 'invflux-product-tab-portal';
    // Same as the unified app: an open menu or dialog must not hide its own overlay tree, or
    // WordPress's announcements, from screen readers. See `keepVisibleDuringModals()`.
    keepVisibleDuringModals(portalHost);
    keepWordPressAnnouncementsAudible();
    document.body.appendChild(portalHost);
    const portalShadow = portalHost.shadowRoot ?? portalHost.attachShadow({ mode: 'open' });
    portalShadow.adoptedStyleSheets = [sheet];
    const portalRoot = document.createElement('div');
    portalShadow.appendChild(portalRoot);

    // Both hosts, for the same reason as the unified app: overlays render in the second tree and
    // must resolve the same stored appearance as the first.
    registerThemeRoot(host);
    registerThemeRoot(portalHost);

    render(
      () => (
        // Cross-page links (grid ledger action, "Manage product in workbench") target the unified app,
        // not the dead standalone pages — see productTabHostNav. Provided above <App> so App's own
        // useHostNav() and every descendant (EmbeddedWorkbench → WorkbenchGrid) read it.
        <HostNavCtx.Provider value={productTabHostNav}>
          <App context={context} productId={productId} portalRoot={portalRoot} />
        </HostNavCtx.Provider>
      ),
      shadow,
    );
  }
}
