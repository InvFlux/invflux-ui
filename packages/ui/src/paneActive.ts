import { createContext, useContext, type Accessor } from 'solid-js';

/**
 * Whether the pane a component is mounted in is the one currently on screen.
 *
 * The app shell keeps surfaces **mounted** while showing only the active one, so "is this component
 * rendered" and "is anyone looking at it" stopped being the same question. Background work has to
 * ask the second one: a hidden pane that keeps polling spends requests nobody reads, and a hidden
 * order that keeps sending presence heartbeats tells the rest of the staff that someone is working
 * on an order they are not looking at — a wrong answer, not merely a wasteful one.
 *
 * Distinct from the *browser* tab being focused, which TanStack already handles via
 * `refetchIntervalInBackground: false` and the heartbeat handles via `document.visibilityState`.
 * Both gates are needed: this one is about which pane is in front inside a single visible page.
 *
 * Defaults to **always active**, so a component mounted outside the shell — a standalone admin
 * page, the embedded product-tab grid, a test — behaves exactly as it did before.
 */
export const PaneActiveCtx = createContext<Accessor<boolean>>(() => true);

/** Whether this pane is the one on screen. Always `true` outside the app shell. */
export function usePaneActive(): Accessor<boolean> {
  return useContext(PaneActiveCtx);
}
