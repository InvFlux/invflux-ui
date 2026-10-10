import { createViewportFill, ErrorBanner, surfaceSettingsRegistry } from '@invflux/ui';
import { __, _x, formatDate, formatMoney, formatTime, sprintf } from '@invflux/i18n';
import { A, useParams } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';
import { slotParts, stockCard, type StockCardCell } from './stockCard';
import {
  buildDisplayCard,
  columnKeyLabel,
  columnTitle,
  type DisplayColumn,
  loadDisplay,
  locationLabel,
  type LedgerDisplay,
  saveDisplay,
  stateLabel,
  visibleCount,
} from './ledgerDisplay';
import { LedgerSettingsPanel } from './LedgerSettingsPanel';

/** One resolved reference document: PO (goods receipt), order (reservation/booking/correction),
 *  shipment, or stock adjustment. `label` is the human id (PO number / WC order id) — or, for an
 *  adjustment, its reason; `sequence` is set for shipments, `discoveryContext`/`note` for
 *  adjustments. */
interface RefDocument {
  type: string;
  label: string;
  url: string | null;
  sequence?: number;
  discoveryContext?: string | null;
  note?: string | null;
}

interface LedgerRow {
  id: string;
  recordedAt: string;
  movementLabel: string;
  movementCode: string;
  fromSlot: string | null;
  toSlot: string | null;
  quantity: number;
  initialFrom: number | null;
  initialTo: number | null;
  actor: { typeCode: string | null; ref: string | null; name: string | null } | null;
  surface: {
    typeCode: string | null;
    ref: string | null;
    name: string | null;
    /** Resolved through the label system: the reader's language, or the merchant's own word. */
    displayName: string | null;
  } | null;
  refType: string | null;
  refId: number | null;
  refDocument: RefDocument | null;
  cost: { unitCost: string; currency: string | null } | null;
}

/** One variation in the family, for the segmented switcher: its subject id + attribute label. */
interface LedgerSibling {
  subjectId: number;
  label: string;
}

/** Who counts this product's stock right now. `since` is null when no date can be stated honestly. */
interface LedgerGovernance {
  state: string;
  since: string | null;
}

interface LedgerResponse {
  subject: {
    subjectId: number;
    postId: number;
    postTitle: string;
    postType: string;
    sku: string;
    familyTitle: string;
  };
  cost: { weightedAvgCost: string | null; seedCost: string | null; currency: string | null } | null;
  rows: LedgerRow[];
  /** The variable-product family (empty for a simple product) — drives the variation switcher. */
  siblings: LedgerSibling[];
  governance: LedgerGovernance;
  capabilities: { viewCosts: boolean };
}

/**
 * Says who counts this product's stock, whenever that is not InvFlux.
 *
 * The rows cannot say it themselves. Releasing a product leaves its ledger and its slot quantities
 * exactly as they were, so the newest row's running balance stays on screen — right as history,
 * wrong as stock — while WooCommerce or another plugin moves the real quantity. Amber, matching the
 * "⚠ Unmanaged" marker the dispatch surfaces already use for this same fact.
 *
 * It sits above the table rather than inside it because it describes the whole page. A period-by-
 * period banding of the history needs the governance transition log to be complete, which it is not
 * yet; this is the band for the period that is still open, and the one that can mislead today.
 */
function GovernanceBand(props: { governance: LedgerGovernance; hasRows: boolean }): JSX.Element {
  const externallyTracked = (): boolean => 'external' === props.governance.state;
  /** Undated when nothing can date it: never adopted, or a log that disagrees with the live flag. */
  const lead = (): string =>
    props.governance.since === null
      ? __('InvFlux doesn’t track this product’s stock.')
      : sprintf(
          /* translators: %s: the date on which InvFlux stopped tracking this product's stock. */
          __('InvFlux stopped tracking this product’s stock on %s.'),
          formatDate(props.governance.since),
        );
  const consequence = (): string => {
    if (props.hasRows) {
      return externallyTracked()
        ? __(
            'WooCommerce or another plugin counts it now, so the quantities below are not this product’s stock today.',
          )
        : __(
            'Nothing is counting a quantity for it now, so the quantities below are not this product’s stock today.',
          );
    }

    return externallyTracked()
      ? __('WooCommerce or another plugin counts it, so there are no movements to show.')
      : __('Nothing is counting a quantity for it, so there are no movements to show.');
  };

  return (
    <Show when={'invflux' !== props.governance.state}>
      <p
        class="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        data-testid="ledger-governance-band"
        data-state={props.governance.state}
      >
        <span class="font-medium">⚠ {lead()}</span> {consequence()}
      </p>
    </Show>
  );
}

