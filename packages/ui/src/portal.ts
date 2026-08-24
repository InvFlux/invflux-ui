import { createContext, useContext } from 'solid-js';

/**
 * Shared light-DOM portal root for overlays that must escape the SPA's shadow boundary — modals and
 * the Kobalte-backed combobox listboxes (Kobalte portals out of the shadow tree, where unmounted
 * content renders unstyled and clicks are swallowed by the host interceptor; see arch-ui-principles
 * §3.9.8). Each SPA creates the root in `main.tsx` (carrying the SPA stylesheet, whitelisted by the
 * click-interceptor) and provides it via `PortalCtx.Provider`.
 *
 * Single context object lives here so `@invflux/ui` components (SearchSelect / SearchMultiSelect /
 * the Combobox shim) can default their portal `mount` to it — each SPA re-exports this from
 * its local `./portal` so existing `usePortalRoot()` call sites keep working unchanged.
 */
export const PortalCtx = createContext<HTMLElement | undefined>(undefined);

/** The provided portal root. Throws when no `PortalCtx.Provider` is in scope (an SPA wiring bug). */
export function usePortalRoot(): HTMLElement {
  const root = useContext(PortalCtx);
  if (!root) throw new Error('PortalCtx not provided');
  return root;
}

/** The provided portal root, or undefined when none is in scope. For library defaults that must not
 *  throw (e.g. a Kobalte wrap falling back to Kobalte's own default mount). */
export function usePortalRootOptional(): HTMLElement | undefined {
  return useContext(PortalCtx);
}
