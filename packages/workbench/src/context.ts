import { createContext, useContext } from 'solid-js';
import type { WorkbenchContext } from './types';

export const WorkbenchCtx = createContext<WorkbenchContext | undefined>(undefined);

export function useWorkbench(): WorkbenchContext {
  const ctx = useContext(WorkbenchCtx);
  if (!ctx) throw new Error('WorkbenchCtx not provided');
  return ctx;
}
