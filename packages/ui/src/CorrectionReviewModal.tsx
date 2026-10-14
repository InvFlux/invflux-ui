import { ErrorBanner } from './ErrorBanner';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Button } from './Button';
import { Dynamic } from 'solid-js/web';
import { __, _n, sprintf } from '@invflux/i18n';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';
import { RequiredMark } from './RequiredMark';
import { SegmentedControl } from './SegmentedControl';
import { Spinner } from './Spinner';
import { codecRegistry, diffPreviewRegistry } from './datatypes/registry';
import { cascadeAllocate, type SlotDeltas } from './onHandCascade';
import type { GridColumnMeta, TaxonomySpace } from './types';

/**
 * Shared save-review / on-hand-correction modal: a pure
 * human diff-verification surface over ALREADY-staged edits — it never captures the numeric input
 * (callers compute the delta), only the disposition / discovery-context / reason.
 *
 * Two presentations from the same component:
 *  - **Batch** (Central Workbench bulk apply): Per-SKU / Per-field tabs, multi-column.
 *  - **Compact** (Product Inventory Tab single correction, or a single-SKU stock-only workbench
 *    edit): tabs hidden, the per-field sections rendered directly. Auto-detected for a single
 *    subject × single column; forceable via `compact`.
 *
 * The on-hand column (`onHandColumnId`, default `total`) renders the `atp → res → ctd` cascade
 * breakdown (computed here via {@link cascadeAllocate} from each row's `onHand` base + delta) plus
 * the boundary warnings when a negative delta bites into reserved-in-cart / paid-but-undispatched
 * stock. Disposition is sign-aware (one choice per sign group present); discovery context is one
 * batch-level choice; reason is required only when an "other" disposition/discovery is chosen.
 */
export interface CorrectionReviewRow {
  subjectId: number;
  name: string;
  sku: string;
  oldValue: unknown;
  newValue: unknown;
  /** Signed stock delta for the on-hand column (first-class delta — shown over the live baseline). */
  delta?: number;
  /** On-hand slot detail for the on-hand column: live base per slot + the `ctd` deficit. The modal
   *  computes the cascade + boundary warnings from this, so it needs no host row type. */
  onHand?: { atp: number; res: number; ctd: number; deficit: number };
  /** Whether the subject has an effective cost basis (`weighted_avg_cost ?? seed_cost`). `false`
   *  drives the A3.5 uncosted-inventory-in warning on a positive delta; `undefined` = unknown (no warning). */
  hasCostBasis?: boolean;
}

/** An advisory note shown in the review banner (e.g. a governance-change consequence). */
export interface ReviewNote {
  tone: 'warn' | 'danger';
  text: JSX.Element;
}

export interface CorrectionReviewGroup {
  columnId: string;
  meta: GridColumnMeta | undefined;
  rows: CorrectionReviewRow[];
}

export interface CorrectionDispositions {
  negative: string | null;
  positive: string | null;
  discoveryContext: string | null;
}

export interface CorrectionReviewModalProps {
  groups: CorrectionReviewGroup[];
  space?: TaxonomySpace;
  error?: string | null;
  /** Which column is the on-hand stock column (cascade + disposition section). Default `total`. */
  onHandColumnId?: string;
  /** Force the compact (tab-less) presentation. Default: auto when one subject × one column. */
  compact?: boolean;
  /** Modal heading. Default "Review changes". */
  title?: string;
  /** Confirm-button label given the change count. Default "Apply N update(s)". */
  confirmLabel?: (count: number) => string;
  onConfirm: (reason: string, dispositions: CorrectionDispositions) => void;
  /**
   * The confirm is in flight — the host owns the request, so it owns this flag.
   *
   * The dialog then covers itself with a busy scrim and refuses every way out and back in: the
   * buttons disable, Escape stops closing, and `confirm()` returns early. That last one is not
   * belt-and-braces — Ctrl+Enter and Ctrl+S reach `confirm()` through two listeners that never
   * consult the button's disabled state, so a second submit is a keystroke away without it.
   *
   * A scrim rather than hiding the dialog, because the confirm is not necessarily terminal: a
   * partial apply (some rows conflicted) leaves it open to show `error`, and it still holds the
   * operator's typed reason. Hiding it would have to un-hide, which reads as a glitch.
   */
  pending?: boolean;
  onCancel: () => void;
  /** Bulk-only "Discard pending edits" action. Omit (e.g. single correction) to hide the button. */
  onDiscard?: () => void;
  /** Advisory notes shown as an always-visible banner below the tabs (e.g. governance adopt / un-govern
   *  consequences). Independent of the active tab, so the warning shows in both Per-SKU and Per-field. */
  governanceNotes?: ReviewNote[];
  /** Portal the modal to this root (shadow-DOM / transformed-ancestor surfaces). */
  mount?: HTMLElement;
  /**
   * Offer to hand the on-hand INCREASES to a goods receipt instead of applying them as a correction.
   * Shown whenever the review holds at least one increase, and it becomes the primary action, Apply
   * stepping back. Only the increases move: a decrease is a real correction, so it stays staged along
   * with every other pending change, for a later Apply. The host owns the request (and unstages the
   * moved cells when it succeeds); the modal only asks the receipt's reason, once, because a
   * receiving session locks it on creation.
   */
  receipt?: ReceiptOffer;
}

