import { createSignal, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { __, _x } from '@invflux/i18n';
import { Input } from '../Input';
import { Select } from '../Select';
import type { SettingControlProps } from './registry';
import { settingControlRegistry } from './registry';

/**
 * `number:presets` — a number offered as named presets, with the number itself still editable.
 *
 * For a setting whose honest unit is one the merchant cannot answer in (how many requests their host
 * can take at once), but which someone who knows their host should still be able to set exactly.
 * `config.options` lists the presets as `{ value, label }` with the value as a string; `min`, `max`
 * and `step` bound the free entry as they do for a plain `number`. A stored value matching no preset
 * opens on the free entry, so a hand-set number is never shown as a preset it is not.
 *
 * Registered under `number:presets`, so a host without this module falls back to the plain `number`
 * control through the datatype chain — the same value, without the names.
 */

/** The select's value for "enter a number". Not a number, so it can never collide with a preset. */
const CUSTOM = 'custom';

/** Every control fills its settings-row cell; the rest of the look comes from the primitives. */
const FIELD = 'block w-full';

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function PresetNumberControl(props: SettingControlProps): JSX.Element {
  const presets = (): Array<{ value: string; label: string }> =>
    Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as Array<{ value: string; label: string }>)
      : [];
  const isPreset = (value: unknown): boolean => presets().some((p) => p.value === String(value));
  // Choosing "Custom" keeps the free entry open even while its number happens to match a preset —
  // otherwise typing 3 would snap the select back to Balanced under the cursor.
  const [chosenCustom, setChosenCustom] = createSignal(false);
  const custom = (): boolean =>
    chosenCustom() || (props.value !== null && props.value !== undefined && !isPreset(props.value));

  return (
    <div
      id={props.controlId}
      role="group"
      aria-labelledby={props.labelId}
      aria-describedby={props.describedBy}
      class="flex flex-wrap items-center gap-2"
      data-testid="setting-preset-number"
      data-custom={custom() ? '1' : '0'}
    >
      <Select
        aria-labelledby={props.labelId}
        class={FIELD}
        value={custom() ? CUSTOM : String(props.value ?? '')}
        disabled={props.disabled}
        data-testid="setting-preset-number-select"
        onChange={(e) => {
          const choice = e.currentTarget.value;
          if (CUSTOM === choice) {
            setChosenCustom(true);
            return;
          }
          setChosenCustom(false);
          props.onChange(Number(choice));
        }}
      >
        <For each={presets()}>{(p) => <option value={p.value}>{p.label}</option>}</For>
        <option value={CUSTOM}>{_x('Custom', 'setting preset: enter your own number')}</option>
      </Select>
      <Show when={custom()}>
        <Input
          type="number"
          aria-label={__('Custom value')}
          class="w-24"
          min={numberOrUndefined(props.definition.config.min)}
          max={numberOrUndefined(props.definition.config.max)}
          step={numberOrUndefined(props.definition.config.step)}
          value={props.value === null || props.value === undefined ? '' : String(props.value)}
          disabled={props.disabled}
          data-testid="setting-preset-number-input"
          onInput={(e) => {
            const raw = e.currentTarget.value;
            props.onChange(raw === '' ? null : Number(raw));
          }}
        />
      </Show>
    </div>
  );
}

settingControlRegistry.register('number:presets', 'core.number-presets', PresetNumberControl, {
  default: true,
});
