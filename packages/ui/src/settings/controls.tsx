import { createSignal, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { __ } from '@invflux/i18n';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Input } from '../Input';
import { Select } from '../Select';
import { Textarea } from '../Textarea';
import type { SettingControlProps } from './registry';
import { settingControlRegistry } from './registry';

/**
 * Built-in settings controls, keyed by datatype slug, registered into
 * {@link settingControlRegistry} on import. Each stages its value via `props.onChange` (the
 * dirty-set model, §10.6) — commit + authoritative validation happen at the form level, not here.
 * `props.disabled` renders read-only (gate-locked or policy-locked).
 */

/** Every control fills its settings-row cell; the rest of the look comes from the primitives. */
const FIELD = 'block w-full';

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function BoolControl(props: SettingControlProps): JSX.Element {
  return (
    <Checkbox
      checked={props.value === true}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.currentTarget.checked)}
    />
  );
}

function NumberControl(props: SettingControlProps): JSX.Element {
  const min = (): number | undefined =>
    typeof props.definition.config.min === 'number' ? props.definition.config.min : undefined;
  const max = (): number | undefined =>
    typeof props.definition.config.max === 'number' ? props.definition.config.max : undefined;

  return (
    <Input
      type="number"
      class={FIELD}
      min={min()}
      max={max()}
      value={asText(props.value)}
      disabled={props.disabled}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        props.onChange(raw === '' ? null : Number(raw));
      }}
    />
  );
}

function TextControl(props: SettingControlProps): JSX.Element {
  return (
    <Input
      type="text"
      class={FIELD}
      value={asText(props.value)}
      disabled={props.disabled}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  );
}

function TextLongControl(props: SettingControlProps): JSX.Element {
  return (
    <Textarea
      class={FIELD}
      rows={4}
      value={asText(props.value)}
      disabled={props.disabled}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  );
}

function EnumControl(props: SettingControlProps): JSX.Element {
  const options = (): Array<{ value: string; label: string }> =>
    Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as Array<{ value: string; label: string }>)
      : [];

  return (
    <Select
      class={FIELD}
      value={asText(props.value)}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <For each={options()}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
    </Select>
  );
}

/**
 * JSON control — the universal fallback (any slug with no registered control degrades here). Edits
 * the raw JSON of a structured value; emits the parsed value on each valid edit and flags an
 * inline parse error while the text is invalid. The form-level validator + summary modal remain
 * the authoritative gate (§10.6) — this hint is just immediate feedback.
 */
function JsonControl(props: SettingControlProps): JSX.Element {
  const [invalid, setInvalid] = createSignal(false);
  const initial = (): string => {
    try {
      return JSON.stringify(props.value ?? null, null, 2);
    } catch {
      return '';
    }
  };

  return (
    <div>
      <Textarea
        class={FIELD}
        rows={6}
        invalid={invalid()}
        spellcheck={false}
        value={initial()}
        disabled={props.disabled}
        onInput={(e) => {
          try {
            const parsed: unknown = JSON.parse(e.currentTarget.value);
            setInvalid(false);
            props.onChange(parsed);
          } catch {
            setInvalid(true);
          }
        }}
      />
      <Show when={invalid()}>
        <p class="mt-1 text-xs text-red-600">{__('Invalid JSON')}</p>
      </Show>
    </div>
  );
}

/**
 * Multiselect control — a checkbox list over `config.options` (`{value,label}[]`); the value is a
 * `string[]` of selected option values. Used for dynamic-option settings like the workbench filter
 * taxonomies (options resolved server-side at request time).
 */
function MultiselectControl(props: SettingControlProps): JSX.Element {
  const options = (): Array<{ value: string; label: string }> =>
    Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as Array<{ value: string; label: string }>)
      : [];
  const selected = (): string[] => (Array.isArray(props.value) ? (props.value as string[]) : []);
  const toggle = (value: string, on: boolean): void => {
    const without = selected().filter((v) => v !== value);
    props.onChange(on ? [...without, value] : without);
  };

  return (
    <div class="flex flex-col gap-y-1">
      <For each={options()}>
        {(opt) => (
          <Checkbox
            label={opt.label}
            wrapperClass="w-fit"
            checked={selected().includes(opt.value)}
            disabled={props.disabled}
            onChange={(e) => toggle(opt.value, e.currentTarget.checked)}
          />
        )}
      </For>
      <Show when={0 === options().length}>
        <p class="text-sm text-text-muted">{__('Nothing available.')}</p>
      </Show>
    </div>
  );
}

