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
import { A } from '@solidjs/router';
import { OnOrderDrilldown } from './components/OnOrderDrilldown';
import { StatusPill } from './components/StatusPill';
import { commitNavEntitlements, commitNavRegistry, type CommitNavRule } from './gridCommitNav';

/**
 * The `window.invflux.procurement.*` plug-in surface — a thin host binding over the shared
 * installer. The shared installer provides the registry/slot `register*` methods; the
 * procurement SPA supplies the runtime **bridge** below —
 * its own SolidJS instance + the `@invflux/ui` primitives — so add-on scripts build against the
 * host's runtime (signals don't cross instances).
 *
 * Add-on scripts enqueue with `invflux-procurement` as a WP dependency, so they load after this
 * bundle but before the (deferred) mount and can register their sections/tabs/columns first.
 */
export interface ProcurementBridge {
  /**
   * Contribute a rule deciding where focus goes after a grid cell is committed.
   *
   * The base moves the way the editor asked and offers no opinion beyond that, so an unextended
   * install has no rule at all. A capability that wants to close a filter/edit cycle — so an
   * operator never reaches for the keyboard between entries — contributes it here, composed from
   * the operations the rule's context hands over.
   *
   * Gate the rule on whatever gates the capability, through `enabled`. A bundle loads whenever its
   * plugin is active, which is not the same question as whether its license currently allows the
   * feature; an unconditional rule would leave a lapsed install still behaving as though paid.
   */
  registerCommitNav: (rule: CommitNavRule) => void;
  /** This install's procurement entitlements, for gating a contributed rule. */
  entitlements: () => Record<string, boolean>;
  /** Curated SolidJS runtime subset for add-on components. */
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
   * dialog and its frame), plus this surface's own. A bridge component renders with the **host's**
   * stylesheet, so an add-on gets it pre-styled without generating those utilities into its own sheet.
   */
  ui: SharedPluginUi & {
    toast: typeof toast;
    /** Router link, host-bound: an add-on renders `<A href="/purchase-orders/…">` and navigation
     *  runs on the host's own router instance (signals/context don't cross bundled router copies). */
    A: typeof A;
    /** Procurement status/stage pill — so an add-on's drill-down rows match the list's badges. */
    StatusPill: typeof StatusPill;
    /** The base "On order" drill-down body — the aggregate and its upgrade prompt. An add-on that
     *  replaces that drill-down renders this whenever the server answers `locked`, so a lapsed
     *  license still shows what is on order rather than nothing. */
    OnOrderSummary: typeof OnOrderDrilldown;
  };
}

export type ProcurementPluginApi = PluginApi<ProcurementBridge>;

/** Install (once) `window.invflux.procurement` with this host's runtime bridge. */
export function installPluginApi(): ProcurementPluginApi {
  return installSharedPluginApi<ProcurementBridge>('procurement', {
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
    registerCommitNav: (rule) => commitNavRegistry.register(rule),
    entitlements: () => commitNavEntitlements(),
    ui: {
      ...sharedPluginUi,
      toast,
      A,
      StatusPill,
      OnOrderSummary: OnOrderDrilldown,
    },
  });
}
