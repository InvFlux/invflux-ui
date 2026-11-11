import { replaceEqualDeep } from '@tanstack/solid-query';

/**
 * A refetch keeps every object whose content did not change.
 *
 * TanStack Query normally does this itself ("structural sharing"), but its Solid binding turns that
 * off and leaves the choice to the `reconcile` option, whose default replaces the data wholesale. A
 * refetch that brings back exactly what was on screen would then hand every consumer new objects,
 * and a grid keyed on its rows redraws every one of them. Set as the client's default `reconcile`,
 * this restores the usual behavior: identical data keeps its identity, and a change replaces only
 * the objects on its path, so only what changed is drawn again.
 */
export function keepUnchanged<T>(previous: T | undefined, next: T): T {
  return replaceEqualDeep(previous, next);
}
