import { __, sprintf } from '@invflux/i18n';
import {
  Button,
  COMMON_ALIASES,
  ImportWizard,
  fetchImportAliases,
  learnImportAlias,
  parseImportFile,
  toast,
  type ImportField,
  type MappedRow,
  type ResolvedRow,
} from '@invflux/ui';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { AddPicker, type AddOption } from './AddPicker';
import { prunePatch } from './linePatch';
import { netOfDiscount } from './linePrice';
import { type DraftLinePatch, PoDraftGrid } from './PoDraftGrid';
import { effectiveQty } from './submissionRules';
import type { SupplierProduct, SupplierProductsResponse } from '../suppliers/types';
import type { PoLine, PoLinesResponse } from './types';

interface EditorProps {
  poId: string;
  supplierId: number;
  /** Supplier display/nickname — for the append-row's "all products added" empty state. */
  supplierLabel: string;
  costDecimals: number;
  lines: PoLine[];
}

/**
 * Inline-editable PO line table for a draft, with snappy interactions:
 * - "+ Add" opens a rapid-add picker that *stays open* — clicking a product adds it to the PO
 *   immediately (the row leaves the list, the filter text is kept), so you can click down a list.
 * - qty / cost edit in place (Tab/Enter advance the same column, like the catalogue editor).
 * - add / edit / remove are all **optimistic** (the cached PO detail updates before the round-trip;
 *   a failure re-syncs from the server and toasts), so there's no per-action latency.
 */
