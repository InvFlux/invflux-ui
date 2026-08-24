import { For, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import type { EditMove, EditProps } from './registry';
import { codecRegistry, editRegistry } from './registry';

/**
 * Built-in per-cell edit components (§11.4), keyed by datatype slug, registered into
 * editRegistry on import. An editor mounts in place of the cell's view while that cell is
 * being edited; it auto-focuses, commits on Enter/Tab/blur (moving the active cell per the
 * direction) and reverts on Escape. Values are validated through the datatype codec —
 * invalid input reverts rather than committing (type-strict, §11.10.1).
 */

/**
 * Shared text-input editor used for the scalar datatypes (number, decimal, text). The codec for
 * the column's datatype validates the typed text on commit; an invalid value reverts rather than
 * committing (type-strict, §11.10.1). `align`/`inputmode` are the only per-datatype differences:
 * numeric types right-align with a numeric/decimal inputmode, text left-aligns.
 */
function makeInputEditor(opts: { align: 'left' | 'right'; inputmode?: 'numeric' | 'decimal' }): (props: EditProps) => JSX.Element {
  return (props: EditProps) => {
    let ref: HTMLInputElement | undefined;
    const initial = props.initialText ?? (props.value === null || props.value === undefined ? '' : String(props.value));

    onMount(() => {
      ref?.focus();
      // No initialText (F2 / double-click) → select all so typing replaces; typed-char seed
      // leaves the cursor after the seed character.
      if (props.initialText === undefined) ref?.select();
    });

    const commit = (move: EditMove): void => {
      const codec = codecRegistry.resolve(props.column.dataType);
      const raw = ref?.value ?? '';
      const parsed = codec
        ? codec.parse(raw, { config: props.column.editorConfig, taxonomySpace: props.ctx.taxonomySpace })
        : raw;
      if (parsed === null) {
        props.onCancel(); // invalid → revert
        return;
      }
      props.onCommit(parsed, move);
    };

    return (
      <input
        ref={ref}
        // `text` + numeric/decimal inputmode (not `number`) so the arrow keys move the text caret
        // like a normal spreadsheet editor rather than nudging a spinner; the codec validates on commit.
        type="text"
        inputmode={opts.inputmode}
        // Fills the cell with a little vertical breathing room; a focus ring stands in for the border.
        class={`block h-full w-full select-text border-0 bg-surface px-2 py-2 outline-none ring-2 ring-inset ring-blue-500 ${
          opts.align === 'right' ? 'text-right tabular-nums' : 'text-left'
        }`}
        value={initial}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commit(e.shiftKey ? 'up' : 'down');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            commit(e.shiftKey ? 'left' : 'right');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          }
        }}
        onBlur={() => commit(null)}
      />
    );
  };
}

/**
 * Focus a select editor and immediately open its dropdown so a double-click / F2 lands directly on
 * the option list (no second click). `showPicker()` needs transient user activation — a double-click
 * provides it; when it's absent (e.g. typed-char entry) it throws and we silently fall back to a
 * focused-but-closed select.
 */
function openSelect(ref: HTMLSelectElement | undefined): void {
  ref?.focus();
  try {
    ref?.showPicker();
  } catch {
    /* no user activation — leave the select focused but closed */
  }
}

/**
 * Boolean editor: a focused Yes/No select. Enter commits (moving down), Shift+Enter up, Tab across,
 * Escape reverts. Emits a real boolean (the bool codec accepts the round-trip too).
 */
function BoolEditor(props: EditProps) {
  let ref: HTMLSelectElement | undefined;
  const initial = props.value === true ? 'true' : 'false';

  onMount(() => openSelect(ref));

  const commit = (move: EditMove): void => {
    props.onCommit(ref?.value === 'true', move);
  };

  return (
    <select
      ref={ref}
      class="block h-full w-full border-0 bg-surface px-2 py-2 outline-none ring-2 ring-inset ring-blue-500"
      value={initial}
      // Picking an option commits immediately (natural dropdown UX, and a native <select> swallows
      // Enter). Keydown still handles Enter/Tab/Escape for keyboard-only flows.
      onChange={() => commit(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? 'up' : 'down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
        }
      }}
      onBlur={() => commit(null)}
    >
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

/**
 * Enum editor: a focused select over the column's declared `editorConfig.options`
 * (`{ value, label }[]`). The select can only yield a declared value, so it commits directly
 * (no codec round-trip needed); paste into the cell still validates through the enum codec.
 */
function EnumEditor(props: EditProps): JSX.Element {
  let ref: HTMLSelectElement | undefined;
  const options = Array.isArray(props.column.editorConfig.options)
    ? (props.column.editorConfig.options as Array<{ value: string; label: string }>)
    : [];
  const initial = props.value === null || props.value === undefined ? '' : String(props.value);

  onMount(() => {
    // Options render via <For>, so the `value=` binding above can apply before they exist and fall back
    // to the first option (e.g. an "External" cell opening on "InvFlux"). Re-assert once mounted.
    if (ref) ref.value = initial;
    openSelect(ref);
  });

  const commit = (move: EditMove): void => {
    props.onCommit(ref?.value ?? '', move);
  };

  return (
    <select
      ref={ref}
      class="block h-full w-full border-0 bg-surface px-2 py-2 outline-none ring-2 ring-inset ring-blue-500"
      value={initial}
      // Picking an option commits immediately (natural dropdown UX, and a native <select> swallows
      // Enter). Keydown still handles Enter/Tab/Escape for keyboard-only flows.
      onChange={() => commit(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? 'up' : 'down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
        }
      }}
      onBlur={() => commit(null)}
    >
      <For each={options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
    </select>
  );
}

editRegistry.register('number', 'core.number-input', makeInputEditor({ align: 'right', inputmode: 'numeric' }), { default: true });
editRegistry.register('decimal', 'core.decimal-input', makeInputEditor({ align: 'right', inputmode: 'decimal' }), { default: true });
editRegistry.register('text', 'core.text-input', makeInputEditor({ align: 'left' }), { default: true });
editRegistry.register('bool', 'core.bool-select', BoolEditor, { default: true });
editRegistry.register('enum', 'core.enum-select', EnumEditor, { default: true });
