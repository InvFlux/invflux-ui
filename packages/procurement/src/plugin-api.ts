import {
  Button,
  Checkbox,
  Combobox,
  IconButton,
  Input,
  Modal,
  Pill,
  Select,
  Spinner,
  Textarea,
  installPluginApi as installSharedPluginApi,
  toast,
  type PluginApi,
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
  /** Shared UI primitives — same as `@invflux/ui`'s public exports. */
  ui: {
    Button: typeof Button;
    IconButton: typeof IconButton;
    Input: typeof Input;
    Select: typeof Select;
    Textarea: typeof Textarea;
    Checkbox: typeof Checkbox;
    Pill: typeof Pill;
    Spinner: typeof Spinner;
    Combobox: typeof Combobox;
    Modal: typeof Modal;
    toast: typeof toast;
    /** Router link, host-bound: an add-on renders `<A href="/purchase-orders/…">` and navigation
     *  runs on the host's own router instance (signals/context don't cross bundled router copies). */
    A: typeof A;
    /** Procurement status/stage pill — so an add-on's drill-down rows match the list's badges. */
    StatusPill: typeof StatusPill;
    /** The base "On order" drill-down body — the aggregate and its upgrade prompt. An add-on that
     *  replaces that drill-down renders this whenever the server answers `locked`, so a lapsed
     *  licence still shows what is on order rather than nothing. */
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
    ui: {
      Button,
      IconButton,
      Input,
      Select,
      Textarea,
      Checkbox,
      Pill,
      Spinner,
      Combobox,
      Modal,
      toast,
      A,
      StatusPill,
      OnOrderSummary: OnOrderDrilldown,
    },
  });
}
