import { describe, expect, it } from 'vitest';
import { createInvFluxViteConfig } from './index.js';

/**
 * The shared-runtime seam is a **compatibility contract**, not an optimisation: an add-on that ends
 * up with its own copy of Solid does not error, it renders once and then silently stops updating.
 * These tests pin the two things that keep that from happening — that the shared specifiers never
 * resolve to a real package, and that the generated bridge carries the whole surface compiled JSX
 * reaches for.
 */

/** The factory returns a config *function* (it branches on serve-vs-build), so resolve it first. */
const resolve = (options, command = 'build') =>
  createInvFluxViteConfig(options)({ command, mode: 'build' === command ? 'production' : 'development' });

const pluginOf = (config) => config.plugins.flat().find((p) => p && 'invflux:shared-runtime' === p.name);

const base = { surface: 'acme', format: 'esm', configUrl: import.meta.url };

describe('sharedRuntime: off (default)', () => {
  it('leaves the config alone, so a host SPA still bundles its own runtime', () => {
    const config = resolve({ ...base });

    expect(pluginOf(config)).toBeUndefined();
    expect(config.optimizeDeps).toBeUndefined();
  });
});

describe('sharedRuntime: on', () => {
  const config = resolve({ ...base, sharedRuntime: true });
  const plugin = pluginOf(config);

  it('is installed ahead of Vite resolution, so a bare specifier never reaches node_modules', () => {
    expect(plugin).toBeDefined();
    expect(plugin.enforce).toBe('pre');
  });

  it('captures exactly the Solid runtime specifiers, and nothing else', () => {
    expect(plugin.resolveId('solid-js')).toContain('invflux-shared-runtime:solid-js');
    expect(plugin.resolveId('solid-js/web')).toContain('invflux-shared-runtime:solid-js/web');
    expect(plugin.resolveId('solid-js/store')).toContain('invflux-shared-runtime:solid-js/store');

    // @invflux/ui deliberately stays bundled — an add-on reaches host components through the
    // curated window.invflux.<spa>.ui bridge, not by sharing the package.
    expect(plugin.resolveId('@invflux/ui')).toBeNull();
    expect(plugin.resolveId('@solidjs/router')).toBeNull();
    expect(plugin.resolveId('./local-module')).toBeNull();
  });

  it('keeps the dev server from pre-bundling a second copy', async () => {
    expect(config.optimizeDeps.exclude).toContain('solid-js');

    // vite-plugin-solid asks for Solid to be pre-bundled; for an add-on that would produce exactly
    // the second runtime this seam exists to prevent (and esbuild refuses include+exclude outright).
    const resolved = { optimizeDeps: { include: ['solid-js', 'solid-js/web', '@tanstack/solid-query'] } };
    plugin.configResolved(resolved);
    expect(resolved.optimizeDeps.include).toEqual(['@tanstack/solid-query']);
  });

  it('generates a bridge to the host global rather than importing a package', async () => {
    const code = await plugin.load(plugin.resolveId('solid-js'));

    expect(code).toContain('globalThis.invflux.runtime?.["solid-js"]');
    expect(code).not.toMatch(/from ['"]solid-js['"]/);
  });

  it('fails loudly when the host runtime is absent, rather than rendering a dead surface', async () => {
    const code = await plugin.load(plugin.resolveId('solid-js'));

    expect(code).toContain('throw new Error');
    expect(code).toContain('script module');
  });

  it('bridges the API an add-on author writes', async () => {
    const code = await plugin.load(plugin.resolveId('solid-js'));

    for (const name of ['createSignal', 'createEffect', 'createMemo', 'onMount', 'Show', 'For']) {
      expect(code).toContain(`export const ${name} = runtime["${name}"];`);
    }
  });

  it('bridges the internals compiled JSX emits, which no author types by hand', async () => {
    const code = await plugin.load(plugin.resolveId('solid-js/web'));

    // If any of these is missing, a bundle compiles and then fails at render time.
    for (const name of ['template', 'insert', 'createComponent', 'delegateEvents', 'effect', 'spread']) {
      expect(code).toContain(`export const ${name} = runtime["${name}"];`);
    }
  });

  it('bridges the store package', async () => {
    const code = await plugin.load(plugin.resolveId('solid-js/store'));

    expect(code).toContain('export const createStore = runtime["createStore"];');
    expect(code).toContain('globalThis.invflux.runtime?.["solid-js/store"]');
  });

  it('ignores modules it did not create', async () => {
    expect(await plugin.load('\0some-other-plugin:thing')).toBeNull();
  });
});
