import { type Accessor, createEffect, createSignal, type Setter } from 'solid-js';

/**
 * A signal whose value is persisted to localStorage under `key` (JSON). Loads any stored value on
 * init, falling back to `fallback`; writes on every change. Storage failures (quota, private mode,
 * malformed JSON) are swallowed — the signal still works in-memory. Used for grid column layout
 * (visibility / order / sizing) so an operator's column choice survives reloads.
 */
export function persistedSignal<T>(key: string, fallback: T): [Accessor<T>, Setter<T>] {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (null !== raw) initial = JSON.parse(raw) as T;
  } catch {
    /* ignore malformed / unavailable storage */
  }

  const [get, set] = createSignal<T>(initial);

  createEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(get()));
    } catch {
      /* ignore quota / private-mode failures */
    }
  });

  return [get, set];
}
