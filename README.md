# invflux-ui

The admin interfaces for [InvFlux for WooCommerce](https://wordpress.org/plugins/invflux-for-woocommerce/) — SolidJS applications built with Vite, compiled into the JavaScript that plugin ships in its `build/` directory.

This repository exists so that code is not a black box. WordPress.org requires public, maintained access to the source of anything compiled or minified inside a plugin, and this is that source. It is equally the reference for anyone writing an InvFlux add-on that contributes to these screens.

## Building

Node 22. From a clean checkout:

```bash
npm install
INVFLUX_PLUGIN_DIR=/absolute/path/to/output npm run build
```

That produces `<output>/build/app/` and `<output>/build/product-tab/`, which are exactly the two directories the plugin ships.

Use an **absolute** path. `INVFLUX_PLUGIN_DIR` is read once per surface, from inside that surface's own package directory, so a relative value produces a separate output tree per package rather than one shared one.

Omit the variable and the output goes to `../../../invflux-for-woocommerce/build/`, a sibling checkout of the plugin. That is the development layout: a build lands directly in the plugin the dev site loads, with no copy step.

Builds are reproducible — dependency versions are pinned in `package-lock.json`, and Vite derives each filename from a hash of its content, so the same commit yields byte-identical bundles.

## Layout

Two packages are buildable entry points; the rest are sources they consume.

| Package | |
| --- | --- |
| `app` | the unified admin application — one entry point, code-split per screen |
| `product-tab` | the Inventory tab on a WooCommerce product |
| `ui` | shared components |
| `workbench`, `dispatch`, `procurement`, `admin` | per-screen sources, consumed by `app` |
| `i18n` | translation helpers over `@wordpress/i18n` |
| `build` | the shared Vite configuration factory every surface calls |

## Other commands

```bash
npm run typecheck    # across every package
npm test             # likewise
npm run dev:app      # dev server for the unified app
```

## Licence

Dual-licensed, on the same terms as `invflux-core` and `invflux-storage-mysql`: **GPL-2.0-or-later**, or a commercial licence for use in a proprietary product. See [LICENSE](LICENSE).

The GPL option is what makes the compiled bundles distributable inside the WordPress.org plugin, which is GPLv2-or-later.
