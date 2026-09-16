import * as Popover from '@kobalte/core/popover';
import { __, _n, formatDateTime, sprintf } from '@invflux/i18n';
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { usePortalRootOptional } from '@invflux/ui';
import { useOrderAnnotationsQuery } from '../queries';
import type { DispatchOrderSummary, OrderNotePreview } from '../types';

/**
 * The note half of the queue's sparse-signal column: `[ N notes ]`, opening to the notes
 * themselves.
 *
 * **An order with no notes renders nothing at all.** That is the design, not an omission — the
 * column's emptiness is what makes a marked row visible, and a placeholder on every row would
 * destroy exactly the property the column exists for.
 *
 * The count doubles as the label, so the same number is both the signal (someone wrote about this
 * order) and the trigger. Reading it costs no interaction.
 */

/**
 * Deliberately a button, not a `:hover` rule.
 *
 * Hover does not exist on touch, and floor operations lean toward tablets, so a hover-only
 * affordance is invisible to the operators most likely to need it — and unreachable by keyboard
 * besides. The popover is opened by click, tap or Enter alike.
 *
 * A hover *preview* on top of this would be a pure enhancement and is not built: it may not become
 */
export function OrderNotesCell(props: { order: DispatchOrderSummary }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  /*
    Mount inside the SPA's portal root, not on `document.body`. A portal that escapes the app's
    subtree also escapes its CSS reset, and wp-admin's own stylesheet then styles the content —
    `common.css` puts margins on `p` and a heading size on `h2`, so the panel arrives spaced like a
    wp-admin page. Every other portalled surface here mounts the same way.
  */
  const mount = usePortalRootOptional();

  const eager = createMemo<OrderNotePreview[]>(() => props.order.recentNotes ?? []);
  const total = createMemo(() => props.order.noteCount ?? 0);
  /** How many exist beyond the ones that rode along with the row. */
  const missing = createMemo(() => Math.max(0, total() - eager().length));

  // Only fetched when the popover is open AND something is actually missing: the typical annotated
  // order carries all of its notes already, and opening it must cost no round trip.
  const tail = useOrderAnnotationsQuery(
    () => props.order.id,
    () => open() && missing() > 0,
  );

  /**
   * Every live note, once the tail has arrived — otherwise the eager ones.
   *
   * The fold mirrors the server's: a thread is a note when it is not deleted and some version of it
   * carries text, and the text shown is its newest such version.
   */
  const allNotes = createMemo<OrderNotePreview[]>(() => {
    const threads = tail.data?.threads;
    if (threads === undefined) return eager();

    const folded: OrderNotePreview[] = [];
    for (const thread of threads) {
      const live = thread.versions[thread.versions.length - 1];
      if (live === undefined || live.action === 'deleted') continue;
      const withText = [...thread.versions].reverse().find((v) => v.body !== null);
      if (withText === undefined) continue;
      folded.push({
        threadId: thread.threadId,
        body: withText.body,
        authorName: withText.authorName ?? null,
        occurredAt: withText.occurredAt ?? null,
      });
    }
    folded.sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));

    return folded.length > 0 ? folded : eager();
  });

  const label = (): string =>
    sprintf(
      /* translators: %d: number of notes written on an order. */
      _n('%d note', '%d notes', total()),
      total(),
    );

  return (
    <Show when={total() > 0}>
      <Popover.Root open={open()} onOpenChange={setOpen}>
        <Popover.Trigger
          /*
            Named for its subject rather than its kind: a grid of triggers all called "Notes" tells
            a screen-reader user which control they are on and nothing about which row.
          */
          aria-label={sprintf(
            /* translators: 1: note count, 2: order number. */
            _n('%1$d note on order %2$s', '%1$d notes on order %2$s', total()),
            total(),
            props.order.externalId,
          )}
          // min-h/min-w keep the hit area at the 24px floor even though the pill draws smaller —
          // on touch it is the only way in.
          class="inline-flex min-h-6 min-w-6 items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-xs whitespace-nowrap text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          <NoteIcon />
          {label()}
        </Popover.Trigger>
        <Popover.Portal mount={mount ?? undefined}>
          <Popover.Content
            class="z-50 max-w-sm rounded border border-border bg-surface p-3 text-text shadow-lg focus:outline-none"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <Popover.Arrow />
            <div class="mb-2 flex items-center justify-between gap-3">
              <Popover.Title class="text-xs font-semibold tracking-wide text-text-muted uppercase">
                {label()}
              </Popover.Title>
              <Popover.CloseButton
                class="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-base leading-none text-text-muted hover:bg-surface-raised hover:text-text"
                aria-label={__('Close')}
              >
                ×
              </Popover.CloseButton>
            </div>

            <ul class="flex flex-col gap-2">
              <For each={allNotes()}>
                {(note) => (
                  <li class="border-b border-border pb-2 last:border-0 last:pb-0">
                    <p class="text-sm whitespace-pre-wrap text-text">{note.body}</p>
                    <p class="mt-0.5 text-xs text-text-muted">
                      {[note.authorName, formatWhen(note.occurredAt)].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                )}
              </For>
            </ul>

            {/*
              The tail, said out loud. Because the total arrived with the row, a slow or failed
              fetch can name what is missing instead of leaving the list looking complete — which is
              the one failure a silent tail cannot be told apart from.
            */}
            <Show when={missing() > 0 && tail.data === undefined}>
              <p
                class="mt-2 text-xs text-text-muted"
                classList={{ 'text-red-700': tail.isError }}
                role="status"
              >
                <Show
                  when={tail.isError}
                  fallback={sprintf(
                    /* translators: %d: number of older notes still being fetched. */
                    _n('Loading %d more note…', 'Loading %d more notes…', missing()),
                    missing(),
                  )}
                >
                  {sprintf(
                    /* translators: %d: number of older notes that could not be fetched. */
                    _n(
                      '%d more note could not be loaded.',
                      '%d more notes could not be loaded.',
                      missing(),
                    ),
                    missing(),
                  )}
                </Show>
              </p>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Show>
  );
}

/** Absolute date-time, in the viewer's locale. Relative ages belong on the row, not in a note. */
function formatWhen(iso: string | null): string {
  if (iso === null) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';

  return formatDateTime(ts);
}

function NoteIcon(): JSX.Element {
  return (
    <svg
      class="h-3 w-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path d="M3 2.5h10v8l-3 3H3z" stroke-linejoin="round" />
      <path d="M13 10.5h-3v3" stroke-linejoin="round" />
    </svg>
  );
}
