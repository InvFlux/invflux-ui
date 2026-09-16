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

/**
 * Which variants interrupt whatever is being read.
 *
 * `error` only. An error reports something that did not happen and that the merchant has to act on,
 * which is what "assertive" is for. `warning` stays polite deliberately — it is context alongside a
 * result, and a channel that interrupts for everything trains people to ignore it.
 */
const URGENT: ReadonlySet<ToastVariant> = new Set<ToastVariant>(['error']);
const urgentToasts = (): Toast[] => toasts().filter((t) => URGENT.has(t.variant));
const calmToasts = (): Toast[] => toasts().filter((t) => !URGENT.has(t.variant));

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
      // No `role` here on purpose: the enclosing region already declares the politeness, and an
      // item that is itself a live region nested inside another is ambiguous — assistive tech may
      // take either. `mb-2` rather than a `gap` on the stack, because the stack now holds two
      // always-present regions and a `gap` would reserve space for whichever one is empty.
      data-toast-variant={props.toast.variant}
      class={`pointer-events-auto mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg transition-all duration-300 ease-out ${VARIANT_CLASS[props.toast.variant]} ${phase()}`}
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
    <div class="pointer-events-none fixed left-1/2 top-12 z-toast flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col">
      {/*
        Two regions, not one, because politeness is a property of the REGION — an individual toast
        cannot opt into interrupting from inside a polite one. A failure that a merchant needs to
        act on was queued behind whatever was being read and could be missed entirely; every
        `toast.error` announced as politely as a "saved" confirmation.

        Both are always mounted, and that is the point: a live region has to exist BEFORE content
        lands in it, so one created at the moment of the error announces nothing. They are plain
        flex children of the one positioned stack — two `fixed` containers at the same coordinates
        would render on top of each other.

        Errors sit above the calm ones so the visual order matches the spoken order.
      */}
      <div aria-live="assertive" aria-atomic="false">
        <For each={urgentToasts()}>{(t) => <ToastItem toast={t} />}</For>
      </div>
      <div aria-live="polite" aria-atomic="false">
        <For each={calmToasts()}>{(t) => <ToastItem toast={t} />}</For>
      </div>
    </div>
  );
}
