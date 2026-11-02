import { __, _n, _x, sprintf } from '@invflux/i18n';
import { IconButton, Input } from '@invflux/ui';
import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useApp } from '../../context';
import { createLicensesApi } from '../licenses/api';
import { createRoadmapApi, isNotRegistered, pointsRefusal } from './api';
import { bridgeRoutes, skusOnSale } from './bridge';
import { filterTree } from './filterTree';
import { splitGloss } from './gloss';
import { productHeading, type ProductHeading } from './productHeading';
import { statusLabel, statusPillClass } from './statusPresentation';
import { pointsOn, type PriorityAllocation, type RoadmapItem, type RoadmapStatus } from './types';

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
  const app = useApp();
  const api = createRoadmapApi(app);
  const [board, { refetch }] = createResource(() => api.getRoadmap());
  // Read only once the board has loaded, so an unregistered install still contacts nothing.
  const [catalog] = createResource(
    () => board() !== undefined,
    () => createLicensesApi(app).getCatalog(),
  );
  const [voteError, setVoteError] = createSignal<'not_registered' | 'failed' | null>(null);
  const [pending, setPending] = createSignal<number | null>(null);
  const [search, setSearch] = createSignal('');
  const items = createMemo(() => filterTree(board()?.items ?? [], search()));
  // What a bridge's pill may offer comes from the catalog, never from the board: a node can be
  // marked shipped before its product is on sale. A catalog that failed to load offers nothing.
  const onSale = createMemo(() => skusOnSale(catalog.error ? undefined : catalog()?.skus));
  const hasConsidering = createMemo(() => {
    const any = (items: RoadmapItem[]): boolean =>
      items.some((item) => item.status === 'considering' || any(item.children));
    return any(board()?.items ?? []);
  });

  // This account's votes, keyed by node, over what the board said when it loaded. Kept apart from
  // the tree on purpose: rewriting a node object to flip its vote makes the list rebuild every row,
  // and the page jumps back to the top under the merchant's cursor.
  const [votes, setVotes] = createSignal<Record<number, boolean>>({});
  const isVoted = (item: RoadmapItem): boolean => votes()[item.id] ?? item.voted;

  const toggle = async (item: RoadmapItem): Promise<void> => {
    const was = isVoted(item);
    setVoteError(null);
    setPending(item.id);
    // Optimistic: the merchant pressed a button and should see it take, with the server's answer
    // only correcting it. A vote is not money — the cost of being briefly wrong is nil.
    setVotes((current) => ({ ...current, [item.id]: !was }));
    try {
      await api.vote(item.id, !was);
    } catch (error) {
      setVotes((current) => ({ ...current, [item.id]: was }));
      setVoteError(isNotRegistered(error) ? 'not_registered' : 'failed');
    } finally {
      setPending(null);
    }
  };

  // Priority points: what the service last said about this account, read as sent. Absent fields
  // mean a service that predates points, and the page then shows the interest flag alone.
  const [summary, setSummary] = createSignal<{
    priority: PriorityAllocation;
    left: number;
    budget: number;
  } | null>(null);
  const priority = (): { priority: PriorityAllocation; left: number; budget: number } | null => {
    const own = summary();
    if (null !== own) return own;
    const doc = board();
    if (undefined === doc || undefined === doc.priority_budget || undefined === doc.priority_left) return null;
    return { priority: doc.priority ?? [], left: doc.priority_left, budget: doc.priority_budget };
  };
  const pointsFor = (item: RoadmapItem): number => pointsOn(priority()?.priority, item.id);
  const [pointsError, setPointsError] = createSignal<
    'priority_budget_exceeded' | 'priority_not_eligible' | 'not_registered' | 'failed' | null
  >(null);

  /** Set one item's points absolutely, and take the account's new summary from the answer. */
  const setPoints = async (item: RoadmapItem, points: number): Promise<void> => {
    setPointsError(null);
    setPending(item.id);
    try {
      const answer = await api.setPoints(item.id, points);
      setSummary({ priority: answer.priority, left: answer.priority_left, budget: answer.priority_budget });
    } catch (error) {
      setPointsError(pointsRefusal(error) ?? (isNotRegistered(error) ? 'not_registered' : 'failed'));
    } finally {
      setPending(null);
    }
  };

  return (
    <section class="mx-auto flex max-w-5xl flex-col bg-surface p-4 text-text" data-testid="roadmap-section">
      <h1 class="text-xl font-semibold text-slate-900">
        {_x('Roadmap', 'roadmap: the section title')}
      </h1>
      <Input
        type="search"
        size="md"
        class="mt-2 w-full"
        placeholder={__('Search the roadmap…')}
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
        data-testid="roadmap-search"
      />
      <p class="mt-1 text-sm text-slate-600">
        {__(
          'What is being built, and in what order. Vote for a whole area or for one feature — we read it when we decide what comes next.',
        )}
      </p>
      {/* The public roadmap on the website leaves out what is only being considered; this board,
          where registered merchants vote, is where those ideas are put to them. */}
      <Show when={hasConsidering()}>
        <p class="mt-1 text-sm text-slate-600" data-testid="roadmap-considering-note">
          {__(
            'This board also lists ideas we are still considering, which the public roadmap leaves out. Your votes tell us which ones matter.',
          )}
        </p>
      </Show>

      <Show when={priority()}>
        {(p) => (
          <p class="mt-2 text-sm text-slate-700" data-testid="roadmap-priority-left">
            {p().left > 0
              ? sprintf(
                  /* translators: 1: priority votes still to place, 2: the account's total. */
                  _n(
                    '%1$d of %2$d priority vote left. Put them on the features you most want built first; you can put more than one on the same feature.',
                    '%1$d of %2$d priority votes left. Put them on the features you most want built first; you can put more than one on the same feature.',
                    p().left,
                  ),
                  p().left,
                  p().budget,
                )
              : sprintf(
                  /* translators: %d: the account's total of priority votes. */
                  __('All %d priority votes placed. Take one back to move it.'),
                  p().budget,
                )}
          </p>
        )}
      </Show>

      <Show when={pointsError() === 'priority_budget_exceeded'}>
        <p class="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="roadmap-points-exhausted">
          {__('No priority votes left. Take one back from another feature first.')}
        </p>
      </Show>
      <Show when={pointsError() === 'priority_not_eligible'}>
        <p class="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="roadmap-points-ineligible">
          {__('This item no longer takes priority votes.')}
        </p>
      </Show>
      <Show when={pointsError() === 'failed' || pointsError() === 'not_registered'}>
        <p class="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900" data-testid="roadmap-points-failed">
          {__('That change did not go through. Please try again.')}
        </p>
      </Show>

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
            {_x('Try again', 'roadmap: retry loading the board')}
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

      <Show when={search().trim() !== '' && (board()?.items.length ?? 0) > 0 && items().length === 0}>
        <p class="mt-4 text-sm text-slate-500" data-testid="roadmap-no-match">
          {__('Nothing on the roadmap matches your search.')}
        </p>
      </Show>

      <ul class="-mx-1 mt-4 space-y-1" data-testid="roadmap-tree">
        <For each={items()}>
          {(item) => (
            <Node
              item={item}
              depth={0}
              productsAbove={0}
              pending={pending}
              isVoted={isVoted}
              onToggle={toggle}
              onSale={onSale}
              points={priority() === null ? null : { of: pointsFor, left: () => priority()?.left ?? 0, set: setPoints }}
            />
          )}
        </For>
      </ul>
    </section>
  );
}

