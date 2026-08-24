import { __ } from '@invflux/i18n';
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

const INPUT = 'w-full rounded border border-slate-300 px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

/** One addable catalogue product (the supplier's catalogue minus products already on the PO). */
export interface AddOption {
  subjectId: number;
  label: string;
  unitPrice: string | null;
}

/**
 * Rapid-add dropdown over the supplier catalogue: auto-focuses, filters as you type, ↑/↓ + Enter to
 * pick, Escape / click-outside to close. `onAdd` fires per pick and the picker stays open (the picked
 * row leaves the list), so a buyer can click down a list. Reused by the draft editor's toolbar button
 * and its append-row product cell.
 */
export function AddPicker(props: { options: AddOption[]; onAdd: (o: AddOption) => void; onClose: () => void }): JSX.Element {
  const [filter, setFilter] = createSignal('');
  const [active, setActive] = createSignal(0);
  let inputRef!: HTMLInputElement;
  let rootRef!: HTMLDivElement;
  onMount(() => inputRef.focus());

  const filtered = (): AddOption[] => {
    const q = filter().toLowerCase().trim();
    return '' === q ? props.options : props.options.filter((o) => o.label.toLowerCase().includes(q));
  };

  createEffect(() => {
    const root = rootRef.getRootNode();
    const onPointerDown = (e: Event): void => {
      if (!e.composedPath().includes(rootRef)) props.onClose();
    };
    root.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => root.removeEventListener('pointerdown', onPointerDown, true));
  });

  const choose = (o: AddOption): void => {
    props.onAdd(o);
    setActive(0);
    inputRef.focus(); // keep the picker hot for the next pick
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const list = filtered();
    if ('ArrowDown' === e.key) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, list.length - 1));
    } else if ('ArrowUp' === e.key) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if ('Enter' === e.key) {
      e.preventDefault();
      const o = list[active()];
      if (o) choose(o);
    } else if ('Escape' === e.key) {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <div ref={rootRef} class="absolute left-0 top-full z-50 mt-1 w-72 rounded border border-slate-200 bg-white shadow-xl">
      <div class="p-1.5">
        <input ref={inputRef} class={INPUT} value={filter()} placeholder={__('Filter products…')} onKeyDown={onKeyDown} onInput={(e) => { setFilter(e.currentTarget.value); setActive(0); }} />
      </div>
      <ul class="max-h-64 overflow-y-auto pb-1">
        <For each={filtered()}>
          {(o, i) => (
            <li
              class="cursor-pointer truncate px-3 py-1.5 font-normal text-slate-700"
              classList={{ 'bg-primary text-white': i() === active(), 'hover:bg-slate-100': i() !== active() }}
              onMouseEnter={() => setActive(i())}
              onClick={() => choose(o)}
            >
              {o.label}
            </li>
          )}
        </For>
        <Show when={0 === filtered().length}>
          <li class="px-3 py-2 text-text-muted">{__('No products to add')}</li>
        </Show>
      </ul>
    </div>
  );
}
