import { render } from 'solid-js/web';
import { setTextDomain } from '@invflux/i18n';
import { HostNavCtx } from '@invflux/ui';
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

  const context: ProductTabContext =
    window.invfluxProductTab ?? {
      apiRoot: '/index.php?rest_route=/',
      nonce,
    };

  // The localized context may not include the nonce; the data attribute is the source of truth here.
  if (!context.nonce) {
    context.nonce = nonce;
  }

  if (productId > 0) {
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];

    // Portal root mounted directly on document.body so modals + toasts can escape the
    // tab's containing block. WC admin's inventory tab puts transforms / containment on
    // ancestor elements, which would break `position: fixed` for descendants of the
    // shadow root — the modal would render inline under the form fields instead of
    // floating above them. The portal carries its own <style> tag with the same CSS
    // (constructable adoptedStyleSheets don't reach across the shadow boundary).
    const portalRoot = document.createElement('div');
    portalRoot.id = 'invflux-product-tab-portal';
    const portalStyle = document.createElement('style');
    portalStyle.textContent = styles;
    portalRoot.appendChild(portalStyle);
    document.body.appendChild(portalRoot);

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
