import { createContext, useContext } from 'solid-js';

/**
 * Where an order detail view is mounted, and what that implies about its chrome.
 *
 * The same component serves two placements. **Embedded** it is one route inside the Dispatch
 * surface, with the queue behind it — so it offers the way back and the neighbours either side.
 * **Standalone** it is a tab of its own, promoted out of the queue: there is no queue behind it to
 * return to, and "the order before this one" has no meaning once the list it was ordered by is not
 * on screen. Both affordances are removed rather than disabled, because a disabled control claims
 * a thing exists and is merely unavailable.
 *
 * `orderPath` exists because the two placements route differently: embedded, the surface's memory
 * router owns bare `/<hexId>`; standalone, the order is a shell route. Anything navigating to
 * another order asks for the path rather than assuming either shape.
 */
export interface OrderViewMode {
  /** True when the order owns the whole tab and nothing sits behind it. */
  standalone: boolean;
  /** The route to another order from wherever this view is mounted. */
  orderPath: (hexId: string) => string;
  /**
   * Which order this view is showing, when the route cannot say.
   *
   * `useParams()` answers for the route *currently matched*, not the one a component was mounted
   * under — so a kept-alive pane sitting behind another tab reads `undefined` the moment the URL
   * moves elsewhere. Placements that outlive their route supply the id here instead.
   */
  hexId?: () => string;
  /**
   * Report that this order holds unsaved work — today, an unsent note draft.
   *
   * Embedded, nobody is listening: the queue's own tab already says "Dispatch", and the order is
   * one route inside it. Promoted, the order IS the tab, so its tab is the only place the state
   * can show — and the only warning before a close throws the draft away.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Embedded in the Dispatch surface — the default, so nothing existing has to opt in. */
const EMBEDDED: OrderViewMode = {
  standalone: false,
  orderPath: (hexId: string): string => `/${hexId}`,
};

export const OrderViewCtx = createContext<OrderViewMode>(EMBEDDED);

export function useOrderView(): OrderViewMode {
  return useContext(OrderViewCtx);
}

/** The shell route a promoted order tab lives at. One definition, shared by the link and the route. */
export function standaloneOrderPath(hexId: string): string {
  return `/order/${hexId}`;
}
