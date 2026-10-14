import { For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { __, sprintf } from '@invflux/i18n';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { createDragReorder } from '../dragReorder';
import type { SettingControlProps } from './registry';
import { registerSettingSummary, settingControlRegistry } from './registry';

/**
 * `ordered-toggles` — an ordered list of named items, each switched on or off. For a setting whose
 * answer is a priority: the dispatch queue's ranking rules, first rule first.
 *
 * `config.options` lists every item as `{ value, label }` in its **built-in** order. The value is a
 * list of `{ name, enabled }` in the merchant's order, or empty for the built-in order — so a
 * setting nobody touched stores nothing, and "Reset to the built-in order" stores nothing again.
 * Items the stored list does not name (registered after it was saved) are laid in the way the
 * server lays them ({@link mergeOrderedToggles}), so the screen shows the order that is in effect.
 *
 * Every edit writes the whole list, so once the merchant has moved or switched anything the stored
 * value names every item and its order is the merchant's alone.
 */

export interface OrderedToggleOption {
  value: string;
  label: string;
}

export interface OrderedToggleRow extends OrderedToggleOption {
  enabled: boolean;
}

interface StoredEntry {
  name: string;
  enabled: boolean;
}

/**
 * Lay a stored list over the options — the client twin of the server's `QueueRank::merge()`, with
 * an option's index standing in for the rule's built-in `order` (the options arrive in that order).
 *
 * - Stored names that are no longer options, or that repeat, are skipped.
 * - An option the stored list does not name goes right after the last row that precedes it in the
 *   built-in order, or first when none does.
 */
export function mergeOrderedToggles(
  options: readonly OrderedToggleOption[],
  stored: unknown,
): OrderedToggleRow[] {
  const position = new Map(options.map((opt, i) => [opt.value.toLowerCase(), i]));
  const listed = new Set<string>();
  const rows: OrderedToggleRow[] = [];

  for (const entry of Array.isArray(stored) ? (stored as unknown[]) : []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const key = name.toLowerCase();
    const at = position.get(key);
    if (at === undefined || listed.has(key)) continue;
    listed.add(key);
    rows.push({ ...options[at]!, enabled: (entry as { enabled?: unknown }).enabled !== false });
  }

  options.forEach((opt, index) => {
    if (listed.has(opt.value.toLowerCase())) return;
    let at = 0;
    rows.forEach((row, i) => {
      if ((position.get(row.value.toLowerCase()) ?? 0) <= index) at = i + 1;
    });
    rows.splice(at, 0, { ...opt, enabled: true });
  });

  return rows;
}

function OrderedTogglesControl(props: SettingControlProps): JSX.Element {
  const options = (): OrderedToggleOption[] =>
    Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as OrderedToggleOption[])
      : [];
  const rows = (): OrderedToggleRow[] => mergeOrderedToggles(options(), props.value);
  const isBuiltIn = (): boolean => !Array.isArray(props.value) || props.value.length === 0;

  /** Every edit stores the whole list, in the order on screen. */
  const commit = (next: OrderedToggleRow[]): void => {
    props.onChange(next.map((row): StoredEntry => ({ name: row.value, enabled: row.enabled })));
  };

  const toggle = (name: string, enabled: boolean): void => {
    commit(rows().map((row) => (row.value === name ? { ...row, enabled } : row)));
  };

  /** Move `fromName` into `toName`'s slot — the one definition of a move, for drag and keys alike. */
  const move = (fromName: string, toName: string): void => {
    const next = rows();
    const from = next.findIndex((row) => row.value === fromName);
    const to = next.findIndex((row) => row.value === toName);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    commit(next);
  };

  const reorder = createDragReorder((fromName, toName) => {
    if (!props.disabled) move(fromName, toName);
  });
  let listEl: HTMLOListElement | undefined;

  /**
   * Alt+↑/↓ moves a row past its neighbor, through the same {@link move} the drag uses. Moving
   * re-inserts the row and blurs its checkbox, so focus is put back by name — otherwise a second
   * Alt+arrow would reach nothing.
   */
  const nudge = (name: string, delta: -1 | 1): void => {
    const list = rows();
    const at = list.findIndex((row) => row.value === name);
    const neighbor = list[at + delta];
    if (at < 0 || neighbor === undefined) return;
    move(name, neighbor.value);
    queueMicrotask(() =>
      listEl?.querySelector<HTMLInputElement>(`input[data-rule="${CSS.escape(name)}"]`)?.focus(),
    );
  };

  return (
    // A group, as with the multiselect: each row carries its own label, so the setting's name
    // belongs to the list rather than to any one row.
    <div
      id={props.controlId}
      aria-describedby={props.describedBy}
      role="group"
      aria-labelledby={props.labelId}
      class="flex flex-col gap-y-2"
    >
      <Show when={!props.disabled && rows().length > 1}>
        <p class="text-sm text-text-muted">
          {__('Drag to reorder, or hold Alt and press the arrow keys.')}
        </p>
      </Show>
      <ol ref={listEl} class="flex flex-col gap-y-1" data-testid="ordered-toggles">
        <For each={rows()}>
          {(row, i) => (
            <>
              <Show when={reorder.isDropTarget(row.value)}>
                <li class="h-0.5 rounded bg-primary" aria-hidden="true" />
              </Show>
              <li
                class="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-text hover:bg-muted"
                classList={{ 'opacity-50': reorder.isDragging(row.value) }}
                {...(props.disabled ? {} : reorder.itemProps(row.value))}
              >
                <Show when={!props.disabled}>
                  <span
                    class="w-3 shrink-0 cursor-move select-none text-text-muted"
                    aria-hidden="true"
                  >
                    ⋮⋮
                  </span>
                </Show>
                <span
                  class="w-5 shrink-0 text-right tabular-nums text-text-muted"
                  aria-hidden="true"
                >
                  {i() + 1}.
                </span>
                <Checkbox
                  label={row.label}
                  wrapperClass={row.enabled ? 'w-fit' : 'w-fit text-text-muted'}
                  data-rule={row.value}
                  checked={row.enabled}
                  disabled={props.disabled}
                  onChange={(e) => toggle(row.value, e.currentTarget.checked)}
                  onKeyDown={(e) => {
                    if (props.disabled || !e.altKey) return;
                    if ('ArrowUp' !== e.key && 'ArrowDown' !== e.key) return;
                    // The browser would otherwise scroll the page under the cursor.
                    e.preventDefault();
                    nudge(row.value, 'ArrowUp' === e.key ? -1 : 1);
                  }}
                />
              </li>
            </>
          )}
        </For>
      </ol>
      <Show when={0 === rows().length}>
        <p class="text-sm text-text-muted">{__('Nothing available.')}</p>
      </Show>
      <div>
        <Button
          variant="quiet"
          size="xs"
          disabled={props.disabled || isBuiltIn()}
          onClick={() => props.onChange([])}
        >
          {__('Reset to the built-in order')}
        </Button>
      </div>
    </div>
  );
}

