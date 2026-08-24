import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Button } from './Button';
import { Dynamic } from 'solid-js/web';
import { __, _n, sprintf } from '@invflux/i18n';
import { Modal } from './Modal';
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
  /** Portal the modal to this light-DOM root (shadow-DOM / transformed-ancestor surfaces). */
  mount?: HTMLElement;
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

function formatCellValue(meta: GridColumnMeta | undefined, value: unknown, space: TaxonomySpace | undefined): string {
  const codec = meta ? codecRegistry.resolve(meta.dataType) : null;
  if (codec && meta) return codec.format(value, { config: meta.editorConfig, taxonomySpace: space });
  return value === null || value === undefined ? '' : String(value);
}

export function CorrectionReviewModal(props: CorrectionReviewModalProps): JSX.Element {
  const onHandColumnId = (): string => props.onHandColumnId ?? 'total';
  const isOnHand = (columnId: string): boolean => columnId === onHandColumnId();

  const [reasons, setReasons] = createSignal<Record<string, string>>({});
  const [dispositionNeg, setDispositionNeg] = createSignal('');
  const [dispositionPos, setDispositionPos] = createSignal('');
  const [discoveryContext, setDiscoveryContext] = createSignal('');
  const [showBreakdown, setShowBreakdown] = createSignal(true);
  let firstReasonRef: HTMLTextAreaElement | undefined;
  let scrimRef: HTMLDivElement | undefined;
  let applyRef: HTMLButtonElement | undefined;

  const distinctSubjects = createMemo(() => {
    const ids = new Set<number>();
    for (const g of props.groups) for (const r of g.rows) ids.add(r.subjectId);
    return ids.size;
  });
  // Compact (no tabs) for a single subject × single column — a one-shot correction reads cleaner
  // without the Per-SKU/Per-field switcher. Forceable via the prop.
  const compact = createMemo(() => props.compact ?? (props.groups.length === 1 && distinctSubjects() === 1));
  const onlyStockChange = createMemo(() => props.groups.length === 1 && isOnHand(props.groups[0]?.columnId ?? ''));
  const [activeTab, setActiveTab] = createSignal<'sku' | 'field'>('field');
  createEffect(() => setActiveTab(compact() || onlyStockChange() ? 'field' : 'sku'));

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  /** Per-row cascade (atp→res→ctd) for an on-hand row, computed from its base slots + delta. */
  const cascadeFor = (row: CorrectionReviewRow): SlotDeltas | null => {
    if (!row.onHand || typeof row.delta !== 'number') return null;
    return cascadeAllocate(row.delta, row.onHand.atp, row.onHand.res, row.onHand.ctd, row.onHand.deficit);
  };

  const dispositionSection = createMemo(() => props.groups.find((g) => g.meta?.dispositionOptions != null));
  const negOptions = createMemo(() => dispositionSection()?.meta?.dispositionOptions?.filter((o) => o.sign === 'negative') ?? []);
  const posOptions = createMemo(() => dispositionSection()?.meta?.dispositionOptions?.filter((o) => o.sign === 'positive') ?? []);
  const discoveryOptions = createMemo(() => dispositionSection()?.meta?.discoveryContextOptions ?? []);
  const hasNeg = createMemo(() => (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) < 0));
  const hasPos = createMemo(() => (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) > 0));

  // Boundary warnings: a negative cascade that reaches reserved-in-cart (res) / paid-undispatched (ctd).
  const warnRes = createMemo(() => (dispositionSection()?.rows ?? []).some((r) => (cascadeFor(r)?.res ?? 0) < 0));
  const warnCtd = createMemo(() => (dispositionSection()?.rows ?? []).some((r) => (cascadeFor(r)?.ctd ?? 0) < 0));

  // A3.5: a positive on-hand correction on a subject with NO cost basis adds stock uncosted — the
  // movement can't be valued. Non-blocking nudge to seed the cost first (seed-then-write-in values the
  // movement; write-in-then-seed leaves an uncosted movement + a silent basis change). Positive-delta only.
  const warnUncosted = createMemo(() =>
    (dispositionSection()?.rows ?? []).some((r) => (r.delta ?? 0) > 0 && r.hasCostBasis === false),
  );

  const totalCount = createMemo(() => props.groups.reduce((sum, g) => sum + g.rows.length, 0));
  const reasonSections = createMemo(() => props.groups.filter((g) => g.meta?.bulkSaveReason != null));
  const reasonRequired = createMemo(
    () => dispositionNeg() === 'other_write_off' || dispositionPos() === 'other_write_in' || discoveryContext() === 'other',
  );
  const requiredMissing = createMemo<CorrectionReviewGroup[]>(() => {
    const section = dispositionSection();
    return reasonRequired() && section !== undefined && (reasons()[section.columnId] ?? '').trim() === '' ? [section] : [];
  });
  const dispositionsMissing = createMemo(() => (hasNeg() && dispositionNeg() === '') || (hasPos() && dispositionPos() === ''));
  const cannotApply = createMemo(() => requiredMissing().length > 0 || dispositionsMissing());

  // Single subject in compact mode → caption it by name/sku instead of the "N across M columns" line.
  const singleRow = createMemo<CorrectionReviewRow | null>(() => {
    if (!compact() || distinctSubjects() !== 1) return null;
    for (const g of props.groups) if (g.rows[0]) return g.rows[0];
    return null;
  });

  type SkuCell = { delta?: number; base?: number; result?: number; oldValue?: unknown; newValue?: unknown };
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
      .map((g) => ({ label: g.meta?.bulkSaveReason?.label ?? g.columnId, text: (reasons()[g.columnId] ?? '').trim() }))
      .filter((e) => e.text !== '');
    if (entries.length === 0) return '';
    if (entries.length === 1) return entries[0].text;
    return entries.map((e) => `${e.label}: ${e.text}`).join('\n');
  }

  function confirm(): void {
    if (props.pending) return;
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
    else if (!now && wasPending) queueMicrotask(() => { if (true === applyRef?.isConnected) applyRef.focus(); });
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
      activeTab() === tab ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text'
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
      backdropClass="flex items-center justify-center bg-black/30 p-6"
      label={heading()}
    >
      <div
        class="relative flex max-h-[80vh] w-full max-w-3xl flex-col rounded border border-border bg-surface shadow-xl"
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
        <div class="border-b border-border p-5">
          <h2 class="text-lg font-semibold text-text">{heading()}</h2>
          <Show
            when={singleRow()}
            fallback={
              <p class="text-sm text-text-muted">
                {totalCount()} {__('pending change(s) across')} {props.groups.length}{' '}
                {__('column(s)')}
              </p>
            }
          >
            {(row) => (
              <p class="text-sm text-text-muted">
                {row().name}
                <Show when={row().sku}>
                  {' '}
                  <span class="font-mono text-xs">{row().sku}</span>
                </Show>
              </p>
            )}
          </Show>
        </div>

        {/* Tab switcher: hidden in compact mode (single subject × single column). */}
        <Show when={!compact()}>
          <div class="flex gap-1 border-b border-border px-5 pt-3">
            <button type="button" class={tabBtnClass('sku')} onClick={() => setActiveTab('sku')}>
              {__('Per-SKU')}
            </button>
            <button type="button" class={tabBtnClass('field')} onClick={() => setActiveTab('field')}>
              {__('Per-field')}
            </button>
          </div>
        </Show>

        <div class="flex-1 space-y-5 overflow-auto p-5">
          <Show when={props.error}>
            <p class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{props.error}</p>
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
                        <td class="px-3 py-2 font-mono text-xs text-text-muted">{skuRow.sku || '—'}</td>
                        <td class="px-3 py-2 text-text">{skuRow.name}</td>
                        <For each={props.groups}>
                          {(group) => {
                            const cell = (): SkuCell | undefined => skuRow.cells[group.columnId];
                            return (
                              <td class="px-3 py-2 text-right tabular-nums">
                                <Show when={cell()} fallback={<span class="text-text-muted">—</span>}>
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
                                        <span classList={{ 'text-red-700': c().delta! < 0, 'text-green-700': c().delta! > 0 }}>
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
                const Preview = group.meta ? diffPreviewRegistry.resolve(group.meta.dataType) : null;
                const onHandSection = isOnHand(group.columnId);
                return (
                  <section class="rounded border border-border">
                    <header class="flex items-center justify-between gap-3 border-b border-border bg-gray-50 px-4 py-2">
                      <span class="font-semibold text-text">
                        {onHandSection ? __('On-hand Total') : (group.meta?.label ?? group.columnId)}
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
                              <th class="px-4 py-1.5 text-right font-semibold">{__('Old value')}</th>
                              <th class="px-4 py-1.5 text-right font-semibold">{__('New value')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={group.rows}>
                              {(row) => (
                                <tr class="border-t border-border align-top">
                                  <td class="px-4 py-2 font-mono text-xs text-text-muted">{row.sku || '—'}</td>
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
                      {/* On-hand: SKU · Name · State · Base · Delta · Result, with slot sub-rows. */}
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
                            <th class="px-4 py-1.5 font-semibold">{__('SKU')}</th>
                            <th class="px-4 py-1.5 font-semibold">{__('Name')}</th>
                            <th class="px-4 py-1.5 font-semibold">{__('State')}</th>
                            <th class="px-4 py-1.5 text-right font-semibold">{__('Base')}</th>
                            <th class="px-4 py-1.5 text-right font-semibold">{__('Delta')}</th>
                            <th class="px-4 py-1.5 text-right font-semibold">{__('Result')}</th>
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
                                    <td class="px-4 py-2 font-mono text-xs font-normal text-text-muted">{row.sku || '—'}</td>
                                    <td class="px-4 py-2 text-text">{row.name}</td>
                                    <td class="px-4 py-2 text-text">{__('Total')}</td>
                                    <td class="px-4 py-2 text-right tabular-nums text-text">{base}</td>
                                    <td class={`px-4 py-2 text-right tabular-nums ${deltaClass(delta)}`}>{signedDelta(delta)}</td>
                                    <td class="px-4 py-2 text-right tabular-nums text-text">{base + delta}</td>
                                  </tr>
                                  <Show when={showBreakdown()}>
                                    <For each={SLOT_LABELS}>
                                      {(slot) => {
                                        const slotDelta = (): number => cascade()?.[slot.key] ?? 0;
                                        const slotBase = (): number => row.onHand?.[slot.key] ?? 0;
                                        return (
                                          <Show when={slotDelta() !== 0}>
                                            <tr class="border-t border-border align-top text-text-muted">
                                              <td class="px-4 py-1" />
                                              <td class="px-4 py-1" />
                                              <td class="px-4 py-1 pl-8">{slot.label()}</td>
                                              <td class="px-4 py-1 text-right tabular-nums">{slotBase()}</td>
                                              <td class={`px-4 py-1 text-right tabular-nums ${deltaClass(slotDelta())}`}>
                                                {signedDelta(slotDelta())}
                                              </td>
                                              <td class="px-4 py-1 text-right tabular-nums">{slotBase() + slotDelta()}</td>
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
                          {__("This removes stock that's currently in customers' carts / checkout.")}
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
        </div>

        {/* Shared on-hand controls: disposition (why) → discovery (how) → reason (conditional). */}
        <Show when={dispositionSection() || reasonSections().length > 0}>
          <div class="space-y-4 border-t border-border bg-gray-50 p-5">
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
                    <p class={`text-xs ${dispositionPos() === 'other_write_in' ? 'text-amber-700' : 'text-text-muted'}`}>
                      {__(
                        'Added units are valued at the current average cost — a correction records no purchase cost. For new stock at a specific cost, receive it via a purchase order.',
                      )}
                    </p>
                    <Show when={warnUncosted()}>
                      <div class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {__(
                          "No cost basis: this stock is added uncosted and the movement can't be valued. Seed the cost first (Cost column) so it's recorded with a value.",
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
                      setReasons((prev) => ({ ...prev, [section().columnId]: e.currentTarget.value }));
                    }}
                  />
                </label>
              )}
            </Show>
          </div>
        </Show>

        {/* Governance-change advisories: a fixed band just above the action buttons — always visible,
            independent of the Per-SKU / Per-field tab and of scroll position. */}
        <Show when={(props.governanceNotes?.length ?? 0) > 0}>
          <div class="space-y-2 px-5 pt-4">
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

        <div class="flex items-center justify-between gap-2 border-t border-border p-5">
          <Show when={props.onDiscard} fallback={<span />}>
            <Button
              variant="danger"
              weight="outline"
              disabled={props.pending}
              onClick={() => props.onDiscard?.()}
            >
              {__('Discard pending edits')}
            </Button>
          </Show>
          <div class="flex gap-2">
            <Button
              variant="secondary"
              disabled={props.pending}
              onClick={props.onCancel}
            >
              {__('Continue editing')}
            </Button>
            <Button
              ref={applyRef}
              disabled={cannotApply() || props.pending}
              onClick={confirm}
            >
              {confirmText()}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
