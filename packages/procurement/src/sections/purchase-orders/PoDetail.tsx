import { __, _n, _x, sprintf } from '@invflux/i18n';
import {
  ConfirmModal,
  SegmentedControl,
  SplitActionButton,
  toast,
  useHostNav,
  PencilIcon,
} from '@invflux/ui';
import { type PoDetailActionContext, registerPoDetailActions } from './poDetailActions';
import { A, useLocation, useNavigate } from '@solidjs/router';

import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { VarianceBadge } from '../../components/VarianceBadge';
import { useProcurement } from '../../context';
import { persistedSignal } from '../../grid/persistedSignal';
import { createApi } from '../../lib/api';
import { fmtDateOnly } from '../../lib/dates';
import { qk, STOCK_MOVED } from '@invflux/ui/api';
import { mintReceiptKey } from '../../receiptKey';
import { confirmationStatus, confirmationVarianceQty, deliveryStatus, deliveryVarianceQty, type VarianceLens } from '../../lib/variance';
import { INCOTERMS, incotermLabel, isMaritimeOnly } from './incoterms';
import { PoExpectedCaptureGrid } from './PoExpectedCaptureGrid';
import { PoLinesEditor } from './PoLinesEditor';
import { PoReceiveForm, type ReceiveRow } from './PoReceiveForm';
import { pruneReason, submittableLines } from './submissionRules';
import { IssueDraftModal } from './IssueDraftModal';
import type { SupplierProductsResponse } from '../suppliers/types';
import type { PoEventsResponse, PoLine, PoTimelineEvent, PurchaseOrderDetail, ReceivingParticipant } from './types';

/** A draft line the server would drop at submission (no quantity, or no price even after inheriting). */
interface PrunePreview {
  lineId: number;
  reason: string; // 'zero_qty' | 'no_price'
}

/** Cadence for the presence heartbeat + the multi-worker background poll (ms). */
const HEARTBEAT_MS = 30_000;
const POLL_MS = 8_000;

const TH = 'border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600';
const TD = 'border-b border-slate-100 px-3 py-1.5 text-right tabular-nums';
const fmtDate = (iso: string | null): string => (null === iso ? '—' : new Date(iso).toLocaleDateString());

