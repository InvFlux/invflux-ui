import tailwindcss from '@tailwindcss/vite';
import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vite';

// Config-time env access, declared locally rather than via `@types/node` (the only Node surface
// this package touches).
/** @type {{ env: Record<string, string | undefined> }} */
// eslint-disable-next-line no-undef
const proc = process;

/**
 * Plain JavaScript on purpose, with types in `index.d.ts`.
 *
 * Vite loads a `vite.config.ts` by bundling it with esbuild, and whether a workspace dependency is
 * inlined into that bundle or left as a runtime `import` depends on how the package is linked. A
 * TypeScript entry only survives the inlined case; JavaScript survives both. A build package that
 * itself needs building would also be a needless bootstrap step.
 */

/**
 * Where a surface's bundle is written, relative to its package directory.
 *
 * The default points at a sibling checkout of the WordPress plugin, which is the working layout:
 * a build lands directly in the plugin the dev site loads, with no copy step. It also means a
 * standalone clone of this repository writes its output *outside* itself, which is surprising to
 * anyone who cloned it only to reproduce the shipped bundles — so `INVFLUX_PLUGIN_DIR` overrides
 * it, and the plugin's readme points reviewers at that. A relative value resolves from the
 * package being built (`packages/app`, `packages/product-tab`), not from the repository root.
 */
const DEFAULT_PLUGIN_DIR = process.env.INVFLUX_PLUGIN_DIR || '../../../invflux-for-woocommerce';

/**
 * The module specifiers an add-on shares with its host instead of bundling.
 *
 * Only the Solid runtime, deliberately. Compiled JSX emits calls into `solid-js/web`
 * (`template`/`insert`/`createComponent`/`delegateEvents`/…), and a second copy of that runtime is a
 * second reactive graph: the add-on's signals do not drive the host's effects, and vice versa. The
 * failure is silent — the surface renders once and then never updates — which is why this is a
 * compatibility contract rather than a bundle-size optimisation.
 *
 * `@invflux/ui` is NOT here: an add-on reaches host components through the curated
 * `window.invflux.<spa>.ui` bridge, which already hands it components built on the host's runtime.
 */
const SHARED_RUNTIME_SPECIFIERS = ['solid-js', 'solid-js/web', 'solid-js/store'];

/** Where the host publishes its runtime. Must match the app's boot (`main.tsx`). */
const HOST_RUNTIME_GLOBAL = 'invflux.runtime';

const VIRTUAL_PREFIX = '\0invflux-shared-runtime:';

/**
 * Resolve the shared specifiers to generated shims that re-export the **host's** runtime.
 *
 * The shim is generated rather than hand-written because Solid's export surface is large (50+ names
 * on `solid-js` alone, 70+ on `solid-js/web`) and compiled JSX reaches for internals no add-on
 * author ever types. Enumerating the installed package keeps the bridge complete by construction; a
 * hand-maintained list would silently lose a name on a Solid upgrade, and the symptom would again be
 * "renders once, never updates".
 */
/**
 * Drop `data-testid` attributes from the shipped bundle.
 *
 * Opt-in via `INVFLUX_STRIP_TESTIDS=1`, which only the release build sets (`bin/build-dist.sh` in
 * the adapter). Every other build — dev server, and the `build/` output the wp-env install serves —
 * keeps them, because that is the DOM the E2E suite drives: stripping everywhere would delete the
 * hooks the suite targets and leave it matching translated text again.
 *
 * Runs `pre`, i.e. on `.tsx` source before `vite-plugin-solid` compiles it. After compilation the
 * attribute has been folded into a `_tmpl$` template *string* (or a `setAttribute` call for a
 * dynamic one), so removing it there would mean rewriting generated code — pattern-matching JSX
 * source is both simpler and safer.
 *
 * Both attribute forms have to go. The static one is a plain string, but real components also pass
 * testids through (`data-testid={props['data-testid']}`) and compute them
 * (`data-testid={`first-run-step2-${phase()}`}`), and those emit attributes at runtime just the
 * same — a static-only strip silently ships them. The braced form is scanned with a depth counter
 * rather than a regex because the value may itself contain braces, which is exactly what a template
 * literal does.
 */
