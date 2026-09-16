import { __, _n, formatDateTime, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, Hint } from '@invflux/ui';
import { StatusPill } from '@invflux/procurement/src/components/StatusPill';
import { A, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { For, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { purchaseOrderHref } from './procurementLink';
import type {
  OpenReceivingSession,
  OpenSessionsResponse,
  ReceiptHistoryResponse,
  ReceiptSummary,
  ReceivingSource,
} from './types';

const CARD = 'rounded border border-border bg-surface';
// `pr-4` is not decoration: these headings are short uppercase phrases in narrow fixed-width
// columns, so without a gutter "LINES COUNTED" and "PEOPLE COUNTING" render as one word.
const TH = 'p-2 text-nowrap pr-4 text-left text-xs font-medium uppercase text-text-muted';
const TD = 'p-2 pr-4';
const TD_NOWRAP = TD + ' text-nowrap';

/** A document label an operator can read: its number, or its id when it has none yet. */
const sourceLabel = (source: ReceivingSource | null): string => {
  if (null === source) return __('No document');
  if ('purchase_order' !== source.type) return __('Another document');
  return '' === source.label
    ? sprintf(
        /* translators: %d is an internal purchase-order id. */ __('Draft order #%d'),
        source.id,
      )
    : sprintf(
        /* translators: %s is a purchase order number. */ __('Purchase order %s'),
        source.label,
      );
};

// `formatDateTime`, not `toLocaleString`: the latter takes the *browser's* locale, which has nothing
// to do with the language WordPress resolved for this user — so it renders US-ordered dates beside
// French labels, and `8/9` against `9/8` is two different days for half the year.
const when = (iso: string | null): string =>
  formatDateTime(iso, '—', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Where a listed reception can be opened.
 *
 * Every open count is reachable by anyone who can see this page: the counting screen is receiving's
 * own, under the same inventory capability that put them here, so there is no row that promises a way
 * in and then refuses it. A source type this build cannot name has no screen to send them to, which
 * is the only reason this ever answers null.
 */
/**
 * Where the *document* lives — the purchase order in Procurement, for a reader who wants to know
 * what else is on it. Distinct from {@link sessionHref}, which goes to the counting screen: one is
 * the paperwork, the other is the work. Null when this viewer cannot open Procurement, or when the
 * source is a type this build cannot name.
 */
const documentHref = (source: ReceivingSource | null): string | null =>
  null !== source && 'purchase_order' === source.type ? purchaseOrderHref(source.id) : null;

const sessionHref = (source: ReceivingSource | null): string | null =>
  null !== source && 'purchase_order' === source.type
    ? `/receiving/new/purchase-order/${source.id}`
    : null;

/**
 * The Receiving landing page: what is being counted right now, and what has been received.
 *
 * **The two lists are different in kind, and that is the design.** A receiving session is live and
 * expected to be discarded — it is not a draft receipt, and an abandoned count deliberately leaves no
 * trace. So the history below is *goods receipts*, the permanent record of what arrived, rather than
 * sessions that happened to finish. Keeping finished sessions around to list them would reintroduce
 * the receipt status column the model exists to avoid.
 */
export function ReceivingHome(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const navigate = useNavigate();

  const sessions = createQuery(() => ({
    queryKey: ['receiving', 'sessions'],
    queryFn: () => api.get<OpenSessionsResponse>('/receiving/sessions'),
    // Someone else's count can start or finish while this page is open.
    refetchInterval: 30_000,
  }));

  const receipts = createQuery(() => ({
    queryKey: ['receiving', 'receipts'],
    queryFn: () => api.get<ReceiptHistoryResponse>('/receiving/receipts'),
  }));

  return (
    <div class="p-4">
      {/* No page title bar: the surface tab above already says "Receiving", and a heading that
          repeats the tab spends the top of a working screen restating where you are. What the page
          is *for* moves into the hint beside the first section, where someone who wants it can ask
          and everyone else gets the rows sooner. */}
      <section class={`${CARD} mb-6 p-4`}>
        <div class="mb-2 flex items-center justify-between gap-4">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold">
            {__('Ongoing receiving sessions')}
            <Hint
              text={__(
                'Goods arriving at the door — what is being counted, and what has been received.',
              )}
            />
          </h2>
          {/* The action sits with the list it adds to, rather than in a bar of its own. */}
          <A href="/receiving/new">
            <Button>{__('Start a reception')}</Button>
          </A>
        </div>
        <Show when={sessions.isError}>
          <ErrorBanner class="text-sm">
            {__('Could not load the receptions in progress.')}
          </ErrorBanner>
        </Show>
        <Show
          when={(sessions.data?.sessions.length ?? 0) > 0}
          fallback={
            <Show
              when={!sessions.isPending}
              fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}
            >
              <p class="text-sm text-text-muted">{__('Nothing is being counted right now.')}</p>
            </Show>
          }
        >
          <table class="w-full text-sm">
            <thead class="bg-surface-raised">
              <tr class="border-b border-border">
                <th class={TH}>{__('Against')}</th>
                <th class={`${TH} w-28 text-right`}>{__('Lines counted')}</th>
                <th class={`${TH} w-32`}>{__('People counting')}</th>
                <th class={`${TH} w-48`}>{__('Last activity')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={sessions.data?.sessions ?? []}>
                {(session: OpenReceivingSession) => (
                  <tr class="border-b border-border/60">
                    <td class={TD}>
                      <Show
                        when={sessionHref(session.source)}
                        fallback={<span>{sourceLabel(session.source)}</span>}
                      >
                        {(href) => (
                          <A href={href()} class="text-primary hover:underline">
                            {sourceLabel(session.source)}
                          </A>
                        )}
                      </Show>
                      <Show when={null !== session.note && '' !== session.note}>
                        <span class="ml-2 text-xs text-text-muted">{session.note}</span>
                      </Show>
                    </td>
                    <td class={`${TD} text-center tabular-nums`}>
                      {/* Counted out of total: on its own a count says how much work has been done
                          and nothing about how much is left, which is the question someone watching
                          a colleague's reception is actually asking. Falls back to the bare number
                          where the document's own line count is unknown, rather than inventing a
                          denominator. */}
                      <Show when={null !== session.documentLineCount} fallback={session.lineCount}>
                        {session.lineCount}
                        <span class="text-text-muted">/{session.documentLineCount}</span>
                      </Show>
                    </td>
                    <td class={`${TD} text-center tabular-nums`}>
                      <Show
                        when={session.participants.length > 0}
                        fallback={<span class="text-text-muted">—</span>}
                      >
                        {String(session.participants.length)}
                      </Show>
                    </td>
                    <td class={`${TD} text-text-muted`}>{when(session.lastActivityAt)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>

      <section class={`${CARD} p-4`}>
        <h2 class="mb-2 text-sm font-semibold">{__('Recently received')}</h2>
        <Show when={receipts.isError}>
          <ErrorBanner class="text-sm">{__('Could not load the receiving history.')}</ErrorBanner>
        </Show>
        <Show
          when={(receipts.data?.receipts.length ?? 0) > 0}
          fallback={
            <Show
              when={!receipts.isPending}
              fallback={<p class="text-sm text-text-muted">{__('Loading…')}</p>}
            >
              <p class="text-sm text-text-muted">{__('Nothing has been received yet.')}</p>
            </Show>
          }
        >
          <table class="w-full text-sm">
            <thead class="bg-surface-raised">
              <tr class="border-b border-border">
                <th class={TH}>{__('Received')}</th>
                <th class={TH}>{__('Against')}</th>
                <th class={`${TH} w-40`}>{__('Document status')}</th>
                <th class={`${TH} w-24 text-right`}>{__('Lines')}</th>
                <th class={`${TH} w-24 text-right`}>{__('Units')}</th>
                {/* The action column carries no header: a verb over one button is a label for a
                    label, and the buttons only appear on the rows that can take one. */}
                <th class={`${TH} w-36`} />
              </tr>
            </thead>
            <tbody>
              <For each={receipts.data?.receipts ?? []}>
                {(receipt: ReceiptSummary) => (
                  <tr class="border-b border-border/60">
                    <td class={TD_NOWRAP}>{when(receipt.receivedAt)}</td>
                    <td class={TD}>
                      {/* A receipt carries a source *or* a reason, never both — the reason is what
                          stands in for the document a source-less intake does not have. */}
                      <Show
                        when={documentHref(receipt.source)}
                        fallback={
                          null !== receipt.source
                            ? sourceLabel(receipt.source)
                            : (receipt.reasonLabel ?? __('No document'))
                        }
                      >
                        {(href) => (
                          <A href={href()} class="text-primary hover:underline">
                            {sourceLabel(receipt.source)}
                          </A>
                        )}
                      </Show>
                      <Show when={null !== receipt.note && '' !== receipt.note}>
                        <span class="ml-2 text-xs text-text-muted">{receipt.note}</span>
                      </Show>
                    </td>
                    <td class={TD}>
                      {/* How the document itself stands now, which is the question a list of what
                          arrived is read to answer: is that order finished, or still owed? */}
                      <Show
                        when={receipt.source?.stage}
                        fallback={<span class="text-slate-300">—</span>}
                      >
                        {(stage) => <StatusPill status={stage()} />}
                      </Show>
                    </td>
                    <td class={`${TD} text-right tabular-nums`}>{receipt.lineCount}</td>
                    <td class={`${TD} text-right tabular-nums`}>
                      {receipt.qty}
                      <Show when={receipt.damagedQty > 0}>
                        <span class="ml-1 text-xs text-amber-600">
                          {sprintf(
                            /* translators: %d is a count of damaged units, recorded beside the good ones. */
                            _n('+%d damaged', '+%d damaged', receipt.damagedQty),
                            receipt.damagedQty,
                          )}
                        </span>
                      </Show>
                    </td>
                    <td class={`${TD} text-right`}>
                      <Show when={receipt.source?.receivable && receipt.source}>
                        {/* A link, not a write: the reception opens with the first counted line,
                            so going to the count changes nothing, and joining one already open is
                            the same trip. */}
                        {(source) => (
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => navigate(`/receiving/new/purchase-order/${source().id}`)}
                          >
                            {__('Receive again')}
                          </Button>
                        )}
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>
    </div>
  );
}