/** The goods-receipt hand-off a host makes available to the review modal. */
export interface ReceiptOffer {
  /** Reasons the operator may pick, as the server states them. Empty while they load. */
  reasons: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
  /** Preselected value; falls back to the first reason. */
  defaultReason?: string;
  onOpen: (reason: string) => void;
}

/**
 * Build the `GridColumnMeta` for a standalone on-hand correction (e.g. the Product Inventory Tab's
 * single-product correction), carrying the canonical Essentials-tier sign-aware disposition options +
 * discovery contexts + a reason prompt. The Central Workbench gets the equivalent meta from the
 * server (NativeWorkbenchColumns); this is the client-side source for surfaces that have no server
 * column. `cycle_count` is omitted; pass `overrides` to extend.
 *
 * A function (not a const) so the `__()` labels resolve at call time, not module-eval time.
 */
export function onHandCorrectionMeta(overrides?: Partial<GridColumnMeta>): GridColumnMeta {
  return {
    id: 'total',
    label: __('On-hand Total'),
    dataType: 'number',
    editorConfig: {},
    kind: 'editable',
    editable: true,
    sortable: false,
    copyable: false,
    pasteable: false,
    bulkSaveReason: { required: false, label: __('Reason') },
    hasDrilldown: false,
    dispositionOptions: [
      { value: 'missing', label: __('Missing'), sign: 'negative' },
      { value: 'damaged', label: __('Damaged'), sign: 'negative' },
      { value: 'other_write_off', label: __('Other write-off'), sign: 'negative' },
      { value: 'found', label: __('Found'), sign: 'positive' },
      { value: 'recount_up', label: __('Recount-up'), sign: 'positive' },
      { value: 'other_write_in', label: __('Other write-in'), sign: 'positive' },
    ],
    discoveryContextOptions: [
      { value: 'one_off', label: __('One-off') },
      { value: 'stock_take', label: __('Stock-take') },
      { value: 'other', label: __('Other') },
    ],
    group: null,
    priority: 0,
    visibleByDefault: true,
    defaultWidth: 0,
    aggregate: null,
    ...overrides,
  };
}

/** Slot → human label for the on-hand breakdown rows. */
const SLOT_LABELS: Array<{ key: 'atp' | 'res' | 'ctd'; label: () => string }> = [
  { key: 'atp', label: () => __('Available') },
  { key: 'res', label: () => __('Reserved') },
  { key: 'ctd', label: () => __('Committed') },
];

function deltaClass(delta: number): string {
  if (delta < 0) return 'text-red-700';
  if (delta > 0) return 'text-green-700';
  return 'text-text-muted';
}

function signedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

function formatCellValue(
  meta: GridColumnMeta | undefined,
  value: unknown,
  space: TaxonomySpace | undefined,
): string {
  const codec = meta ? codecRegistry.resolve(meta.dataType) : null;
  if (codec && meta)
    return codec.format(value, { config: meta.editorConfig, taxonomySpace: space });
  return value === null || value === undefined ? '' : String(value);
}

