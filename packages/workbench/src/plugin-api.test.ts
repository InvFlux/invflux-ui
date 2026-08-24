import { beforeEach, describe, expect, it, vi } from 'vitest';

// @invflux/ui's components call solid-js/web's delegateEvents at module load, which needs a DOM.
// The node test env has none, so stub the UI primitives — but keep the (pure, DOM-free) datatype
// registries real, imported straight from the registry module, so the registration assertions
// run against the same instances the plug-in API uses.
/**
 * The atomic primitives the bridge hands to add-ons. Shared by the mock and the assertion below so
 * the two cannot drift apart.
 *
 * They are **stubbed**, not imported for real: this suite runs in the `node` environment, and a
 * compiled Solid component carrying an event handler (`Pill`'s dismiss button) calls
 * `delegateEvents` at module load, which needs a `document`. Nothing is lost by stubbing — that the
 * real components exist and are exported is pinned by the bridge's own types (`Button: typeof
 * Button` fails to compile if the export goes away), which is a stronger guarantee than a runtime
 * `typeof === "function"` check. What this test pins is the *shape of the bridge*: that each
 * primitive is actually wired into `installPluginApi`'s `ui` object and reaches `window.invflux`.
 */
const ATOMICS = vi.hoisted(
  () => ['Button', 'IconButton', 'Input', 'Select', 'Textarea', 'Checkbox', 'Pill', 'Spinner'] as const,
);

vi.mock('@invflux/ui', async () => {
  const registry = await import('../../ui/src/datatypes/registry');
  const slots = await import('../../ui/src/slots');
  const pluginApi = await import('../../ui/src/plugin-api');
  const toastMod = await import('../../ui/src/toast');
  return {
    Combobox: () => null,
    Modal: () => null,
    ...Object.fromEntries(ATOMICS.map((name) => [name, () => null])),
    ...registry,
    ...slots,
    ...pluginApi,
    ...toastMod,
  };
});

import type { ViewComponent } from '@invflux/ui';
import { viewRegistry } from '@invflux/ui';
import { installPluginApi } from './plugin-api';

// installPluginApi only touches `window` when called, so a minimal stub set per-test suffices.
describe('installPluginApi', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  it('exposes the register* surface, solid runtime and ui primitives', () => {
    const api = installPluginApi();
    expect(window.invflux?.workbench).toBe(api);
    expect(typeof api.registerView).toBe('function');
    expect(typeof api.registerEdit).toBe('function');
    expect(typeof api.registerDrilldown).toBe('function');
    expect(typeof api.registerCodec).toBe('function');
    expect(typeof api.registerDiffPreview).toBe('function');
    expect(typeof api.registerSlot).toBe('function');
    expect(typeof api.registerFilterControl).toBe('function');
    expect(typeof api.registerBulkAction).toBe('function');
    expect(typeof api.solid.createSignal).toBe('function');
    expect(typeof api.solid.Show).toBe('function');
    expect(typeof api.ui.Combobox).toBe('function');
    expect(typeof api.ui.Modal).toBe('function');
    // The atomic suite — an add-on hand-rolling its own <button> is what this exposure prevents.
    for (const name of ATOMICS) {
      expect(typeof api.ui[name], name).toBe('function');
    }
    expect(typeof api.toast).toBe('function');
    expect(typeof api.toast.success).toBe('function');
  });

  it('registerView routes into the shared view registry with its label', () => {
    const api = installPluginApi();
    const Comp: ViewComponent = () => null;
    api.registerView('plugin.test:thing', 'demo.view', Comp, { default: true, label: 'Demo view' });

    expect(viewRegistry.resolve('plugin.test:thing')).toBe(Comp);
    expect(viewRegistry.list('plugin.test:thing')).toContainEqual({
      id: 'demo.view',
      label: 'Demo view',
      isDefault: true,
    });
  });

  it('is idempotent — repeated installs return the same surface', () => {
    expect(installPluginApi()).toBe(installPluginApi());
  });
});