/** `from → to` with the moved quantity. */
function transition(row: LedgerRow): JSX.Element {
  if (0 === row.quantity) return <></>;

  const fromSlot = row.fromSlot ?? '∅';
  const finalQty = (initial: number | null, delta: number): JSX.Element =>
    initial === null ? (
      <></>
    ) : (
      <span class="text-xs text-text-muted">
        {initial} → {initial + delta}
      </span>
    );
  const toSlot = row.toSlot ?? '∅';
  const slot = (slot: string, init: number | null, delta: number): JSX.Element => (
    <span class="inline-flex flex-col items-center bg-surface-raised p-1 rounded-md">
      <span>{slot}</span>
      {finalQty(init, delta)}
    </span>
  );

  return (
    <div class="flex items-center gap-2">
      {slot(fromSlot, row.initialFrom, -row.quantity)}
      <span class="flex flex-col items-center">
        {row.quantity}
        <span>{'→'}</span>
      </span>
      {slot(toSlot, row.initialTo, row.quantity)}
    </div>
  );
}

/** The two ways to read the ledger: each movement as one transition, or each slot as one column. */
type LedgerView = 'transitions' | 'stock-card';

const LEDGER_VIEW_KEY = 'invflux:app:ledger:view';

/**
 * The view this browser last chose, defaulting to the stock card.
 *
 * The stock card answers the question a merchant arrives with — "how much was there, and when did
 * that change" — by carrying a running balance per slot on every row. Transitions answers "what
 * exactly moved where", which is the auditor's question and the second one asked. Only an explicit
 * choice of transitions is honoured, so a reader who picked it keeps it and everyone else lands on
 * the balance.
 */
function storedLedgerView(): LedgerView {
  try {
    return 'transitions' === localStorage.getItem(LEDGER_VIEW_KEY) ? 'transitions' : 'stock-card';
  } catch {
    return 'stock-card';
  }
}

/** What a state code means for the stock in it. Read at render time, so the active locale applies. */
function stateGloss(state: string): string | null {
  switch (state) {
    case 'atp':
      return _x(
        'available to promise — can be sold now',
        'stock slot state atp, explained in a tooltip',
      );
    case 'res':
      return _x(
        'reserved — held by a cart or checkout, released if it expires',
        'stock slot state res, explained in a tooltip',
      );
    case 'ctd':
      return _x(
        'committed — promised to a confirmed order',
        'stock slot state ctd, explained in a tooltip',
      );
    case 'pnd':
      return _x(
        'pending — on its way in, not yet available to promise',
        'stock slot state pnd, explained in a tooltip',
      );
    case 'qi':
      return _x(
        'quality inspection — on the premises, awaiting pass or fail',
        'stock slot state qi, explained in a tooltip',
      );
    case 'bkd':
      return _x(
        'blocked — on the premises, withheld pending a decision',
        'stock slot state bkd, explained in a tooltip',
      );
    default:
      return null;
  }
}

/** What a location means; a leaf (`oh/main`) is explained by its root. */
function locationGloss(location: string): string | null {
  const root = (prefix: string): boolean =>
    location === prefix || location.startsWith(`${prefix}/`);
  if (root('trs/inb'))
    return _x(
      'inbound transit — on its way to you',
      'stock slot location trs/inb, explained in a tooltip',
    );
  if (root('trs/dsp'))
    return _x(
      'dispatched — on its way to the customer',
      'stock slot location trs/dsp, explained in a tooltip',
    );
  if (root('trs/rto'))
    return _x(
      'returning — on its way back to you',
      'stock slot location trs/rto, explained in a tooltip',
    );
  if (root('oh'))
    return _x('on hand — in your stock', 'stock slot location oh, explained in a tooltip');
  if (root('sup'))
    return _x(
      'supplier side — not yet in your hands',
      'stock slot location sup, explained in a tooltip',
    );
  return null;
}

