import { createContext, useContext } from 'solid-js';

/**
 * The surface a component is mounted within, provided by the app shell around each top-level
 * `nav.section`. Lets a shared component (e.g. the DataGrid) know *which* surface it lives in — so it
 * can contribute a settings section to that surface's gear popover (`surfaceSettingsRegistry`) — and
 * open the shell's gear on demand (e.g. the grid's `Ctrl+,`). Absent when the component runs outside
 * the unified app (standalone admin page, embedded product-tab grid) — the component then falls back
 * to its own local UI (e.g. the grid's display-settings modal).
 */
export interface SurfaceContext {
  /** The active surface's `nav.section` id (e.g. "workbench" / "dispatch"). */
  surfaceId: string;
  /** Open the app shell's contextual gear popover (which shows this surface's settings panels). */
  openSettings: () => void;
}

export const SurfaceCtx = createContext<SurfaceContext | undefined>(undefined);

/** The surface this component is mounted in, or `undefined` outside the unified app shell. */
export function useSurface(): SurfaceContext | undefined {
  return useContext(SurfaceCtx);
}
