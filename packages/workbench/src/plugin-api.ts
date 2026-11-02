import {
  sharedPluginUi,
  installPluginApi as installSharedPluginApi,
  toast,
  type PluginApi,
  type SharedPluginUi,
} from '@invflux/ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * Track 7 — the public `window.invflux.workbench.*` plug-in surface (§7.2), now a thin host
 * binding over the shared installer. The shared
 * installer provides the registry/slot `register*` methods; the workbench supplies the runtime
 * **bridge** below — its own SolidJS instance + the `@invflux/ui` primitives — so plug-in scripts
 * build against the host's runtime (signals don't cross instances).
 *
 * Plug-in scripts enqueue with `invflux-workbench` as a WP script dependency, so they load after
 * this bundle but before the (deferred) mount and can register first.
 */
export interface WorkbenchBridge {
  /** Curated SolidJS runtime subset for plug-in components (§7.2). */
  solid: {
    createSignal: typeof createSignal;
    createMemo: typeof createMemo;
    createEffect: typeof createEffect;
    onMount: typeof onMount;
    onCleanup: typeof onCleanup;
    Show: typeof Show;
    For: typeof For;
    Switch: typeof Switch;
    Match: typeof Match;
    Dynamic: typeof Dynamic;
  };
  /**
   * UI components for add-on markup: the SPA-wide set ({@link SharedPluginUi}: form controls, the
   * dialog and its frame). A bridge component renders with the **host's**
   * stylesheet, so an add-on gets it pre-styled without generating those utilities into its own sheet.
   */
  ui: SharedPluginUi;
  /** Transient notifications — `toast.success(…)`, `toast(…, { variant, duration })`, etc. */
  toast: typeof toast;
}

export type WorkbenchPluginApi = PluginApi<WorkbenchBridge>;

/**
 * Install (once) the `window.invflux.workbench` surface with the workbench runtime bridge.
 * Idempotent via the shared installer. Called at module load from main.tsx, before mount.
 */
export function installPluginApi(): WorkbenchPluginApi {
  return installSharedPluginApi<WorkbenchBridge>('workbench', {
    solid: {
      createSignal,
      createMemo,
      createEffect,
      onMount,
      onCleanup,
      Show,
      For,
      Switch,
      Match,
      Dynamic,
    },
    ui: { ...sharedPluginUi },
    toast,
  });
}
