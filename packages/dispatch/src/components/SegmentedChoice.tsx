import { For, type JSX } from 'solid-js';

/**
 * A labelled row of mutually exclusive buttons — for a choice among two or three answers, where a
 * select would hide the alternatives the operator should see at a glance.
 *
 * A `radiogroup` of `radio` buttons for assistive technology. A disabled option stays visible: an
 * answer that does not apply here is information, and hiding it would make the control's shape
 * change under the operator's hand.
 */
export function SegmentedChoice<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  /** Stable hook for tests and scripts; the labels are translated. */
  name: string;
}): JSX.Element {
  return (
    <div class="block text-xs">
      <span class="block text-gray-600 mb-1">{props.label}</span>
      <div
        role="radiogroup"
        aria-label={props.label}
        class="inline-flex overflow-hidden rounded border border-gray-300"
        data-segmented={props.name}
      >
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.value === option.value}
              disabled={option.disabled}
              title={option.title}
              data-value={option.value}
              class={`border-l border-gray-300 px-3 py-1 text-sm transition-colors first:border-l-0 ${
                props.value === option.value
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text hover:bg-surface-raised'
              } ${option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              onClick={() => {
                if (!option.disabled) props.onChange(option.value);
              }}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
