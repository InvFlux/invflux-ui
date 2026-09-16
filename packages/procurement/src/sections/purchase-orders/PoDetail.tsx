import { __, _n, _x, formatDate, formatDateOnly, formatDateTime, sprintf } from '@invflux/i18n';
import {
  Button,
  ColumnPicker,
  ColumnsSettingsIcon,
  DropdownMenu,
  ErrorBanner,
  ConfirmModal,
  type PickableColumn,
  SegmentedControl,
  Select,
  SplitActionButton,
  Textarea,
  toast,
  useHostNav,
  PencilIcon,
  Hint,
} from '@invflux/ui';
import { type PoDetailActionContext, registerPoDetailActions } from './poDetailActions';
import { A, useLocation, useNavigate } from '@solidjs/router';

import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { VarianceBadge } from '../../components/VarianceBadge';
import { useProcurement } from '../../context';
import { persistedSignal } from '../../grid/persistedSignal';
import { createApi } from '../../lib/api';
import { qk, STOCK_MOVED } from '@invflux/ui/api';
import { usePaneActive } from '@invflux/ui/pane';
import {
  confirmationStatus,
  confirmationVarianceQty,
  deliveryStatus,
  deliveryVarianceQty,
  type VarianceLens,
} from '../../lib/variance';
import { INCOTERMS, incotermGloss, incotermLabel, isMaritimeOnly } from './incoterms';
import { PoExpectedCaptureGrid } from './PoExpectedCaptureGrid';
import { PoInvoiceCapture } from './PoInvoiceCapture';
import { supplierDocHint, supplierDocLabel, type SupplierDocKind } from './supplierDocKinds';
import { useTermsSets } from '../terms/useTermsSets';
import { refusalBody, refusalMessage } from '../terms/errors';
import { TermsModal, type TermsModalTarget } from '../terms/TermsModal';
import type { NumberingBreak, TermsPlace } from '../terms/types';
import { PoLinesEditor } from './PoLinesEditor';
import { availablePoLineColumns, type PoLineColumnId } from './poLineColumns';
import { SHORT_REASONS } from './shortReasons';
import { pruneReason, submittableLines } from './submissionRules';
import { IssueDraftModal } from './IssueDraftModal';
import type { SupplierProductsResponse } from '../suppliers/types';
import type { PoEventsResponse, PoLine, PoTimelineEvent, PurchaseOrderDetail } from './types';

/** A draft line the server would drop at submission (no quantity, or no price even after inheriting). */
interface PrunePreview {
  lineId: number;
  reason: string; // 'zero_qty' | 'no_price'
}

/** How often this page re-reads an order a delivery is being counted against (ms). */
const POLL_MS = 8_000;

const TH = 'border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600';
/** The same header, for the text columns — a name and a code read from the left, a figure doesn't. */
const TH_LEFT = 'border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600';

/** The supplier-document entry control, worn by both the menu trigger and the single-kind button. */
const CAPTURE_BTN =
  'rounded border border-slate-300 bg-surface px-3 py-1 text-sm text-slate-600 hover:bg-slate-50';
const TD = 'border-b border-slate-100 px-3 py-1.5 text-right tabular-nums';
/** Body cell for a machine-readable code: monospaced so digits align down the column. */
const TD_CODE = 'border-b border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500';
const fmtDate = (iso: string | null): string => formatDate(iso);

// Transition targets are the server's **stage slugs** — the same vocabulary the PO's `stage` field
// carries — posted to the generic /transition endpoint, which resolves the slug and validates the edge
// server-side against PurchaseOrderLifecycle. Posting slugs (not backing ints) keeps the client from
// drifting when the PoStatus enum is renumbered.
const STAGE_IN_RECEPTION = 'in_reception';
const STAGE_RECEIVED = 'received';
const STAGE_CANCELLED = 'cancelled';

// Register the core po.detail title-bar actions once (idempotent). Add-ons contribute more via the
// same shared entity-action registry.
registerPoDetailActions();

/**
 * Purchase-order detail (#/purchase-orders/:id) — the lifecycle view. This first slice is the
 * read surface (header + qty-progression lines) for any status; a Draft (in_prep) shows the
 * "Draft" pill. Draft editing, the submit-to-supplier transition, and inline receiving land in
 * subsequent slices.
 */