/** What sets each level of product heading apart from the next, and from a feature's plain title. */
const PRODUCT_HEADING_CLASS: Record<ProductHeading, string> = {
  h2: 'm-0 text-lg font-semibold text-slate-900',
  h3: 'm-0 text-base font-semibold text-slate-900',
  h4: 'm-0 text-sm font-semibold text-slate-900',
};

/** One node and its subtree. Indentation is the only thing depth changes. */
function Node(props: {
  item: RoadmapItem;
  depth: number;
  /** How many products contain this row, which sets its heading level. */
  productsAbove: number;
  pending: () => number | null;
  isVoted: (item: RoadmapItem) => boolean;
  onToggle: (item: RoadmapItem) => Promise<void>;
  /** The SKUs the catalog has on sale, which decide what a bridge's pill may offer. */
  onSale: () => ReadonlySet<string>;
  /** Priority points, or null when the service predates them. */
  points: {
    of: (item: RoadmapItem) => number;
    left: () => number;
    set: (item: RoadmapItem, points: number) => Promise<void>;
  } | null;
}): JSX.Element {
  // Points go on a feature, not on a heading, and only while it is still a question: planned or
  // considering. The service enforces the same rule; this only decides where the control appears.
  const takesPoints = (): boolean =>
    props.points !== null &&
    props.item.children.length === 0 &&
    (props.item.status === 'planned' || props.item.status === 'considering');
  const heading = (): ProductHeading | null => productHeading(props.item, props.productsAbove);

  return (
    // The padding is always there, not added on hover, so a row lights up without its text moving.
    // Hovering a row counts as hovering every row around it, so a row stands down while the pointer
    // is on a row inside it.
    <li
      class="roadmap-row rounded p-1 hover:not-has-[.roadmap-row:hover]:bg-surface-raised"
      data-testid={`roadmap-node-${props.item.slug}`}
      style={{ 'margin-left': `${props.depth * 16}px` }}
      classList={{
        'pt-4': heading() === 'h2',
        'pt-2': heading() === 'h3',
       }}
    >
      <div class="flex items-start gap-3" classList={{ 'border-b border-border pb-1': heading() === 'h2' }}>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Dynamic
              component={heading() ?? 'span'}
              class={heading() === null ? 'text-sm font-semibold text-slate-800' : PRODUCT_HEADING_CLASS[heading()!]}
              data-testid={heading() === null ? undefined : 'roadmap-product-heading'}
            >
              {splitGloss(props.item).name}
              <Show when={splitGloss(props.item).gloss}>
                {(gloss) => (
                  <span class="ml-1 text-xs font-normal text-slate-500" data-testid="roadmap-gloss">
                    ({gloss()})
                  </span>
                )}
              </Show>
            </Dynamic>
            <StatusPill status={props.item.status} />
            <Show when={bridgeRoutes(props.item, props.onSale())}>
              {(routes) => (
                <span
                  class="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                  data-testid="roadmap-bridge-pill"
                >
                  {routes() === 'both'
                    ? _x(
                        'Included in Pro · also available on its own',
                        'roadmap: a bundle that Pro includes and that can also be bought without Pro',
                      )
                    : routes() === 'pro'
                      ? _x('Included in Pro', 'roadmap: a bundle that comes with Pro and is not yet sold on its own')
                      : _x('Available without Pro', 'roadmap: a bundle sold on its own while Pro is not on sale yet')}
                </span>
              )}
            </Show>
          </div>
          <Show when={props.item.body}>
            <p class="mt-0.5 text-sm text-slate-600">{props.item.body}</p>
          </Show>
        </div>
        {/* Nothing shipped carries a vote control: the board asks what to build NEXT, and inviting a
            merchant to ask for what they already have would collect a signal nobody can act on. The
            control sits where the eye lands after reading the title and the line under it. */}
        <Show when={takesPoints() && props.points}>
          {(points) => (
            <div class="flex shrink-0 items-center gap-1" data-testid={`roadmap-points-${props.item.slug}`}>
              <IconButton
                size="sm"
                label={_x('Take back a priority vote', 'roadmap: button that removes one priority vote from an item')}
                class="border border-border bg-surface text-text-muted hover:bg-surface-raised hover:text-text"
                disabled={props.pending() === props.item.id || points().of(props.item) === 0}
                onClick={() => void points().set(props.item, points().of(props.item) - 1)}
              >
                <span aria-hidden="true">−</span>
              </IconButton>
              <span
                class="min-w-6 text-center text-sm tabular-nums text-text"
                aria-label={_x('Priority votes on this item', 'roadmap: the count of priority votes placed on one item')}
              >
                {points().of(props.item)}
              </span>
              <IconButton
                size="sm"
                label={_x('Add a priority vote', 'roadmap: button that places one priority vote on an item')}
                class="border border-border bg-surface text-text-muted hover:bg-surface-raised hover:text-text"
                disabled={props.pending() === props.item.id || points().left() === 0}
                onClick={() => void points().set(props.item, points().of(props.item) + 1)}
              >
                <span aria-hidden="true">+</span>
              </IconButton>
            </div>
          )}
        </Show>
        <Show when={props.item.status !== 'shipped'}>
          <IconButton
            size="md"
            label={
              props.isVoted(props.item)
                ? _x('Remove my interest', 'roadmap: button that withdraws interest in an item')
                : _x('I am interested in this', 'roadmap: button that expresses interest in an item')
            }
            class={
              props.isVoted(props.item)
                ? 'bg-primary text-white hover:bg-primary-hover'
                : 'border border-border bg-surface text-text-muted hover:bg-surface-raised hover:text-text'
            }
            disabled={props.pending() === props.item.id}
            aria-pressed={props.isVoted(props.item)}
            data-testid={`roadmap-vote-${props.item.slug}`}
            onClick={() => void props.onToggle(props.item)}
          >
            <svg viewBox="0 0 24 24" class="h-full w-full" fill="currentColor" aria-hidden="true">
              <path d="M12 4 4.5 13h4.75v7h5.5v-7h4.75z" />
            </svg>
          </IconButton>
        </Show>
      </div>
      <Show when={props.item.children.length > 0}>
        <ul class="mt-1">
          <For each={props.item.children}>
            {(child) => (
              <Node
                item={child}
                depth={props.depth + 1}
                productsAbove={props.productsAbove + (heading() === null ? 0 : 1)}
                pending={props.pending}
                isVoted={props.isVoted}
                onToggle={props.onToggle}
                onSale={props.onSale}
                points={props.points}
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
  return (
    <span
      class={`rounded px-1.5 py-0.5 text-xs ${statusPillClass(props.status)}`}
      data-testid="roadmap-status"
    >
      {statusLabel(props.status)}
    </span>
  );
}
