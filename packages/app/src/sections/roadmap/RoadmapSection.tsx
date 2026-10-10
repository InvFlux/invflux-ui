import { __ } from '@invflux/i18n';
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { useApp } from '../../context';
import { createRoadmapApi, isNotRegistered } from './api';
import type { RoadmapItem, RoadmapStatus } from './types';

/**
 * The feature board: what is being built, in what order, and what this shop wants next.
 *
 * **An unregistered install fetches nothing and says why.** The roadmap is public and this screen
 * could show it to anybody, but the plugin promises that it contacts the licensing service only
 * after a merchant registers or activates — so rather than quietly breaking that on a page-load,
 * an install with no license gets the explanation and a link to the public page on the website.
 *
 * **A heading is votable, and so is a feature under it.** The two are different statements — "this
 * area matters to us" against "this one thing matters to us" — so the vote control repeats at every
 * level rather than only on leaves, and a parent's state is never derived from its children's.
 *
 * **No counts are shown, because none are sent.** A registration whose email was never confirmed
 * still creates an account, so any tally would be only as trustworthy as an unconfirmed address.
 * What the merchant sees is their own position; what the board is *for* is read on our side.
 */
export default function RoadmapSection(): JSX.Element {
  // Context comes from the shell's provider, like every other surface: the nav slot passes no
  // props, so a section that took them could not be registered there.
  const api = createRoadmapApi(useApp());
  const [board, { mutate, refetch }] = createResource(() => api.getRoadmap());
  const [voteError, setVoteError] = createSignal<'not_registered' | 'failed' | null>(null);
  const [pending, setPending] = createSignal<number | null>(null);

  /** Flip one node's `voted` in place, wherever it sits in the tree. */
  const setVoted = (items: RoadmapItem[], id: number, voted: boolean): RoadmapItem[] =>
    items.map((item) =>
      item.id === id
        ? { ...item, voted }
        : { ...item, children: setVoted(item.children, id, voted) },
    );

  const toggle = async (item: RoadmapItem): Promise<void> => {
    const next = !item.voted;
    setVoteError(null);
    setPending(item.id);
    // Optimistic: the merchant pressed a button and should see it take, with the server's answer
    // only correcting it. A vote is not money — the cost of being briefly wrong is nil.
    mutate((current) =>
      current ? { ...current, items: setVoted(current.items, item.id, next) } : current,
    );
    try {
      await api.vote(item.id, next);
    } catch (error) {
      mutate((current) =>
        current ? { ...current, items: setVoted(current.items, item.id, item.voted) } : current,
      );
      setVoteError(isNotRegistered(error) ? 'not_registered' : 'failed');
    } finally {
      setPending(null);
    }
  };

  return (
    <section class="p-4" data-testid="roadmap-section">
      <h1 class="text-lg font-semibold text-slate-900">{__('Roadmap')}</h1>
      <p class="mt-1 max-w-2xl text-sm text-slate-600">
        {__(
          'What is being built, and in what order. Vote for a whole area or for one feature — we read it when we decide what comes next.',
        )}
      </p>

      <Show when={board()?.stale}>
        <p
          class="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
          data-testid="roadmap-stale"
        >
          {__('Showing the last roadmap we could fetch — the licensing service was unreachable.')}
        </p>
      </Show>

      <Show when={voteError() === 'not_registered'}>
        <p
          class="mt-3 rounded border border-primary/30 bg-primary/5 p-2 text-sm text-slate-700"
          data-testid="roadmap-needs-registration"
        >
          {__(
            'Voting needs a registered license — it is how a vote is attached to your account. Register on InvFlux → Licenses & Add-ons; reading the roadmap never needs one.',
          )}
        </p>
      </Show>
      <Show when={voteError() === 'failed'}>
        <p
          class="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900"
          data-testid="roadmap-vote-failed"
        >
          {__('That vote did not go through. Please try again.')}
        </p>
      </Show>

      <Show when={board.error && isNotRegistered(board.error)}>
        <div
          class="mt-4 rounded border border-primary/30 bg-primary/5 p-3 text-sm text-slate-700"
          data-testid="roadmap-unregistered"
        >
          <p>
            {__(
              'The roadmap is public — read it on the website, no license needed. It is shown here once this site holds a license, because that is also what lets you vote.',
            )}
          </p>
          <p class="mt-2">
            <a
              href="https://invflux.com/roadmap"
              target="_blank"
              rel="noreferrer noopener"
              class="underline hover:no-underline"
            >
              {__('Open the public roadmap')}
            </a>
          </p>
        </div>
      </Show>

      <Show when={board.error && !isNotRegistered(board.error)}>
        <p class="mt-4 text-sm text-slate-600" data-testid="roadmap-error">
          {__('The roadmap could not be loaded.')}{' '}
          <button type="button" class="underline" onClick={() => void refetch()}>
            {__('Try again')}
          </button>
        </p>
      </Show>

      <Show when={board.loading}>
        <p class="mt-4 text-sm text-slate-500">{__('Loading…')}</p>
      </Show>

      <Show when={!board.loading && !board.error && (board()?.items.length ?? 0) === 0}>
        <p class="mt-4 text-sm text-slate-500" data-testid="roadmap-empty">
          {__('Nothing is on the roadmap yet.')}
        </p>
      </Show>

      <ul class="mt-4 space-y-3" data-testid="roadmap-tree">
        <For each={board()?.items ?? []}>
          {(item) => <Node item={item} depth={0} pending={pending} onToggle={toggle} />}
        </For>
      </ul>
    </section>
  );
}

