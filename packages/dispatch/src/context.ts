import { createContext, useContext } from 'solid-js';
import type { DispatchContext } from './types';

export const DispatchCtx = createContext<DispatchContext | undefined>(undefined);

export function useDispatch(): DispatchContext {
  const ctx = useContext(DispatchCtx);
  if (!ctx) throw new Error('DispatchCtx not provided');
  return ctx;
}