export function PoLinesEditor(props: EditorProps): JSX.Element {
  const ctx = useProcurement();
  const api = createApi(ctx);
  const isPro = ctx.hasPro; // supplier-SKU capture (non-key mapping) is Pro
  const queryClient = useQueryClient();
  // The LINES cache, not the order's. The header is fetched separately so it can render before
  // these arrive, so a line write updates the lines entry and leaves the header alone.
  const key = (): [string, string, string, string] => [
    'procurement',
    'purchase-orders',
    props.poId,
    'lines',
  ];

  const [adding, setAdding] = createSignal(false);

  /**
   * The catalogue terms for the products **on this order** — MOQ, case pack, the price an inherited
   * cost displays.
   *
   * Scoped by `po_id` rather than fetched whole: the supplier's catalogue runs to thousands of
   * products and this needs the few dozen on the order. The server does the join, so this goes out
   * in parallel with the lines instead of waiting to learn their subject ids from them.
   */
  const lineCatalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', props.supplierId, 'products', 'po', props.poId],
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${props.supplierId}/products`, {
        po_id: props.poId,
      }),
  }));

  /**
   * The **whole** catalogue, for the add-a-product pickers — they offer what is *not* on the order,
   * so no scoping helps them.
   *
   * Fetched on first use rather than with the page. Most orders are generated and never have a
   * product added by hand, so this was thousands of rows and seconds of waiting that nine times in
   * ten nobody wanted. The pickers open immediately and show that it is loading.
   */
  const [catalogueWanted, setCatalogueWanted] = createSignal(false);
  const fullCatalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', props.supplierId, 'products'],
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${props.supplierId}/products`),
    enabled: catalogueWanted(),
  }));

  const catalogueItem = (subjectId: number): SupplierProduct | undefined =>
    lineCatalogue.data?.products.find((p) => p.subjectId === subjectId);
  const moqFor = (subjectId: number): number | null => catalogueItem(subjectId)?.moq ?? null;
  const casePackFor = (subjectId: number): number | null =>
    catalogueItem(subjectId)?.casePack ?? null;
  // Catalogue unit price — the value a null (inherited) line cost displays faded and freezes to at submit.
  const catalogPriceFor = (subjectId: number): string | null =>
    catalogueItem(subjectId)?.unitPrice ?? null;
  const addOptions = (): AddOption[] => {
    const onPo = new Set(props.lines.map((l) => l.subjectId));
    return (fullCatalogue.data?.products ?? [])
      .filter((p) => !onPo.has(p.subjectId))
      .map((p) => ({
        subjectId: p.subjectId,
        label: null === p.sku ? p.productLabel : `${p.productLabel} · ${p.sku}`,
        unitPrice: p.unitPrice,
      }));
  };

  const setLines = (fn: (lines: PoLine[]) => PoLine[]): void => {
    queryClient.setQueryData<PoLinesResponse>(key(), (old) =>
      old ? { ...old, lines: fn(old.lines) } : old,
    );
  };

  // Optimistic line builder, shared by the toolbar quick-add and the append-row data entry. A temp
  // negative id is replaced by the real row on settle; stock context (available / on-order / post id)
  // is filled by the next refetch.
  let tempId = -1;
  const buildOptimisticLine = (
    subjectId: number,
    label: string,
    qty: number | null,
    unitCost: string | null,
  ): PoLine => {
    const item = catalogueItem(subjectId);
    const effectiveCost = unitCost ?? catalogPriceFor(subjectId); // inherit the catalogue price when unset
    return {
      id: tempId--,
      subjectId,
      postId: null,
      productLabel: item?.productLabel ?? label,
      sku: item?.sku ?? null,
      supplierSku: item?.supplierSku ?? null,
      gtin: item?.gtin ?? null,
      imageUrl: item?.imageUrl ?? null,
      exists: true,
      qtyRequested: qty,
      qtyExpected: null,
      qtyReceived: 0,
      qtyDamagedSoFar: 0,
      qtyClosedShort: 0,
      qtyOpen: qty ?? 0,
      unitCost,
      listUnitCost: null,
      discountPct: null,
      unitCostInvoiced: null,
      qtyInvoiced: 0,
      catalogUnitCost: catalogPriceFor(subjectId),
      lineTotal: null === effectiveCost ? '0' : ((qty ?? 0) * Number(effectiveCost)).toFixed(4),
      available: null,
      onOrder: null,
      lowStockAmount: null,
      suggestedQty: null,
      note: null,
    };
  };

  // Toolbar quick-add: a clicked catalogue product appears immediately, inheriting both figures —
  // quantity from the replenishment suggestion, cost from the catalogue price — each shown faded
  // until overridden, and both frozen at submission. A line starts as "what we would order", not 0.
  const add = createMutation(() => ({
    mutationFn: (o: AddOption) =>
      api.post(`/procurement/purchase-orders/${props.poId}/lines`, {
        subject_id: o.subjectId,
        qty_requested: null,
        unit_cost: null,
      }),
    onMutate: async (o: AddOption) => {
      await queryClient.cancelQueries({ queryKey: key() });
      const prev = queryClient.getQueryData<PoLinesResponse>(key());
      setLines((lines) => [...lines, buildOptimisticLine(o.subjectId, o.label, null, null)]);
      return { prev };
    },
    onError: (_e, _o, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key(), ctx.prev);
      toast.error(__('Could not add the line.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key() }),
  }));

  // Append-row data entry (MS-Access style): the catalogue picker commits a product, the server fills a
  // sensible quantity (replenishment, `auto_qty`); cost is left null → inherits the catalogue price.
  // Deliberately NOT optimistic —
  // we await the POST *and* the authoritative reload (qty + stock context) before resolving, so the grid
  // only drops into the qty editor once the row is fully settled (an optimistic insert + later reload
  // would re-render and kick the editor back to cell-nav mode). Resolves to the new line's id.
  const addDraftLine = async (subjectId: number): Promise<number | null> => {
    try {
      const { line } = await api.post<{ line: PoLine }>(
        `/procurement/purchase-orders/${props.poId}/lines`,
        {
          subject_id: subjectId,
          auto_qty: true,
        },
      );
      await queryClient.invalidateQueries({ queryKey: key() }); // reload with qty + stock context, awaited
      return line.id;
    } catch {
      toast.error(__('Could not add the line.'));
      return null;
    }
  };

  // Remove one or more lines (the grid's right-click "Delete N selected rows"). Optimistic across the
  // whole set, parallel DELETEs, one reconcile. There's no bulk-delete endpoint; the per-line route is
  // fired in parallel and we invalidate once on settle.
  const delMany = createMutation(() => ({
    mutationFn: (ids: number[]) =>
      Promise.all(
        ids.map((id) => api.del(`/procurement/purchase-orders/${props.poId}/lines/${id}`)),
      ),
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: key() });
      const prev = queryClient.getQueryData<PoLinesResponse>(key());
      const idset = new Set(ids);
      setLines((lines) => lines.filter((l) => !idset.has(l.id)));
      return { prev };
    },
    onError: (_e: unknown, _ids: number[], ctx: { prev?: PoLinesResponse } | undefined) => {
      if (ctx?.prev) queryClient.setQueryData(key(), ctx.prev);
      toast.error(__('Could not remove the lines.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key() }),
  }));

  // Apply an immediate-commit patch to a line's optimistic cache row. Mirrors the server's price rules
  // (core `LinePrice`): the typed unit cost is the price before the discount, so retyping it keeps the
  // discount; a discount comes off that price, or the catalogue price on a line still inheriting; the
  // stored unit cost is always the net. The refetch on settle replaces this with the server's answer.
  const applyPatch = (l: PoLine, patch: DraftLinePatch): PoLine => {
    const next: PoLine = { ...l };
    // `in`, not `undefined !==`: a null quantity is a real patch (back to inheriting), not an absent one.
    if ('qty_requested' in patch) next.qtyRequested = patch.qty_requested ?? null;
    if ('unit_cost' in patch || 'discount_pct' in patch) {
      const clearsCost = 'unit_cost' in patch && null === (patch.unit_cost ?? null);
      const pct = 'discount_pct' in patch ? (patch.discount_pct ?? null) : next.discountPct;
      const price =
        'unit_cost' in patch
          ? (patch.unit_cost ?? null)
          : (next.listUnitCost ?? next.unitCost ?? (null === pct ? null : next.catalogUnitCost));
      const net =
        null === pct || null === price ? null : netOfDiscount(price, pct, props.costDecimals);
      if (clearsCost || null === net) {
        next.unitCost = clearsCost ? null : price;
        next.listUnitCost = null;
        next.discountPct = null;
      } else {
        next.unitCost = net;
        next.listUnitCost = price;
        next.discountPct = pct;
      }
    }
    if ('note' in patch) next.note = patch.note ?? null;
    next.lineTotal =
      null === next.unitCost ? null : (effectiveQty(next) * Number(next.unitCost)).toFixed(4);
    return next;
  };

  // Immediate-commit edits, coalesced. Each edit paints its cell at once and joins a pending batch;
  // a short debounce later the batch goes out as ONE request.
  //
  // The batching is not an optimisation, it is what makes a grid-wide gesture survivable: clearing a
  // selected quantity column on a 1700-line draft is one user action, and as a request per line it
  // queued 1700 PATCHes behind the browser's six-per-origin limit and froze the page. Per line the
  // work is also quadratic in re-renders, which is why a bulk gesture paints once (`editLines`)
  // rather than once per cell.
  //
  // Debounced rather than staged, deliberately: a draft PO already has a commitment boundary at
  // numbering, so a second "not saved yet" state would compete with it. The delay is short enough
  // that a save is never something the merchant waits for, and long enough that holding a key down
  // sends one write instead of one per repeat.
  //
  // Deliberately NO invalidate on success. `key()` is the order's key and TanStack matches by prefix,
  // so invalidating it refetches the order AND its activity timeline — three requests for one
  // keystroke, and a visible stall on every cell. A failure still re-syncs from the server, which is
  // where a refetch actually earns its round-trip.
  const FLUSH_DELAY_MS = 120;
  const pending = new Map<number, DraftLinePatch>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  // Captured when the queue goes empty → non-empty: what to restore if the batch is refused.
  let rollbackTo: PoLinesResponse | undefined;

  const editLines = createMutation(() => ({
    mutationFn: (edits: Array<{ id: number; patch: DraftLinePatch }>) =>
      api.patch<{ lines: PoLine[]; rejected: Array<{ id: number; reason: string }> }>(
        `/procurement/purchase-orders/${props.poId}/lines`,
        { edits },
      ),
    onSuccess: ({
      lines,
      rejected,
    }: {
      lines: PoLine[];
      rejected: Array<{ id: number; reason: string }>;
    }) => {
      const settled = new Map(lines.map((l) => [l.id, l]));
      setLines((ls) => ls.map((l) => settled.get(l.id) ?? l));
      rollbackTo = undefined;
      // A line the order no longer carries, or a discount the price model refuses. The rest saved,
      // so the grid is right about them; only the refused rows need re-reading from the server.
      if (rejected.length > 0) {
        toast.error(__('Some lines could not be saved.'));
        void queryClient.invalidateQueries({ queryKey: key() });
      }
    },
    onError: () => {
      if (rollbackTo) queryClient.setQueryData(key(), rollbackTo);
      rollbackTo = undefined;
      toast.error(__('Could not save the lines.'));
      void queryClient.invalidateQueries({ queryKey: key() });
    },
    onSettled: () => {
      inFlight = false;
      // Edits made while the batch was in flight are already painted and still queued; send them.
      if (pending.size > 0) scheduleFlush();
    },
  }));

  const flush = (): void => {
    flushTimer = undefined;
    // One batch at a time: overlapping writes to the same lines could settle out of order, and the
    // later response would put the earlier value back on screen.
    if (inFlight || 0 === pending.size) return;
    const edits = [...pending].map(([id, patch]) => ({ id, patch }));
    pending.clear();
    inFlight = true;
    editLines.mutate(edits);
  };

  const scheduleFlush = (): void => {
    if (undefined !== flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  };

  /** Queue one or more line edits: paint once, then write once. */
  const queueEdits = (edits: Array<{ id: number; patch: DraftLinePatch }>): void => {
    const current = queryClient.getQueryData<PoLinesResponse>(key());
    const byId = new Map((current?.lines ?? []).map((l) => [l.id, l]));

    const real: Array<{ id: number; patch: DraftLinePatch }> = [];
    for (const { id, patch } of edits) {
      const line = byId.get(id);
      const pruned = line ? prunePatch(line, patch) : patch;
      if (null === pruned) continue; // nothing to say about this cell
      real.push({ id, patch: pruned });
    }
    if (0 === real.length) return;

    if (0 === pending.size && !inFlight) rollbackTo = current;
    for (const { id, patch } of real) {
      pending.set(id, { ...(pending.get(id) ?? {}), ...patch });
    }

    // One pass over the rows for the whole gesture — a 1700-cell clear repaints the grid once.
    const patches = new Map(real.map((e) => [e.id, e.patch]));
    setLines((ls) =>
      ls.map((l) => (patches.has(l.id) ? applyPatch(l, patches.get(l.id) as DraftLinePatch) : l)),
    );
    scheduleFlush();
  };

  // Leaving the screen must not drop a write still sitting in the debounce window.
  onCleanup(() => {
    if (undefined !== flushTimer) clearTimeout(flushTimer);
    flush();
  });

  // Bulk paste import (shared ImportWizard). Key candidates first, in priority order; qty required.
  const [importing, setImporting] = createSignal(false);
  // Merchant-taught header aliases (global), fed to the wizard's auto-mapper; "Remember" teaches more.
  const aliasesQuery = createQuery(() => ({
    queryKey: ['procurement', 'import-aliases'],
    queryFn: () => fetchImportAliases(ctx),
    staleTime: 5 * 60 * 1000,
  }));
  const learnAlias = (concept: string, header: string): void => {
    void learnImportAlias(ctx, concept, header)
      .then((map) => queryClient.setQueryData(['procurement', 'import-aliases'], map))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : __('Could not save the alias.')),
      );
  };
  // Preview display formatter for costs — to the supplier's configured decimals; passes through blanks,
  // the delete sentinel, and non-numeric input untouched.
  const fmtCost = (v: string): string =>
    '' === v || '-' === v || Number.isNaN(Number(v)) ? v : Number(v).toFixed(props.costDecimals);
  const importFields: ImportField[] = [
    // Identifiers are match keys. WC's Product SKU is always read-only (key-only). Supplier SKU is a
    // non-key update target at Pro (capture). Barcode/GTIN capture isn't wired yet, so it stays key-only.
    // Built-in aliases from the shared concept dictionary (+ a few PO-specific extras) auto-map common
    // synonym / plural / cross-locale headers. Raw literals, not translated — see COMMON_ALIASES.
    {
      key: 'sku',
      label: __('SKU'),
      aliases: [...COMMON_ALIASES.sku],
      keyCandidate: true,
      keyPriority: 1,
      keyOnly: true,
    },
    {
      key: 'supplier_sku',
      label: __('Supplier SKU'),
      aliases: [...COMMON_ALIASES.supplier_sku],
      keyCandidate: true,
      keyPriority: 2,
      keyOnly: !isPro,
    },
    {
      key: 'gtin',
      label: __('Barcode (GTIN/EAN)'),
      aliases: [...COMMON_ALIASES.gtin],
      keyCandidate: true,
      keyPriority: 3,
      keyOnly: true,
    },
    {
      key: 'qty_requested',
      label: __('Quantity'),
      aliasKey: 'qty',
      aliases: [...COMMON_ALIASES.qty, 'ordered', 'order qty', 'quantité commandée'],
      numeric: true,
    },
    {
      key: 'unit_cost',
      label: __('Unit cost'),
      aliasKey: 'cost',
      aliases: [...COMMON_ALIASES.cost],
      numeric: true,
      format: fmtCost,
    },
    {
      // Taken off the unit cost in the same row. With no discount column mapped, an imported price is
      // the price before the discount a line already carries — the discount stays.
      key: 'discount_pct',
      label: __('Discount %'),
      aliasKey: 'discount',
      aliases: [
        'discount',
        'disc',
        'disc.',
        'disc %',
        'discount %',
        'remise',
        'remise %',
        'rabais',
        'rabatt',
      ],
      numeric: true,
    },
  ];

  /**
   * Resolve pasted rows to WC products by the chosen key (SKU / GTIN) via the batch endpoint, then
   * mark each as new or an update-of-an-existing-line (carrying the current values for the diff). Cost
   * goes into the commit payload only when a cost column was mapped, so an update never wipes a cost.
   */
  const resolveImport = async (rows: MappedRow[], keyField: string): Promise<ResolvedRow[]> => {
    const keys = rows.map((r) => (r[keyField] ?? '').trim()).filter((k) => '' !== k);
    const { resolved } = await api.post<{
      resolved: Record<
        string,
        {
          postId: number | null;
          isVariation: boolean;
          name: string;
          subjectId: number | null;
          supplierSku?: string | null;
        }
      >;
    }>(
      '/procurement/products/resolve',
      // supplier_id is needed for the supplier-SKU key (scoped) and to surface the product's current
      // supplier SKU (so re-importing the same code shows as unchanged, not a green add).
      { keyType: keyField, keys, supplier_id: props.supplierId },
    );
    const lineBySubject = new Map(props.lines.map((l) => [l.subjectId, l]));
    return rows.map((r): ResolvedRow => {
      const k = (r[keyField] ?? '').trim();
      const hit = resolved[k];
      if (!hit) {
        return { key: k, label: k, status: 'unmatched', note: __('No matching product') };
      }
      // Per-cell upsert intent (positive upsert — never destructive by omission):
      //   empty cell → leave the existing value untouched (omit from the payload);
      //   '-'        → intentional delete/clear;
      //   value      → set it.
      const qtyCell = 'qty_requested' in r ? (r.qty_requested ?? '').trim() : undefined;
      const costCell = 'unit_cost' in r ? (r.unit_cost ?? '').trim() : undefined;
      // SKU/GTIN matches carry a WC post (minted on commit); a supplier-SKU match resolves straight to
      // a subject id.
      const data: Record<string, unknown> =
        null !== hit.postId
          ? { post_id: hit.postId, is_variation: hit.isVariation }
          : { subject_id: hit.subjectId };
      if (undefined !== qtyCell && '' !== qtyCell)
        data.qty_requested = '-' === qtyCell ? 0 : Number(qtyCell) || 0;
      if (undefined !== costCell && '' !== costCell)
        data.unit_cost = '-' === costCell ? null : costCell;
      const discountCell = 'discount_pct' in r ? (r.discount_pct ?? '').trim() : undefined;
      if (undefined !== discountCell && '' !== discountCell)
        data.discount_pct = '-' === discountCell ? null : discountCell;
      // Supplier-SKU capture (Pro): a non-key supplier_sku column writes the code onto the product. Sent
      // regardless of tier; the server gates it. '-' clears it.
      const supSkuCell =
        'supplier_sku' in r && 'supplier_sku' !== keyField
          ? (r.supplier_sku ?? '').trim()
          : undefined;
      if (undefined !== supSkuCell && '' !== supSkuCell)
        data.supplier_sku = '-' === supSkuCell ? '' : supSkuCell;

      const existingLine = null !== hit.subjectId ? lineBySubject.get(hit.subjectId) : undefined;
      const result: ResolvedRow = { key: k, label: hit.name || k, status: 'matched', data };
      // Current per-field values for the diff (raw; the wizard formats for display). qty/cost come from
      // an existing PO line; the supplier SKU is the product's current scoped code (independent of the
      // line), so re-importing the same code reads as unchanged rather than a green add.
      const existing: Record<string, string> = {};
      if (existingLine) {
        if ('qty_requested' in r) existing.qty_requested = String(existingLine.qtyRequested);
        // The price before the discount — what an imported price is compared with.
        if ('unit_cost' in r)
          existing.unit_cost = existingLine.listUnitCost ?? existingLine.unitCost ?? '';
        if ('discount_pct' in r) existing.discount_pct = existingLine.discountPct ?? '';
      }
      if ('supplier_sku' in r && 'supplier_sku' !== keyField)
        existing.supplier_sku = hit.supplierSku ?? '';
      if (Object.keys(existing).length > 0) result.existing = existing;
      return result;
    });
  };

  /** Commit the matched rows in one round-trip — the server adds new lines and updates existing ones. */
  const commitImport = async (matched: ResolvedRow[]): Promise<void> => {
    const { added, updated } = await api.post<{ added: number; updated: number }>(
      `/procurement/purchase-orders/${props.poId}/lines/bulk`,
      {
        lines: matched.map((m) => m.data),
      },
    );
    void queryClient.invalidateQueries({ queryKey: key() });
    toast.success(sprintf(__('Import done — %1$d added, %2$d updated.'), added, updated));
  };

  return (
    <div>
      <Show when={importing()}>
        <ImportWizard
          title={__('Import purchase-order lines')}
          fields={importFields}
          onResolve={resolveImport}
          onCommit={commitImport}
          onParseFile={(file) => parseImportFile(ctx, file)}
          learnedAliases={aliasesQuery.data}
          onLearnAlias={learnAlias}
          onClose={() => setImporting(false)}
          importColumnTitle={__('Imported into the purchase order')}
          valueColumnHint={__('Map at least one column to import (e.g. Quantity or Unit cost).')}
        />
      </Show>
      <PoDraftGrid
        lines={props.lines}
        costDecimals={props.costDecimals}
        moqFor={moqFor}
        casePackFor={casePackFor}
        addOptions={addOptions}
        onAddOptionsNeeded={() => setCatalogueWanted(true)}
        addOptionsLoading={() => fullCatalogue.isPending}
        supplierLabel={props.supplierLabel}
        onAddLine={addDraftLine}
        onEdit={(id, patch) => queueEdits([{ id, patch }])}
        onEditMany={(edits) => queueEdits(edits)}
        onRemoveMany={(ids) => delMany.mutate(ids)}
        // Grid chrome shares the filter's row: two control groups, one line, and the rows saved
        // go to the grid. The picker's wrapper keeps `relative` — the dropdown positions against
        // it, so it travels with the button rather than against the old toolbar.
        toolbarEnd={
          <>
            <div class="relative">
              {/* `text-nowrap`: these share a row with the filter now, so a narrow window would
                  otherwise wrap a two-word label onto a second line and make the row taller than
                  the one it replaced. */}
              <Button
                size="sm"
                class="text-nowrap"
                onClick={() => {
                  // Opening the picker is the moment the catalogue is worth fetching.
                  setCatalogueWanted(true);
                  setAdding((a) => !a);
                }}
              >
                {__('+ Add')}
              </Button>
              <Show when={adding()}>
                <AddPicker
                  options={addOptions()}
                  loading={fullCatalogue.isPending}
                  onAdd={(o) => add.mutate(o)}
                  onClose={() => setAdding(false)}
                />
              </Show>
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="text-nowrap"
              onClick={() => setImporting(true)}
            >
              {__('Import / paste')}
            </Button>
          </>
        }
      />
      {/* No total row here: it rides the Activity section's header in `PoDetail`, at the right-hand
          end of a row that already exists. A full-width row holding one number is the vertical
          space the grid's viewport fill is trying to reclaim. */}
    </div>
  );
}