/**
 * A slot column's tooltip: the key, then one line per component in the order the key writes them —
 * its state and its location, each with what it means. A code this list does not know (an add-on's)
 * shows as the bare code rather than a guess.
 */
function slotTooltip(slot: string): string {
  const { location, state } = slotParts(slot);
  const stateMeaning = stateGloss(state);
  const locationMeaning = locationGloss(location);
  const stateLine =
    '' === state
      ? null
      : null === stateMeaning
        ? sprintf(
            /* translators: %s: a stock state code with no known meaning, e.g. one an add-on registered */
            _x('State %s', 'ledger slot tooltip: names the state part of a slot key'),
            state,
          )
        : sprintf(
            /* translators: 1: a stock state code such as "atp", 2: what that state means */
            _x('State %1$s: %2$s', 'ledger slot tooltip: a state code, then what it means'),
            state,
            stateMeaning,
          );
  const locationLine =
    null === locationMeaning
      ? sprintf(
          /* translators: %s: a stock location code with no known meaning, e.g. one an add-on registered */
          _x('Location %s', 'ledger slot tooltip: names the location part of a slot key'),
          location,
        )
      : sprintf(
          /* translators: 1: a stock location code such as "oh", 2: what that location means */
          _x('Location %1$s: %2$s', 'ledger slot tooltip: a location code, then what it means'),
          location,
          locationMeaning,
        );
  const stateFirst = '' !== state && slot.startsWith(`${state}.`);
  const lines: Array<string | null> = stateFirst
    ? [stateLine, locationLine]
    : [locationLine, stateLine];
  return [slot, ...lines.filter((l): l is string => null !== l)].join('\n');
}

/** A change with its sign, using a true minus so the column's digits line up. */
function signed(change: number): string {
  if (change > 0) return `+${change}`;
  return change < 0 ? `−${-change}` : '0';
}

/** One slot on one row of the stock card: the change this movement made and the balance after it,
 *  or — for a slot the row did not touch — the balance it carried, muted. A balance that disagrees
 *  with the previous row's is marked, with both values in its tooltip. */
function StockCardCellView(props: { cell: StockCardCell | undefined }): JSX.Element {
  const cell = (): StockCardCell => props.cell ?? { balance: null, change: null };
  const gapTitle = (): string | undefined => {
    const { balance, change, expectedBefore } = cell();
    if (undefined === expectedBefore || null === balance || null === change) return undefined;
    return sprintf(
      /* translators: 1: slot balance recorded before this movement, 2: balance the previous movement left */
      __(
        'The balance before this movement is recorded as %1$d, but the movement before it left %2$d.',
      ),
      balance - change,
      expectedBefore,
    );
  };
  return (
    <td
      class="px-3 py-2 whitespace-nowrap text-right font-mono text-xs tabular-nums"
      classList={{ 'bg-amber-50': undefined !== gapTitle() }}
      title={gapTitle()}
      data-gap={undefined !== gapTitle() ? '' : undefined}
    >
      <Show
        when={null !== cell().change}
        fallback={<span class="text-text-muted">{cell().balance ?? ''}</span>}
      >
        <div
          classList={{
            'text-emerald-700': (cell().change ?? 0) > 0,
            'text-red-700': (cell().change ?? 0) < 0,
          }}
        >
          {signed(cell().change ?? 0)}
        </div>
        <div class="font-semibold text-text">{cell().balance ?? '?'}</div>
      </Show>
    </td>
  );
}

/** The raw `{type}:{ref}` pair — the actor as the ledger stores it. */
function actorKey(row: LedgerRow): string {
  if (!row.actor) return '—';
  const parts = [row.actor.typeCode, row.actor.ref].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : '—';
}