function stripTestIdsPlugin() {
  /** Remove `data-testid={…}`, honouring nested braces inside the expression. */
  function stripBraced(code) {
    const ATTR = 'data-testid={';
    let out = code;
    for (let at = out.indexOf(ATTR); -1 !== at; at = out.indexOf(ATTR, at)) {
      let depth = 0;
      let end = at + ATTR.length - 1; // sits on the opening brace
      for (; end < out.length; end++) {
        if ('{' === out[end]) depth++;
        else if ('}' === out[end] && 0 === --depth) break;
      }
      if (end >= out.length) break; // unbalanced — leave it rather than corrupt the source

      // Swallow the preceding whitespace too, so the surrounding JSX keeps its spacing.
      let start = at;
      while (start > 0 && /\s/.test(out[start - 1])) start--;
      out = out.slice(0, start) + out.slice(end + 1);
    }

    return out;
  }

  return {
    name: 'invflux:strip-testids',
    enforce: 'pre',

    transform(code, id) {
      if (!id.endsWith('.tsx') || !code.includes('data-testid')) return null;

      return { code: stripBraced(code.replace(/\s+data-testid="[^"]*"/g, '')), map: null };
    },
  };
}

function sharedRuntimePlugin() {
  return {
    name: 'invflux:shared-runtime',
    // Ahead of Vite's own resolution, so the bare specifier never reaches node_modules.
    enforce: 'pre',

    /**
     * `vite-plugin-solid` adds Solid to `optimizeDeps.include` so the dev server pre-bundles it.
     * That is right for an app and wrong for an add-on: pre-bundling produces a second copy, which
     * is the thing we are preventing — and combined with our `exclude` it is not even a silent
     * problem, esbuild refuses outright ("The entry point 'solid-js' cannot be marked as external").
     *
     * Stripping it in `configResolved` rather than in `config` is deliberate: plugin `config` hooks
     * merge by concatenation and ours runs first, so anything removed there is simply re-added.
     */
    configResolved(resolved) {
      const include = resolved.optimizeDeps?.include;
      if (Array.isArray(include)) {
        resolved.optimizeDeps.include = include.filter(
          (dep) => 'solid-js' !== dep && !dep.startsWith('solid-js/'),
        );
      }
    },

    resolveId(id) {
      return SHARED_RUNTIME_SPECIFIERS.includes(id) ? VIRTUAL_PREFIX + id : null;
    },

    async load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;

      const specifier = id.slice(VIRTUAL_PREFIX.length);
      const real = await import(specifier);
      const names = Object.keys(real).filter((name) => 'default' !== name);

      const access = `globalThis.${HOST_RUNTIME_GLOBAL}?.[${JSON.stringify(specifier)}]`;

      return [
        `const runtime = ${access};`,
        'if (!runtime) {',
        '  throw new Error(',
        `    ${JSON.stringify(
          `[invflux] The host's Solid runtime is missing (${HOST_RUNTIME_GLOBAL}["${specifier}"]). ` +
            'An add-on bundle must be enqueued as a script module depending on the InvFlux app module, ' +
            'so it evaluates after the app has published its runtime.',
        )},`,
        '  );',
        '}',
        // One binding per export. Copied at evaluation time, which is correct for the functions and
        // constants Solid exposes; the host module object is already fully initialised by then.
        ...names.map((name) => `export const ${name} = runtime[${JSON.stringify(name)}];`),
      ].join('\n');
    },
  };
}

/**
 * The one Vite config every InvFlux admin SPA is built with.
 *
 * A surface declares its identity — name, output shape, dev port — and inherits everything else:
 * output naming, externals, the dev server and its cross-origin settings, and the dev-vs-build
 * fork. An add-on gets the same contract by calling this instead of copying a config, so a change
 * to how PHP locates an asset is a version bump rather than an N-repository migration.
 *
 * @param {import('./index.js').InvFluxViteOptions} options
 * @returns {ReturnType<typeof defineConfig>}
 */
export function createInvFluxViteConfig(options) {
  const {
    surface,
    format = 'iife',
    globalName,
    entry = 'src/main.tsx',
    devPort = 5173,
    pluginDir = DEFAULT_PLUGIN_DIR,
    configUrl,
    alias = {},
    sharedRuntime = false,
    test = { environment: 'node', include: ['src/**/*.test.ts'] },
  } = options;

  if ('iife' === format && !globalName) {
    throw new Error(`@invflux/build: surface "${surface}" is an iife build and needs a globalName.`);
  }
  if ('esm' === format && !configUrl) {
    throw new Error(
      `@invflux/build: surface "${surface}" is an esm build and needs configUrl (pass import.meta.url) ` +
        'so its entry and aliases resolve against the calling package, not this one.',
    );
  }

  /** Absolute path against the *calling* config's URL — this file's own URL would be wrong. */
  const fromCaller = (rel) => new URL(rel, configUrl).pathname;

  // The wp-admin page and the dev server are different origins (the site is served on its own host
  // and port, the dev server on :5173), so Vite ≥6 refuses the cross-origin request unless the
  // admin origin is named here, and the HMR socket has to be told where to connect.
  const adminOrigin = proc.env.INVFLUX_DEV_HOST_URL ?? 'http://localhost:8888';
  const port = Number(proc.env.INVFLUX_VITE_PORT ?? String(devPort));

  return defineConfig(({ command }) => ({
    define: {
      // Dependencies (TanStack Query et al.) read `process.env.NODE_ENV` at runtime and the bundle
      // has no Node shim. This MUST track the actual mode: hard-coding 'production' in a dev-server
      // run leaves Solid on its production build and silently disables HMR — a failure that reads
      // as a broken setup rather than a mis-set flag.
      'process.env.NODE_ENV': JSON.stringify('build' === command ? 'production' : 'development'),
    },
    plugins: [
      // Before solidPlugin: the strip works on JSX source, not on compiled templates.
      ...('1' === proc.env.INVFLUX_STRIP_TESTIDS ? [stripTestIdsPlugin()] : []),
      solidPlugin(),
      tailwindcss(),
      ...(sharedRuntime ? [sharedRuntimePlugin()] : []),
    ],
    ...(Object.keys(alias).length > 0 ? { resolve: { alias } } : {}),
    // Keep the shared specifiers out of dependency pre-bundling: an optimised copy would be a second
    // runtime, reintroducing under the dev server exactly what the shim prevents in a build.
    ...(sharedRuntime ? { optimizeDeps: { exclude: SHARED_RUNTIME_SPECIFIERS } } : {}),
    server: {
      port,
      // Fail loudly rather than drifting to the next port: PHP enqueues a fixed one, so a silent
      // bump means a blank surface. Ports are allocated per plugin (§3.3), not discovered.
      strictPort: true,
      cors: { origin: adminOrigin },
      origin: `http://localhost:${port}`,
      allowedHosts: [new URL(adminOrigin).hostname],
      hmr: { host: 'localhost', port, protocol: 'ws' },
    },
    build:
      'esm' === format
        ? {
            // **ESM app build.** Required wherever the surface uses lazy routes: IIFE/UMD cannot
            // code-split (Rollup errors outright). This is the standard Vite backend-integration
            // shape — `manifest: true` emits `.vite/manifest.json` for PHP to resolve the hashed
            // entry and preload the shared chunk, and each `import()` becomes its own hashed chunk.
            // Chunks are self-locating (relative ESM imports resolve against the entry module URL),
            // so no runtime `base` gymnastics are needed.
            outDir: `${pluginDir}/build/${surface}`,
            emptyOutDir: true,
            sourcemap: true,
            manifest: true,
            target: 'es2022',
            modulePreload: { polyfill: false },
            rollupOptions: {
              input: fromCaller(`./${entry}`),
              output: {
                format: 'es',
                entryFileNames: `${surface}.[hash].js`,
                chunkFileNames: 'chunk-[name].[hash].js',
                assetFileNames: `${surface}.[hash][extname]`,
              },
            },
          }
        : {
            // **IIFE lib build.** Fixed output filename, enqueued by path — the shape for a surface
            // that mounts one component tree and needs no code splitting. `@wordpress/i18n` is
            // external and read off the `wp.i18n` global that WordPress already puts on the page.
            outDir: `${pluginDir}/build/${surface}`,
            emptyOutDir: true,
            sourcemap: true,
            lib: {
              entry,
              formats: ['iife'],
              name: globalName,
              fileName: () => `${surface}.js`,
            },
            rollupOptions: {
              external: ['@wordpress/i18n'],
              output: {
                globals: { '@wordpress/i18n': 'wp.i18n' },
                assetFileNames: `${surface}.[ext]`,
              },
            },
          },
    test,
  }));
}
