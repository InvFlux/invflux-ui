import { For, Show, createSignal, onMount } from 'solid-js';
import { toast, toasts, leavingIds, type Toast, type ToastVariant } from './toast';

/**
 * Host region for transient notifications. Mount **once** per SPA
 * shell (inside the shell's shadow root so the app's Tailwind + design tokens apply); it renders
 * whatever {@link toast} has queued. Anchored top-centre: toasts **stack** downward and **fade**
 * in (with a slight settle from above) / out — the fade reads cleanly when several arrive in a
 * burst, where a slide-out would make the stack jump.
 *
 * The store ({@link toast}) is DOM-free and shared, so any code path — core or a plug-in (via the
 * runtime bridge) — can `toast.success(…)` and it surfaces here.
 */

const VARIANT_CLASS: Record<ToastVariant, string> = {
  info: 'border-blue-300 bg-blue-50 text-blue-900',
  success: 'border-green-300 bg-green-50 text-green-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

function ToastItem(props: { toast: Toast }) {
  // `entered` flips on AFTER the initial opacity-0 state has painted so the enter transition (fade +
  // settle down) actually plays — a single rAF runs before that paint and the browser skips the
  // transition, so we wait two frames. `leaving` (from the store) drives the fade-out; the store
  // keeps the toast for TOAST_EXIT_MS so the transition finishes before it unmounts.
  const [entered, setEntered] = createSignal(false);
  onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))));
  const leaving = (): boolean => leavingIds().has(props.toast.id);
  const phase = (): string => {
    if (leaving()) return 'opacity-0 translate-y-0'; // fade out in place
    if (!entered()) return 'opacity-0 -translate-y-1'; // start just above, hidden
    return 'opacity-100 translate-y-0'; // settled
  };
  return (
    <div
      role="status"
      data-toast-variant={props.toast.variant}
      class={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg transition-all duration-300 ease-out ${VARIANT_CLASS[props.toast.variant]} ${phase()}`}
    >
      <span class="min-w-0 flex-1 break-words">{props.toast.message}</span>
      <Show when={props.toast.action}>
        {(action) => (
          <button
            type="button"
            // Deliberately NOT <Button>/<IconButton>: these two sit on the toast's own coloured
            // background and inherit its colour, whereas every Button variant commits to a colour
            // (text-primary, text-text-muted, …) that would clash per variant. They still owe the
            // suite's rules, so cursor-pointer and a focus ring are spelled out here.
            class="-my-0.5 shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-semibold underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
            onClick={() => {
              action().onClick();
              toast.dismiss(props.toast.id);
            }}
          >
            {action().label}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="-mr-1 -mt-0.5 cursor-pointer rounded px-1 text-base leading-none opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
        aria-label="Dismiss notification"
        onClick={() => toast.dismiss(props.toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ToastRegion() {
  return (
    // `top-12` (48px) clears the WordPress admin bar (32px desktop / 46px mobile, fixed at the very
    // top of the viewport) so the first toast never sits on top of it.
    //
    // `z-toast` is the highest rung of the shared layering scale, above `z-modal`: a toast is often
    // the only report a modal-triggered mutation gives, and the modal's backdrop covers the whole
    // viewport. See the layering block in `styles/theme.css`.
    <div
      class="pointer-events-none fixed left-1/2 top-12 z-toast flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      <For each={toasts()}>{(t) => <ToastItem toast={t} />}</For>
    </div>
  );
}