/** Actor cell — the named principal, over the raw key it resolves from (a system/plugin actor has no
 *  name, so its key carries the whole cell rather than being repeated under a placeholder). */
/**
 * Who moved the stock, and through what.
 *
 * The surface — the screen or job a movement was initiated from — lives here rather than in a
 * column of its own because the two answer one question together. On its own it mostly restated
 * the movement ("reconciliation" beside "Stock reconciliation"); it says something only beside a
 * person, where it tells you which screen they used. So it is a quiet line under the name, and a
 * movement with no recorded surface simply has nothing under it instead of a dash in a column.
 */
function ActorCell(props: { row: LedgerRow; showKey: boolean }): JSX.Element {
  const name = (): string | null => props.row.actor?.name ?? null;
  const via = (): string | null => props.row.surface?.displayName ?? null;
  return (
    <>
      {/* With no name to show, the key IS the answer and appears whatever the preference says:
          hiding it there would leave the cell empty rather than discreet. */}
      <Show when={name()} fallback={<span>{actorKey(props.row)}</span>}>
        {(resolved) => <span>{resolved()}</span>}
      </Show>
      <Show when={via()}>
        {(surface) => (
          <span class="block text-xs text-text-muted">
            {sprintf(
              /* translators: %s: the screen or job a stock movement was initiated from, e.g. "Workbench". */
              _x('via %s', 'ledger actor cell: where a stock movement was initiated'),
              surface(),
            )}
          </span>
        )}
      </Show>
      <Show when={props.showKey && name()}>
        <span class="block font-mono text-xs text-text-muted">{actorKey(props.row)}</span>
      </Show>
    </>
  );
}

/** A human prefix before the linked id, by resolved-document type. Raw ids come from PHP; the
 *  "Order"/"#" decoration is UI-side. Order/shipment → "Order #2325"; PO → "PO-68" (self-labelling). */
function refPrefix(type: string): string {
  return type === 'order' || type === 'shipment' ? `${__('Order')} ` : '';
}

/** The linked text for a resolved document — orders/shipments get a `#` before the sequential id. */
function refLinkText(doc: RefDocument): string {
  return doc.type === 'order' || doc.type === 'shipment' ? `#${doc.label}` : doc.label;
}

/** Trailing detail after the linked id — a shipment appends its per-order number, e.g. " - shipment #2". */
function refSuffix(doc: RefDocument): string {
  return doc.type === 'shipment' && doc.sequence != null
    ? ` - ${__('shipment')} #${doc.sequence}`
    : '';
}

/** A stock adjustment references no document — it *is* the movement. So the cell reads as what the
 *  operator asserted: what the change reflects (the disposition), how it was noticed (the discovery
 *  context, on the same line — the two are one sentence), and their note under both. */
function AdjustmentRef(props: { doc: RefDocument }): JSX.Element {
  return (
    <>
      <span>{props.doc.label}</span>
      <Show when={props.doc.discoveryContext}>
        {(context) => <span class="text-xs text-text-muted"> · {context()}</span>}
      </Show>
      <Show when={props.doc.note}>
        {(note) => <div class="text-xs text-slate-500 italic">{note()}</div>}
      </Show>
    </>
  );
}