export function CorrectionReviewModal(props: CorrectionReviewModalProps): JSX.Element {
  const onHandColumnId = (): string => props.onHandColumnId ?? 'total';
  const isOnHand = (columnId: string): boolean => columnId === onHandColumnId();

  const [reasons, setReasons] = createSignal<Record<string, string>>({});
  const [dispositionNeg, setDispositionNeg] = createSignal('');
  const [dispositionPos, setDispositionPos] = createSignal('');
  const [discoveryContext, setDiscoveryContext] = createSignal('');
  const [showBreakdown, setShowBreakdown] = createSignal(false);
  const [receiptStep, setReceiptStep] = createSignal(false);
  const [receiptReason, setReceiptReason] = createSignal('');
  let firstReasonRef: HTMLTextAreaElement | undefined;
  let scrimRef: HTMLDivElement | undefined;
  let receiptPanelRef: HTMLDivElement | undefined;
  let applyRef: HTMLButtonElement | undefined;

  const distinctSubjects = createMemo(() => {
    const ids = new Set<number>();
    for (const g of props.groups) for (const r of g.rows) ids.add(r.subjectId);
    return ids.size;
  });
  // Compact (no tabs) for a single subject × single column — a one-shot correction reads cleaner
  // without the Per-SKU/Per-field switcher. Forceable via the prop.
  const compact = createMemo(
    () => props.compact ?? (props.groups.length === 1 && distinctSubjects() === 1),
  );
  const onlyStockChange = createMemo(
    () => props.groups.length === 1 && isOnHand(props.groups[0]?.columnId ?? ''),
  );
  const [activeTab, setActiveTab] = createSignal<'sku' | 'field'>('field');
  createEffect(() => setActiveTab(compact() || onlyStockChange() ? 'field' : 'sku'));

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  /** Per-row cascade (atp→res→ctd) for an on-hand row, computed from its base slots + delta. */
  const cascadeFor = (row: CorrectionReviewRow): SlotDeltas | null => {
    if (!row.onHand || typeof row.delta !== 'number') return null;
    return cascadeAllocate(
      row.delta,
      row.onHand.atp,
      row.onHand.res,
      row.onHand.ctd,
      row.onHand.deficit,
    );
  };

  const dispositionSection = createMemo(() =>
    props.groups.find((g) => g.meta?.dispositionOptions != null),
  );
  const negOptions = createMemo(
    () =>
      dispositionSection()?.meta?.dispositionOptions?.filter((o) => o.sign === 'negative') ?? [],
  );
  const posOptions = createMemo(
    () =>
      dispositionSection()?.meta?.dispositionOptions?.filter((o) => o.sign === 'positive') ?? [],
  );
  const discoveryOptions = createMemo(
    () => dispositionSection()?.meta?.discoveryContextOptions ?? [],
  );
  const hasNeg = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) < 0),
  );
  const hasPos = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) > 0),
  );

  // The receipt route is for on-hand INCREASES. A review may also carry decreases and other columns:
  // the host moves only the increasing on-hand rows into the receipt and leaves everything else staged,
  // to be applied through a normal review afterwards.
  const stockIncreaseRows = createMemo(
    () =>
      props.groups.find((g) => isOnHand(g.columnId))?.rows.filter((r) => (r.delta ?? 0) > 0) ?? [],
  );
  const hasStockIncrease = createMemo(() => stockIncreaseRows().length > 0);
  const offersReceipt = createMemo(() => props.receipt !== undefined && hasStockIncrease());
  // Keep a pickable reason selected: the default when there is one, else the first that is not disabled.
  createEffect(() => {
    const offer = props.receipt;
    const pickable = (offer?.reasons ?? []).filter((r) => !r.disabled);
    if (pickable.length === 0 || pickable.some((r) => r.value === receiptReason())) return;
    setReceiptReason((pickable.find((r) => r.value === offer?.defaultReason) ?? pickable[0]).value);
  });
  // Leaving the "holds an increase" state (cannot happen while open, but keeps the invariant local).
  createEffect(() => {
    if (!offersReceipt()) setReceiptStep(false);
  });

  // Boundary warnings: a negative cascade that reaches reserved-in-cart (res) / paid-undispatched (ctd).
  const warnRes = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (cascadeFor(r)?.res ?? 0) < 0),
  );
  const warnCtd = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (cascadeFor(r)?.ctd ?? 0) < 0),
  );

  // A3.5: a positive on-hand correction on a subject with NO cost basis adds stock uncosted — the
  // movement can't be valued. Non-blocking nudge to seed the cost first (seed-then-write-in values the
  // movement; write-in-then-seed leaves an uncosted movement + a silent basis change). Positive-delta only.
  const warnUncosted = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) > 0 && r.hasCostBasis === false),
  );

  const totalCount = createMemo(() => props.groups.reduce((sum, g) => sum + g.rows.length, 0));
  const reasonSections = createMemo(() =>
    props.groups.filter((g) => g.meta?.bulkSaveReason != null),
  );
  const reasonRequired = createMemo(
    () =>
      dispositionNeg() === 'other_write_off' ||
      dispositionPos() === 'other_write_in' ||
      discoveryContext() === 'other',
  );
  const requiredMissing = createMemo<CorrectionReviewGroup[]>(() => {
    const section = dispositionSection();
    return reasonRequired() &&
      section !== undefined &&
      (reasons()[section.columnId] ?? '').trim() === ''
      ? [section]
      : [];
  });
  const dispositionsMissing = createMemo(
    () => (hasNeg() && dispositionNeg() === '') || (hasPos() && dispositionPos() === ''),
  );
  const cannotApply = createMemo(() => requiredMissing().length > 0 || dispositionsMissing());

  // Single subject in compact mode → caption it by name/sku instead of the "N across M columns" line.
  const singleRow = createMemo<CorrectionReviewRow | null>(() => {
    if (!compact() || distinctSubjects() !== 1) return null;
    for (const g of props.groups) if (g.rows[0]) return g.rows[0];
    return null;
  });

  type SkuCell = {
    delta?: number;
    base?: number;
    result?: number;
    oldValue?: unknown;
    newValue?: unknown;
  };
  type SkuRow = { subjectId: number; name: string; sku: string; cells: Record<string, SkuCell> };
  const reviewBySku = createMemo<SkuRow[]>(() => {
    const bySubject = new Map<number, SkuRow>();
    const order: number[] = [];
    for (const group of props.groups) {
      for (const row of group.rows) {
        let entry = bySubject.get(row.subjectId);
        if (!entry) {
          entry = { subjectId: row.subjectId, name: row.name, sku: row.sku, cells: {} };
          bySubject.set(row.subjectId, entry);
          order.push(row.subjectId);
        }
        if (isOnHand(group.columnId) && typeof row.delta === 'number') {
          const base = typeof row.oldValue === 'number' ? row.oldValue : 0;
          entry.cells[group.columnId] = { delta: row.delta, base, result: base + row.delta };
        } else {
          entry.cells[group.columnId] = { oldValue: row.oldValue, newValue: row.newValue };
        }
      }
    }
    return order.map((id) => bySubject.get(id)!);
  });

  function buildReason(): string {
    const entries = reasonSections()
      .map((g) => ({
        label: g.meta?.bulkSaveReason?.label ?? g.columnId,
        text: (reasons()[g.columnId] ?? '').trim(),
      }))
      .filter((e) => e.text !== '');
    if (entries.length === 0) return '';
    if (entries.length === 1) return entries[0].text;
    return entries.map((e) => `${e.label}: ${e.text}`).join('\n');
  }

  function openReceipt(): void {
    if (props.pending || !offersReceipt() || receiptReason() === '') return;
    props.receipt?.onOpen(receiptReason());
  }

  function confirm(): void {
    if (props.pending) return;
    // In the receipt step the chord opens the receipt: it is what the dialog is asking for then.
    if (receiptStep()) {
      openReceipt();
      return;
    }
    if (cannotApply()) {
      if (requiredMissing().length > 0) firstReasonRef?.focus();
      return;
    }
    props.onConfirm(buildReason(), {
      negative: dispositionNeg() || null,
      positive: dispositionPos() || null,
      discoveryContext: discoveryContext() || null,
    });
  }

  createEffect(() => {
    queueMicrotask(() => firstReasonRef?.focus());
  });

  // Hand focus to the scrim while the apply is in flight, and take it back when the dialog survives
  // the round trip (a partial apply). Not cosmetic: disabling the button the operator just pressed
  // makes the browser drop focus to `<body>`, which puts the next Tab at the top of the *page* —
  // outside the dialog. The modal's focus trap cannot help, because it walks
  // `:not([disabled])` and every control in here is disabled while pending.
  createEffect((wasPending: boolean | undefined) => {
    const now = props.pending ?? false;
    if (now && !wasPending) queueMicrotask(() => scrimRef?.focus());
    // `isConnected`, because settling and closing look the same from here. A successful apply
    // clears `pending` AND unmounts the dialog in the same turn, so focusing Apply unconditionally
    // would move focus onto a detached button — dropping it to `<body>` and undoing the host's
    // hand-back to the grid. Only a dialog that survived the round trip (a partial apply) still has
    // a button to return to.
    else if (!now && wasPending)
      queueMicrotask(() => {
        if (true === applyRef?.isConnected) applyRef.focus();
      });
    return now;
  });

  createEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== 'Enter' && event.key !== 's' && event.key !== 'S') return;
      event.preventDefault();
      event.stopPropagation();
      confirm();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const tabBtnClass = (tab: 'sku' | 'field'): string =>
    `cursor-pointer rounded-t border-b-2 px-3 py-1.5 text-sm font-medium ${
      activeTab() === tab
        ? 'border-primary text-text'
        : 'border-transparent text-text-muted hover:text-text'
    }`;

  const heading = (): string => props.title ?? __('Review changes');
  const confirmText = (): string =>
    props.confirmLabel
      ? props.confirmLabel(totalCount())
      : sprintf(_n('Apply %d update', 'Apply %d updates', totalCount()), totalCount());

  return (
    <Modal
      onClose={props.onCancel}
      closeOnBackdrop={false}
      closeOnEsc={!props.pending}
      mount={props.mount}
      label={heading()}
    >
      <ModalPanel
        size="3xl"
        class="relative"
        aria-busy={props.pending || undefined}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            confirm();
          }
        }}
      >
        {/* Busy scrim. `tabindex=0` so it is the one thing the modal's focus trap can still find
            while every control below is disabled — see the focus effect above. `z-10` is the
            in-component rung of the layering scale (styles/theme.css), not the overlay ladder:
            this stacks against its siblings in the panel, not against the host chrome. */}
        <Show when={props.pending}>
          <div
            ref={scrimRef}
            class="absolute inset-0 z-10 flex items-center justify-center gap-3 rounded bg-surface/70 focus:outline-none"
            role="status"
            aria-live="polite"
            tabindex="0"
          >
            <Spinner size="md" />
            <span class="text-sm font-medium text-text">{__('Applying…')}</span>
          </div>
        </Show>
        <ModalHeader
          title={heading()}
          subtitle={
            <Show
              when={singleRow()}
              fallback={
                <p>
                  {totalCount()} {__('pending change(s) across')} {props.groups.length}{' '}
                  {__('column(s)')}
                </p>
              }
            >
              {(row) => (
                <p>
                  {row().name}
                  <Show when={row().sku}>
                    {' '}
                    <span class="font-mono">{row().sku}</span>
                  </Show>
                </p>
              )}
            </Show>
          }
        />

        {/* Tab switcher: hidden in compact mode (single subject × single column). */}
        <Show when={!compact()}>
          <div class="flex gap-1 border-b border-border px-4 pt-3">
            <button type="button" class={tabBtnClass('sku')} onClick={() => setActiveTab('sku')}>
              {__('Per-SKU')}
            </button>
            <button
              type="button"
              class={tabBtnClass('field')}
              onClick={() => setActiveTab('field')}
            >
              {__('Per-field')}
            </button>
          </div>
        </Show>

        <div class="flex-1 space-y-5 overflow-auto p-4">
          <Show when={props.error}>
            <ErrorBanner class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm">
              {props.error}
            </ErrorBanner>
          </Show>

          {/* ── Per-SKU matrix ── */}
          <Show when={activeTab() === 'sku'}>
            <div class="overflow-x-auto rounded border border-border">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border bg-gray-50 text-left">
                    <th class="px-3 py-2 font-semibold text-text">{__('SKU')}</th>
                    <th class="px-3 py-2 font-semibold text-text">{__('Name')}</th>
                    <For each={props.groups}>
                      {(group) => (
                        <th class="px-3 py-2 text-right font-semibold text-text">
                          {isOnHand(group.columnId)
                            ? __('On-hand Total')
                            : (group.meta?.label ?? group.columnId)}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={reviewBySku()}>
                    {(skuRow) => (
                      <tr class="border-t border-border align-top">
                        <td class="px-3 py-2 font-mono text-xs text-text-muted">
                          {skuRow.sku || '—'}
                        </td>
                        <td class="px-3 py-2 text-text">{skuRow.name}</td>
                        <For each={props.groups}>
                          {(group) => {
                            const cell = (): SkuCell | undefined => skuRow.cells[group.columnId];
                            return (
                              <td class="px-3 py-2 text-right tabular-nums">
                                <Show
                                  when={cell()}
                                  fallback={<span class="text-text-muted">—</span>}
                                >
                                  {(c) => (
                                    <Show
                                      when={isOnHand(group.columnId) && c().delta !== undefined}
                                      fallback={
                                        <span class="text-text">
                                          <span class="text-red-700 line-through">
                                            {formatCellValue(group.meta, c().oldValue, props.space)}
                                          </span>
                                          {' → '}
                                          <span class="text-green-700">
                                            {formatCellValue(group.meta, c().newValue, props.space)}
                                          </span>
                                        </span>
                                      }
                                    >
                                      <span class="text-text">
                                        {c().base}{' '}
                                        <span
                                          classList={{
                                            'text-red-700': c().delta! < 0,
                                            'text-green-700': c().delta! > 0,
                                          }}
                                        >
                                          {c().delta! < 0 ? '−' : '+'} {Math.abs(c().delta!)}
                                        </span>
                                        {' = '}
                                        <span class="font-semibold">{c().result}</span>
                                      </span>
                                    </Show>
                                  )}
                                </Show>
                              </td>
                            );
                          }}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          {/* ── Per-field sections ── */}
          <Show when={activeTab() === 'field'}>
            <For each={props.groups}>
              {(group) => {
                const Preview = group.meta
                  ? diffPreviewRegistry.resolve(group.meta.dataType)
                  : null;
                const onHandSection = isOnHand(group.columnId);
                return (
                  <section class="rounded border border-border">
                    <header class="flex items-center justify-between gap-3 border-b border-border bg-gray-50 px-4 py-2">
                      <span class="font-semibold text-text">
                        {onHandSection
                          ? __('On-hand Total')
                          : (group.meta?.label ?? group.columnId)}
                      </span>
                      <div class="flex items-center gap-3">
                        <Show when={onHandSection}>
                          <Button
                            variant="link"
                            size="xs"
                            disabled={props.pending}
                            onClick={() => setShowBreakdown((v) => !v)}
                          >
                            {showBreakdown()
                              ? __('Hide delta breakdown detail')
                              : __('Show delta breakdown detail')}
                          </Button>
                        </Show>
                        <span class="text-xs text-text-muted">{group.rows.length}</span>
                      </div>
                    </header>

                    <Show
                      when={onHandSection}
                      fallback={
                        <table class="w-full text-sm">
                          <thead>
                            <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
                              <th class="px-4 py-1.5 font-semibold">{__('SKU')}</th>
                              <th class="px-4 py-1.5 font-semibold">{__('Name')}</th>
                              <th class="px-4 py-1.5 text-right font-semibold">
                                {__('Old value')}
                              </th>
                              <th class="px-4 py-1.5 text-right font-semibold">
                                {__('New value')}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={group.rows}>
                              {(row) => (
                                <tr class="border-t border-border align-top">
                                  <td class="px-4 py-2 font-mono text-xs text-text-muted">
                                    {row.sku || '—'}
                                  </td>
                                  <td class="px-4 py-2 text-text">{row.name}</td>
                                  <Show
                                    when={Preview && group.meta}
                                    fallback={
                                      <>
                                        <td class="px-4 py-2 text-right">
                                          <span class="text-red-700 line-through">
                                            {formatCellValue(group.meta, row.oldValue, props.space)}
                                          </span>
                                        </td>
                                        <td class="px-4 py-2 text-right">
                                          <span class="text-green-700">
                                            {formatCellValue(group.meta, row.newValue, props.space)}
                                          </span>
                                        </td>
                                      </>
                                    }
                                  >
                                    <td class="px-4 py-2 text-right" colspan={2}>
                                      <Dynamic
                                        component={Preview!}
                                        column={group.meta!}
                                        oldValue={row.oldValue}
                                        newValue={row.newValue}
                                        ctx={{ taxonomySpace: props.space }}
                                      />
                                    </td>
                                  </Show>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      }
                    >
                      {/* On-hand: SKU · Name · [State] · Base · Delta · Result; the slot sub-rows and the State column
                          appear only with the breakdown open. */}
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
                            {/* Narrow screens (below `sm:`) drop SKU (it moves under the name) and
                                Base; State only exists while the breakdown is open, since every row
                                is "Total" otherwise. */}
                            <th class="hidden px-4 py-1.5 font-semibold sm:table-cell">{__('SKU')}</th>
                            <th class="px-3 py-1.5 font-semibold sm:px-4">{__('Name')}</th>
                            <Show when={showBreakdown()}>
                              <th class="px-3 py-1.5 font-semibold sm:px-4">{__('State')}</th>
                            </Show>
                            <th class="hidden px-4 py-1.5 text-right font-semibold sm:table-cell">
                              {__('Base')}
                            </th>
                            <th class="px-3 py-1.5 text-right font-semibold sm:px-4">{__('Delta')}</th>
                            <th class="px-3 py-1.5 text-right font-semibold sm:px-4">{__('Result')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={group.rows}>
                            {(row) => {
                              const cascade = (): SlotDeltas | null => cascadeFor(row);
                              const base = typeof row.oldValue === 'number' ? row.oldValue : 0;
                              const delta = row.delta ?? 0;
                              return (
                                <>
                                  <tr class="border-t border-border align-top font-semibold">
                                    <td class="hidden px-4 py-2 font-mono text-xs font-normal text-text-muted sm:table-cell">
                                      {row.sku || '—'}
                                    </td>
                                    <td class="px-3 py-2 text-text sm:px-4">
                                      {row.name}
                                      {/* The SKU column is hidden on narrow screens; it lives here. */}
                                      <Show when={row.sku}>
                                        <span class="block font-mono text-xs font-normal text-text-muted sm:hidden">
                                          {row.sku}
                                        </span>
                                      </Show>
                                    </td>
                                    <Show when={showBreakdown()}>
                                      <td class="px-3 py-2 text-text sm:px-4">{__('Total')}</td>
                                    </Show>
                                    <td class="hidden px-4 py-2 text-right tabular-nums text-text sm:table-cell">
                                      {base}
                                    </td>
                                    <td
                                      class={`px-3 py-2 text-right tabular-nums sm:px-4 ${deltaClass(delta)}`}
                                    >
                                      {signedDelta(delta)}
                                    </td>
                                    <td class="px-3 py-2 text-right tabular-nums text-text sm:px-4">
                                      {base + delta}
                                    </td>
                                  </tr>
                                  <Show when={showBreakdown()}>
                                    <For each={SLOT_LABELS}>
                                      {(slot) => {
                                        const slotDelta = (): number => cascade()?.[slot.key] ?? 0;
                                        const slotBase = (): number => row.onHand?.[slot.key] ?? 0;
                                        return (
                                          <Show when={slotDelta() !== 0}>
                                            <tr class="border-t border-border align-top text-text-muted">
                                              <td class="hidden px-4 py-1 sm:table-cell" />
                                              <td class="px-3 py-1 sm:px-4" />
                                              <td class="px-3 py-1 sm:px-4 sm:pl-8">{slot.label()}</td>
                                              <td class="hidden px-4 py-1 text-right tabular-nums sm:table-cell">
                                                {slotBase()}
                                              </td>
                                              <td
                                                class={`px-3 py-1 text-right tabular-nums sm:px-4 ${deltaClass(slotDelta())}`}
                                              >
                                                {signedDelta(slotDelta())}
                                              </td>
                                              <td class="px-3 py-1 text-right tabular-nums sm:px-4">
                                                {slotBase() + slotDelta()}
                                              </td>
                                            </tr>
                                          </Show>
                                        );
                                      }}
                                    </For>
                                  </Show>
                                </>
                              );
                            }}
                          </For>
                        </tbody>
                      </table>

                      {/* Boundary warnings (negative cascade reaching cart-reserved / paid-committed). */}
                      <Show when={warnRes()}>
                        <div class="m-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          {__('This removes stock that customers are paying for right now.')}
                        </div>
                      </Show>
                      <Show when={warnCtd()}>
                        <div class="m-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                          <span class="font-semibold">{__('Warning:')}</span>{' '}
                          {__('this makes paid orders unfulfillable.')}
                        </div>
                      </Show>
                    </Show>
                  </section>
                );
              }}
            </For>
          </Show>

          {/* Shared on-hand controls: disposition (why) → discovery (how) → reason (conditional).
              Below the review, inside the scroll area: on a short screen the questions would otherwise
              claim the height the review needs. */}
          <Show
            when={!(receiptStep() && props.receipt)}
            fallback={null}
          >
        <Show when={dispositionSection() || reasonSections().length > 0}>
          <div class="space-y-4 rounded border border-border bg-gray-50 p-4">
            {/* Says why Apply is disabled, at the head of the questions that would enable it. */}
            <Show when={dispositionsMissing()}>
              <p class="text-xs text-text-muted">
                {__('Choose a disposition below to apply these changes.')}
              </p>
            </Show>
            <Show when={dispositionSection()}>
              <div class="flex flex-wrap gap-x-10 gap-y-3">
                <Show when={hasNeg()}>
                  <div class="grid gap-1">
                    <span class="text-xs font-semibold uppercase text-text-muted">
                      {__('Disposition — decreases')}
                      <RequiredMark />
                    </span>
                    <SegmentedControl
                      ariaLabel={__('Disposition for decreases')}
                      disabled={props.pending}
                      options={negOptions()}
                      value={dispositionNeg() || null}
                      onChange={(v) => setDispositionNeg(v)}
                      class="flex-wrap"
                    />
                  </div>
                </Show>
                <Show when={hasPos()}>
                  <div class="grid gap-1">
                    <span class="text-xs font-semibold uppercase text-text-muted">
                      {__('Disposition — increases')}
                      <RequiredMark />
                    </span>
                    <SegmentedControl
                      ariaLabel={__('Disposition for increases')}
                      disabled={props.pending}
                      options={posOptions()}
                      value={dispositionPos() || null}
                      onChange={(v) => setDispositionPos(v)}
                      class="flex-wrap"
                    />
                    {/* The uncosted warning below says the same thing more urgently (no cost at all, not
                        just no purchase cost), so when it shows, it replaces this line. */}
                    <Show when={!warnUncosted()}>
                      <p
                        class={`text-xs ${dispositionPos() === 'other_write_in' ? 'text-amber-700' : 'text-text-muted'}`}
                      >
                        {/* With the receipt on offer, point at it: it is where the units' cost is stated.
                            Without it (no receiving capability), the purchase-order route is the pointer. */}
                        {offersReceipt()
                          ? __(
                              'Added units are valued at the current average cost — a correction records no purchase cost. To record what the units cost, enter them as a Goods Receipt.',
                            )
                          : __(
                              'Added units are valued at the current average cost — a correction records no purchase cost. For new stock at a specific cost, receive it via a purchase order.',
                            )}
                      </p>
                    </Show>
                    <Show when={warnUncosted()}>
                      <div class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {offersReceipt()
                          ? (() => {
                              // Split on the placeholder rather than sprintf() it, so the remedy keeps
                              // its bold — and stays one sentence a translator can reorder.
                              const [before, after] = __(
                                /* translators: %s: the bold remedy, "Enter it as a Goods Receipt" */
                                'No cost basis: this stock would be added uncosted. %s to state its cost, or seed the cost first (Unit cost column).',
                              ).split(/%(?:1\$)?s/);
                              return (
                                <>
                                  {before}
                                  <strong class="font-semibold">
                                    {__('Enter it as a Goods Receipt')}
                                  </strong>
                                  {after}
                                </>
                              );
                            })()
                          : __(
                              "No cost basis: this stock is added uncosted and the movement can't be valued. Seed the cost first (Unit cost column) so it's recorded with a value.",
                            )}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
              <Show when={discoveryOptions().length > 0}>
                <div class="grid gap-1">
                  <span class="text-xs font-semibold uppercase text-text-muted">
                    {__('Discovery context')}
                  </span>
                  <SegmentedControl
                    ariaLabel={__('Discovery context')}
                    disabled={props.pending}
                    options={discoveryOptions()}
                    value={discoveryContext() || null}
                    onChange={(v) => setDiscoveryContext(v)}
                  />
                </div>
              </Show>
            </Show>
            <Show when={reasonRequired() ? dispositionSection() : undefined}>
              {(section) => (
                <label class="grid gap-1">
                  <span class="text-xs font-semibold uppercase text-text-muted">
                    {section().meta?.bulkSaveReason?.label ?? __('Reason')}
                    <RequiredMark />
                  </span>
                  <textarea
                    ref={(el) => {
                      firstReasonRef = el;
                      queueMicrotask(() => {
                        autoGrow(el);
                        el.focus();
                      });
                    }}
                    rows={1}
                    disabled={props.pending}
                    class="resize-none overflow-hidden rounded border border-border bg-surface px-3 py-1.5 text-sm shadow-sm"
                    value={reasons()[section().columnId] ?? ''}
                    onInput={(e) => {
                      autoGrow(e.currentTarget);
                      setReasons((prev) => ({
                        ...prev,
                        [section().columnId]: e.currentTarget.value,
                      }));
                    }}
                  />
                </label>
              )}
            </Show>
          </div>
        </Show>
          </Show>

          {/* The receipt hand-off replaces the correction's own questions: its reason is asked here, once,
              because a receiving session locks it on creation. The units are not booked by this click. */}
          <Show when={receiptStep() && props.receipt}>
            {(offer) => (
              <div
                ref={receiptPanelRef}
                class="space-y-3 rounded border border-border bg-gray-50 p-4"
              >
                <div class="grid gap-1">
                  <span class="text-xs font-semibold uppercase text-text-muted">
                    {__('Why is there more than recorded?')}
                    <RequiredMark />
                  </span>
                  <div
                    role="radiogroup"
                    aria-label={__('Why is there more than recorded?')}
                    class="grid gap-1.5"
                  >
                    <For each={offer().reasons}>
                      {(r) => (
                        <label
                          class="flex items-start gap-2 text-sm"
                          classList={{
                            'cursor-pointer': !r.disabled && !props.pending,
                            'cursor-not-allowed opacity-50': !!r.disabled,
                          }}
                        >
                          <input
                            type="radio"
                            name="receipt-reason"
                            class="mt-1"
                            value={r.value}
                            checked={receiptReason() === r.value}
                            disabled={r.disabled || props.pending}
                            onChange={() => setReceiptReason(r.value)}
                          />
                          <span class="grid">
                            <span class="font-medium text-text">{r.label}</span>
                            <Show when={r.hint}>
                              <span class="text-xs text-text-muted">{r.hint}</span>
                            </Show>
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                </div>
                <p class="text-xs font-medium text-text">
                  {sprintf(
                    _n(
                      '%d increase moves to the receipt.',
                      '%d increases move to the receipt.',
                      stockIncreaseRows().length,
                    ),
                    stockIncreaseRows().length,
                  )}
                  <Show when={totalCount() - stockIncreaseRows().length > 0}>
                    {' '}
                    {sprintf(
                      _n(
                        '%d other pending change stays staged.',
                        '%d other pending changes stay staged.',
                        totalCount() - stockIncreaseRows().length,
                      ),
                      totalCount() - stockIncreaseRows().length,
                    )}
                  </Show>
                </p>
                <p class="text-xs text-text-muted">
                  {__(
                    'A Goods Receipt opens with these on-hand increases. Nothing is booked until you post it there, where you also state what the units cost. The increases are cleared here; any other pending changes stay staged.',
                  )}
                </p>
              </div>
            )}
          </Show>
        </div>

        {/* Governance-change advisories: a fixed band just above the action buttons — always visible,
            independent of the Per-SKU / Per-field tab and of scroll position. */}
        <Show when={(props.governanceNotes?.length ?? 0) > 0}>
          <div class="space-y-2 px-4 pt-4">
            <For each={props.governanceNotes}>
              {(note) => (
                <div
                  class={
                    note.tone === 'danger'
                      ? 'rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800'
                      : 'rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
                  }
                >
                  {note.text}
                </div>
              )}
            </For>
          </div>
        </Show>

        <ModalFooter layout="between">
          {/* One wrapper so the narrow layout can stack: the primary actions first, the destructive
              one last and on its own row, instead of three buttons fighting for a phone's width. */}
          <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Show when={props.onDiscard} fallback={<span />}>
              <Button
                class="order-last self-start whitespace-nowrap sm:order-first"
                variant="danger"
                weight="outline"
                disabled={props.pending}
                onClick={() => props.onDiscard?.()}
              >
                {__('Discard pending edits')}
              </Button>
            </Show>
            <div class="flex flex-wrap justify-end gap-2">
              <Show
                when={receiptStep()}
                fallback={
                  <>
                    <Button variant="secondary" disabled={props.pending} onClick={props.onCancel}>
                      {__('Continue editing')}
                    </Button>
                    {/* With the receipt on offer, Apply steps back: for increases the receipt is the
                        primary route (it asks about cost; a correction never does). */}
                    <Button
                      ref={applyRef}
                      variant={offersReceipt() ? 'secondary' : 'primary'}
                      disabled={cannotApply() || props.pending}
                      onClick={confirm}
                    >
                      {confirmText()}
                    </Button>
                    <Show when={offersReceipt()}>
                      <Button
                        data-testid="correction-enter-as-receipt"
                        disabled={props.pending || (props.receipt?.reasons.length ?? 0) === 0}
                        onClick={() => {
                        setReceiptStep(true);
                        // The reason form sits under the review; on a short screen it opens out of
                        // sight, so scroll to it once it has rendered. Aligned to its TOP: the browser
                        // stops at the bottom of the scroll area, so a short form lands fully in view,
                        // and a form taller than the area still starts at its question.
                        queueMicrotask(() =>
                          receiptPanelRef?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                        );
                      }}
                      >
                        {__('Enter as a Goods Receipt…')}
                      </Button>
                    </Show>
                  </>
                }
              >
                <Button
                  variant="secondary"
                  disabled={props.pending}
                  onClick={() => setReceiptStep(false)}
                >
                  {__('Back')}
                </Button>
                <Button
                  data-testid="correction-open-receipt"
                  disabled={props.pending || receiptReason() === ''}
                  onClick={openReceipt}
                >
                  {__('Open the Goods Receipt')}
                </Button>
              </Show>
            </div>
          </div>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
