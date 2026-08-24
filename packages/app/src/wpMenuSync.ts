/**
 * Sync the WordPress admin **sidebar** (`#adminmenu`) InvFlux active-highlight to the SPA's current
 * surface.
 *
 * The migrated menu items (Workbench / Dispatch / Procurement / Settings) all live on one page
 * (`page=invflux-app`) as `#/<route>` hash links, so switching between them is a same-page hash change
 * — no reload, which is the point. But WP renders the sidebar highlight server-side, once per page
 * load, so without help it stays stuck on whichever item was current at load. This toggles the
 * `.current` class + `aria-current` among the InvFlux submenu links on every hash change (and once at
 * boot) so the sidebar follows the app.
 *
 * Light-DOM only (the WP chrome lives outside the app's shadow root); a no-op when `#adminmenu` isn't
 * present (e.g. a non-admin context or a future front-end mount).
 */

/** The top-level surface of a route fragment; the empty/`/` default is the workbench. */
function surfaceOf(fragment: string): string {
  const seg = fragment.replace(/^#?\/?/, '').split(/[/?]/, 1)[0];
  return '' === seg ? 'workbench' : seg;
}

export function startWpMenuSync(): void {
  const sync = (): void => {
    const menu = document.getElementById('adminmenu');
    if (null === menu) return;

    const links = menu.querySelectorAll<HTMLAnchorElement>('a[href*="page=invflux-app"]');
    if (0 === links.length) return;

    const current = surfaceOf(window.location.hash);
    links.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      const linkSurface = surfaceOf(href.includes('#') ? href.slice(href.indexOf('#') + 1) : '');
      const active = linkSurface === current;
      a.closest('li')?.classList.toggle('current', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };

  window.addEventListener('hashchange', sync);
  sync();
}
