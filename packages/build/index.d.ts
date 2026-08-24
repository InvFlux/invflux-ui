import type { UserConfig } from 'vite';

export interface InvFluxViteOptions {
  /**
   * Surface name — the single source of every output name: `build/<surface>/<surface>.js` for an
   * IIFE build, `build/<surface>/<surface>.<hash>.js` for an ESM one.
   */
  surface: string;

  /**
   * `iife` (default) for a surface that mounts one tree and is enqueued by path; `esm` for one
   * with lazy routes, which IIFE cannot express (Rollup refuses to code-split it).
   */
  format?: 'iife' | 'esm';

  /** IIFE global name, e.g. `InvFluxWorkbench`. Required when `format` is `iife`. */
  globalName?: string;

  /** Entry module, relative to the package root. */
  entry?: string;

  /**
   * Dev-server port. 5173 is the base plugin's; add-ons take 5174+, allocated centrally —
   * two surfaces sharing a port serve each other's modules.
   */
  devPort?: number;

  /** Where built assets land, relative to the package root. Defaults to the base plugin. */
  pluginDir?: string;

  /**
   * The **calling** config's `import.meta.url`. Paths resolved inside the factory would otherwise
   * resolve against this package. Required for `esm`, which resolves an absolute entry.
   */
  configUrl?: string;

  /** Extra `resolve.alias` entries merged into the config. */
  alias?: Record<string, string>;

  /**
   * Build against the **host's** Solid runtime instead of bundling one.
   *
   * For an add-on that authors its own JSX. `solid-js`, `solid-js/web` and `solid-js/store` resolve
   * to generated shims re-exporting `window.invflux.runtime`, so the add-on's signals and the host's
   * share one reactive graph. A second bundled copy would not error — it would render once and never
   * update again.
   *
   * The add-on writes ordinary imports (`import { createSignal } from 'solid-js'`) and needs nothing
   * else in its config. It must be enqueued as a script module depending on the app module, so it
   * evaluates after the host publishes the runtime.
   */
  sharedRuntime?: boolean;

  /** Vitest config for the package; pass `undefined` to omit. */
  test?: UserConfig['test'];
}

export declare function createInvFluxViteConfig(options: InvFluxViteOptions): UserConfig;