/** Reference cell — a labelled, linked named document when resolved, else the raw `{type} #{id}`. */
function ReferenceCell(props: { row: LedgerRow }): JSX.Element {
  const doc = (): RefDocument | null => props.row.refDocument;
  /**
   * What to show when the reference did not resolve to a named document.
   *
   * **An internal uuid is never shown.** The column exists to point at something a merchant can
   * open — a purchase order, an order — and a 32-character key opens nothing, identifies nothing a
   * merchant holds, and reads as damage on the page. Where the id is one of ours, the row's movement
   * label is already the honest account of what happened, so the cell stays empty rather than
   * printing a key next to it. An admin-minted number (a receipt, a PO) is a real handle and stays.
   */
  const fallback = (): string => {
    const { refType, refId } = props.row;
    if (!refType) return '—';
    if (refId === null) return refType;

    return /^[0-9a-f]{32}$/.test(String(refId)) ? '—' : `${refType} #${refId}`;
  };
  return (
    <Show when={doc()} fallback={<span class="text-slate-500">{fallback()}</span>}>
      {(d) => (
        <Show when={d().type !== 'stock_adjustment'} fallback={<AdjustmentRef doc={d()} />}>
          <span>
            {refPrefix(d().type)}
            <Show when={d().url} fallback={<span>{refLinkText(d())}</span>}>
              {(url) => (
                <A href={url()} class="text-primary hover:underline">
                  {refLinkText(d())}
                </A>
              )}
            </Show>
            {refSuffix(d())}
          </span>
        </Show>
      )}
    </Show>
  );
}

/**
 * Per-product inventory-ledger inspector. Deep-linked from any domain surface
 * (`#/ledger/{subjectId}`); reads `GET invflux/v1/subjects/{subjectId}/ledger`, which resolves
 * references to named, linked documents (goods receipt → purchase order) and — for users with
 * `invflux_view_costs` — includes WAC/seed cost and a per-row acquisition-cost column (blank for
 * non-valued movements).
 */
