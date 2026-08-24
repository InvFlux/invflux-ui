import { describe, expect, it } from 'vitest';
import { createComponentRegistry, type ComponentRegistry } from '../datatypes/registry';
import { resolveSettingControl, SETTING_CONTROL_FALLBACK, type SettingControl } from './registry';

// Distinct sentinel "controls" — compared by reference (no JSX runtime in the node test env).
const make = (): SettingControl => (() => null) as unknown as SettingControl;
const json = make();
const num = make();
const text = make();
const alt = make();

function registry(): ComponentRegistry<SettingControl> {
  const reg = createComponentRegistry<SettingControl>();
  reg.register(SETTING_CONTROL_FALLBACK, 'core.json', json, { default: true });
  reg.register('number', 'core.number', num, { default: true });
  reg.register('text', 'core.text', text, { default: true });

  return reg;
}

describe('resolveSettingControl', () => {
  it("resolves the exact datatype's default control", () => {
    expect(resolveSettingControl('number', undefined, registry())).toBe(num);
  });

  it('falls back to the json control for an unknown top-level slug', () => {
    expect(resolveSettingControl('myplugin.peer-map', undefined, registry())).toBe(json);
  });

  it('walks the base:variant parent chain before falling back to json', () => {
    // `text:long` isn't registered → datatypeChain falls back to `text`, NOT the json fallback.
    expect(resolveSettingControl('text:long', undefined, registry())).toBe(text);
  });

  it('prefers an explicitly chosen component id', () => {
    const reg = registry();
    reg.register('number', 'alt.number', alt);

    expect(resolveSettingControl('number', 'alt.number', reg)).toBe(alt);
    // An unknown chosen id falls back to the datatype default.
    expect(resolveSettingControl('number', 'does-not-exist', reg)).toBe(num);
  });

  it('returns null only when even the json fallback is unregistered', () => {
    const bare = createComponentRegistry<SettingControl>();
    expect(resolveSettingControl('anything', undefined, bare)).toBeNull();
  });
});
