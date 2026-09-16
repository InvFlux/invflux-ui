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
import { createSignal, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { AddPicker, type AddOption } from './AddPicker';
import { netOfDiscount } from './linePrice';
import { type DraftLinePatch, PoDraftGrid } from './PoDraftGrid';
import type { SupplierProduct, SupplierProductsResponse } from '../suppliers/types';
import type { PoLine, PurchaseOrderDetail } from './types';

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
  const key = (): [string, string, string] => ['procurement', 'purchase-orders', props.poId];

  const [adding, setAdding] = createSignal(false);

  const catalogue = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', props.supplierId, 'products'],
    queryFn: () =>
      api.get<SupplierProductsResponse>(`/procurement/suppliers/${props.supplierId}/products`),
  }));
  const catalogueItem = (subjectId: number): SupplierProduct | undefined =>
    catalogue.data?.products.find((p) => p.subjectId === subjectId);
  const moqFor = (subjectId: number): number | null => catalogueItem(subjectId)?.moq ?? null;
  const casePackFor = (subjectId: number): number | null =>
    catalogueItem(subjectId)?.casePack ?? null;
  // Catalogue unit price — the value a null (inherited) line cost displays faded and freezes to at submit.
  const catalogPriceFor = (subjectId: number): string | null =>
    catalogueItem(subjectId)?.unitPrice ?? null;
  const addOptions = (): AddOption[] => {
    const onPo = new Set(props.lines.map((l) => l.subjectId));
    return (catalogue.data?.products ?? [])
      .filter((p) => !onPo.has(p.subjectId))
      .map((p) => ({
        subjectId: p.subjectId,
        label: null === p.sku ? p.productLabel : `${p.productLabel} · ${p.sku}`,
        unitPrice: p.unitPrice,
      }));
  };

  const setLines = (fn: (lines: PoLine[]) => PoLine[]): void => {
    queryClient.setQueryData<PurchaseOrderDetail>(key(), (old) =>
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
    qty: number,
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
      qtyOpen: qty,
      unitCost,
      listUnitCost: null,
      discountPct: null,
      unitCostInvoiced: null,
      qtyInvoiced: 0,
      catalogUnitCost: catalogPriceFor(subjectId),
      lineTotal: null === effectiveCost ? '0' : (qty * Number(effectiveCost)).toFixed(4),
      available: null,
      onOrder: null,
      reorderThreshold: null,
      suggestedQty: null,
      note: null,
    };
  };

  // Toolbar quick-add: a clicked catalogue product appears as a qty-0 line immediately. Cost is left
  // null → it inherits the catalogue price (faded) until overridden, and freezes at submission.
  const add = createMutation(() => ({
    mutationFn: (o: AddOption) =>
      api.post(`/procurement/purchase-orders/${props.poId}/lines`, {
        subject_id: o.subjectId,
        qty_requested: 0,
        unit_cost: null,
      }),
    onMutate: async (o: AddOption) => {
      await queryClient.cancelQueries({ queryKey: key() });
      const prev = queryClient.getQueryData<PurchaseOrderDetail>(key());
      setLines((lines) => [...lines, buildOptimisticLine(o.subjectId, o.label, 0, null)]);
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
      const prev = queryClient.getQueryData<PurchaseOrderDetail>(key());
      const idset = new Set(ids);
      setLines((lines) => lines.filter((l) => !idset.has(l.id)));
      return { prev };
    },
    onError: (_e: unknown, _ids: number[], ctx: { prev?: PurchaseOrderDetail } | undefined) => {
      if (ctx?.prev) queryClient.setQueryData(key(), ctx.prev);
      toast.error(__('Could not remove the lines.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key() }),
  }));

  const grandTotal = (): number =>
    props.lines.reduce((s, l) => s + (null === l.lineTotal ? 0 : Number(l.lineTotal)), 0);

  // Apply an immediate-commit patch to a line's optimistic cache row. Mirrors the server's price rules
  // (core `LinePrice`): the typed unit cost is the price before the discount, so retyping it keeps the
  // discount; a discount comes off that price, or the catalogue price on a line still inheriting; the
  // stored unit cost is always the net. The refetch on settle replaces this with the server's answer.
  const applyPatch = (l: PoLine, patch: DraftLinePatch): PoLine => {
    const next: PoLine = { ...l };
    if (undefined !== patch.qty_requested) next.qtyRequested = patch.qty_requested;
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
      null === next.unitCost ? null : (next.qtyRequested * Number(next.unitCost)).toFixed(4);
    return next;
  };

  // Immediate-commit edit of one line field (qty / unit cost / note) — optimistic, then PATCH.
  const editLine = createMutation(() => ({
    mutationFn: ({ id, patch }: { id: number; patch: DraftLinePatch }) =>
      api.patch(`/procurement/purchase-orders/${props.poId}/lines/${id}`, patch),
    onMutate: async ({ id, patch }: { id: number; patch: DraftLinePatch }) => {
      await queryClient.cancelQueries({ queryKey: key() });
      const prev = queryClient.getQueryData<PurchaseOrderDetail>(key());
      setLines((lines) => lines.map((l) => (l.id === id ? applyPatch(l, patch) : l)));
      return { prev };
    },
    onError: (
      _e: unknown,
      _v: { id: number; patch: DraftLinePatch },
      ctx: { prev?: PurchaseOrderDetail } | undefined,
    ) => {
      if (ctx?.prev) queryClient.setQueryData(key(), ctx.prev);
      toast.error(__('Could not save the line.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key() }),
  }));

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
      <div class="mb-2 flex items-center gap-3">
        <div class="relative">
          <Button size="sm" onClick={() => setAdding((a) => !a)}>
            {__('+ Add')}
          </Button>
          <Show when={adding()}>
            <AddPicker
              options={addOptions()}
              onAdd={(o) => add.mutate(o)}
              onClose={() => setAdding(false)}
            />
          </Show>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
          {__('Import / paste')}
        </Button>
      </div>
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
        supplierLabel={props.supplierLabel}
        onAddLine={addDraftLine}
        onEdit={(id, patch) => editLine.mutate({ id, patch })}
        onRemoveMany={(ids) => delMany.mutate(ids)}
      />
      <Show when={props.lines.length > 0}>
        <div class="mt-2 flex justify-end pr-2 text-sm font-semibold tabular-nums">
          {__('Total')}: {grandTotal().toFixed(props.costDecimals)}
        </div>
      </Show>
    </div>
  );
}