/**
 * Meta-columns control — the row editor for "surface host fields as read-only grid columns"
 * settings. The value is a list of `{key, type, label}` rows: `key` picked from
 * `config.options` (the host's request-time field-key list — e.g. distinct WP post-meta keys),
 * `type` from the closed vocabulary below (the localized labels live HERE, client-side, so the
 * boot-resolved PHP catalog never needs a translated config), `label` an optional column-title
 * override. Host-neutral by design: nothing in the control names WordPress — the host's setting
 * title/description carry the platform-specific words.
 */
interface MetaColumnRow {
  key: string;
  type: string;
  label?: string;
}

/** Kept in lock-step with the server's validator (WorkbenchMetaColumnSettings::TYPES). */
const META_COLUMN_TYPES = (): Array<{ value: string; label: string }> => [
  { value: 'text', label: __('Text') },
  { value: 'number', label: __('Whole number') },
  { value: 'decimal', label: __('Decimal') },
  { value: 'decimal:money', label: __('Money') },
  { value: 'bool', label: __('Yes / No') },
  { value: 'date', label: __('Date') },
  { value: 'image:url', label: __('Image (URL)') },
];

function MetaColumnsControl(props: SettingControlProps): JSX.Element {
  const options = (): Array<{ value: string; label: string }> =>
    Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as Array<{ value: string; label: string }>)
      : [];
  const rows = (): MetaColumnRow[] =>
    Array.isArray(props.value)
      ? (props.value as unknown[]).filter(
          (r): r is MetaColumnRow =>
            typeof r === 'object' && r !== null && typeof (r as MetaColumnRow).key === 'string',
        )
      : [];

  const usedKeys = (): Set<string> => new Set(rows().map((r) => r.key));
  // Keys still pickable for a NEW row (each key maps to at most one column).
  const freeKeys = (): Array<{ value: string; label: string }> =>
    options().filter((opt) => !usedKeys().has(opt.value));
  // A row's own choices: the free keys plus its current key — which may no longer exist in the
  // option list (the meta key vanished from the store); keep it visible rather than losing it.
  const choicesFor = (row: MetaColumnRow): Array<{ value: string; label: string }> => {
    const own = options().find((opt) => opt.value === row.key) ?? { value: row.key, label: row.key };
    return [own, ...freeKeys()];
  };

  const update = (index: number, patch: Partial<MetaColumnRow>): void => {
    props.onChange(rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const remove = (index: number): void => {
    props.onChange(rows().filter((_, i) => i !== index));
  };
  const add = (): void => {
    const first = freeKeys()[0];
    if (first === undefined) return;
    props.onChange([...rows(), { key: first.value, type: 'text', label: '' }]);
  };

  return (
    <div class="flex flex-col gap-y-2">
      <For each={rows()}>
        {(row, i) => (
          <div class="flex items-center gap-x-2">
            <Select
              class="min-w-0 flex-[2]"
              value={row.key}
              disabled={props.disabled}
              onChange={(e) => update(i(), { key: e.currentTarget.value })}
            >
              <For each={choicesFor(row)}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
            </Select>
            <Select
              class="min-w-0 flex-1"
              value={row.type}
              disabled={props.disabled}
              onChange={(e) => update(i(), { type: e.currentTarget.value })}
            >
              <For each={META_COLUMN_TYPES()}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
            </Select>
            <Input
              type="text"
              class="min-w-0 flex-[2]"
              placeholder={__('Column title (optional)')}
              value={row.label ?? ''}
              disabled={props.disabled}
              onInput={(e) => update(i(), { label: e.currentTarget.value })}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              aria-label={__('Remove column')}
              title={__('Remove column')}
              onClick={() => remove(i())}
            >
              ✕
            </Button>
          </div>
        )}
      </For>
      <Show when={rows().length === 0}>
        <p class="text-sm text-text-muted">{__('No custom-field columns configured.')}</p>
      </Show>
      <div>
        <Button variant="secondary" size="sm" disabled={props.disabled || freeKeys().length === 0} onClick={add}>
          {__('Add column')}
        </Button>
      </div>
    </div>
  );
}

settingControlRegistry.register('bool', 'core.bool', BoolControl, { default: true });
settingControlRegistry.register('meta-columns', 'core.meta-columns', MetaColumnsControl, { default: true });
settingControlRegistry.register('multiselect', 'core.multiselect', MultiselectControl, { default: true });
settingControlRegistry.register('number', 'core.number', NumberControl, { default: true });
settingControlRegistry.register('text', 'core.text', TextControl, { default: true });
settingControlRegistry.register('text:long', 'core.text-long', TextLongControl, { default: true });
settingControlRegistry.register('enum', 'core.enum', EnumControl, { default: true });
settingControlRegistry.register('json', 'core.json', JsonControl, { default: true });
