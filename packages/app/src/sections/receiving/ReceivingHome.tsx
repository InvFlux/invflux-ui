import { __, _n, _x, formatDateTime, sprintf } from '@invflux/i18n';
import {
  Button,
  ColumnsSettingsIcon,
  createColumnModel,
  DataTable,
  type DataTableColumn,
  ErrorBanner,
  Hint,
  Pill,
} from '@invflux/ui';
import { StatusPill } from '@invflux/procurement/src/components/StatusPill';
import { CorrectedFigure } from '@invflux/procurement/src/sections/purchase-orders/CorrectedFigure';
import {
  damagedCorrected,
  receivedCorrected,
} from '@invflux/procurement/src/sections/purchase-orders/PoReceiptsList';
import { A, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { purchaseOrderHref, sourceLabel } from './procurementLink';
import type {
  OpenReceivingSession,
  OpenSessionsResponse,
  ReceiptHistoryResponse,
  ReceiptSummary,
  ReceivingSource,
} from './types';

const CARD = 'rounded border border-border bg-surface';
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

const sessionHref = (session: OpenReceivingSession): string | null => {
  if (null === session.source) return `/receiving/new/manual/${session.id}`;
  return 'purchase_order' === session.source.type
    ? `/receiving/new/purchase-order/${session.source.id}`
    : null;
};

/**
 * How a count names itself in the list: its document, or — answering none — its own id and the
 * reason it carries instead.
 */
const sessionLabel = (session: OpenReceivingSession): string =>
  null === session.source
    ? sprintf(
        /* translators: 1: a receiving session's internal id; 2: why the stock is arriving, e.g. "Opening balance". */
        __('Standalone session #%1$d — %2$s'),
        session.id,
        session.reasonLabel ?? '',
      )
    : sourceLabel(session.source);

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


  // The operator's column choices, kept per table: the two lists answer different questions, so a
  // column hidden on one says nothing about the other.
  const sessionsModel = createColumnModel({ scope: 'receiving-sessions' });
  const receiptsModel = createColumnModel({ scope: 'receiving-receipts' });

  const sessionColumns = (): DataTableColumn<OpenReceivingSession>[] => [
    {
      id: 'against',
      header: __('Against'),
      required: true,
      sortValue: (session) => sessionLabel(session),
      cell: (session) => (
        <>
          <Show when={sessionHref(session)} fallback={<span>{sessionLabel(session)}</span>}>
            {(href) => (
              <A href={href()} class="text-primary hover:underline">
                {sessionLabel(session)}
              </A>
            )}
          </Show>
          <Show when={null !== session.note && '' !== session.note}>
            <span class="ml-2 text-xs text-text-muted">{session.note}</span>
          </Show>
        </>
      ),
    },
    {
      id: 'lines',
      header: __('Lines counted'),
      kind: 'num',
      widthClass: 'w-28',
      sortValue: (session) => session.lineCount,
      // Counted out of total: on its own a count says how much work has been done and nothing
      // about how much is left, which is the question someone watching a colleague's reception is
      // actually asking. Falls back to the bare number where the document's own line count is
      // unknown, rather than inventing a denominator.
      cell: (session) => (
        <Show when={null !== session.documentLineCount} fallback={session.lineCount}>
          {session.lineCount}
          <span class="text-text-muted">/{session.documentLineCount}</span>
        </Show>
      ),
    },
    {
      id: 'people',
      header: __('People counting'),
      kind: 'num',
      widthClass: 'w-32',
      sortValue: (session) => session.participants.length,
      cell: (session) => (
        <Show
          when={session.participants.length > 0}
          fallback={<span class="text-text-muted">—</span>}
        >
          {String(session.participants.length)}
        </Show>
      ),
    },
    {
      id: 'activity',
      header: __('Last activity'),
      widthClass: 'w-48',
      sortValue: (session) => session.lastActivityAt,
      cell: (session) => <span class="text-text-muted">{when(session.lastActivityAt)}</span>,
    },
  ];

  const receiptColumns = (): DataTableColumn<ReceiptSummary>[] => [
    {
      id: 'received',
      header: __('Received'),
      sortValue: (receipt) => receipt.receivedAt,
      cell: (receipt) => <span class="text-nowrap">{when(receipt.receivedAt)}</span>,
    },
    {
      id: 'against',
      header: __('Against'),
      required: true,
      sortValue: (receipt) =>
        null !== receipt.source
          ? sourceLabel(receipt.source)
          : (receipt.reasonLabel ?? __('No document')),
      cell: (receipt) => (
        <>
          {/* A receipt carries a source *or* a reason, never both — the reason is what
              stands in for the document a source-less intake does not have. */}
          <Show
            when={documentHref(receipt.source)}
            fallback={
              null !== receipt.source ? (
                sourceLabel(receipt.source)
              ) : (
                // No document to open, so the receipt itself is the page.
                <A
                  href={`/receiving/receipts/${receipt.id}`}
                  data-testid="receipt-link"
                  class="text-primary hover:underline"
                >
                  {receipt.reasonLabel ?? __('No document')}
                </A>
              )
            }
          >
            {(href) => (
              <A href={href()} class="text-primary hover:underline">
                {sourceLabel(receipt.source)}
              </A>
            )}
          </Show>
          {/* A receipt against a document opens on its own page too — the one place
              any receipt is read and corrected, whatever it answers. */}
          <Show when={null !== receipt.source}>
            <span class="text-text-muted">{' · '}</span>
            <A
              href={`/receiving/receipts/${receipt.id}`}
              data-testid="receipt-link"
              class="text-primary hover:underline"
            >
              {sprintf(
                /* translators: %d is a goods receipt's internal id. */
                __('Receipt #%d'),
                receipt.id,
              )}
            </A>
          </Show>
          <Show when={'posted' !== receipt.state}>
            <Pill
              class="ml-2"
              tone={'reversed' === receipt.state ? 'neutral' : 'info'}
              title={
                'reversed' === receipt.state
                  ? __(
                      'Every quantity was corrected to zero. The receipt stays on file.',
                    )
                  : __(
                      'Figures were corrected after posting. The receipt lists the corrections.',
                    )
              }
              data-testid="receipt-state"
            >
              {'reversed' === receipt.state
                ? _x(
                    'Reversed',
                    'goods receipt status: every quantity corrected to zero',
                  )
                : _x(
                    'Corrected',
                    'goods receipt status: figures corrected after posting',
                  )}
            </Pill>
          </Show>
          <Show when={null !== receipt.note && '' !== receipt.note}>
            <span class="ml-2 text-xs text-text-muted">{receipt.note}</span>
          </Show>
        </>
      ),
    },
    {
      id: 'status',
      header: __('Document status'),
      widthClass: 'w-40',
      sortValue: (receipt) => receipt.source?.stage,
      // How the document itself stands now, which is the question a list of what arrived is read
      // to answer: is that order finished, or still owed?
      cell: (receipt) => (
        <Show when={receipt.source?.stage} fallback={<span class="text-slate-300">—</span>}>
          {(stage) => <StatusPill status={stage()} />}
        </Show>
      ),
    },
    {
      id: 'lines',
      header: __('Lines'),
      kind: 'num',
      widthClass: 'w-24',
      sortValue: (receipt) => receipt.lineCount,
      cell: (receipt) => receipt.lineCount,
    },
    {
      id: 'units',
      header: __('Units'),
      kind: 'num',
      widthClass: 'w-24',
      sortValue: (receipt) => receipt.correctedQty ?? receipt.qty,
      cell: (receipt) => (
        <>
          <CorrectedFigure
            posted={receipt.qty}
            current={receipt.correctedQty}
            format={(n) => n}
            title={receivedCorrected}
          />
          <Show when={receipt.damagedQty > 0 || (receipt.correctedDamagedQty ?? 0) > 0}>
            <span class="ml-1 text-xs text-amber-600">
              <CorrectedFigure
                posted={receipt.damagedQty}
                current={receipt.correctedDamagedQty}
                format={(n) =>
                  sprintf(
                    /* translators: %d is a count of damaged units, recorded beside the good ones. */
                    _n('+%d damaged', '+%d damaged', n),
                    n,
                  )
                }
                title={damagedCorrected}
              />
            </span>
          </Show>
        </>
      ),
    },
    {
      id: 'actions',
      // No heading: a verb over one button is a label for a label, and the buttons only appear on
      // the rows that can take one.
      label: () => __('Actions'),
      widthClass: 'w-36',
      kind: 'num',
      cell: (receipt) => (
        <Show when={receipt.source?.receivable && receipt.source}>
          {/* A link, not a write: the reception opens with the first counted line, so going to
              the count changes nothing, and joining one already open is the same trip. */}
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
      ),
    },
  ];

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
          <div class="flex items-center gap-2">
            <A href="/receiving/new">
              <Button>{__('Start a reception')}</Button>
            </A>
            <Button
              variant="secondary"
              size="xs"
              class="px-1.5!"
              title={__('Columns')}
              aria-label={__('Columns')}
              onClick={sessionsModel.openPicker}
            >
              <ColumnsSettingsIcon class="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Show when={sessions.isError}>
          <ErrorBanner class="text-sm">
            {__('Could not load the receptions in progress.')}
          </ErrorBanner>
        </Show>
        <DataTable
          columns={sessionColumns()}
          rows={sessions.data?.sessions ?? []}
          rowKey={(session) => String(session.id)}
          model={sessionsModel}
          empty={
            <span class="text-text-muted">
              {sessions.isPending ? __('Loading…') : __('Nothing is being counted right now.')}
            </span>
          }
          testId="receiving-sessions"
        />
      </section>

      <section class={`${CARD} p-4`}>
        <div class="mb-2 flex items-center justify-between gap-4">
          <h2 class="text-sm font-semibold">{__('Recently received')}</h2>
          <Button
            variant="secondary"
            size="xs"
            class="px-1.5!"
            title={__('Columns')}
            aria-label={__('Columns')}
            onClick={receiptsModel.openPicker}
          >
            <ColumnsSettingsIcon class="h-4 w-4" />
          </Button>
        </div>
        <Show when={receipts.isError}>
          <ErrorBanner class="text-sm">{__('Could not load the receiving history.')}</ErrorBanner>
        </Show>
        <DataTable
          columns={receiptColumns()}
          rows={receipts.data?.receipts ?? []}
          rowKey={(receipt) => String(receipt.id)}
          model={receiptsModel}
          empty={
            <span class="text-text-muted">
              {receipts.isPending ? __('Loading…') : __('Nothing has been received yet.')}
            </span>
          }
          testId="receiving-receipts"
        />
      </section>
    </div>
  );
}
