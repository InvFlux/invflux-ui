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
  StagePill,
  Textarea,
  StockConcernBadge,
  ViewerBadge,
  installPluginApi as installSharedPluginApi,
  type PluginApi,
} from '@invflux/ui';
import { queueSortEntitlements, queueSortRegistry, type QueueSortRule } from './queueSort';
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
 * `window.invflux.dispatch` plug-in surface.
 * Thin host binding over the shared `installPluginApi` from `@invflux/ui`:
 * the shared installer provides the registry / slot `register*` methods;
 * this module supplies the runtime **bridge** — the host's SolidJS
 * instance + `@invflux/ui` primitives — so plug-in scripts build their
 * components against the host's runtime (signals don't cross instances).
 *
 * Plug-in scripts enqueue with `invflux-dispatch` as a WP script
 * dependency so they load after this bundle but before the (deferred)
 * mount, and can register first.
 *
 * Mirrors the workbench's binding in
 * `packages/workbench/src/plugin-api.ts` so a plug-in targeting both
 * SPAs has the same shape under `window.invflux.workbench` and
 * `window.invflux.dispatch`.
 */
export interface DispatchBridge {
  /** Curated SolidJS runtime subset for plug-in components. */
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
   * Shared UI primitives — keeps plug-in visuals consistent with the host. The atomic set
   * (`Button` … `Spinner`) is what stops an add-on hand-rolling its own controls; because a bridge
   * component renders with the **host's** stylesheet, an add-on gets them pre-styled without
   * generating those utilities into its own sheet.
   */
  /**
   * Contribute a ranking rule to the dispatch queue's client-side sort.
   *
   * The queue loads its working set once and then polls for deltas, so after the first page every
   * row an operator sees was ordered on the client. A capability that ranks orders therefore has to
   * register **both** halves — this and the server's `QueueSortRegistry` fragment — with the same
   * `order` number, or the two disagree the moment a delta arrives.
   *
   * Gate the registration on whatever gates the capability. The add-on's bundle loads whenever its
   * plugin is active, which is not the same question as whether its licence currently allows the
   * feature; registering unconditionally would leave a lapsed install sorting by something the
   * server has stopped honouring.
   */
  registerQueueSort: (rule: QueueSortRule) => void;
  /** This install's dispatch entitlements, for gating a contributed rule. */
  entitlements: () => Record<string, boolean>;
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
    StagePill: typeof StagePill;
    StockConcernBadge: typeof StockConcernBadge;
    ViewerBadge: typeof ViewerBadge;
  };
}

export type DispatchPluginApi = PluginApi<DispatchBridge>;

/**
 * Install (once) the `window.invflux.dispatch` surface with the
 * dispatch runtime bridge. Idempotent via the shared installer. Called
 * at module load from main.tsx, before mount, so plug-in scripts that
 * registered against this entry point can run first.
 */
export function installPluginApi(): DispatchPluginApi {
  return installSharedPluginApi<DispatchBridge>('dispatch', {
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
    registerQueueSort: (rule) => queueSortRegistry.register(rule),
    entitlements: () => queueSortEntitlements(),
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
      StagePill,
      StockConcernBadge,
      ViewerBadge,
    },
  });
}
