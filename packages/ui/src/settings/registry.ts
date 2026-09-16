import type { JSX } from 'solid-js';
import { createComponentRegistry, type ComponentRegistry } from '../datatypes/registry';

/**
 * Settings-UI control registry.
 *
 * A setting's `dataType` slug selects which control renders it — the SAME MIME-style contract as
 * the workbench column registries, reusing {@link createComponentRegistry} + `datatypeChain`. It's
 * a SEPARATE instance with its own props contract because a settings form has no grid-cell
 * semantics (no onCommit/EditMove/initialText): a control just renders a value and stages changes.
 *
 * `json` is the universal fallback: {@link resolveSettingControl} returns it for any slug with no
 * registered control or registered ancestor, so an unrenderable setting always degrades to a raw
 * JSON editor (VSCode's "edit in settings.json" as the automatic floor, not a separate mode).
 */

/** The datatype slug whose control is the universal fallback. */
export const SETTING_CONTROL_FALLBACK = 'json';

/** Catalog UI schema handed to a control (everything but the value, which is a separate prop). */
export interface SettingMeta {
  name: string;
  dataType: string;
  config: Record<string, unknown>;
  title: string | null;
  description: string | null;
  group: string | null;
  /** Display-only label naming what unlocks the setting; shown only when `gate === "locked"`. */
  tier: string | null;
  gate: 'open' | 'locked';
}

export interface SettingControlProps {
  value: unknown;
  definition: SettingMeta;
  /**
   * DOM id the control MUST put on the element the setting's visible name labels.
   *
   * Required, not optional, on the same principle as `IconButton`'s `label`: the host renders the
   * name and can associate it, but only the control knows which of its elements is *the* field. A
   * control that drops this renders an input with no accessible name at all — which is what every
   * one of them did before, on the largest form surface in the SPA.
   *
   * A composite control (several inputs, each already named) puts this on its wrapper and adds
   * `role="group"` + `aria-labelledby={labelId}` instead, so the group carries the setting's name
   * and the children keep their own.
   */
  controlId: string;
  /** DOM id of the element rendering the setting's visible name, for `aria-labelledby`. */
  labelId: string;
  /**
   * DOM id of the row's error message while one is showing, else undefined.
   *
   * Put it on the same element as {@link controlId}. Without it the message is announced when it
   * appears and then becomes unreachable: someone tabbing back to the field to fix the value hears
   * the field's name and nothing about what was wrong with it.
   */
  describedBy?: string;
  /** True when the setting is gate-locked or policy-locked: the control renders read-only. */
  disabled: boolean;
  effectivePolicy: 'local' | 'replicated';
  /** Stage a pending change into the form's dirty set (commit + validation are form-level, §10.6). */
  onChange: (value: unknown) => void;
}

export type SettingControl = (props: SettingControlProps) => JSX.Element;

/** The app-wide settings-control registry. Built-ins register at module load (see controls.tsx). */
export const settingControlRegistry: ComponentRegistry<SettingControl> =
  createComponentRegistry<SettingControl>();

/**
 * Resolve the control for a setting's `dataType`: prefer an explicitly chosen component id, then
 * the datatype's default (walking the `base:variant` parent chain), then the universal `json`
 * fallback. Returns null only when even the fallback is unregistered.
 *
 * `registry` defaults to the app-wide singleton; it's injectable for testing.
 */
export function resolveSettingControl(
  dataType: string,
  chosenId?: string,
  registry: ComponentRegistry<SettingControl> = settingControlRegistry,
): SettingControl | null {
  return registry.resolve(dataType, chosenId) ?? registry.resolve(SETTING_CONTROL_FALLBACK);
}
