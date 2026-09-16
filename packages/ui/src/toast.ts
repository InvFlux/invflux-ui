import { createSignal } from 'solid-js';

/**
 * Shared transient-notification (toast) store + API. SPA-agnostic and signal-backed: this module
 * is DOM-free, so it's node-testable; the visual host is the separate
 * {@link ToastRegion} component, which each SPA shell mounts once.
 *
 * Usage:
 *   import { toast } from "@invflux/ui";
 *   toast.success("Saved");
 *   toast("Heads up", { variant: "warning", duration: 8000 });
 *   const id = toast.info("Working…", { duration: 0 }); // sticky; dismiss manually
 *   toast.dismiss(id);
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/** An optional inline action button (e.g. "Reject", "Undo"). Clicking it runs `onClick`. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss after this many ms; `0` = sticky (manual dismiss only). */
  duration: number;
  action?: ToastAction;
}

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms before auto-dismiss; `0` = sticky. Defaults to {@link DEFAULT_TOAST_DURATION}. */
  duration?: number;
  action?: ToastAction;
}

/** Default auto-dismiss window. */
export const DEFAULT_TOAST_DURATION = 4000;

/** How long a dismissed toast lingers (marked leaving) so its fade-out transition can play. */
export const TOAST_EXIT_MS = 300;

const [toastList, setToastList] = createSignal<Toast[]>([]);
// Ids in their fade-out window — tracked SEPARATELY from the toast objects so dismissing one does
// NOT change a toast's identity (which would make `<For>` remount it and skip the exit transition).
const [leavingList, setLeavingList] = createSignal<ReadonlySet<number>>(new Set());
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

/** Reactive accessor for the active toasts — consumed by {@link ToastRegion}. */
export const toasts = toastList;
/** Reactive accessor for the set of ids currently fading out. */
export const leavingIds = leavingList;

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
}

/** Hard-remove a toast (after its fade-out window). */
function remove(id: number): void {
  clearTimer(id);
  setToastList((prev) => prev.filter((t) => t.id !== id));
  setLeavingList((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}

/**
 * Dismiss a toast: mark it leaving so {@link ToastRegion} fades it out, then hard-remove after
 * {@link TOAST_EXIT_MS}. Idempotent (a second call while leaving is a no-op). The store stays
 * DOM-free — just signals + timers, node-testable with fake timers.
 */
function dismiss(id: number): void {
  if (leavingList().has(id) || !toastList().some((t) => t.id === id)) {
    return;
  }
  clearTimer(id); // cancel any pending auto-dismiss
  setLeavingList((prev) => new Set(prev).add(id));
  setTimeout(() => remove(id), TOAST_EXIT_MS);
}

function clear(): void {
  for (const id of timers.keys()) clearTimeout(timers.get(id)!);
  timers.clear();
  setToastList([]);
  setLeavingList(new Set<number>());
}

function show(message: string, opts: ToastOptions = {}): number {
  const id = nextId++;
  const entry: Toast = {
    id,
    message,
    variant: opts.variant ?? 'info',
    duration: opts.duration ?? DEFAULT_TOAST_DURATION,
    action: opts.action,
  };
  setToastList((prev) => [...prev, entry]);
  if (entry.duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), entry.duration),
    );
  }
  return id;
}

/** Callable toast API with per-variant convenience methods. Returns the new toast's id. */
export const toast = Object.assign(
  (message: string, opts?: ToastOptions): number => show(message, opts),
  {
    show,
    info: (message: string, opts?: ToastOptions): number =>
      show(message, { ...opts, variant: 'info' }),
    success: (message: string, opts?: ToastOptions): number =>
      show(message, { ...opts, variant: 'success' }),
    warning: (message: string, opts?: ToastOptions): number =>
      show(message, { ...opts, variant: 'warning' }),
    error: (message: string, opts?: ToastOptions): number =>
      show(message, { ...opts, variant: 'error' }),
    dismiss,
    clear,
  },
);