/** One node and its subtree. Indentation is the only thing depth changes. */
function Node(props: {
  item: RoadmapItem;
  depth: number;
  pending: () => number | null;
  onToggle: (item: RoadmapItem) => Promise<void>;
}): JSX.Element {
  return (
    <li
      data-testid={`roadmap-node-${props.item.slug}`}
      style={{ 'margin-left': `${props.depth * 16}px` }}
    >
      <div class="flex items-start gap-2">
        {/* Nothing shipped carries a vote control: the board asks what to build NEXT, and inviting a
            merchant to ask for what they already have would collect a signal nobody can act on. */}
        <Show
          when={props.item.status !== 'shipped'}
          fallback={<span class="mt-0.5 w-12 shrink-0" aria-hidden="true" />}
        >
          <button
            type="button"
            class="mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs"
            classList={{
              'border-primary bg-primary/10 text-primary': props.item.voted,
              'border-slate-300 text-slate-600': !props.item.voted,
            }}
            disabled={props.pending() === props.item.id}
            aria-pressed={props.item.voted}
            data-testid={`roadmap-vote-${props.item.slug}`}
            onClick={() => void props.onToggle(props.item)}
          >
            {props.item.voted ? __('Voted') : __('Vote')}
          </button>
        </Show>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="text-sm font-medium text-slate-900"
              classList={{ 'text-base': props.depth === 0 }}
            >
              {props.item.title}
            </span>
            <StatusPill status={props.item.status} />
          </div>
          <Show when={props.item.body}>
            <p class="mt-0.5 text-sm text-slate-600">{props.item.body}</p>
          </Show>
        </div>
      </div>
      <Show when={props.item.children.length > 0}>
        <ul class="mt-2 space-y-2">
          <For each={props.item.children}>
            {(child) => (
              <Node
                item={child}
                depth={props.depth + 1}
                pending={props.pending}
                onToggle={props.onToggle}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** Status is a word rather than a date, so the pill says the word. */
function StatusPill(props: { status: RoadmapStatus }): JSX.Element {
  const label = (): string => {
    switch (props.status) {
      case 'shipped':
        return __('Shipped');
      case 'in_progress':
        return __('In progress');
      case 'planned':
        return __('Planned');
      default:
        return props.status;
    }
  };

  return (
    <span
      class="rounded px-1.5 py-0.5 text-xs"
      classList={{
        'bg-green-100 text-green-800': props.status === 'shipped',
        'bg-blue-100 text-blue-800': props.status === 'in_progress',
        'bg-slate-200 text-slate-700': props.status !== 'shipped' && props.status !== 'in_progress',
      }}
      data-testid="roadmap-status"
    >
      {label()}
    </span>
  );
}
