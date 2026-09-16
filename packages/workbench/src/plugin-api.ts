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
   * Shared UI primitives — same as `@invflux/ui`'s public exports. The atomic set
   * (`Button` … `Spinner`) is what stops a plug-in hand-rolling its own controls; a bridge
   * component renders with the **host's** stylesheet, so they arrive pre-styled.
   */
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
  };
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
    },
    toast,
  });
}