export function PoDetail(props: { id: string }): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The list's filter rides in the router query; preserve it on the way back so returning from a PO
  // lands on the same filtered list instead of a reset one.
  const location = useLocation();
  const hostNav = useHostNav();
  const [confirming, setConfirming] = createSignal(false);
  const [prunePreview, setPrunePreview] = createSignal<PrunePreview[] | null>(null);
  // Which gate raised the prune confirmation — both settle the lines, so both can surface one, and the
  // re-post has to go back to the endpoint that asked.
  const [pruneGate, setPruneGate] = createSignal<'assign-number' | 'mark-sent'>('assign-number');
  const [cancelling, setCancelling] = createSignal(false);
  const [archiving, setArchiving] = createSignal(false);
  // Finishing a partially-received order on what has arrived — the reason prompt's state.
  const [closingShort, setClosingShort] = createSignal(false);
  const [shortReason, setShortReason] = createSignal('supplier_oos');
  const [shortNote, setShortNote] = createSignal('');
  // A real nonce'd link (not window.open) → never popup-blocked. Opens an auto-printing HTML page
  // in a new tab for browser "Save as PDF". rest_route apiRoot already has `?`, so append with `&`.
  const printHref = (): string => {
    const base = `${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1/procurement/purchase-orders/${props.id}/print`;
    return `${base}${base.includes('?') ? '&' : '?'}_wpnonce=${encodeURIComponent(ctx.nonce)}`;
  };

  const paneActive = usePaneActive();
  // Whether a delivery is being counted against this order right now, mirrored into a signal so the
  // query below can poll on it without referring to its own result (which types as a cycle).
  const [countingNow, setCountingNow] = createSignal(false);

  const query = createQuery(() => ({
    queryKey: ['procurement', 'purchase-orders', props.id],
    queryFn: () => api.get<PurchaseOrderDetail>(`/procurement/purchase-orders/${props.id}`),
    // Poll while a delivery is being counted somewhere else, so this page reflects what the dock
    // is doing without the buyer reloading it. A hidden pane stops it — the surface stays mounted
    // behind another tab, and polling from there is work nobody is looking at.
    refetchInterval: () => (paneActive() && countingNow() ? POLL_MS : false),
  }));

  // The rest is not coming: write off what is still outstanding and finish the order. The same
  // write-off a count can end with, taken here without one — an earlier delivery already settled the
  // order, and this records only the decision that no further one is expected.
  const closeShort = createMutation(() => ({
    mutationFn: () =>
      api.post(`/receiving/purchase-orders/${props.id}/close-short`, {
        reason: shortReason(),
        note: '' === shortNote().trim() ? null : shortNote().trim(),
      }),
    onSuccess: () => {
      setClosingShort(false);
      setShortNote('');
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      toast.success(__('The order is closed on what arrived.'));
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not close the order short.')),
  }));

  // Activity timeline (who did what when). Separate query so it refreshes on its own key; invalidated
  // alongside the PO on any mutation. Read-only — needs stock-view.
  const eventsQuery = createQuery(() => ({
    queryKey: ['procurement', 'purchase-orders', props.id, 'events'],
    queryFn: () => api.get<PoEventsResponse>(`/procurement/purchase-orders/${props.id}/events`),
  }));
  const events = (): PoTimelineEvent[] => eventsQuery.data?.events ?? [];

  // Mirror "a count is open" out of the query result, which is what the poll above reads. Written
  // here rather than read directly in the query options, where referring to the query's own data
  // types as a cycle.
  createEffect(() => setCountingNow(query.data?.purchaseOrder.receivingOpen ?? false));

  // Give the draft its document number, then hand the operator the file to send. This is the
  // "becomes a real document" step: the number is permanent and gapless, so the server mints it once
  // and re-uses it on any later click. The lines are settled first (inherited costs frozen to the
  // catalogue, unorderable lines dropped) — and rather than drop them silently, the server returns the
  // doomed lines for confirmation and we re-post with `confirm: true`.
  const assignNumber = createMutation(() => ({
    mutationFn: (confirm: boolean) =>
      api.post<{ requiresConfirmation?: boolean; prune?: PrunePreview[] }>(
        `/procurement/purchase-orders/${props.id}/assign-number`,
        confirm ? { confirm: true } : {},
      ),
    onSuccess: (data) => {
      if (data.requiresConfirmation && data.prune) {
        setConfirming(false);
        setPruneGate('assign-number');
        setPrunePreview(data.prune); // open the "these lines will be removed" confirmation
        return;
      }
      setPrunePreview(null);
      invalidate();
      setConfirming(false);
      // The number is only useful in the operator's hands — download straight away, which is what
      // the action promises ("Assign number & download").
      exportXlsx.mutate();
    },
    onError: (e: unknown) => {
      setConfirming(false);
      setPrunePreview(null);
      toast.error(
        e instanceof Error ? e.message : __('Could not assign a number to the purchase order.'),
      );
    },
  }));

  // Record that the numbered PO went to the supplier (in_prep → submitted): the server freezes the
  // content and records the event. Nothing is transmitted — getting the order to the supplier is the
  // operator's job (the .xlsx download is the hand-off). Lines are re-settled here too, so one added
  // between numbering and sending still gets its inherited cost frozen.
  const markSent = createMutation(() => ({
    mutationFn: (confirm: boolean) =>
      api.post<{ requiresConfirmation?: boolean; prune?: PrunePreview[] }>(
        `/procurement/purchase-orders/${props.id}/mark-sent`,
        confirm ? { confirm: true } : {},
      ),
    onSuccess: (data) => {
      if (data.requiresConfirmation && data.prune) {
        setConfirming(false);
        setPruneGate('mark-sent');
        setPrunePreview(data.prune);
        return;
      }
      setPrunePreview(null);
      invalidate();
      toast.success(__('Purchase order marked as sent.'));
      setConfirming(false);
    },
    onError: (e: unknown) => {
      setConfirming(false);
      setPrunePreview(null);
      toast.error(
        e instanceof Error ? e.message : __('Could not mark the purchase order as sent.'),
      );
    },
  }));

  // Download the print-ready xlsx (any status) — the merchant sends it to the supplier themselves.
  const exportXlsx = createMutation(() => ({
    mutationFn: () =>
      api.download(
        `/procurement/purchase-orders/${props.id}/export`,
        `${po()?.number ?? 'purchase-order'}.xlsx`,
      ),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not export the purchase order.')),
  }));

  // Clone this PO into a fresh editable draft (recurring orders / "use as model") → open it.
  const copyToDraft = createMutation(() => ({
    mutationFn: () =>
      api.post<{ purchaseOrder: { id: number } }>(
        `/procurement/purchase-orders/${props.id}/copy`,
        {},
      ),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      toast.success(__('Copied to a new draft.'));
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not copy the purchase order.')),
  }));

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.procurement.purchaseOrders(props.id) });
    void queryClient.invalidateQueries({ queryKey: qk.procurement.purchaseOrders() }); // list stage column
    // A PO lifecycle move can put units on the shelf — receiving is the obvious one, and closing
    // short writes off the remainder. Both are stock movements, and the Workbench grid and the
    // Dispatch queue in this same never-unmounting client are showing the old numbers until told.
    // Before this they were told by nothing at all: the grid's key was invalidated by no one, so a
    // merchant who received a delivery here read yesterday's on-hand there until they alt-tabbed.
    for (const key of STOCK_MOVED) void queryClient.invalidateQueries({ queryKey: key });
  };

  // Generic forward lifecycle move (mark in transit, start receiving, close). The edge is validated
  // server-side; we just name the target status.
  const transition = createMutation(() => ({
    mutationFn: (to: string) =>
      api.post(`/procurement/purchase-orders/${props.id}/transition`, { to }),
    onSuccess: (_d, to) => {
      invalidate();
      setCancelling(false);
      if (STAGE_RECEIVED === to) toast.success(__('Purchase order received.'));
      else if (STAGE_IN_RECEPTION === to) {
        toast.success(__('Receiving session opened.'));
        // Opening a reception is a move to the dock, not a status edit: the operator pressed it
        // because they are about to count, and counting happens on the receiving surface. Staying
        // here leaves them on a page whose only remaining offer is the link they would click next.
        //
        // Followed by assigning the href the adjacent link already carries, rather than the
        // router's `navigate`: this component sits under the procurement section's own base (it
        // navigates `/purchase-orders/{id}`, not `/procurement/…`), so an absolute route resolves
        // against the wrong root. `receivingHref()` is resolved by the host binding, so it stays
        // correct whether surfaces are hash routes in one page or separate admin pages.
        window.location.href = receivingHref();
      } else if (STAGE_CANCELLED === to) {
        toast.success(__('Purchase order cancelled.'));
        navigate(-1); // cancelled = done with it; return to wherever we came from
      }
    },
    onError: (e: unknown) => {
      setCancelling(false);
      toast.error(e instanceof Error ? e.message : __('That status change is not allowed.'));
    },
  }));

  /**
   * File the order out of the working lists, or put it back.
   *
   * Its own endpoint rather than a status move: filing away leaves the stage alone, so the order
   * still says how it turned out while it sits out of the lists. Filing away navigates back to the
   * list it just left; putting it back stays put, because the order the operator is reading is the
   * one they wanted.
   */
  const setArchived = createMutation(() => ({
    mutationFn: (archived: boolean) =>
      api.put(`/procurement/purchase-orders/${props.id}/archived`, { archived }),
    onSuccess: (_d, archived) => {
      invalidate();
      setArchiving(false);
      if (archived) {
        toast.success(__('Purchase order filed away.'));
        navigate(`/purchase-orders${location.search}`);
      } else {
        toast.success(__('Purchase order put back in the lists.'));
      }
    },
    onError: (e: unknown) => {
      setArchiving(false);
      toast.error(e instanceof Error ? e.message : __('Could not file that purchase order away.'));
    },
  }));

  const po = () => query.data?.purchaseOrder;
  const lines = (): PoLine[] => query.data?.lines ?? [];
  const decimals = (): number => po()?.costDecimals ?? 2;
  const fmt = (v: string | null): string => (null === v ? '—' : Number(v).toFixed(decimals()));
  const grandTotal = createMemo(() =>
    lines().reduce((sum, l) => sum + (null === l.lineTotal ? 0 : Number(l.lineTotal)), 0),
  );
  // Received / Open only make sense once the PO is past draft; a draft shows Qty + cost only.
  const isDraft = (): boolean => 'in_prep' === po()?.stage;

  // Supplier catalogue — only needed by the submit modal (MOQ / case-pack checks + [Fix all quantities]);
  // fetched once the PO is a draft. Same queryKey as PoLinesEditor's, so TanStack de-dupes the request.
  const catalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', po()?.supplierId ?? 0, 'products'],
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${po()?.supplierId}/products`),
    enabled: isDraft() && undefined !== po()?.supplierId,
  }));
  const moqFor = (subjectId: number): number | null =>
    catalogue.data?.products.find((p) => p.subjectId === subjectId)?.moq ?? null;
  const casePackFor = (subjectId: number): number | null =>
    catalogue.data?.products.find((p) => p.subjectId === subjectId)?.casePack ?? null;

  // Would the server prune any line at submission? We pass the matching `confirm` flag so the
  // client/server prune sets agree (the prune modal is only a fallback).
  const wouldPrune = (): boolean => lines().some((l) => null !== pruneReason(l));

  // What the PO amounts to once the doomed lines are dropped. Zero ⇒ the draft is empty in substance
  // however many rows it shows, and the server would refuse it — so the headline action goes disabled
  // rather than opening a modal whose only outcome is an error.
  const submittableCount = createMemo(() => submittableLines(lines()).length);

  // Stage a set of qty fixes from the submit modal ([Fix all quantities] / [Set suggested quantities]):
  // parallel PATCHes, one reconcile — the grid + modal then recompute from the authoritative reload.
  const fixQtys = createMutation(() => ({
    mutationFn: (patches: Array<{ id: number; qty: number }>) =>
      Promise.all(
        patches.map((p) =>
          api.patch(`/procurement/purchase-orders/${props.id}/lines/${p.id}`, {
            qty_requested: p.qty,
          }),
        ),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id],
      }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not update the quantities.')),
  }));

  // Delivery-variance lens (Ordered = purchasing/admin, Expected = dock/ops), shared with the receive
  // grid via the same persisted key so the chosen baseline follows the operator across both surfaces.
  const [lens, setLens] = persistedSignal<VarianceLens>(
    'invflux:po-receive:variance-baseline',
    'ordered',
  );

  // The reception columns (Received / Damaged / Open + the delivery Status) are structurally empty and
  // meaningless before any goods receipt, so the read table hides them at the pre-GR stages and shows
  // Ordered + Expected + a confirmation Status instead. Expected itself is display-only here — its
  // entry lives in the dedicated OA/ASN/Invoice document-capture workflow, never inline.
  const preReception = (): boolean => ['submitted', 'in_transit'].includes(po()?.stage ?? '');

  // ── Which columns the lines table shows ───────────────────────────────────────────────────────
  // Visibility only, no order: the table below is a hand-written template, so a stored order could
  // not be honoured. The hidden set persists per operator, per browser — a display preference, not
  // store policy, so it is deliberately not saved server-side.
  const [hiddenColumns, setHiddenColumns] = persistedSignal<PoLineColumnId[]>(
    'invflux:po-lines:hidden',
    [],
  );
  const [columnsOpen, setColumnsOpen] = createSignal(false);
  const offeredColumns = (): PickableColumn<PoLineColumnId>[] =>
    availablePoLineColumns(preReception());
  const shows = (id: PoLineColumnId): boolean => !hiddenColumns().includes(id);
  const toggleColumn = (id: PoLineColumnId): void => {
    setHiddenColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };
  // Counted rather than a constant: the empty-state and total rows span whatever is actually on
  // screen, so hiding a column cannot leave a stray cell past the end of the table.
  const readColCount = (): number => offeredColumns().filter((c) => shows(c.id)).length;

  // Which variance a line surfaces: pre-reception → confirmation (ordered vs supplier-confirmed); once
  // anything is received or the line is finalized → delivery (received vs the chosen lens).
  const isDeliveryStage = (l: PoLine): boolean => l.qtyReceived > 0 || 0 === l.qtyOpen;
  // Show the lens toggle only when delivery badges are actually on screen (lens is moot pre-reception).
  const anyDelivery = (): boolean => !preReception() && lines().some(isDeliveryStage);

  // Supplier-document capture: which kind is being recorded, or null when the table is showing.
  // The kind lives here rather than inside either capture screen so switching between them keeps one
  // continuous picker — the control stays put and the body under it changes.
  const [capturing, setCapturing] = createSignal<SupplierDocKind | null>(null);
  // An acknowledgement or a shipping notice states what is still *coming*, so both are offered
  // while something still is. A second notice is ordinary on a multi-shipment order — after an
  // acknowledgement, and after a first delivery has been received — so those stages are not the
  // limit; only being settled is.
  //
  // A count in progress is the one live stage that refuses them, and the reason is not tidiness:
  // `qtyExpected` is a **total** rather than a remainder, and it is the baseline the floor's
  // variance is measured against. Raising it for a second shipment mid-count turns a complete
  // delivery into "15 short" under the person deciding whether to close short. The document waits
  // for the count, which is minutes; a wrong close-short decision does not undo.
  const expectedBlockedBecause = (): string | undefined => {
    const stage = po()?.stage ?? '';
    if ('in_reception' === stage) {
      return __(
        'A count is in progress. Expected quantities are the baseline its variance is measured against, so they stay put until it is finalised.',
      );
    }
    if (['received', 'cancelled', 'archived'].includes(stage)) {
      return __('This order is settled — nothing further is expected on it.');
    }

    return undefined;
  };
  // An invoice is on a different clock. It arrives before the goods, with them, or long after the
  // order closed, so no stage forbids it — only a draft, which the supplier has not been sent yet,
  // and a cancelled order, which was never delivered. Pricing is its own authority, so the
  // capability is asked separately and mirrored from the server's own check on that route.
  const invoiceBlockedBecause = (): string | undefined => {
    if (!ctx.capabilities.stateCost) {
      return __('Recording what a supplier charged needs the cost-entry permission.');
    }
    if (
      ![
        'submitted',
        'acknowledged',
        'in_transit',
        'in_reception',
        'partially_received',
        'received',
      ].includes(po()?.stage ?? '')
    ) {
      return __('This order was never delivered, so there is nothing to be invoiced for.');
    }

    return undefined;
  };
  /**
   * Every supplier document, each carrying the reason it cannot be recorded right now.
   *
   * Unavailable kinds are shown **disabled with that reason** rather than filtered out: a missing
   * entry leaves the merchant to guess whether the moment is wrong or whether InvFlux models the
   * document at all, and those want different responses. Same treatment the goods-receipt reason
   * picker gives a cost source this build cannot work out.
   */
  const docKindOptions = (): { kind: SupplierDocKind; blocked?: string }[] => [
    { kind: 'oa', blocked: expectedBlockedBecause() },
    { kind: 'asn', blocked: expectedBlockedBecause() },
    { kind: 'invoice', blocked: invoiceBlockedBecause() },
  ];
  const docKinds = (): SupplierDocKind[] =>
    docKindOptions()
      .filter((o) => undefined === o.blocked)
      .map((o) => o.kind);
  // The control appears while at least one kind is possible. A menu whose every entry is disabled
  // states a rule nobody can act on, which is worse than the page simply not offering the step.
  const canCaptureDocument = (): boolean => docKinds().length > 0;
  // (Cancel/Archive availability now lives on the po.detail actions' isAvailable — see poDetailActions.ts.)
  // The open-session form shows while in reception and nothing has been committed yet.
  // The session form shows whenever a reception is open. (Essentials finalizes straight to received, so it only
  // shows before the first receipt; Pro re-opens for the next delivery, so it shows again with prior
  // receipts committed — the form counts the new delivery against the remaining qty_open.)
  const isReceiving = (): boolean => 'in_reception' === po()?.stage;
  const isPartiallyReceived = (): boolean => 'partially_received' === po()?.stage;
  // A count is open against this order — the buyer joins it rather than starting a second one, which
  // the database refuses anyway (one session per document).
  const receivingOpen = (): boolean => po()?.receivingOpen ?? false;
  // How many people are on that count. A number, not names: who is on the dock is the receiving
  // surface's to show, and this page only needs to say whether anyone is.
  const countersOnIt = (): number => po()?.receivingCounters ?? 0;
  // Into the receiving surface's own route. The count belongs there, so this is a link and not a
  // second implementation — and it works for a buyer who also holds the inventory capability, which
  // at Essentials is everyone who can see this page.
  const receivingHref = (): string =>
    hostNav.routeHref(`/receiving/new/purchase-order/${props.id}`);
  const outstandingUnits = (): number => lines().reduce((sum, l) => sum + l.qtyOpen, 0);
  // Deep-link to the central workbench filtered to this PO's products (parents pull their variations via
  // bring_children). Dash-joined post ids — the param shape the workbench's PostIdsFilter reads. The
  // supplier filter (supplier[]=<id>) is carried too, so the supplier-specific per-product columns
  // (supplier SKU / cost) can be made visible there.
  const workbenchHref = (): string | null => {
    const ids = [
      ...new Set(
        lines()
          .map((l) => l.postId)
          .filter((id): id is number => null !== id),
      ),
    ];
    if (0 === ids.length) {
      return null;
    }
    const supplierId = po()?.supplierId;
    const supplierParam = supplierId ? `&supplier[]=${supplierId}` : '';
    return hostNav.routeHref(
      '/workbench',
      `post_ids=${ids.join('-')}${supplierParam}&bring_children=1`,
    );
  };

  // The supplier link shows the nickname when one is set, so the legal name earns a tooltip. When the
  // two are the same string there is no nickname, and a tooltip would only repeat what is on screen.
  const supplierLegalName = (): string | undefined => {
    const legal = po()?.supplierName;
    return legal && legal !== po()?.supplierDisplay ? legal : undefined;
  };

  // Live context handed to the title-bar action registry each render. The actions are declared in
  // poDetailActions.ts; here we bind the verbs to this component's mutations/signals + expose the state.
  const poActionCtx = (): PoDetailActionContext => ({
    stage: po()?.stage ?? '',
    hasPro: ctx.hasPro,
    busy:
      transition.isPending ||
      assignNumber.isPending ||
      markSent.isPending ||
      exportXlsx.isPending ||
      copyToDraft.isPending,
    lineCount: lines().length,
    submittableCount: submittableCount(),
    numbered: po()?.numbered ?? false,
    number: po()?.number ?? null,
    workbenchHref: workbenchHref(),
    transitionTo: (slug) => transition.mutate(slug),
    openIssue: () => setConfirming(true),
    markSent: () => markSent.mutate(false),
    exportXlsx: () => exportXlsx.mutate(),
    copyToDraft: () => copyToDraft.mutate(),
    print: () => window.open(printHref(), '_blank', 'noopener'),
    openInWorkbench: () => {
      const href = workbenchHref();
      if (null === href) return;
      if (hostNav.opensNewTab) window.open(href, '_blank', 'noopener');
      else window.location.href = href;
    },
    beginCancel: () => setCancelling(true),
    archived: po()?.archived ?? false,
    beginArchive: () => setArchiving(true),
    unarchive: () => setArchived.mutate(false),
  });

  // Inline ETA editing. The expected date is set at creation but supplier dates move, so it stays
  // revisable until the PO is terminal; each change records a po.eta_changed audit event server-side
  // (visible in the timeline). The date input speaks `yyyy-mm-dd`.
  const [editingEta, setEditingEta] = createSignal(false);
  const [etaDraft, setEtaDraft] = createSignal('');
  const canEditHeader = (): boolean =>
    !(po()?.archived ?? false) && !['received', 'cancelled'].includes(po()?.stage ?? '');
  // The commercial terms are what the supplier was sent, so they close when the order goes out —
  // earlier than the ETA, which keeps moving for the whole live life of the order. Mirrors the
  // server, which refuses the same fields from `submitted` on, so the pencil is withheld rather than
  // offered and then refused.
  const canEditTerms = (): boolean => canEditHeader() && 'in_prep' === po()?.stage;
  const beginEditEta = (): void => {
    // expectedAt is already a `YYYY-MM-DD` calendar date — feed it straight to the date input.
    setEtaDraft(po()?.expectedAt ?? '');
    setEditingEta(true);
  };
  const updateEta = createMutation(() => ({
    mutationFn: (expectedAt: string | null) =>
      api.patch<{ purchaseOrder: PurchaseOrderDetail }>(
        `/procurement/purchase-orders/${props.id}`,
        { expected_at: expectedAt },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id, 'events'],
      });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] }); // list ETA column
      setEditingEta(false);
      toast.success(__('Expected date updated.'));
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not update the expected date.')),
  }));

  // Per-order commercial terms: the delivery term (Incoterm + its named place), how the goods
  // travel, and which purchase terms the order carries. Editable on the same window as the ETA —
  // until the PO is terminal — and saved through the same header PATCH, which records which fields
  // moved. The purchase terms stop being editable earlier, at numbering, which freezes them.
  const [editingTerms, setEditingTerms] = createSignal(false);
  // Whether the block states anything at all. Purchase terms count only at the two overriding rungs:
  // the store's set applies to every order, so inheriting it is not something this order says.
  const hasTerms = (): boolean =>
    null !== (po()?.incoterm ?? null) ||
    null !== (po()?.shippingMethod ?? null) ||
    true === po()?.termsOneOff ||
    null !== (po()?.termsLineageId ?? po()?.supplierTermsLineageId ?? null);
  const [incotermDraft, setIncotermDraft] = createSignal('');
  const [placeDraft, setPlaceDraft] = createSignal('');
  const [shippingDraft, setShippingDraft] = createSignal('');
  // The order's purchase terms: inherited, a set on file, or written for this order alone — one of
  // the three, which is why they are one choice rather than a picker beside a text box.
  const TERMS_INHERIT = '';
  const TERMS_ONE_OFF = 'one-off';
  const TERMS_SET = 'set:';
  const [termsChoice, setTermsChoice] = createSignal(TERMS_INHERIT);
  const [oneOffDraft, setOneOffDraft] = createSignal('');
  /** The terms dialog, open on a set, a new set, or this order's own text — null while closed. */
  const [termsModal, setTermsModal] = createSignal<TermsModalTarget | null>(null);
  const termsSets = useTermsSets();
  const termsSetName = (id: number | null | undefined): string | null =>
    null == id ? null : (termsSets.data?.sets.find((s) => s.id === id)?.name ?? null);
  /** What inheriting means for this order, named: its supplier's set, else the store's, else none. */
  const inheritLabel = (): string => {
    const supplierSet = termsSetName(po()?.supplierTermsLineageId);
    if (null !== supplierSet) {
      /* translators: %s: the name of the supplier's set of purchase terms */
      return sprintf(__('The supplier’s terms (“%s”)'), supplierSet);
    }
    const storeSet = termsSets.data?.sets.find((s) => s.isStoreDefault)?.name ?? null;

    /* translators: %s: the name of the store's default set of purchase terms */
    return null !== storeSet
      ? sprintf(__('The store’s default terms (“%s”)'), storeSet)
      : __('None');
  };
  /** The set the picker stands on: the one chosen, else the one the order inherits. Null for a one-off or none. */
  const pickedSetId = (): number | null => {
    const choice = termsChoice();
    if (choice.startsWith(TERMS_SET)) {
      return Number(choice.slice(TERMS_SET.length));
    }
    if (TERMS_INHERIT === choice) {
      return inheritedSetId();
    }

    return null;
  };
  /** The set the order follows while it chooses none: its supplier's, else the store's. */
  const inheritedSetId = (): number | null =>
    po()?.supplierTermsLineageId ?? termsSets.data?.sets.find((s) => s.isStoreDefault)?.id ?? null;
  // A set made from here — new, or an edited copy of a shared one — is chosen in the picker, and the
  // card's Save commits it with the rest of the card. Choosing the set the order already inherits
  // leaves it inheriting, so it keeps following its supplier.
  const chooseForOrder = (id: number): void => {
    if (TERMS_INHERIT === termsChoice() && id === inheritedSetId()) {
      return;
    }
    setTermsChoice(`${TERMS_SET}${id}`);
  };
  /** How the set the picker stands on applies: chosen for this order, or inherited. */
  const pickedVia = (): 'chosen' | 'supplier' | 'store' =>
    termsChoice().startsWith(TERMS_SET)
      ? 'chosen'
      : null != po()?.supplierTermsLineageId
        ? 'supplier'
        : 'store';
  /**
   * This order as the terms dialog names it — its number once it has one, else "Draft #N", as the order
   * list shows drafts — with what applies to it and how to make another set apply.
   */
  const termsPlace = (
    appliedId: number | null,
    via: 'chosen' | 'supplier' | 'store',
  ): TermsPlace => {
    const ref = po()?.number ?? sprintf(__('Draft #%d'), Number(props.id));

    return {
      appliedId,
      appliesText:
        'supplier' === via
          ? /* translators: %s: a purchase order, e.g. "Draft #123" or "PO-1042" */
            sprintf(__('These terms are on %s, from its supplier.'), ref)
          : 'store' === via
            ? /* translators: %s: a purchase order, e.g. "Draft #123" or "PO-1042" */
              sprintf(__('These terms are on %s, as the store default.'), ref)
            : /* translators: %s: a purchase order, e.g. "Draft #123" or "PO-1042" */
              sprintf(__('These terms are on %s.'), ref),
      /* translators: %s: a purchase order, e.g. "Draft #123" */
      useLabel: sprintf(__('Use these terms on %s'), ref),
      /* translators: %s: a purchase order, e.g. "Draft #123" */
      badge: sprintf(_x('On %s', 'terms list badge: the set a purchase order carries'), ref),
      saveAndUse: (version) =>
        null === version
          ? /* translators: %s: a purchase order, e.g. "Draft #123" */
            sprintf(__('Save and use on %s'), ref)
          : /* translators: 1: the version number a save will create, 2: a purchase order, e.g. "Draft #123" */
            sprintf(__('Save version %1$d and use on %2$s'), version, ref),
    };
  };
  /** Whether this order's terms can still change: a draft, before numbering fixes them. */
  const termsOpen = (): boolean => canEditTerms() && null === (po()?.number ?? null);
  /**
   * What the read view's terms link opens. A numbered order shows the text numbering fixed on it —
   * its set may have a newer version since. Past the draft stage nothing is edited from here.
   */
  const viewTermsTarget = (): TermsModalTarget | null => {
    const p = po();
    if (undefined === p) {
      return null;
    }
    const setId = p.termsLineageId ?? p.supplierTermsLineageId;
    if (null !== p.number && null != p.termsIssuedText) {
      return { kind: 'issued', text: p.termsIssuedText, name: termsSetName(setId) };
    }
    if (null === setId) {
      return null;
    }

    const place = termsPlace(setId, null !== p.termsLineageId ? 'chosen' : 'supplier');

    return termsOpen()
      ? { kind: 'set', id: setId, useHere: chooseForOrderNow, place }
      : { kind: 'set', id: setId, readOnly: true, place };
  };
  /** Chosen from the card's read view, where there is no card Save: the order is saved at once. */
  const chooseForOrderNow = async (id: number): Promise<void> => {
    const p = po();
    if (undefined === p || id === (p.termsLineageId ?? inheritedSetId())) {
      return;
    }
    await api.patch(`/procurement/purchase-orders/${props.id}`, { terms_lineage_id: id });
    await queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id] });
  };
  /** Save this order's own terms from the dialog: true once saved, else the breaks it was refused for. */
  const saveOneOff = async (text: string): Promise<true | NumberingBreak[]> => {
    try {
      const data = await api.patch<PurchaseOrderDetail>(
        `/procurement/purchase-orders/${props.id}`,
        {
          terms_one_off: text,
        },
      );
      setOneOffDraft(data.purchaseOrder.termsOneOffText ?? text);
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id],
      });
      toast.success(__('The terms for this order are saved.'));

      return true;
    } catch (e: unknown) {
      const refused = refusalBody(e);
      toast.error(refusalMessage(e, __('Could not save the terms for this order.')));

      return 'numbering_break' === refused.reason && Array.isArray(refused.numberingBreaks)
        ? (refused.numberingBreaks as NumberingBreak[])
        : [];
    }
  };
  const termsPayload = (): Record<string, unknown> => {
    const choice = termsChoice();
    if (TERMS_ONE_OFF === choice) {
      return { terms_one_off: oneOffDraft() };
    }

    return {
      terms_lineage_id: choice.startsWith(TERMS_SET)
        ? Number(choice.slice(TERMS_SET.length))
        : null,
    };
  };
  const beginEditTerms = (): void => {
    const p = po();
    setIncotermDraft(p?.incoterm ?? '');
    setPlaceDraft(p?.incotermPlace ?? '');
    setShippingDraft(p?.shippingMethod ?? '');
    setTermsChoice(
      p?.termsOneOff
        ? TERMS_ONE_OFF
        : null != p?.termsLineageId
          ? `${TERMS_SET}${p.termsLineageId}`
          : TERMS_INHERIT,
    );
    setOneOffDraft(p?.termsOneOffText ?? '');
    setEditingTerms(true);
  };
  // The term is meaningless without its place ("FCA" says nothing, "FCA Rotterdam" is a term), and
  // the four maritime terms are routinely written on air and road orders where they have no defined
  // meaning. Both are warnings, not blocks: the merchant knows their trade better than we do.
  const termsWarning = (): string | null => {
    if ('' !== incotermDraft() && '' === placeDraft().trim()) {
      return __('A delivery term needs a named place to mean anything — e.g. “FCA Rotterdam”.');
    }
    if (isMaritimeOnly(incotermDraft())) {
      return __('This term is defined for sea and inland-waterway transport only.');
    }

    return null;
  };
  const updateTerms = createMutation(() => ({
    mutationFn: () =>
      api.patch<{ purchaseOrder: PurchaseOrderDetail }>(
        `/procurement/purchase-orders/${props.id}`,
        {
          incoterm: incotermDraft() || null,
          incoterm_place: placeDraft().trim() || null,
          shipping_method: shippingDraft().trim() || null,
          // The purchase terms ride along only while the order is un-numbered: numbering froze them,
          // and the server refuses a change after it.
          ...(null === po()?.number ? termsPayload() : {}),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'purchase-orders', props.id, 'events'],
      });
      setEditingTerms(false);
      toast.success(__('Delivery & terms updated.'));
    },
    // The server's own sentence where it gave one — "Request failed (422)" tells a merchant nothing.
    onError: (e: unknown) =>
      toast.error(refusalMessage(e, __('Could not update the delivery terms.'))),
  }));

  return (
    <section>
      <Show when={termsModal()}>
        {(target) => <TermsModal target={target()} onClose={() => setTermsModal(null)} />}
      </Show>
      <Show when={query.isPending}>
        <p class="mt-4 text-slate-500">{__('Loading…')}</p>
      </Show>
      <Show when={query.isError}>
        <ErrorBanner class="mt-4">{__('Failed to load the purchase order.')}</ErrorBanner>
      </Show>

      <Show when={po()}>
        {(p) => (
          <>
            <header class="mb-4 flex items-center gap-3">
              {/* Reads as one sentence: what this is, which one, where it stands, and who it is for. */}
              <h1 class="text-xl flex items-center gap-2 font-semibold">
                <span class="font-normal text-text-muted">{__('Purchase Order')}</span>
                {/* Un-numbered draft: fall back to the internal id, muted and `#`-sigilled so it can't
                    be read as the document number (which is prefixed and possibly zero-padded). */}
                <Show
                  when={p().number}
                  fallback={<span class="font-normal text-text-muted">#{p().id}</span>}
                >
                  {(number) => <span>{number()}</span>}
                </Show>

                <StatusPill status={p().stage} />

                <span class="font-normal text-text-muted">
                  {_x('to', 'purchase order … to {supplier}')}
                </span>
                <A
                  href={`/suppliers/${po()?.supplierId}/pos`}
                  class="text-slate-500 text-lg hover:text-slate-800"
                  title={supplierLegalName()}
                >
                  {po()?.supplierDisplay}
                </A>
              </h1>

              {/* Title-bar actions via the shared entity-action registry: one
                  contextual primary + an overflow menu. No top-bar action during an open reception — the
                  receive form owns finalize (Confirm / Close short / Close partial / Cancel), so none of
                  the registered primaries match in_reception. */}
              <div class="ml-auto">
                <SplitActionButton
                  scope="po.detail"
                  ctx={poActionCtx()}
                  overflowLabel={__('More actions')}
                />
              </div>
            </header>

            {/* What the document states, as one panel on the ground. The page <header> above stays
                out of it: a heading names the page rather than sitting on it, which is how the
                receiving surface reads too. */}
            {/* The panel spans the column; the *content* inside it is what stays narrow. Constraining
                the panel instead left its right edge short of the line table's below, and two
                stacked cards that nearly line up read as a mistake rather than as a choice. */}
            <div class="mb-6 rounded border border-border bg-surface p-4">
              {/* Two columns: the order's own facts on the left, what it says about delivery on the
                  right. The terms block starts its heading on the first row and runs down beside the
                  facts, so the panel reads as two short statements rather than one long one. */}
              {/* Wraps to one column when there is not room for two — and wraps on the *container's*
                  width via `auto-fit`, not on a viewport breakpoint. The width this panel actually
                  gets depends on the WP admin sidebar, which collapses on its own schedule, so a
                  `md:` rule would be guessing at a number it cannot see and would strand the second
                  column off-screen exactly where it did before. */}
              <div class="grid max-w-4xl grid-cols-[repeat(auto-fit,minmax(19rem,1fr))] gap-x-10 gap-y-4">
                <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 self-start text-sm">
                  <dt class="text-slate-500">{__('Currency')}</dt>
                  <dd>
                    {p().currency}
                    {p().currency !== p().baseCurrency ? ` → ${p().baseCurrency}` : ''}
                  </dd>
                  <dt class="text-slate-500">{__('Created')}</dt>
                  <dd>{fmtDate(p().createdAt)}</dd>
                  <dt class="text-slate-500">{__('Expected (ETA)')}</dt>
                  <dd>
                    <Show
                      when={editingEta()}
                      fallback={
                        <Show
                          when={canEditHeader()}
                          fallback={<>{formatDateOnly(p().expectedAt)}</>}
                        >
                          <button
                            type="button"
                            class="group inline-flex items-center gap-1 rounded px-1 -mx-1 text-left hover:bg-slate-100"
                            title={__('Change the expected date')}
                            onClick={beginEditEta}
                          >
                            <span>{formatDateOnly(p().expectedAt)}</span>
                            <PencilIcon class="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
                          </button>
                        </Show>
                      }
                    >
                      <span class="inline-flex items-center gap-1">
                        <input
                          aria-label={__('Expected date')}
                          type="date"
                          class="rounded border border-slate-300 px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={etaDraft()}
                          onInput={(e) => setEtaDraft(e.currentTarget.value)}
                        />
                        <button
                          type="button"
                          class="rounded bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                          disabled={updateEta.isPending}
                          onClick={() => updateEta.mutate(etaDraft() || null)}
                        >
                          {__('Save')}
                        </button>
                        <button
                          type="button"
                          class="rounded px-1 text-xs text-slate-500 hover:text-slate-800"
                          onClick={() => setEditingEta(false)}
                        >
                          {__('Cancel')}
                        </button>
                      </span>
                    </Show>
                  </dd>
                </dl>

                {/* Delivery & terms — what the purchase order states beyond the goods themselves. Its
                  own block rather than more rows in the facts list, because it is document content
                  the merchant edits as a *set*, not per-field facts like the ETA.

                  In read mode it sits in the second column beside those facts. Editing spans the
                  whole panel instead: the editor is a four-field form, and a form squeezed into half
                  the width to preserve a reading layout is a layout winning an argument it should
                  not be in. */}
                <section class={editingTerms() ? 'col-span-full' : 'self-start'}>
                  <h2 class="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {__('Delivery & terms')}
                    <Show when={!editingTerms() && !hasTerms()}>
                      <span class="font-normal normal-case tracking-normal text-text-muted">
                        {__('(none)')}
                      </span>
                    </Show>
                    <Show when={canEditTerms() && !editingTerms()}>
                      <button
                        type="button"
                        class="text-slate-300 hover:text-slate-500"
                        title={__('Edit the delivery terms for this order')}
                        onClick={beginEditTerms}
                      >
                        <PencilIcon class="h-3.5 w-3.5" />
                      </button>
                    </Show>
                    {/* Said once the order is out, so the missing pencil reads as a rule rather than
                        a bug. Only where there is a panel to explain — a terminal order explains
                        itself. */}
                    <Show when={canEditHeader() && !canEditTerms()}>
                      <span
                        class="font-normal normal-case tracking-normal text-text-muted"
                        title={__(
                          'These terms are part of what the supplier received, so they are fixed from the moment the order was sent.',
                        )}
                      >
                        {__('(as sent)')}
                      </span>
                    </Show>
                  </h2>

                  <Show
                    when={editingTerms()}
                    fallback={
                      <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-sm">
                        {/* Read mode is dense: a row appears only when it has something to say. Most
                        orders state none of this, and three em-dashes cost a block of the page to
                        report nothing. The "(none)" beside the heading carries that instead. */}
                        <Show when={p().incoterm}>
                          {(code) => (
                            <>
                              <dt class="text-slate-500">{__('Delivery term')}</dt>
                              <dd>
                                {/* The code alone, because that is the term of art printed on the
                                    document and the one a merchant matches against the supplier's
                                    paperwork. The gloss rides in the hint rather than in the line:
                                    spelled out it is longer than every other value in this panel and
                                    wraps a field that states three letters onto two. */}
                                {code()}
                                <Show when={incotermGloss(code())}>
                                  {(gloss) => <Hint text={gloss()} />}
                                </Show>
                                <Show when={p().incotermPlace}>
                                  {(place) => <span class="text-slate-500">{` · ${place()}`}</span>}
                                </Show>
                              </dd>
                            </>
                          )}
                        </Show>
                        <Show when={p().shippingMethod}>
                          {(method) => (
                            <>
                              <dt class="text-slate-500">{__('Shipping')}</dt>
                              <dd class="break-words">{method()}</dd>
                            </>
                          )}
                        </Show>
                        {/* Only the two overriding rungs of `order ?? supplier ?? store` earn a row —
                        the store's set is the baseline every order inherits, so stating it here
                        would put a line on every purchase order to say "nothing special". The
                        marker distinguishes the supplier's set from this order's own choice. */}
                        <Show
                          when={
                            p().termsOneOff ||
                            null != p().termsIssuedText ||
                            null !== (p().termsLineageId ?? p().supplierTermsLineageId)
                          }
                        >
                          <dt class="text-slate-500">{__('Terms')}</dt>
                          <dd class="break-words">
                            {p().termsOneOff
                              ? __('Written for this order')
                              : (termsSetName(p().termsLineageId ?? p().supplierTermsLineageId) ??
                                (null != p().termsIssuedText
                                  ? __('Fixed at numbering')
                                  : __('A set of terms')))}
                            <Show
                              when={
                                !p().termsOneOff &&
                                null === p().termsLineageId &&
                                null !== p().supplierTermsLineageId
                              }
                            >
                              <span class="ml-1 text-xs text-text-muted">
                                {__('(from the supplier)')}
                              </span>
                            </Show>
                            <Show when={ctx.capabilities.managePurchaseOrders && !p().termsOneOff}>
                              <button
                                type="button"
                                class="ml-2 text-xs text-primary hover:underline"
                                data-testid="po-terms-view"
                                onClick={() => setTermsModal(viewTermsTarget())}
                              >
                                {termsOpen()
                                  ? __('View or edit purchase terms')
                                  : __('View purchase terms')}
                              </button>
                            </Show>
                          </dd>
                        </Show>
                      </dl>
                    }
                  >
                    <div class="grid grid-cols-2 gap-3 text-sm">
                      <label class="block text-sm text-slate-700">
                        {__('Delivery term (Incoterm)')}
                        <select
                          class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={incotermDraft()}
                          onChange={(e) => setIncotermDraft(e.currentTarget.value)}
                        >
                          <option value="">{__('None')}</option>
                          <For each={INCOTERMS}>
                            {(t) => <option value={t.code}>{incotermLabel(t.code)}</option>}
                          </For>
                        </select>
                      </label>
                      <label class="block text-sm text-slate-700">
                        {__('Named place')}
                        <input
                          class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          placeholder={__('e.g. Rotterdam')}
                          value={placeDraft()}
                          onInput={(e) => setPlaceDraft(e.currentTarget.value)}
                        />
                      </label>
                    </div>
                    <Show when={termsWarning()}>
                      {(warning) => <p class="mt-2 text-xs text-amber-700">{warning()}</p>}
                    </Show>
                    <label class="mt-3 block text-sm text-slate-700">
                      {__('Shipping method')}
                      <input
                        class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder={__('e.g. DHL Express, own truck')}
                        value={shippingDraft()}
                        onInput={(e) => setShippingDraft(e.currentTarget.value)}
                      />
                    </label>
                    <Show
                      when={null === p().number}
                      fallback={
                        <p class="mt-3 text-xs text-text-muted">
                          {__('The purchase terms were fixed when this order was numbered.')}
                        </p>
                      }
                    >
                      <label class="mt-3 block text-sm text-slate-700">
                        {__('Purchase terms')}
                        <select
                          class="mt-1 w-full rounded border border-slate-300 bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={termsChoice()}
                          onChange={(e) => setTermsChoice(e.currentTarget.value)}
                        >
                          {/* `selected` per option, not only the select's value: a set made in the dialog
                              is chosen before the refreshed list brings its option, and a select does
                              not re-select when a matching option arrives later. */}
                          <option value={TERMS_INHERIT} selected={TERMS_INHERIT === termsChoice()}>
                            {inheritLabel()}
                          </option>
                          <For each={termsSets.data?.sets ?? []}>
                            {(s) => (
                              <option
                                value={`${TERMS_SET}${s.id}`}
                                selected={`${TERMS_SET}${s.id}` === termsChoice()}
                              >
                                {s.name}
                              </option>
                            )}
                          </For>
                          <option value={TERMS_ONE_OFF} selected={TERMS_ONE_OFF === termsChoice()}>
                            {__('Written for this order…')}
                          </option>
                        </select>
                      </label>
                      {/* With no set to show — none chosen, no supplier's, no store default — the
                          dialog opens on the list. Terms written for this order have their own box. */}
                      <Show when={TERMS_ONE_OFF !== termsChoice()}>
                        <button
                          type="button"
                          class="mt-1 text-xs text-primary hover:underline"
                          data-testid="po-terms-open"
                          onClick={() =>
                            setTermsModal({
                              kind: 'set',
                              id: pickedSetId(),
                              useHere: chooseForOrder,
                              place: termsPlace(pickedSetId(), pickedVia()),
                            })
                          }
                        >
                          {null === pickedSetId()
                            ? __('Choose or write purchase terms')
                            : __('View or edit purchase terms')}
                        </button>
                      </Show>
                      <Show when={TERMS_ONE_OFF === termsChoice()}>
                        <div class="mt-2 flex items-start gap-2 rounded border border-slate-200 bg-surface px-3 py-2 text-sm">
                          <span class="line-clamp-3 min-w-0 flex-1 whitespace-pre-line text-slate-700">
                            {'' === oneOffDraft().trim() ? (
                              <span class="text-text-muted">{__('Nothing written yet.')}</span>
                            ) : (
                              oneOffDraft()
                            )}
                          </span>
                          <button
                            type="button"
                            class="shrink-0 text-xs text-primary hover:underline"
                            onClick={() =>
                              setTermsModal({
                                kind: 'one-off',
                                value: oneOffDraft(),
                                onSave: saveOneOff,
                              })
                            }
                          >
                            {'' === oneOffDraft().trim() ? __('Write them…') : __('Edit…')}
                          </button>
                        </div>
                      </Show>
                    </Show>
                    <div class="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        class="rounded bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                        disabled={updateTerms.isPending}
                        onClick={() => updateTerms.mutate()}
                      >
                        {updateTerms.isPending ? __('Saving…') : __('Save')}
                      </button>
                      <button
                        type="button"
                        class="rounded px-2 py-1 text-sm text-slate-500 hover:text-slate-800"
                        onClick={() => setEditingTerms(false)}
                      >
                        {__('Cancel')}
                      </button>
                    </div>
                  </Show>
                </section>
              </div>
            </div>

            {/* A delivery is arriving, or the rest of one is. Counting it happens on the
                receiving surface — this page hands over rather than embedding the grid, because
                the person who counts a pallet is routinely not the person who ordered it and does
                not have this page at all. What they need is the link; what a buyer needs is to see
                where it went. */}
            <Show when={isReceiving() || isPartiallyReceived()}>
              <div class="mb-3 flex flex-wrap items-center gap-3 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
                <span class="text-teal-800">
                  <Show
                    when={isReceiving()}
                    fallback={sprintf(
                      _n(
                        'Partially received — %d unit still outstanding.',
                        'Partially received — %d units still outstanding.',
                        outstandingUnits(),
                      ),
                      outstandingUnits(),
                    )}
                  >
                    <Show
                      when={countersOnIt() > 0}
                      fallback={__('A delivery is being received against this order.')}
                    >
                      {sprintf(
                        _n(
                          '%d person is counting a delivery against this order right now.',
                          '%d people are counting a delivery against this order right now.',
                          countersOnIt(),
                        ),
                        countersOnIt(),
                      )}
                    </Show>
                  </Show>
                </span>
                <div class="flex-1" />
                {/* The rest may never come. Shown disabled rather than hidden without the authority,
                    as in the count: the buyer should know finishing short is a thing someone can do. */}
                <Show when={isPartiallyReceived() && !receivingOpen()}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!ctx.capabilities.closeShort || closeShort.isPending}
                    title={
                      ctx.capabilities.closeShort
                        ? __('Cancel what is still outstanding and finish the order')
                        : __(
                            'Finishing an order on less than was ordered needs permission you do not have.',
                          )
                    }
                    onClick={() => setClosingShort(true)}
                  >
                    {__('Close short')}
                  </Button>
                </Show>
                <a
                  href={receivingHref()}
                  class="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
                >
                  {receivingOpen() ? __('Join the count') : __('Start counting')}
                </a>
              </div>
            </Show>

            <Show when={closingShort()}>
              <ConfirmModal
                title={__('Finish on what arrived?')}
                message={
                  <div>
                    <p class="mb-3 text-sm">
                      {__(
                        'The units still outstanding will be cancelled and the order finished. Say why, so the record shows it.',
                      )}
                    </p>
                    <label class="block text-sm">
                      <span class="mb-1 block font-medium">{__('Reason')}</span>
                      <Select
                        class="w-full"
                        value={shortReason()}
                        onChange={(e) => setShortReason(e.currentTarget.value)}
                      >
                        <For each={SHORT_REASONS()}>
                          {(reason) => <option value={reason.value}>{reason.label}</option>}
                        </For>
                      </Select>
                    </label>
                    <label class="mt-3 block text-sm">
                      <span class="mb-1 block font-medium">{__('Note (optional)')}</span>
                      <Textarea
                        rows="2"
                        class="w-full"
                        value={shortNote()}
                        onInput={(e) => setShortNote(e.currentTarget.value)}
                      />
                    </label>
                  </div>
                }
                confirmLabel={__('Finish the order')}
                variant="warning"
                onConfirm={() => closeShort.mutate()}
                onCancel={() => setClosingShort(false)}
              />
            </Show>

            <Show
              when={isDraft()}
              fallback={
                <Show
                  when={capturing()}
                  fallback={
                    <>
                      {/* One bar over the table rather than a row per control: each of these was
                          conditional, so separately they left the table sitting under nothing, one
                          gap, or two. Columns is right-most and always present — it is the only one
                          that acts on what the table *shows* rather than on what it holds. */}
                      <div class="mb-2 flex items-center justify-end gap-3">
                        {/* The kind is chosen here rather than inside the capture bar, because it
                            decides which grid opens underneath — Expected for the two that state
                            what is coming, billed quantity + price for the one that states what is
                            charged.

                            Always the menu, never a single button, even when only one kind is
                            available. The moment that happens is the moment the other two are
                            refusing for a reason worth reading — mid-count, or settled — and a
                            button labelled "Record invoice" would answer a question the merchant
                            did not ask while silently dropping the two they did. */}
                        <Show when={canCaptureDocument()}>
                          <DropdownMenu
                            ariaLabel={__('Record supplier document')}
                            triggerClass={CAPTURE_BTN}
                            trigger={
                              <span class="flex items-center gap-1.5">
                                {__('Record supplier document')}
                                <span aria-hidden="true" class="text-slate-400">
                                  ▾
                                </span>
                              </span>
                            }
                            items={docKindOptions().map(({ kind, blocked }) => ({
                              id: kind,
                              label: supplierDocLabel(kind),
                              description: supplierDocHint(kind),
                              disabled: undefined !== blocked,
                              // The refusal goes in the tooltip rather than replacing the hint: the
                              // hint says what the document is, which is what tells the merchant
                              // whether to wait for this one or reach for another.
                              tooltip: blocked,
                              run: () => setCapturing(kind),
                            }))}
                          />
                        </Show>
                        <Show when={anyDelivery()}>
                          <div class="flex items-center gap-1.5 text-xs text-slate-500">
                            <span>{__('Variance vs')}</span>
                            <SegmentedControl
                              ariaLabel={__('Variance baseline')}
                              size="sm"
                              options={[
                                {
                                  value: 'ordered',
                                  label: __('Ordered'),
                                  title: __('Purchasing lens: did we get what we ordered?'),
                                },
                                {
                                  value: 'expected',
                                  label: __('Expected'),
                                  title: __(
                                    'Receiving lens: did we get what the supplier confirmed?',
                                  ),
                                },
                              ]}
                              value={lens()}
                              onChange={(v: 'ordered' | 'expected') => setLens(v)}
                            />
                          </div>
                        </Show>
                        <Button
                          variant="secondary"
                          class="h-8 shrink-0 px-2!"
                          aria-label={__('Columns')}
                          title={__('Columns')}
                          onClick={() => setColumnsOpen(true)}
                        >
                          <ColumnsSettingsIcon class="h-5 w-5" />
                        </Button>
                      </div>
                      {/* The table scrolls inside its own box rather than pushing the page sideways:
                          the optional identifier columns can outgrow any viewport, and a body that
                          scrolls horizontally takes the whole layout with it. `overflow-x-auto`
                          also clips the corners, so the rounding survives without overflow-hidden. */}
                      <div class="overflow-x-auto rounded border border-border bg-surface">
                        {/* `min-w-full`, not `w-full`: the latter pins the table to the box and makes
                            the columns compress instead, so the scroll container it sits in would
                            never have anything to scroll. */}
                        <table class="min-w-full border-collapse text-sm">
                          <thead class="bg-surface-raised">
                            <tr>
                              <Show when={shows('image')}>
                                <th class={`${TH} w-12`} />
                              </Show>
                              <th class={TH_LEFT}>{__('Product')}</th>
                              <Show when={shows('sku')}>
                                <th class={`${TH_LEFT} w-28`}>{__('SKU')}</th>
                              </Show>
                              <Show when={shows('supplier_sku')}>
                                <th
                                  class={`${TH_LEFT} w-32`}
                                  title={__('The supplier’s own code — matches their packing slip')}
                                >
                                  {__('Supplier SKU')}
                                </th>
                              </Show>
                              <Show when={shows('gtin')}>
                                <th
                                  class={`${TH_LEFT} w-36`}
                                  title={__('The barcode on the carton')}
                                >
                                  {__('GTIN')}
                                </th>
                              </Show>
                              <Show when={shows('ordered')}>
                                <th class={`${TH} w-20`}>{__('Ordered')}</th>
                              </Show>
                              <Show when={shows('expected')}>
                                <th
                                  class={`${TH} w-24`}
                                  title={__('Supplier-confirmed (OA/ASN) quantity')}
                                >
                                  {__('Expected')}
                                </th>
                              </Show>
                              <Show when={!preReception()}>
                                <Show when={shows('received')}>
                                  <th class={`${TH} w-20`}>{__('Received')}</th>
                                </Show>
                                <Show when={shows('damaged')}>
                                  <th class={`${TH} w-20`}>{__('Damaged')}</th>
                                </Show>
                                <Show when={shows('open')}>
                                  <th class={`${TH} w-20`}>
                                    {_x('Open', 'quantity remaining to receive')}
                                  </th>
                                </Show>
                              </Show>
                              <Show when={shows('status')}>
                                <th class="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600 w-24">
                                  {__('Status')}
                                </th>
                              </Show>
                              <Show when={shows('unit_cost')}>
                                <th class={`${TH} w-28`}>{__('Unit cost')}</th>
                              </Show>
                              <Show when={shows('line_total')}>
                                <th class={`${TH} w-28`}>{__('Line total')}</th>
                              </Show>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={lines()}>
                              {(l) => (
                                <tr class="hover:bg-slate-50">
                                  <Show when={shows('image')}>
                                    <td class="border-b border-slate-100 px-3 py-1.5">
                                      <Show
                                        when={l.imageUrl}
                                        fallback={<div class="h-9 w-9 rounded bg-slate-100" />}
                                      >
                                        {(u) => (
                                          <img
                                            src={u()}
                                            alt=""
                                            class="h-9 w-9 rounded object-cover"
                                          />
                                        )}
                                      </Show>
                                    </td>
                                  </Show>
                                  <td class="border-b border-slate-100 px-3 py-1.5">
                                    <div
                                      class="font-medium"
                                      classList={{ 'text-text-muted italic': !l.exists }}
                                    >
                                      {l.productLabel}
                                    </div>
                                  </td>
                                  <Show when={shows('sku')}>
                                    <td class={TD_CODE}>{l.sku ?? '—'}</td>
                                  </Show>
                                  <Show when={shows('supplier_sku')}>
                                    <td class={TD_CODE}>{l.supplierSku ?? '—'}</td>
                                  </Show>
                                  <Show when={shows('gtin')}>
                                    <td class={TD_CODE}>{l.gtin ?? '—'}</td>
                                  </Show>
                                  <Show when={shows('ordered')}>
                                    <td class={TD}>{l.qtyRequested}</td>
                                  </Show>
                                  <Show when={shows('expected')}>
                                    <td class={TD}>
                                      <Show
                                        when={null !== l.qtyExpected}
                                        fallback={
                                          <span
                                            class="text-slate-300"
                                            title={__(
                                              'Not yet confirmed — falls back to the ordered quantity',
                                            )}
                                          >
                                            —
                                          </span>
                                        }
                                      >
                                        {l.qtyExpected}
                                      </Show>
                                    </td>
                                  </Show>
                                  <Show when={!preReception()}>
                                    <Show when={shows('received')}>
                                      <td class={TD}>{l.qtyReceived}</td>
                                    </Show>
                                    <Show when={shows('damaged')}>
                                      <td class={TD}>
                                        <Show
                                          when={l.qtyDamagedSoFar > 0}
                                          fallback={<span class="text-slate-300">—</span>}
                                        >
                                          <span class="text-red-600">{l.qtyDamagedSoFar}</span>
                                        </Show>
                                      </td>
                                    </Show>
                                    <Show when={shows('open')}>
                                      <td class={TD}>{l.qtyOpen}</td>
                                    </Show>
                                  </Show>
                                  <Show when={shows('status')}>
                                    <td class="border-b border-slate-100 px-3 py-1.5 text-center">
                                      <Show
                                        when={isDeliveryStage(l)}
                                        fallback={
                                          // Confirmation badge only once an OA/ASN is recorded (expected set); an
                                          // unconfirmed line shows nothing, so a match here is a real "Confirmed".
                                          <Show when={null !== l.qtyExpected}>
                                            <VarianceBadge
                                              kind="confirmation"
                                              status={confirmationStatus(l)}
                                              varianceQty={confirmationVarianceQty(l)}
                                            />
                                          </Show>
                                        }
                                      >
                                        <VarianceBadge
                                          kind="delivery"
                                          status={deliveryStatus(l, lens())}
                                          varianceQty={deliveryVarianceQty(l, lens())}
                                        />
                                      </Show>
                                    </td>
                                  </Show>
                                  <Show when={shows('unit_cost')}>
                                    <td class={TD}>{fmt(l.unitCost)}</td>
                                  </Show>
                                  <Show when={shows('line_total')}>
                                    <td class={TD}>{fmt(l.lineTotal)}</td>
                                  </Show>
                                </tr>
                              )}
                            </For>
                            <Show when={0 === lines().length}>
                              <tr>
                                <td colspan={readColCount()} class="px-3 py-3 text-slate-500">
                                  {__('No lines on this purchase order.')}
                                </td>
                              </tr>
                            </Show>
                          </tbody>
                          {/* The grand total is the sum of the Line total column, so it goes with
                              that column: with it hidden there is no column for the figure to sit
                              under, and a total floating past the last header is worse than none. */}
                          <Show when={lines().length > 0 && shows('line_total')}>
                            <tfoot>
                              <tr>
                                <td
                                  colspan={readColCount() - 1}
                                  class="px-3 py-2 text-right text-sm font-semibold"
                                >
                                  {__('Total')}
                                </td>
                                <td class="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                                  {grandTotal().toFixed(decimals())} {p().currency}
                                </td>
                              </tr>
                            </tfoot>
                          </Show>
                        </table>
                      </div>
                    </>
                  }
                >
                  <Show
                    when={'invoice' === capturing()}
                    fallback={
                      <PoExpectedCaptureGrid
                        poId={Number(props.id)}
                        lines={lines()}
                        docKind={'asn' === capturing() ? 'asn' : 'oa'}
                        onDone={() => setCapturing(null)}
                      />
                    }
                  >
                    <PoInvoiceCapture
                      poId={Number(props.id)}
                      lines={lines()}
                      currency={p().currency}
                      costDecimals={p().costDecimals}
                      onDone={() => setCapturing(null)}
                    />
                  </Show>
                </Show>
              }
            >
              <PoLinesEditor
                poId={props.id}
                supplierId={p().supplierId}
                supplierLabel={p().supplierDisplay ?? p().supplierName ?? ''}
                costDecimals={p().costDecimals}
                lines={lines()}
              />
            </Show>

            <PoTimeline events={events()} loading={eventsQuery.isPending} />
          </>
        )}
      </Show>

      <Show when={columnsOpen()}>
        <ColumnPicker<PoLineColumnId>
          columns={offeredColumns()}
          hidden={hiddenColumns()}
          onToggle={toggleColumn}
          // No `onMove`: the table renders from a template, so a stored order could not be honoured.
          onReset={() => setHiddenColumns([])}
          onClose={() => setColumnsOpen(false)}
        />
      </Show>

      <Show when={confirming() && po()}>
        {(p) => (
          <IssueDraftModal
            lines={lines()}
            moqFor={moqFor}
            casePackFor={casePackFor}
            costDecimals={p().costDecimals}
            currency={p().currency}
            supplierLabel={p().supplierDisplay ?? p().supplierName ?? ''}
            onFixQtys={(patches) => fixQtys.mutate(patches)}
            fixing={fixQtys.isPending}
            issuing={assignNumber.isPending}
            // The modal already surfaces the lines the server would drop, so confirm them up-front
            // when there are any (confirm:true) — no second "these will be removed" round-trip.
            onConfirm={() => assignNumber.mutate(wouldPrune())}
            onCancel={() => setConfirming(false)}
          />
        )}
      </Show>

      <Show when={prunePreview()}>
        {(prune) => (
          <ConfirmModal
            title={__('Some lines will be removed')}
            message={
              <div>
                <p class="mb-2">
                  {sprintf(
                    _n(
                      '%d line has no quantity or price and will be removed from the order:',
                      '%d lines have no quantity or price and will be removed from the order:',
                      prune().length,
                    ),
                    prune().length,
                  )}
                </p>
                <ul class="list-disc space-y-0.5 pl-5">
                  <For each={prune()}>
                    {(p) => {
                      const line = lines().find((l) => l.id === p.lineId);
                      return (
                        <li>
                          {line?.productLabel ?? `#${p.lineId}`}{' '}
                          <span class="text-text-muted">
                            — {'zero_qty' === p.reason ? __('no quantity') : __('no price')}
                          </span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            }
            confirmLabel={
              'mark-sent' === pruneGate() ? __('Remove & mark as sent') : __('Remove & download')
            }
            variant="warning"
            onConfirm={() =>
              'mark-sent' === pruneGate() ? markSent.mutate(true) : assignNumber.mutate(true)
            }
            onCancel={() => setPrunePreview(null)}
          />
        )}
      </Show>

      <Show when={cancelling()}>
        <ConfirmModal
          title={__('Cancel this purchase order?')}
          message={__(
            'It will be marked cancelled and no further goods received. Stock already received is unaffected; outstanding quantities will not be received.',
          )}
          confirmLabel={__('Cancel PO')}
          cancelLabel={__('Keep')}
          variant="danger"
          onConfirm={() => transition.mutate(STAGE_CANCELLED)}
          onCancel={() => setCancelling(false)}
        />
      </Show>

      <Show when={archiving()}>
        <ConfirmModal
          title={__('Archive this purchase order?')}
          message={__(
            'It moves out of your active purchase-order lists. You can still reach it by direct link.',
          )}
          confirmLabel={__('Archive')}
          cancelLabel={__('Keep')}
          onConfirm={() => setArchived.mutate(true)}
          onCancel={() => setArchiving(false)}
        />
      </Show>
    </section>
  );
}

/**
 * Renders an event description, substituting the target-status pill for the `%s` placeholder on a
 * lifecycle-transition event. Translation-safe: the server-translated template keeps `%s`, so we split
 * on it and drop the substitution in — which is why the number/date is never baked into the sentence
 * server-side. Events with nothing to substitute render as plain text.
 */
function EventDescription(props: {
  description: string;
  stage: string | null;
  date?: string | null;
  emphasis?: string | null;
}): JSX.Element {
  const parts = (): string[] => props.description.split('%s');
  return (
    <Show
      when={props.stage}
      fallback={
        // A verbatim literal (an assigned document number) takes `%s` as-is; a date-bearing event
        // (a revised ETA) formats it first; anything else has no placeholder and renders plain.
        <Show
          when={props.emphasis}
          fallback={
            <Show when={props.date} fallback={<>{props.description}</>}>
              {(date) => (
                <>
                  {parts()[0]}
                  <span class="font-medium text-slate-700">{formatDateOnly(date())}</span>
                  {parts()[1] ?? ''}
                </>
              )}
            </Show>
          }
        >
          {(literal) => (
            <>
              {parts()[0]}
              <span class="font-semibold text-slate-700">{literal()}</span>
              {parts()[1] ?? ''}
            </>
          )}
        </Show>
      }
    >
      {(stage) => (
        <>
          {parts()[0]}
          <span class="mx-0.5 inline-block align-middle">
            <StatusPill status={stage()} />
          </span>
          {parts()[1] ?? ''}
        </>
      )}
    </Show>
  );
}

/**
 * The PO activity timeline — who did what, when (server-rendered descriptions + resolved actor names).
 * A read-only vertical list; the Essentials basic surface. Pro will add documents, export, and cross-PO audit.
 */
function PoTimeline(props: { events: PoTimelineEvent[]; loading: boolean }): JSX.Element {
  const fmt = (iso: string | null): string => {
    if (null === iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : formatDateTime(d);
  };
  return (
    <section class="mt-6">
      <h3 class="mb-2 text-sm font-semibold text-slate-600">{__('Activity')}</h3>
      <Show
        when={!props.loading}
        fallback={<p class="text-sm text-text-muted">{__('Loading activity…')}</p>}
      >
        <Show
          when={props.events.length > 0}
          fallback={<p class="text-sm text-text-muted">{__('No activity yet.')}</p>}
        >
          <ol class="relative ml-2 border-l border-slate-200">
            <For each={props.events}>
              {(e) => (
                <li class="mb-3 ml-4">
                  <div class="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                  <div class="text-sm text-slate-700">
                    <span class="font-medium text-slate-800">{e.actorName}</span>{' '}
                    <EventDescription
                      description={e.description}
                      stage={e.stage}
                      date={e.date}
                      emphasis={e.emphasis}
                    />
                  </div>
                  <div class="text-xs text-text-muted">{fmt(e.at)}</div>
                  <Show when={e.note}>
                    <div class="mt-0.5 text-xs italic text-slate-500">“{e.note}”</div>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
    </section>
  );
}