settingControlRegistry.register('ordered-toggles', 'core.ordered-toggles', OrderedTogglesControl, {
  default: true,
});

/**
 * The value in one line: the rules that rank, numbered, then the ones switched off. An empty value
 * spells the built-in order out rather than showing nothing, so a reset reads as what it restores.
 */
registerSettingSummary('ordered-toggles', (value, definition) => {
  const options = Array.isArray(definition.config.options)
    ? (definition.config.options as OrderedToggleOption[])
    : [];
  const rows = mergeOrderedToggles(options, value);
  const on = rows.filter((row) => row.enabled);
  const off = rows.filter((row) => !row.enabled);
  const numbered = on.map((row, i) => `${i + 1}. ${row.label}`).join(', ');
  const ranked = on.length > 0 ? numbered : __('No rule ranks');
  const parts = [
    !Array.isArray(value) || value.length === 0
      ? sprintf(
          /* translators: %s: the numbered list of ranking rules, e.g. "1. Ready to pack first, 2. …". */
          __('Built-in order: %s'),
          ranked,
        )
      : ranked,
  ];
  if (off.length > 0) {
    parts.push(
      sprintf(
        /* translators: %s: the names of the rules switched off, comma-separated. */
        __('off: %s'),
        off.map((row) => row.label).join(', '),
      ),
    );
  }

  return parts.join(' · ');
});
