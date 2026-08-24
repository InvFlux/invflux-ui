import {
  codecRegistry,
  diffPreviewRegistry,
  drilldownRegistry,
  editRegistry,
  viewRegistry,
  type Codec,
  type DiffPreviewComponent,
  type DrilldownComponent,
  type EditComponent,
  type RegisterOpts,
  type ViewComponent,
} from './datatypes/registry';
import { slotRegistry, type SlotContribution } from './slots';
import { filterControlRegistry, type FilterControl } from './filters';
import { bulkActionRegistry, type BulkAction } from './bulk-actions';
import {
  entityActionRegistry,
  type EntityAction,
  type EntityActionContext,
} from './entity-actions';

/**
 * Shared plug-in API installer. Each SPA installs an additive-only,
 * version-contracted surface at `window.invflux.<spa>` exposing the registry `register*` methods
 * **plus a curated runtime bridge** (the host's `solid` primitives + `@invflux/ui` components).
 *
 * The bridge is **not optional and is passed in by the host SPA**: a plug-in shipping its own JS
 * bundle must build its Solid components against the *host's* SolidJS instance — signals don't
 * cross runtime instances — so the host hands its own `solid`/`ui` references through. (Keeping
 * the bridge a parameter also keeps this module DOM-free: it imports only the pure registries, so
 * it's safe to load in a node test env.)
 *
 * The datatype registries are global singletons, so `registerView` etc. register the same
 * component everywhere regardless of which SPA surface called them — register once, render in any
 * SPA. `registerSlot` targets the shared slot registry by namespaced key.
 */

/** The registry-facing half of every SPA's plug-in surface (shared, SPA-independent). */
export interface RegistryApi {
  registerView(dataType: string, id: string, component: ViewComponent, opts?: RegisterOpts): void;
  registerEdit(dataType: string, id: string, component: EditComponent, opts?: RegisterOpts): void;
  registerDrilldown(
    dataType: string,
    id: string,
    component: DrilldownComponent,
    opts?: RegisterOpts,
  ): void;
  /** Codecs are one-per-datatype in practice; a stable id keeps re-registration idempotent. */
  registerCodec(dataType: string, codec: Codec, opts?: RegisterOpts & { id?: string }): void;
  registerDiffPreview(
    dataType: string,
    id: string,
    component: DiffPreviewComponent,
    opts?: RegisterOpts,
  ): void;
  /** Register a contribution into a host slot (§3.4), e.g. `<entity>.detail.tab`. */
  registerSlot<P = Record<string, unknown>>(slotKey: string, contribution: SlotContribution<P>): void;
  /** Register a filter control for a filter `type` (§1.2), e.g. a `date-range` control. */
  registerFilterControl(type: string, id: string, component: FilterControl, opts?: RegisterOpts): void;
  /** Register a selection-bar bulk action (§2), e.g. Procurement's "Create PO". */
  registerBulkAction(action: BulkAction): void;
  /**
   * Register an entity-action into a headline/menu scope, e.g. an add-on's
   * "Partial ship" on `po.detail`. The action is a data descriptor (label/icon/group/`run`), so a
   * plain action needs none of the runtime bridge; only an action whose `run` renders host
   * components reaches for the bridge below.
   */
  registerEntityAction<Ctx extends EntityActionContext>(scope: string, action: EntityAction<Ctx>): void;
}

/** A full SPA surface: the shared registry API plus the host-provided runtime bridge. */
export type PluginApi<Bridge = unknown> = RegistryApi & Bridge;

declare global {
  interface Window {
    invflux?: Record<string, unknown>;
  }
}

function registryApi(): RegistryApi {
  return {
    registerView: (dataType, id, component, opts) => viewRegistry.register(dataType, id, component, opts),
    registerEdit: (dataType, id, component, opts) => editRegistry.register(dataType, id, component, opts),
    registerDrilldown: (dataType, id, component, opts) =>
      drilldownRegistry.register(dataType, id, component, opts),
    registerCodec: (dataType, codec, opts) =>
      codecRegistry.register(dataType, opts?.id ?? 'plugin.codec', codec, opts),
    registerDiffPreview: (dataType, id, component, opts) =>
      diffPreviewRegistry.register(dataType, id, component, opts),
    registerSlot: (slotKey, contribution) => slotRegistry.register(slotKey, contribution),
    registerFilterControl: (type, id, component, opts) =>
      filterControlRegistry.register(type, id, component, opts),
    registerBulkAction: (action) => bulkActionRegistry.register(action),
    registerEntityAction: (scope, action) => entityActionRegistry.register(scope, action),
  };
}

/**
 * Install (once per SPA) the `window.invflux.<spa>` surface. Idempotent — repeated calls return
 * the existing surface, so the bundle loading twice can't clobber registrations. Call at module
 * load, before the (deferred) mount, so plug-in scripts can register first.
 *
 * @param spa    the SPA key, e.g. `"workbench"`, `"dispatch"`, `"procurement"`.
 * @param bridge the host's runtime bridge (`{ solid, ui }`) merged into the surface.
 */
export function installPluginApi<Bridge>(spa: string, bridge: Bridge): PluginApi<Bridge> {
  const root = (window.invflux ??= {});
  const existing = root[spa];
  if (existing !== undefined) return existing as PluginApi<Bridge>;

  const api = { ...registryApi(), ...bridge } as PluginApi<Bridge>;
  root[spa] = api;
  return api;
}