export default function LedgerSection(): JSX.Element {
  const app = useApp();
  const api = createApi(app);
  const params = useParams<{ subjectId: string }>();

  const query = createQuery(() => ({
    queryKey: ['ledger', params.subjectId],
    queryFn: () => api.get<LedgerResponse>(`/subjects/${params.subjectId}/ledger`),
  }));

  const showCosts = (): boolean => query.data?.capabilities.viewCosts ?? false;

  const [view, setView] = createSignal<LedgerView>(storedLedgerView());
  const chooseView = (next: LedgerView): void => {
    setView(next);
    try {
      localStorage.setItem(LEDGER_VIEW_KEY, next);
    } catch {
      // Not remembered across visits; the choice still holds for this one.
    }
  };
  const [display, setDisplay] = createSignal<LedgerDisplay>(loadDisplay());
  const updateDisplay = (patch: Partial<LedgerDisplay>): void => {
    const next = { ...display(), ...patch };
    setDisplay(next);
    saveDisplay(next);
  };
  // The ledger is a detail route, so the shell reads its surface id off the first path segment
  // (`#/ledger/906` → `ledger`) rather than from a nav section; the panel registers under that.
  onCleanup(
    surfaceSettingsRegistry.register({
      surfaceId: 'ledger',
      id: 'display',
      order: 10,
      label: () => __('Display'),
      component: () => <LedgerSettingsPanel display={display} onChange={updateDisplay} />,
    }),
  );

  const card = createMemo(() => buildDisplayCard(stockCard(query.data?.rows ?? []), display()));
  /** The stock card's head is two rows deep (location over state); every other view's is one. */
  const headRows = (): number => ('stock-card' === view() ? 2 : 1);
  /**
   * The rows to draw, each keeping the index of its cells in the card.
   *
   * Merging can leave a row with nothing to say — it moved stock between two slots that are now one
   * column — and such a row is dropped rather than drawn blank. The original index travels with it
   * because the card is still computed over every row: the hidden ones carry balances the visible
   * ones depend on.
   */
  const visibleRows = createMemo(() =>
    (query.data?.rows ?? [])
      .map((row, index) => ({ row, index }))
      .filter(({ index }) => !card().hiddenRows[index]),
  );
  const viewOptions = (): Array<{ id: LedgerView; label: string }> => [
    {
      id: 'transitions',
      label: _x(
        'Transitions',
        'ledger view toggle: one column showing each movement from slot to slot',
      ),
    },
    {
      id: 'stock-card',
      label: _x(
        'Stock card',
        'ledger view toggle: one column per stock slot, with its balance on every row',
      ),
    },
  ];

  // Variation switcher state. A variable-product family exposes one segment per variation; the current
  // subject is either one of them (a variation — show its ledger) or the variable parent (not among
  // the siblings — show the control with nothing selected + a prompt, i.e. blank until a variation is
  // picked). Clicking a segment navigates same-tab to that variation's ledger.
  const currentId = (): number => Number(params.subjectId);
  const siblings = (): LedgerSibling[] => query.data?.siblings ?? [];
  const selected = (): LedgerSibling | undefined =>
    siblings().find((s) => s.subjectId === currentId());
  const isParentView = (): boolean => siblings().length > 0 && selected() === undefined;

  /**
   * A cost as money, not as the column that stores it. The wire value is a 4-decimal string because
   * that is the precision a unit cost is kept at; showing `142.0000 USD` leaks the storage decision
   * to a merchant who only ever wanted 142.00.
   *
   * The formatting itself is the app's one money format — the ISO code placed by the locale, never a
   * symbol — so this only decides what a *missing* cost looks like, which is a dash rather than a
   * zero: an unvalued movement has no cost, and 0.00 would be a claim about its worth.
   */
  const money = (value: string | null, currency: string | null): string => {
    if (value === null) return '—';
    const amount = Number(value);

    return Number.isFinite(amount) ? formatMoney(amount, currency) : value;
  };

  // Fill the viewport from wherever the section begins, the way the queue and the workbench do.
  // `h-screen` is 100vh measured from the top of the PAGE, not from below WordPress's admin bar and
  // the shell's tab strip, so it would overhang by exactly that chrome; this measures the element.
  let rootEl: HTMLDivElement | undefined;
  const fillHeight = createViewportFill(() => rootEl);

  return (
    <div ref={rootEl} class="flex flex-col p-4 bg-ground" style={{ height: fillHeight() }}>
      <Show
        when={query.data}
        fallback={
          <Show
            when={query.isError}
            fallback={<p class="text-sm text-slate-500">{__('Loading ledger…')}</p>}
          >
            <ErrorBanner class="text-sm">
              {query.error instanceof Error && query.error.message.includes('404')
                ? __('This product is not synced to an InvFlux subject.')
                : __('Could not load the ledger.')}
            </ErrorBanner>
          </Show>
        }
      >
        {(data) => (
          <>
            {/* Header: subject identity + (cost-gated) valuation. For a variable product the title is
                the family (parent) name; the segmented control below switches between variations. */}
            <header class="mb-4 shrink-0">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 class="text-lg font-semibold text-slate-900">
                  {data().subject.familyTitle ||
                    data().subject.postTitle ||
                    `#${data().subject.postId}`}
                </h1>
                <Show when={siblings().length > 0}>
                  <div
                    class="inline-flex flex-wrap gap-0.5 rounded-md bg-slate-100 p-0.5"
                    role="tablist"
                  >
                    <For each={siblings()}>
                      {(s) => (
                        <A
                          href={`/ledger/${s.subjectId}`}
                          role="tab"
                          aria-selected={s.subjectId === currentId()}
                          class="rounded px-2.5 py-1 text-sm font-medium no-underline transition-colors"
                          classList={{
                            'bg-surface text-slate-900 shadow-sm': s.subjectId === currentId(),
                            'text-slate-600 hover:text-slate-900': s.subjectId !== currentId(),
                          }}
                        >
                          {s.label}
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              {/* The identity line and the view switcher share a row: the switcher belongs to the
                  grid below, and on its own line it cost a whole band of vertical space that the
                  grid now wants, since the grid fills the viewport. */}
              <div class="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <dl class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text">
                  <div>
                    <dt class="inline text-text-muted">{__('SKU')}: </dt>
                    <dd class="inline font-mono">{data().subject.sku || '—'}</dd>
                  </div>
                  <div>
                    {/* WooCommerce's own product id, under the name its admin uses. The InvFlux
                      subject id is deliberately absent: it is an internal key, and a merchant
                      reading a stock history has nothing to do with it. */}
                    <dt class="inline text-text-muted">{__('Product ID')}: </dt>
                    <dd class="inline font-mono">{data().subject.postId}</dd>
                  </div>
                  {/* One cost, the one in force. The two are successive, not parallel: a product is
                      valued at the baseline a merchant seeded until a costed goods receipt
                      establishes a weighted average, and from then on the baseline is history. Shown
                      side by side they were two numbers with nothing saying which one counts — and
                      on 86% of this store's subjects the WAC half was simply a dash. The rest of the
                      system reads the same `weighted_avg_cost ?? seed_cost`.

                      The label is the workbench's, because this is that column's field and a second
                      name for it on a second surface is how vocabulary drifts — minus the "(WAC)"
                      while no receipt has established one, since the parenthetical names the very
                      thing that is absent. Both forms are words the app already had; which phase
                      applies is spelled out in the tooltip, at no new vocabulary at all. */}
                  <Show when={data().cost}>
                    {(cost) => (
                      <div
                        title={
                          cost().weightedAvgCost === null
                            ? __(
                                'Unit cost, editable as a starting baseline until the first goods receipt.',
                              )
                            : __(
                                'Weighted average cost, maintained from goods receipts. It supersedes the starting baseline.',
                              )
                        }
                      >
                        <dt class="inline text-text-muted">
                          {cost().weightedAvgCost === null
                            ? __('Unit cost')
                            : __('Unit cost (WAC)')}
                          :{' '}
                        </dt>
                        <dd class="inline font-mono">
                          {money(cost().weightedAvgCost ?? cost().seedCost, cost().currency)}
                        </dd>
                      </div>
                    )}
                  </Show>
                </dl>
                <Show when={!isParentView() && data().rows.length > 0}>
                  <div
                    class="inline-flex gap-0.5 rounded-md bg-surface-raised p-0.5"
                    role="radiogroup"
                    aria-label={__('Ledger view')}
                    data-testid="ledger-view-toggle"
                  >
                    <For each={viewOptions()}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={view() === option.id}
                          data-view={option.id}
                          class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                          classList={{
                            'bg-surface text-text shadow-sm': view() === option.id,
                            'text-text-muted hover:text-text': view() !== option.id,
                          }}
                          onClick={() => chooseView(option.id)}
                        >
                          {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </header>

            <Show
              when={!isParentView()}
              fallback={
                <p class="text-sm text-slate-500">
                  {__('Select a variation above to view its stock ledger.')}
                </p>
              }
            >
              <GovernanceBand governance={data().governance} hasRows={data().rows.length > 0} />
              <Show
                when={data().rows.length > 0}
                fallback={
                  // "Nothing happened" is only true while InvFlux is the one counting; otherwise the
                  // band above has already said why there is nothing here.
                  <Show when={'invflux' === data().governance.state}>
                    <p class="text-sm text-slate-500">{__('No stock movements recorded.')}</p>
                  </Show>
                }
              >
                <div class="min-h-0 flex-1 overflow-auto rounded border border-border bg-surface shadow-sm">
                  <table
                    class="w-full min-w-[720px] text-left text-sm"
                    data-testid="ledger-table"
                    data-view={view()}
                  >
                    {/* The stock card heads its columns twice: a location spanning its states, then
                        the states themselves. Every other column is one head spanning both rows, so
                        the two layouts share one row of cells. The transitions view has no column
                        groups and keeps a single head row. */}
                    <thead class="sticky top-0 z-10 border-b border-border bg-surface-raised text-xs font-semibold uppercase tracking-wide text-text-muted">
                      <tr>
                        <th class="px-3 py-2" rowSpan={headRows()}>
                          {__('Timestamp')}
                        </th>
                        <th class="px-3 py-2" rowSpan={headRows()}>
                          {__('Movement')}
                        </th>
                        <Show
                          when={'stock-card' === view()}
                          fallback={<th class="px-3 py-2">{__('Transition')}</th>}
                        >
                          <For each={card().groups}>
                            {(group) => (
                              <th
                                class="border-l border-border px-3 py-2 text-center normal-case"
                                colSpan={group.columns.length}
                                title={group.location}
                              >
                                {display().stateNames
                                  ? locationLabel(group.location)
                                  : group.location}
                              </th>
                            )}
                          </For>
                        </Show>
                        <th class="px-3 py-2" rowSpan={headRows()}>
                          {__('Actor')}
                        </th>
                        <th class="px-3 py-2" rowSpan={headRows()}>
                          {__('Reference')}
                        </th>
                        <Show when={showCosts()}>
                          <th class="px-3 py-2 text-right" rowSpan={headRows()}>
                            {__('Unit cost')}
                          </th>
                        </Show>
                      </tr>
                      <Show when={'stock-card' === view()}>
                        <tr>
                          <For each={card().columns}>
                            {(column) => (
                              <th
                                class="cursor-help px-3 py-1.5 text-right font-normal normal-case"
                                classList={{ 'font-mono': !display().stateNames }}
                                title={columnTitle(column, display())}
                              >
                                {display().stateNames
                                  ? stateLabel(column.state)
                                  : columnKeyLabel(column)}
                              </th>
                            )}
                          </For>
                        </tr>
                      </Show>
                    </thead>
                    <tbody class="divide-y divide-border">
                      <For each={visibleRows()}>
                        {({ row, index }) => (
                          <tr class="even:bg-ground hover:bg-surface-hover">
                            {/* Date over time: a ledger is read down the column, and stacking lets the
                                eye follow the days while the time stays available for the rows that
                                share one. The stored microsecond value remains the tooltip. */}
                            <td
                              class="px-3 py-2 whitespace-nowrap text-xs text-text-muted"
                              title={row.recordedAt}
                            >
                              {formatDate(row.recordedAt)}
                              <br />
                              <span class="text-text-muted">{formatTime(row.recordedAt)}</span>
                            </td>
                            {/* The label alone. A movement's machine code says the same thing in our
                                vocabulary rather than the merchant's, and the label is what the
                                registry exists to provide — so the code rides along as a tooltip for
                                whoever is debugging, and stops being a second line on every row. */}
                            <td class="px-3 py-2" title={row.movementCode}>
                              {row.movementLabel}
                            </td>
                            <Show
                              when={'stock-card' === view()}
                              fallback={
                                <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">
                                  {transition(row)}
                                </td>
                              }
                            >
                              <For each={card().columns}>
                                {(_column, col) => (
                                  <StockCardCellView cell={card().cells[index]?.[col()]} />
                                )}
                              </For>
                            </Show>
                            <td class="px-3 py-2 text-text">
                              <ActorCell row={row} showKey={display().actorKeys} />
                            </td>
                            <td class="px-3 py-2">
                              <ReferenceCell row={row} />
                            </td>
                            <Show when={showCosts()}>
                              {/* Grounded in the subject's cost currency: a row carries the amount
                                  but not what it is denominated in, and the currency is what decides
                                  how many decimals the amount has — two for CHF, none for JPY. The
                                  stored 4-decimal precision stays available as the tooltip. */}
                              <td class="px-3 py-2 text-right font-mono" title={row.cost?.unitCost}>
                                {money(
                                  row.cost?.unitCost ?? null,
                                  // Each costed line is frozen in its own currency and never
                                  // reconverted, so the line grounds its own amount; the subject's
                                  // currency covers the one source that has none, a goods receipt.
                                  row.cost?.currency ?? data().cost?.currency ?? null,
                                )}
                              </td>
                            </Show>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                {/* Once a row can be hidden, a bare count would describe a page the reader is not
                    looking at — so the footer says both numbers whenever they differ. */}
                <p class="mt-2 shrink-0 text-xs text-text-muted">
                  <Show
                    when={visibleCount(card().hiddenRows) !== data().rows.length}
                    fallback={sprintf(
                      /* translators: %d: number of ledger rows shown */
                      __('Showing the %d most recent movements.'),
                      data().rows.length,
                    )}
                  >
                    {sprintf(
                      /* translators: %1$d: movements shown; %2$d: movements in this page of the ledger. */
                      __(
                        'Showing %1$d of the %2$d most recent movements — the rest only moved stock within a column.',
                      ),
                      visibleCount(card().hiddenRows),
                      data().rows.length,
                    )}
                  </Show>
                </p>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
