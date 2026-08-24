import { createContext, useContext } from 'solid-js';
import type { AppContext } from './types';

/** Host context provider — every section reads `apiRoot`/`nonce`/`caps`/`tier` from here. */
export const AppCtx = createContext<AppContext>();

export function useApp(): AppContext {
  const ctx = useContext(AppCtx);
  if (!ctx) {
    throw new Error('useApp() called outside <AppCtx.Provider>');
  }
  return ctx;
}
