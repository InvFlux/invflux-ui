import { createContext, useContext } from 'solid-js';
import type { ProcurementContext } from './types';

/** Boot context (REST root, nonce, user, capabilities) made available to route components. */
export const ProcurementCtx = createContext<ProcurementContext>();

export function useProcurement(): ProcurementContext {
  const ctx = useContext(ProcurementCtx);
  if (!ctx) throw new Error('ProcurementCtx not provided');
  return ctx;
}