// Transition targets are the server's **stage slugs** — the same vocabulary the PO's `stage` field
// carries — posted to the generic /transition endpoint, which resolves the slug and validates the edge
// server-side against PurchaseOrderLifecycle. Posting slugs (not backing ints) keeps the client from
// drifting when the PoStatus enum is renumbered.
const STAGE_IN_TRANSIT = 'in_transit';
const STAGE_IN_RECEPTION = 'in_reception';
const STAGE_RECEIVED = 'received';
const STAGE_CANCELLED = 'cancelled';
const STAGE_ARCHIVED = 'archived';
const STAGE_PARTIALLY_RECEIVED = 'partially_received';

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
  const [closing, setClosing] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const [archiving, setArchiving] = createSignal(false);
  // Close-short reason (a closed enum mirroring CloseShortReceipt::REASONS) + optional free-text note.
  const [shortReason, setShortReason] = createSignal('supplier_oos');
  const [shortNote, setShortNote] = createSignal('');
  // Whether the close prompt is a short-close (remainder outstanding) vs a clean full close. Set from the
  // receipt response / the line state when the prompt opens, so it never reads stale query data.
  const [shortClose, setShortClose] = createSignal(false);
  // A staged short receipt awaiting confirmation: set when the receive form asks to close short, so the
  // reason modal opens BEFORE anything is committed. Null = the receipt is already committed (the modal
  // only needs to write off the remainder, or it's a clean full close).
  const [pendingReceipt, setPendingReceipt] = createSignal<{ rows: ReceiveRow[]; note: string; fxRate: string | null } | null>(null);
  // Held across retries of one confirm, cleared once it lands. A timeout the operator answers by
  // clicking again reuses the token and replays server-side; a fresh receipt mints a new one and is
  // recorded as the separate delivery it is. See receiptKey.ts for why it is not payload-derived.
  const [receiptKey, setReceiptKey] = createSignal<string | null>(null);
  const currentReceiptKey = (): string => {
    const held = receiptKey();
    if (null !== held) return held;
    const minted = mintReceiptKey();
    setReceiptKey(minted);
    return minted;
  };

  // A real nonce'd link (not window.open) → never popup-blocked. Opens an auto-printing HTML page
  // in a new tab for browser "Save as PDF". rest_route apiRoot already has `?`, so append with `&`.
  const printHref = (): string => {
    const base = `${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1/procurement/purchase-orders/${props.id}/print`;
    return `${base}${base.includes('?') ? '&' : '?'}_wpnonce=${encodeURIComponent(ctx.nonce)}`;
  };

  // Presence of other workers (kept fresh by the heartbeat response) drives background polling: when
  // more than one worker is in the session, refetch so each sees the others' staged counts.
  const [presence, setPresence] = createSignal<ReceivingParticipant[]>([]);

  const query = createQuery(() => ({
    queryKey: ['procurement', 'purchase-orders', props.id],
    queryFn: () => api.get<PurchaseOrderDetail>(`/procurement/purchase-orders/${props.id}`),
    // Poll while more than one worker is present (live heartbeat presence — declared above this
    // query so it's safe to reference here).
    refetchInterval: () => (presence().length > 1 ? POLL_MS : false),
  }));

  // Activity timeline (who did what when). Separate query so it refreshes on its own key; invalidated
  // alongside the PO on any mutation. Read-only — needs stock-view.
  const eventsQuery = createQuery(() => ({
    queryKey: ['procurement', 'purchase-orders', props.id, 'events'],
    queryFn: () => api.get<PoEventsResponse>(`/procurement/purchase-orders/${props.id}/events`),
  }));
  const events = (): PoTimelineEvent[] => eventsQuery.data?.events ?? [];

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
      toast.error(e instanceof Error ? e.message : __('Could not assign a number to the purchase order.'));
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
      toast.error(e instanceof Error ? e.message : __('Could not mark the purchase order as sent.'));
    },
  }));

  // Download the print-ready xlsx (any status) — the merchant sends it to the supplier themselves.
  const exportXlsx = createMutation(() => ({
    mutationFn: () => api.download(`/procurement/purchase-orders/${props.id}/export`, `${po()?.number ?? 'purchase-order'}.xlsx`),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not export the purchase order.')),
  }));

  // Clone this PO into a fresh editable draft (recurring orders / "use as model") → open it.
  const copyToDraft = createMutation(() => ({
    mutationFn: () => api.post<{ purchaseOrder: { id: number } }>(`/procurement/purchase-orders/${props.id}/copy`, {}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      toast.success(__('Copied to a new draft.'));
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not copy the purchase order.')),
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
    mutationFn: (to: string) => api.post(`/procurement/purchase-orders/${props.id}/transition`, { to }),
    onSuccess: (_d, to) => {
      invalidate();
      setClosing(false);
      setCancelling(false);
      setArchiving(false);
      if (STAGE_RECEIVED === to) toast.success(__('Purchase order received.'));
      else if (STAGE_IN_RECEPTION === to) toast.success(__('Receiving session opened.'));
      else if (STAGE_CANCELLED === to) {
        toast.success(__('Purchase order cancelled.'));
        navigate(-1); // cancelled = done with it; return to wherever we came from
      }
      else if (STAGE_ARCHIVED === to) {
        toast.success(__('Purchase order archived.'));
        navigate(`/purchase-orders${location.search}`); // archived POs drop out of the active lists
      }
    },
    onError: (e: unknown) => {
      setClosing(false);
      setCancelling(false);
      setArchiving(false);
      toast.error(e instanceof Error ? e.message : __('That status change is not allowed.'));
    },
  }));

  // Close an under-delivery short: write off the outstanding qty (recorded as a short) and finalize to
  // received. Distinct from the blunt transition — the remainder is captured, not silently dropped.
  const closeShort = createMutation(() => ({
    mutationFn: () =>
      api.post(`/procurement/purchase-orders/${props.id}/close-short`, { reason: shortReason(), note: shortNote().trim() || null }),
    onSuccess: () => {
      invalidate();
      setClosing(false);
      setShortNote('');
      toast.success(__('Purchase order closed short.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not close the purchase order short.')),
  }));

  // Short-receipt finalize: commit the staged receipt, THEN write off the remainder — both only after
  // the reason modal is confirmed, so the form (grid) stays put and nothing is irreversible until then.
  const confirmAndCloseShort = createMutation(() => ({
    mutationFn: async (p: { rows: ReceiveRow[]; note: string; fxRate: string | null }) => {
      return api.post(`/procurement/purchase-orders/${props.id}/receive`, {
        lines: p.rows,
        note: p.note,
        fxRate: p.fxRate,
        remainder: 'close_short',
        reason: shortReason(),
        idempotencyKey: currentReceiptKey(),
      });
    },
    onSuccess: () => {
      invalidate();
      setClosing(false);
      setPendingReceipt(null);
      setShortNote('');
      setReceiptKey(null); // landed — the next receipt is a new intent
      toast.success(__('Receipt logged and purchase order closed short.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not close the purchase order short. Nothing was received — try again.')),
  }));

  // Keep the PO open for the next delivery: commit the staged receipt, then park in partially_received.
  // Base behaviour — receiving one delivery of a split shipment and awaiting the rest is recording what
  // physically arrived (correctness), not a paid workflow. The PO stays open; the merchant reopens for
  // the next delivery or finalizes / closes short from the partially_received banner.
  const keepOpen = createMutation(() => ({
    mutationFn: async (p: { rows: ReceiveRow[]; note: string; fxRate: string | null }) => {
      return api.post(`/procurement/purchase-orders/${props.id}/receive`, {
        lines: p.rows, note: p.note, fxRate: p.fxRate, remainder: 'settle', idempotencyKey: currentReceiptKey(),
      });
    },
    onSuccess: () => {
      invalidate();
      setReceiptKey(null);
      toast.success(__('Delivery received — the purchase order stays open for the rest.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not log the receipt.')),
  }));

  // Re-open a partially-received PO for the next delivery (→ in_reception; the form then shows).
  const reopen = createMutation(() => ({
    mutationFn: () => api.post(`/procurement/purchase-orders/${props.id}/transition`, { to: STAGE_IN_RECEPTION }),
    onSuccess: () => {
      invalidate();
      toast.success(__('Ready for the next delivery.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not re-open the purchase order.')),
  }));

  // Cancel an empty reception: nothing was received, so there's no receipt to log — no goods moved. The
  // transition endpoint drops the staged WIP on leaving reception; we step back to the resting pre-receive
  // state — partially_received when earlier deliveries are already in (Pro reopen), else in_transit.
  const cancelReception = createMutation(() => ({
    mutationFn: () =>
      api.post(`/procurement/purchase-orders/${props.id}/transition`, { to: hasReceipts() ? STAGE_PARTIALLY_RECEIVED : STAGE_IN_TRANSIT }),
    onSuccess: () => {
      invalidate();
      toast.success(__('Reception cancelled — nothing was received.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not cancel the reception.')),
  }));

  // Autosave the staged receiving-session WIP (debounced by the form) so a reload doesn't lose it.
  // Fire-and-forget: a transient save failure just means the next keystroke retries.
  const persistSession = createMutation(() => ({
    mutationFn: (p: { rows: ReceiveRow[]; note: string }) =>
      api.put(`/procurement/purchase-orders/${props.id}/receiving-session`, { lines: p.rows, note: p.note }),
  }));

  // Full receipt: commit the staged session → stock + WAC, then mark the PO received — in one action.
  // At Essentials a PO takes one receipt and a full count leaves nothing further to decide, so there's no
  // separate "close the PO?" step (the form's "Confirm receipt" IS the finalize). The short path is the
  // only one that still opens a modal, because it's collecting the close-short reason.
  const confirmReceipt = createMutation(() => ({
    mutationFn: async (p: { rows: ReceiveRow[]; note: string; fxRate: string | null }) => {
      return api.post(`/procurement/purchase-orders/${props.id}/receive`, {
        lines: p.rows, note: p.note, fxRate: p.fxRate, remainder: 'settle', idempotencyKey: currentReceiptKey(),
      });
    },
    onSuccess: () => {
      invalidate();
      setReceiptKey(null);
      toast.success(__('Purchase order received.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not log the receipt.')),
  }));

  const po = () => query.data?.purchaseOrder;
  const lines = (): PoLine[] => query.data?.lines ?? [];
  const decimals = (): number => po()?.costDecimals ?? 2;
  const fmt = (v: string | null): string => (null === v ? '—' : Number(v).toFixed(decimals()));
  const grandTotal = createMemo(() => lines().reduce((sum, l) => sum + (null === l.lineTotal ? 0 : Number(l.lineTotal)), 0));
  // Received / Open only make sense once the PO is past draft; a draft shows Qty + cost only.
  const isDraft = (): boolean => 'in_prep' === po()?.stage;

  // Supplier catalogue — only needed by the submit modal (MOQ / case-pack checks + [Fix all quantities]);
  // fetched once the PO is a draft. Same queryKey as PoLinesEditor's, so TanStack de-dupes the request.
  const catalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', po()?.supplierId ?? 0, 'products'],
    queryFn: () => api.get<SupplierProductsResponse>(`/procurement/suppliers/${po()?.supplierId}/products`),
    enabled: isDraft() && undefined !== po()?.supplierId,
  }));
  const moqFor = (subjectId: number): number | null => catalogue.data?.products.find((p) => p.subjectId === subjectId)?.moq ?? null;
  const casePackFor = (subjectId: number): number | null => catalogue.data?.products.find((p) => p.subjectId === subjectId)?.casePack ?? null;

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
      Promise.all(patches.map((p) => api.patch(`/procurement/purchase-orders/${props.id}/lines/${p.id}`, { requested_qty: p.qty }))),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not update the quantities.')),
  }));

  // Delivery-variance lens (Ordered = purchasing/admin, Expected = dock/ops), shared with the receive
  // grid via the same persisted key so the chosen baseline follows the operator across both surfaces.
  const [lens, setLens] = persistedSignal<VarianceLens>('invflux:po-receive:variance-baseline', 'ordered');

  // The reception columns (Received / Damaged / Open + the delivery Status) are structurally empty and
  // meaningless before any goods receipt, so the read table hides them at the pre-GR stages and shows
  // Ordered + Expected + a confirmation Status instead. Expected itself is display-only here — its
  // entry lives in the dedicated OA/ASN/Invoice document-capture workflow, never inline.
  const preReception = (): boolean => ['submitted', 'in_transit'].includes(po()?.stage ?? '');
  // Column count for the empty-state / total colspans (image, product, ordered, expected, status,
  // unit cost, line total = 7; + received, damaged, open when post-GR).
  const readColCount = (): number => (preReception() ? 7 : 10);

  // Which variance a line surfaces: pre-reception → confirmation (ordered vs supplier-confirmed); once
  // anything is received or the line is finalized → delivery (received vs the chosen lens).
  const isDeliveryStage = (l: PoLine): boolean => l.qtyReceived > 0 || 0 === l.qtyOpen;
  // Show the lens toggle only when delivery badges are actually on screen (lens is moot pre-reception).
  const anyDelivery = (): boolean => !preReception() && lines().some(isDeliveryStage);

  // Supplier-document (OA/ASN) capture: enter supplier-confirmed expected quantities on the shared
  // DataGrid. Offered on live PO stages where a supplier confirmation is meaningful (submitted / in
  // transit, and between deliveries when partially received) — not on a draft or a terminal PO.
  const [capturing, setCapturing] = createSignal(false);
  const canCaptureDocument = (): boolean => ['submitted', 'in_transit', 'partially_received'].includes(po()?.stage ?? '');
  // (Cancel/Archive availability now lives on the po.detail actions' isAvailable — see poDetailActions.ts.)
  // Has any goods receipt been committed yet (Essentials = one session per PO; another is Pro)?
  const hasReceipts = (): boolean => lines().some((l) => l.qtyReceived > 0);
  // The open-session form shows while in reception and nothing has been committed yet.
  // The session form shows whenever a reception is open. (Essentials finalizes straight to received, so it only
  // shows before the first receipt; Pro re-opens for the next delivery, so it shows again with prior
  // receipts committed — the form counts the new delivery against the remaining qty_open.)
  const isReceiving = (): boolean => 'in_reception' === po()?.stage;
  const isPartiallyReceived = (): boolean => 'partially_received' === po()?.stage;
  const outstandingUnits = (): number => lines().reduce((sum, l) => sum + l.qtyOpen, 0);
  // Live heartbeat presence wins; fall back to the PO payload before the first heartbeat lands.
  const participants = (): ReceivingParticipant[] => {
    const live = presence();
    return live.length > 0 ? live : (po()?.receivingParticipants ?? []);
  };
  const multiParticipant = (): boolean => participants().length > 1;

  // Deep-link to the central workbench filtered to this PO's products (parents pull their variations via
  // bring_children). Dash-joined post ids — the param shape the workbench's PostIdsFilter reads. The
  // supplier filter (supplier[]=<id>) is carried too, so the supplier-specific per-product columns
  // (supplier SKU / cost) can be made visible there.
  const workbenchHref = (): string | null => {
    const ids = [...new Set(lines().map((l) => l.postId).filter((id): id is number => null !== id))];
    if (0 === ids.length) {
      return null;
    }
    const supplierId = po()?.supplierId;
    const supplierParam = supplierId ? `&supplier[]=${supplierId}` : '';
    return hostNav.routeHref('/workbench', `post_ids=${ids.join('-')}${supplierParam}&bring_children=1`);
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
    beginArchive: () => setArchiving(true),
  });

  // Inline ETA editing. The expected date is set at creation but supplier dates move, so it stays
  // revisable until the PO is terminal; each change records a po.eta_changed audit event server-side
  // (visible in the timeline). The date input speaks `yyyy-mm-dd`.
  const [editingEta, setEditingEta] = createSignal(false);
  const [etaDraft, setEtaDraft] = createSignal('');
  const canEditHeader = (): boolean => !['received', 'cancelled', 'archived'].includes(po()?.stage ?? '');
  const beginEditEta = (): void => {
    // expectedAt is already a `YYYY-MM-DD` calendar date — feed it straight to the date input.
    setEtaDraft(po()?.expectedAt ?? '');
    setEditingEta(true);
  };
  const updateEta = createMutation(() => ({
    mutationFn: (expectedAt: string | null) =>
      api.patch<{ purchaseOrder: PurchaseOrderDetail }>(`/procurement/purchase-orders/${props.id}`, { expected_at: expectedAt }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id] });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] }); // list ETA column
      setEditingEta(false);
      toast.success(__('Expected date updated.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not update the expected date.')),
  }));

  // Per-order commercial terms: the delivery term (Incoterm + its named place), how the goods
  // travel, and a terms override. Editable on the same window as the ETA — until the PO is terminal
  // — and saved through the same header PATCH, which records which fields moved.
  const [editingTerms, setEditingTerms] = createSignal(false);
  // Whether the block states anything at all. Terms count only at the two overriding rungs: the
  // store-wide default applies to every order, so inheriting it is not something this order says.
  const hasTerms = (): boolean =>
    null !== (po()?.incoterm ?? null) || null !== (po()?.shippingMethod ?? null) || null !== (po()?.termsConditions ?? po()?.supplierTerms ?? null);
  const [incotermDraft, setIncotermDraft] = createSignal('');
  const [placeDraft, setPlaceDraft] = createSignal('');
  const [shippingDraft, setShippingDraft] = createSignal('');
  const [termsDraft, setTermsDraft] = createSignal('');
  const beginEditTerms = (): void => {
    const p = po();
    setIncotermDraft(p?.incoterm ?? '');
    setPlaceDraft(p?.incotermPlace ?? '');
    setShippingDraft(p?.shippingMethod ?? '');
    setTermsDraft(p?.termsConditions ?? '');
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
      api.patch<{ purchaseOrder: PurchaseOrderDetail }>(`/procurement/purchase-orders/${props.id}`, {
        incoterm: incotermDraft() || null,
        incoterm_place: placeDraft().trim() || null,
        shipping_method: shippingDraft().trim() || null,
        terms_conditions: termsDraft().trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id] });
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders', props.id, 'events'] });
      setEditingTerms(false);
      toast.success(__('Delivery & terms updated.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : __('Could not update the delivery terms.')),
  }));

  // While the receive form is open, beat presence on a timer (and immediately on open) so other
  // workers detect us within a TTL; the response keeps our own participant view fresh.
  createEffect(() => {
    if (!isReceiving()) {
      setPresence([]);
      return;
    }
    const beat = (): void => {
      void api
        .post<{ participants: ReceivingParticipant[] }>(`/procurement/purchase-orders/${props.id}/receiving-session/heartbeat`, {})
        .then((r) => setPresence(r.participants))
        .catch(() => {
          /* transient — the next beat retries */
        });
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <section>
      <Show when={query.isPending}>
        <p class="mt-4 text-slate-500">{__('Loading…')}</p>
      </Show>
      <Show when={query.isError}>
        <p class="mt-4 text-red-700">{__('Failed to load the purchase order.')}</p>
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
                <Show when={p().number} fallback={<span class="font-normal text-text-muted">#{p().id}</span>}>
                  {(number) => <span>{number()}</span>}
                </Show>

                <StatusPill status={p().stage} />

                <span class="font-normal text-text-muted">{_x('to', 'purchase order … to {supplier}')}</span>
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
                <SplitActionButton scope="po.detail" ctx={poActionCtx()} overflowLabel={__('More actions')} />
              </div>
            </header>

            <dl class="mb-6 grid max-w-2xl grid-cols-[7rem_1fr_7rem_1fr] gap-y-1 text-sm">
              <dt class="text-slate-500">{__('Currency')}</dt>
              <dd>{p().currency}{p().currency !== p().baseCurrency ? ` → ${p().baseCurrency}` : ''}</dd>
              <dt class="text-slate-500">{__('Expected (ETA)')}</dt>
              <dd>
                <Show
                  when={editingEta()}
                  fallback={
                    <Show when={canEditHeader()} fallback={<>{fmtDateOnly(p().expectedAt)}</>}>
                      <button
                        type="button"
                        class="group inline-flex items-center gap-1 rounded px-1 -mx-1 text-left hover:bg-slate-100"
                        title={__('Change the expected date')}
                        onClick={beginEditEta}
                      >
                        <span>{fmtDateOnly(p().expectedAt)}</span>
                        <PencilIcon class="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
                      </button>
                    </Show>
                  }
                >
                  <span class="inline-flex items-center gap-1">
                    <input
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
                    <button type="button" class="rounded px-1 text-xs text-slate-500 hover:text-slate-800" onClick={() => setEditingEta(false)}>
                      {__('Cancel')}
                    </button>
                  </span>
                </Show>
              </dd>
              <dt class="text-slate-500">{__('Created')}</dt>
              <dd>{fmtDate(p().createdAt)}</dd>
            </dl>

            {/* Delivery & terms — what the purchase order states beyond the goods themselves. Kept
                out of the header grid because it is document content the merchant edits as a set,
                not per-field facts like the ETA. */}
            <section class="mb-6 max-w-2xl">
              <h2 class="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {__('Delivery & terms')}
                <Show when={!editingTerms() && !hasTerms()}>
                  <span class="font-normal normal-case tracking-normal text-text-muted">{__('(none)')}</span>
                </Show>
                <Show when={canEditHeader() && !editingTerms()}>
                  <button
                    type="button"
                    class="text-slate-300 hover:text-slate-500"
                    title={__('Edit the delivery terms for this order')}
                    onClick={beginEditTerms}
                  >
                    <PencilIcon class="h-3.5 w-3.5" />
                  </button>
                </Show>
              </h2>

              <Show
                when={editingTerms()}
                fallback={
                  <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
                    {/* Read mode is dense: a row appears only when it has something to say. Most
                        orders state none of this, and three em-dashes cost a block of the page to
                        report nothing. The "(none)" beside the heading carries that instead. */}
                    <Show when={p().incoterm}>
                      {(code) => (
                        <>
                          <dt class="text-slate-500">{__('Delivery term')}</dt>
                          <dd>
                            {incotermLabel(code())}
                            <Show when={p().incotermPlace}>{(place) => <span class="text-slate-500">{` · ${place()}`}</span>}</Show>
                          </dd>
                        </>
                      )}
                    </Show>
                    <Show when={p().shippingMethod}>
                      {(method) => (
                        <>
                          <dt class="text-slate-500">{__('Shipping')}</dt>
                          <dd>{method()}</dd>
                        </>
                      )}
                    </Show>
                    {/* Only the two overriding rungs of `PO ?? supplier ?? store` earn a row — the
                        store-wide default is the baseline every order inherits, so stating it here
                        would put a line on every purchase order to say "nothing special". The
                        marker distinguishes the supplier's standing terms from this order's. */}
                    <Show when={p().termsConditions ?? p().supplierTerms}>
                      {(text) => (
                        <>
                          <dt class="text-slate-500">{__('Terms')}</dt>
                          <dd>
                            <span class="whitespace-pre-line">{text()}</span>
                            <Show when={null === p().termsConditions}>
                              <span class="ml-1 text-xs text-text-muted">{__('(from the supplier)')}</span>
                            </Show>
                          </dd>
                        </>
                      )}
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
                      <For each={INCOTERMS}>{(t) => <option value={t.code}>{`${t.code} — ${t.label()}`}</option>}</For>
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
                <label class="mt-3 block text-sm text-slate-700">
                  {__('Terms & conditions for this order')}
                  <textarea
                    class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    rows="3"
                    placeholder={p().supplierTerms ?? __('Leave empty to use the store-wide purchase terms.')}
                    value={termsDraft()}
                    onInput={(e) => setTermsDraft(e.currentTarget.value)}
                  />
                </label>
                <div class="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                    disabled={updateTerms.isPending}
                    onClick={() => updateTerms.mutate()}
                  >
                    {updateTerms.isPending ? __('Saving…') : __('Save')}
                  </button>
                  <button type="button" class="rounded px-2 py-1 text-sm text-slate-500 hover:text-slate-800" onClick={() => setEditingTerms(false)}>
                    {__('Cancel')}
                  </button>
                </div>
              </Show>
            </section>

            <Show when={isReceiving() && multiParticipant()}>
              <div class="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {sprintf(
                  _n(
                    '%d worker is receiving this purchase order — counts refresh automatically.',
                    '%d workers are receiving this purchase order — counts refresh automatically.',
                    participants().length,
                  ),
                  participants().length,
                )}
              </div>
            </Show>

            {/* Between deliveries (Pro): re-open for the next delivery, or finish by closing short. */}
            <Show when={isPartiallyReceived()}>
              <div class="mb-3 flex flex-wrap items-center gap-3 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
                <span class="text-teal-800">
                  {sprintf(
                    _n('Partially received — %d unit still outstanding.', 'Partially received — %d units still outstanding.', outstandingUnits()),
                    outstandingUnits(),
                  )}
                </span>
                <div class="flex-1" />
                <button
                  type="button"
                  class="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                  disabled={reopen.isPending}
                  onClick={() => reopen.mutate()}
                >
                  {__('Receive next delivery')}
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  // Teaching tooltip: the terse ERP label ("solder le reliquat") explained in plain words.
                  title={__('Finalise the purchase order and write off the units that were ordered but never delivered.')}
                  disabled={closeShort.isPending}
                  onClick={() => {
                    // No new receipt — the close-short writes off the remaining qty_open directly.
                    setPendingReceipt(null);
                    setShortClose(true);
                    setClosing(true);
                  }}
                >
                  {__('Finish — close short')}
                </button>
              </div>
            </Show>

            <Show
              when={isDraft()}
              fallback={
                <Show
                  when={isReceiving()}
                  fallback={
                <Show
                  when={capturing()}
                  fallback={
                <>
                <Show when={canCaptureDocument()}>
                  <div class="mb-2 flex justify-end">
                    <button
                      type="button"
                      class="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                      onClick={() => setCapturing(true)}
                    >
                      {__('Record supplier document')}
                    </button>
                  </div>
                </Show>
                <Show when={anyDelivery()}>
                  <div class="mb-2 flex items-center justify-end gap-1.5 text-xs text-slate-500">
                    <span>{__('Variance vs')}</span>
                    <SegmentedControl
                      ariaLabel={__('Variance baseline')}
                      size="sm"
                      options={[
                        { value: 'ordered', label: __('Ordered'), title: __('Purchasing lens: did we get what we ordered?') },
                        { value: 'expected', label: __('Expected'), title: __('Receiving lens: did we get what the supplier confirmed?') },
                      ]}
                      value={lens()}
                      onChange={(v: 'ordered' | 'expected') => setLens(v)}
                    />
                  </div>
                </Show>
                <table class="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th class={`${TH} w-12`} />
                      <th class="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600">{__('Product')}</th>
                      <th class={`${TH} w-20`}>{__('Ordered')}</th>
                      <th class={`${TH} w-24`} title={__('Supplier-confirmed (OA/ASN) quantity')}>{__('Expected')}</th>
                      <Show when={!preReception()}>
                        <th class={`${TH} w-20`}>{__('Received')}</th>
                        <th class={`${TH} w-20`}>{__('Damaged')}</th>
                        <th class={`${TH} w-20`}>{_x('Open', 'quantity remaining to receive')}</th>
                      </Show>
                      <th class="border-b border-slate-200 px-3 py-2 text-center font-semibold text-slate-600 w-24">{__('Status')}</th>
                      <th class={`${TH} w-28`}>{__('Unit cost')}</th>
                      <th class={`${TH} w-28`}>{__('Line total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={lines()}>
                      {(l) => (
                        <tr class="hover:bg-slate-50">
                          <td class="border-b border-slate-100 px-3 py-1.5">
                            <Show when={l.imageUrl} fallback={<div class="h-9 w-9 rounded bg-slate-100" />}>
                              {(u) => <img src={u()} alt="" class="h-9 w-9 rounded object-cover" />}
                            </Show>
                          </td>
                          <td class="border-b border-slate-100 px-3 py-1.5">
                            <div class="font-medium" classList={{ 'text-text-muted italic': !l.exists }}>{l.productLabel}</div>
                            <div class="space-y-0.5 text-xs text-text-muted">
                              <Show when={l.sku}>
                                <div>{l.sku}</div>
                              </Show>
                              <Show when={l.supplierSku}>
                                <div><span class="text-slate-300">{__('Supplier')}:</span> {l.supplierSku}</div>
                              </Show>
                              <Show when={l.gtin}>
                                <div><span class="text-slate-300">{__('GTIN')}:</span> {l.gtin}</div>
                              </Show>
                            </div>
                          </td>
                          <td class={TD}>{l.requestedQty}</td>
                          <td class={TD}>
                            <Show when={null !== l.expectedQty} fallback={<span class="text-slate-300" title={__('Not yet confirmed — falls back to the ordered quantity')}>—</span>}>
                              {l.expectedQty}
                            </Show>
                          </td>
                          <Show when={!preReception()}>
                            <td class={TD}>{l.qtyReceived}</td>
                            <td class={TD}>
                              <Show when={l.damagedSoFar > 0} fallback={<span class="text-slate-300">—</span>}>
                                <span class="text-red-600">{l.damagedSoFar}</span>
                              </Show>
                            </td>
                            <td class={TD}>{l.qtyOpen}</td>
                          </Show>
                          <td class="border-b border-slate-100 px-3 py-1.5 text-center">
                            <Show
                              when={isDeliveryStage(l)}
                              fallback={
                                // Confirmation badge only once an OA/ASN is recorded (expected set); an
                                // unconfirmed line shows nothing, so a match here is a real "Confirmed".
                                <Show when={null !== l.expectedQty}>
                                  <VarianceBadge kind="confirmation" status={confirmationStatus(l)} varianceQty={confirmationVarianceQty(l)} />
                                </Show>
                              }
                            >
                              <VarianceBadge kind="delivery" status={deliveryStatus(l, lens())} varianceQty={deliveryVarianceQty(l, lens())} />
                            </Show>
                          </td>
                          <td class={TD}>{fmt(l.unitCost)}</td>
                          <td class={TD}>{fmt(l.lineTotal)}</td>
                        </tr>
                      )}
                    </For>
                    <Show when={0 === lines().length}>
                      <tr>
                        <td colspan={readColCount()} class="px-3 py-3 text-slate-500">{__('No lines on this purchase order.')}</td>
                      </tr>
                    </Show>
                  </tbody>
                  <Show when={lines().length > 0}>
                    <tfoot>
                      <tr>
                        <td colspan={readColCount() - 1} class="px-3 py-2 text-right text-sm font-semibold">{__('Total')}</td>
                        <td class="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                          {grandTotal().toFixed(decimals())} {p().currency}
                        </td>
                      </tr>
                    </tfoot>
                  </Show>
                </table>
                </>
                  }
                >
                  <PoExpectedCaptureGrid poId={Number(props.id)} lines={lines()} onDone={() => setCapturing(false)} />
                </Show>
                  }
                >
                  <PoReceiveForm
                    poId={Number(props.id)}
                    lines={lines()}
                    currency={p().currency}
                    baseCurrency={p().baseCurrency}
                    pending={confirmReceipt.isPending || confirmAndCloseShort.isPending || keepOpen.isPending || cancelReception.isPending}
                    initial={p().receivingSession}
                    initialNote={p().receivingNote}
                    canLax={ctx.capabilities.closeShortLax}
                    onPersist={(rows, note) => persistSession.mutate({ rows, note })}
                    onConfirm={(rows, note, fxRate) => confirmReceipt.mutate({ rows, note, fxRate })}
                    onKeepOpen={(rows, note, fxRate) => keepOpen.mutate({ rows, note, fxRate })}
                    onCancel={() => cancelReception.mutate()}
                    onCloseShort={(rows, note, fxRate) => {
                      // Stage the receipt and open the reason modal — commit happens on confirm.
                      setPendingReceipt({ rows, note, fxRate });
                      setShortClose(true);
                      setClosing(true);
                    }}
                  />
                </Show>
              }
            >
              <PoLinesEditor poId={props.id} supplierId={p().supplierId} supplierLabel={p().supplierDisplay ?? p().supplierName ?? ''} costDecimals={p().costDecimals} lines={lines()} />
            </Show>

            <PoTimeline events={events()} loading={eventsQuery.isPending} />
          </>
        )}
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
                          <span class="text-text-muted">— {'zero_qty' === p.reason ? __('no quantity') : __('no price')}</span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </div>
            }
            confirmLabel={'mark-sent' === pruneGate() ? __('Remove & mark as sent') : __('Remove & download')}
            variant="warning"
            onConfirm={() => ('mark-sent' === pruneGate() ? markSent.mutate(true) : assignNumber.mutate(true))}
            onCancel={() => setPrunePreview(null)}
          />
        )}
      </Show>

      <Show when={closing()}>
        <ConfirmModal
          title={shortClose() ? __('Close short?') : __('Close purchase order?')}
          message={
            !shortClose() ? (
              __('All ordered quantities have been received. Close this purchase order?')
            ) : (
              <div class="space-y-3">
                <p>
                  {__('Some lines are short of the ordered quantity. Closing short writes off the outstanding units — recorded as a short — and finalizes the PO as received.')}
                </p>
                <label class="block text-sm">
                  <span class="mb-1 block font-medium text-slate-600">{__('Reason')}</span>
                  <select
                    class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                    value={shortReason()}
                    onChange={(e) => setShortReason(e.currentTarget.value)}
                  >
                    <option value="supplier_oos">{__('Supplier out of stock')}</option>
                    <option value="packing_error">{__('Short / packing error')}</option>
                    <option value="discontinued">{__('Discontinued')}</option>
                    <option value="wont_ship">{__('Won’t ship the rest')}</option>
                    <option value="other">{__('Other / unknown')}</option>
                  </select>
                </label>
                <label class="block text-sm">
                  <span class="mb-1 block font-medium text-slate-600">{__('Note (optional)')}</span>
                  <textarea
                    rows="2"
                    class="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                    placeholder={__('e.g. supplier confirmed the rest is cancelled')}
                    value={shortNote()}
                    onInput={(e) => setShortNote(e.currentTarget.value)}
                  />
                </label>
              </div>
            )
          }
          confirmLabel={shortClose() ? __('Close short') : __('Close PO')}
          variant={shortClose() ? 'warning' : 'default'}
          autoFocusConfirm={!shortClose()}
          onConfirm={() => {
            if (!shortClose()) return transition.mutate(STAGE_RECEIVED);
            // A staged receipt → commit it then write off; an already-committed one → write off only.
            const pending = pendingReceipt();
            return pending ? confirmAndCloseShort.mutate(pending) : closeShort.mutate();
          }}
          onCancel={() => {
            setClosing(false);
            setPendingReceipt(null); // discard the staged receipt — nothing was committed
          }}
        />
      </Show>

      <Show when={cancelling()}>
        <ConfirmModal
          title={__('Cancel this purchase order?')}
          message={__('It will be marked cancelled and no further goods received. Stock already received is unaffected; outstanding quantities will not be received.')}
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
          message={__('It moves out of your active purchase-order lists. You can still reach it by direct link.')}
          confirmLabel={__('Archive')}
          cancelLabel={__('Keep')}
          onConfirm={() => transition.mutate(STAGE_ARCHIVED)}
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
function EventDescription(props: { description: string; stage: string | null; date?: string | null; emphasis?: string | null }): JSX.Element {
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
                  <span class="font-medium text-slate-700">{fmtDateOnly(date())}</span>
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
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
  return (
    <section class="mt-6">
      <h3 class="mb-2 text-sm font-semibold text-slate-600">{__('Activity')}</h3>
      <Show when={!props.loading} fallback={<p class="text-sm text-text-muted">{__('Loading activity…')}</p>}>
        <Show when={props.events.length > 0} fallback={<p class="text-sm text-text-muted">{__('No activity yet.')}</p>}>
          <ol class="relative ml-2 border-l border-slate-200">
            <For each={props.events}>
              {(e) => (
                <li class="mb-3 ml-4">
                  <div class="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                  <div class="text-sm text-slate-700">
                    <span class="font-medium text-slate-800">{e.actorName}</span>{' '}
                    <EventDescription description={e.description} stage={e.stage} date={e.date} emphasis={e.emphasis} />
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
