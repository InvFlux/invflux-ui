import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { iconButtonClass } from './primitives';
import { __, _n, sprintf } from '@invflux/i18n';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';
import { parseSpreadsheetTsv } from './excel-tsv-parser';
import { bestMatch, foldKey } from './fuzzy-match';
import { normalizeAlias } from './import-aliases';
import { MatchSelect } from './MatchSelect';
import { ErrorBanner } from './ErrorBanner';

// Acceptance floor for treating a header→field pairing as an auto-map candidate and rendering it in the
// "matched" group (above the separator + alpha-sorted no-match tail). Exact key/label/alias matches
// score 1.0. Set below the library default (0.5) because header vocabulary benefits from surfacing more
// plausible partials — the operator still reviews, and the % + colour signal low-confidence ones.
const MATCH_THRESHOLD = 0.4;

/** A target field a pasted column can be mapped to. */
export interface ImportField {
  /** Stable field key the mapped value is emitted under (e.g. 'qty', 'unit_cost', 'sku'). */
  key: string;
  label: string;
  /** Must be mapped before the user can continue. */
  required?: boolean;
  /** Extra header labels this column also auto-maps from, for headers the label can't cover — e.g. a
   *  supplier document's "Confirmed" / "Confirmé" mapping to an "Expected" field (the same quantity named
   *  from the seller's side of the deal, not a synonym), or plural / cross-locale variants ("Qty", "Qté",
   *  "Menge"). Matched case-, accent-, and spacing-insensitively; listed as raw literals (NOT wrapped in
   *  `__()`) so a foreign-language document still matches under any UI locale. */
  aliases?: string[];
  /** Concept id under which *learned* aliases are stored and merged — shared across surfaces so teaching
   *  a SKU / cost header once applies everywhere that column appears. Defaults to {@link key}. Set it to
   *  a shared concept (`cost`, `qty`) for cross-surface fields, or keep a distinct one (`expected`) where
   *  learning must NOT leak (a supplier's "Confirmed" → Expected must not touch a draft's ordered qty). */
  aliasKey?: string;
  /** Eligible as the row-matching key (SKU / supplier-SKU / barcode). */
  keyCandidate?: boolean;
  /** Auto-pick order among mapped key candidates — lower wins (SKU < sup-SKU < barcode). */
  keyPriority?: number;
  /** Not selectable (e.g. a fully-Pro field at Essentials) — rendered as a disabled option. */
  disabled?: boolean;
  /** An identifier you match on but never update (e.g. WC SKU; supplier SKU / barcode at Essentials). It can
   *  only be the match key — when mapped but not the active key it contributes no value (no Import mark). */
  keyOnly?: boolean;
  /** Right-align this column's value cells in the preview (numeric data — qty, cost). */
  numeric?: boolean;
  /** Format a value for display in the preview (e.g. a cost to the supplier's decimals). Comparison still
   *  runs on the raw value, so formatting never affects the changed/unchanged decision. */
  format?: (value: string) => string;
}

/** One parsed data row, keyed by the target field it was mapped to. */
export type MappedRow = Record<string, string>;

export type ImportRowStatus = 'matched' | 'unmatched' | 'ambiguous';

/** A resolved row the host hands back from {@link ImportWizardProps.onResolve}. */
export interface ResolvedRow {
  /** The key value used to match (echoed in the preview). */
  key: string;
  /** Display label — the resolved name when matched, else the raw key. */
  label: string;
  status: ImportRowStatus;
  /** Host payload carried to {@link ImportWizardProps.onCommit} for matched rows. */
  data?: unknown;
  /** Optional hint shown in the preview (e.g. why a row is unmatched/ambiguous). */
  note?: string;
  /**
   * Current value per mapped field key — drives the preview's per-column diff (old vs new), decided
   * per field: a non-empty current value shows the unchanged/changed diff; an empty/absent one shows the
   * pasted value as a plain addition. Set a field here whenever the host knows its current value (an
   * existing PO line's qty/cost, a product's current supplier SKU), independently of the other fields.
   */
  existing?: Record<string, string>;
}

export interface ImportWizardProps {
  title: string;
  /** The columns the host accepts, in display order. */
  fields: ImportField[];
  /** Resolve the mapped rows against the host catalogue, keyed on the chosen `keyField`. */
  onResolve: (rows: MappedRow[], keyField: string) => Promise<ResolvedRow[]>;
  /** Commit the matched rows — the host creates the records, then this wizard closes. */
  onCommit: (matched: ResolvedRow[]) => void | Promise<void>;
  onClose: () => void;
  /** Override the commit-button label given the add/update breakdown. Default is precise on its own. */
  commitLabel?: (counts: { added: number; updated: number }) => string;
  /** Tooltip on the read-only "Import" indicator (what the value columns flow into). Host-specific
   *  noun — defaults to a generic phrasing. */
  importColumnTitle?: string;
  /** Amber hint shown when no value column is mapped yet. Defaults to a generic prompt; hosts can name
   *  their own value columns (e.g. "Quantity or Unit cost"). */
  valueColumnHint?: string;
  /** Require at least one value (non-key, non-key-only) column before continuing. Default true (a PO
   *  line needs qty/cost). Set false where the key alone is a valid record (a catalogue link with no
   *  terms). */
  requireValueColumn?: boolean;
  /** Optional server-side file parse: a picked CSV / TSV / XLSX → the same row grid a clipboard paste
   *  produces. When provided, a "Choose file" control appears next to the paste box; the host owns the
   *  upload transport (endpoint + nonce) so the wizard stays SPA-agnostic and ships no file parser.
   *  Omit to keep the wizard paste-only. */
  onParseFile?: (file: File) => Promise<string[][]>;
  /** Merchant-taught aliases keyed by concept ({@link ImportField.aliasKey}), merged into auto-mapping on
   *  top of the built-in {@link ImportField.aliases}. The host fetches these; omit for none. */
  learnedAliases?: Record<string, string[]>;
  /** Persist a newly-taught header → concept mapping. When set (and a column is manually mapped to a
   *  field its header didn't already match), a "Remember" affordance appears on that row. */
  onLearnAlias?: (concept: string, header: string) => void;
}

// Comparison key (accent-fold + lowercase + alnum-only) — shared with the fuzzy-match scorer.
const norm = foldKey;

/** Equal for diffing: exact for text, but numeric values compare by value ("220.00" === "220"). */
const sameValue = (a: string, b: string): boolean => {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return '' !== a && '' !== b && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};

/**
 * Shared paste → map → resolve → preview → commit import wizard. SPA-agnostic: the host supplies the
 * target {@link ImportField}s, an `onResolve` that turns mapped rows into {@link ResolvedRow}s against
 * its own catalogue (Procurement → subjects, Workbench → products), and an `onCommit`. The wizard owns
 * the clipboard-TSV paste + parse, the column-mapping grid with inline key selection (padlock,
 * auto-priority SKU→sup-SKU→barcode), and the match preview.
 */
export function ImportWizard(props: ImportWizardProps): JSX.Element {
  const [raw, setRaw] = createSignal('');
  const [hasHeader, setHasHeader] = createSignal(true);
  const [mapping, setMapping] = createSignal<(string | null)[]>([]);
  const [keyColumn, setKeyColumn] = createSignal<number | null>(null);
  const [step, setStep] = createSignal<'map' | 'preview'>('map');
  const [busy, setBusy] = createSignal(false);
  // A server-parsed file overrides the paste box: its grid feeds the exact same map → resolve → commit
  // pipeline. Null means "use the pasted text"; typing in the paste box clears it back to null.
  const [fileGrid, setFileGrid] = createSignal<string[][] | null>(null);
  const [fileName, setFileName] = createSignal<string | null>(null);
  const [loadingFile, setLoadingFile] = createSignal(false);
  // Drop this many leading lines before the header — for workbook exports that carry title/blank rows
  // above the table (a clipboard paste usually selects the header precisely, so it defaults to 0).
  const [skipRows, setSkipRows] = createSignal(0);

  // Multi-step progress line under the title — "Step N/M: <what this step is for>".
  const STEP_ORDER = ['map', 'preview'] as const;
  const stepLabel = createMemo<string>(() => {
    const titles: Record<(typeof STEP_ORDER)[number], string> = {
      map: __('Map columns'),
      preview: __('Review & import'),
    };
    const current = step();
    return sprintf(
      __('Step %1$d/%2$d: %3$s'),
      STEP_ORDER.indexOf(current) + 1,
      STEP_ORDER.length,
      titles[current],
    );
  });
  const [error, setError] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<ResolvedRow[]>([]);

  // Land focus on the paste box so the merchant can paste immediately (Ctrl/Cmd+V) on open.
  let pasteRef: HTMLTextAreaElement | undefined;
  onMount(() => pasteRef?.focus());

  const grid = createMemo(() => fileGrid() ?? parseSpreadsheetTsv(raw()).rows);
  const parseErrors = createMemo(() =>
    null !== fileGrid() ? [] : parseSpreadsheetTsv(raw()).errors,
  );
  // The raw grid's line count — drives the skip control's ceiling and keeps it visible even when the
  // skip would (temporarily) empty the trimmed grid, so the user can always dial it back down.
  const rawCount = createMemo(() => grid().length);
  // The grid the mapping/preview actually work on, after dropping the skipped leading lines.
  const rows = createMemo(() => {
    const s = Math.min(Math.max(0, skipRows()), grid().length);
    return s > 0 ? grid().slice(s) : grid();
  });

  // A picked file is parsed server-side (host-supplied transport) into the same grid shape as a paste.
  const onPickFile = async (file: File): Promise<void> => {
    const parse = props.onParseFile;
    if (!parse) return;
    setError(null);
    setLoadingFile(true);
    try {
      const parsed = await parse(file);
      setRaw('');
      setFileGrid(parsed);
      setFileName(file.name);
      setHasHeader(true);
      setManualCols(new Set<number>());
      // Land the skip on the detected header row so a workbook's title/blank preamble is dropped without
      // the user counting rows by hand. They can still adjust it.
      setSkipRows(detectHeaderSkip(parsed));
    } catch (e) {
      setFileGrid(null);
      setFileName(null);
      setError(e instanceof Error ? e.message : __('Could not read that file.'));
    } finally {
      setLoadingFile(false);
    }
  };
  const colCount = createMemo(() => rows().reduce((m, r) => Math.max(m, r.length), 0));
  const headers = createMemo<string[]>(() => {
    const first = hasHeader() ? rows()[0] : undefined;
    return Array.from({ length: colCount() }, (_, i) => {
      const h = first?.[i]?.trim();
      return h ? h : sprintf(__('Column %d'), i + 1);
    });
  });
  const dataRows = createMemo(() => (hasHeader() ? rows().slice(1) : rows()));

  const fieldByKey = (k: string | null): ImportField | undefined =>
    k ? props.fields.find((f) => f.key === k) : undefined;

  // Aliases the merchant has taught this session (optimistic), merged over the host-fetched map so a
  // just-remembered header stops offering "Remember" and auto-maps immediately.
  const [sessionLearned, setSessionLearned] = createSignal<Record<string, string[]>>({});
  // Columns the user re-mapped by hand — the only ones offered a "Remember" affordance (an auto-mapped
  // column already matches, so there's nothing to teach).
  const [manualCols, setManualCols] = createSignal<Set<number>>(new Set());
  const conceptOf = (f: ImportField): string => f.aliasKey ?? f.key;
  const learnedFor = (f: ImportField): string[] => [
    ...(props.learnedAliases?.[conceptOf(f)] ?? []),
    ...(sessionLearned()[conceptOf(f)] ?? []),
  ];

  // The header labels a field matches from: its key, its (translated) label, host-supplied built-in
  // aliases, and any merchant-taught (learned) aliases for its concept. Raw (unfolded) — the scorer
  // tokenises them, so word boundaries must survive.
  const fieldTargets = (f: ImportField): string[] =>
    [f.key, f.label, ...(f.aliases ?? []), ...learnedFor(f)].filter((t) => '' !== t.trim());

  // A header→field match: its best score (0–1) across the field's targets and the folded length of the
  // winning target (specificity — a longer matched alias is more specific, breaks score ties).
  const scoreField = (header: string, f: ImportField): { score: number; spec: number } => {
    const bm = bestMatch(header, fieldTargets(f));
    return { score: bm.score, spec: norm(bm.matched).length };
  };

  // Is the header already an EXACT target of the field (nothing to teach — hides "Remember")?
  const hasExactTarget = (f: ImportField, header: string): boolean => {
    const h = norm(header);
    return '' !== h && fieldTargets(f).some((t) => norm(t) === h);
  };

  // Match a row of header cells to fields — the single source of truth shared by the column auto-mapper
  // and the header-row auto-detector. Each (column, field) pair is scored (symmetric fuzzy match against
  // the field's best alias); candidates clearing MATCH_THRESHOLD are assigned by one global greedy pass,
  // ordered by (score desc, then specificity desc). Because the score is length-aware, a generic "Qty"
  // scores low against a specific "confirmed qty" alias and won't steal Expected from a "Confirmed qty"
  // column; and when two headers each hit a full 1.0 via their own exact alias, the longer (more specific)
  // matched alias wins the field. A column maps to one field, a field to one column.
  const mapCellsToFields = (cells: string[]): (string | null)[] => {
    const result: (string | null)[] = cells.map(() => null);

    const candidates: Array<{ col: number; fieldKey: string; score: number; spec: number }> = [];
    cells.forEach((cell, col) => {
      const header = (cell ?? '').trim();
      if ('' === norm(header)) return;
      for (const f of props.fields) {
        const { score, spec } = scoreField(header, f);
        if (score >= MATCH_THRESHOLD) candidates.push({ col, fieldKey: f.key, score, spec });
      }
    });

    candidates.sort((a, b) => b.score - a.score || b.spec - a.spec);
    const used = new Set<string>();
    for (const c of candidates) {
      if (null !== result[c.col] || used.has(c.fieldKey)) continue;
      result[c.col] = c.fieldKey;
      used.add(c.fieldKey);
    }

    return result;
  };

  const autoKeyColumn = (map: (string | null)[]): number | null => {
    const cands = map.map((k, i) => ({ i, f: fieldByKey(k) })).filter((c) => c.f?.keyCandidate);
    if (0 === cands.length) return null;
    cands.sort((a, b) => (a.f?.keyPriority ?? 99) - (b.f?.keyPriority ?? 99));
    return cands[0].i;
  };

  // Scan the first ~30 lines of a freshly-loaded grid and pick the line that most looks like a header
  // (most cells matching a field). Returns the skip count that lands on it — 0 when nothing matches, so
  // a headerless / unrecognised sheet is left untouched. Best line wins ties (headers precede data).
  const detectHeaderSkip = (g: string[][]): number => {
    const limit = Math.min(30, g.length);
    let bestIdx = 0;
    let bestScore = 0;
    for (let i = 0; i < limit; i++) {
      const score = mapCellsToFields(g[i] ?? []).filter(Boolean).length;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestScore > 0 ? bestIdx : 0;
  };

  // Re-derive the mapping whenever the parsed shape (or the alias sets that feed matching) changes:
  // auto-match each header to a field, but PRESERVE any column the user mapped by hand — otherwise a
  // later alias load, or clicking "Remember" (which mutates the learned set this effect tracks), would
  // wipe the operator's manual mappings. Manual state + the current mapping are read untracked so this
  // never self-triggers. A fresh parse resets manualCols, so a new grid re-derives fully.
  createEffect(() => {
    const n = colCount();
    const hdrs = headers();
    const auto = mapCellsToFields(hdrs).slice(0, n);
    const manual = untrack(manualCols);
    const current = untrack(mapping);
    const map = auto.map((k, i) => (manual.has(i) ? (current[i] ?? k) : k));
    setMapping(map);
    setKeyColumn(autoKeyColumn(map));
  });

  const keyCandidateCols = createMemo(() =>
    mapping()
      .map((k, i) => ({ k, i }))
      .filter((c) => fieldByKey(c.k)?.keyCandidate)
      .map((c) => c.i),
  );
  // The chosen key, falling back to the priority auto-pick when the chosen column is no longer valid.
  const effectiveKeyCol = createMemo<number | null>(() => {
    const cands = keyCandidateCols();
    if (0 === cands.length) return null;
    const k = keyColumn();
    return null !== k && cands.includes(k) ? k : autoKeyColumn(mapping());
  });
  const keyField = (): string | null => {
    const c = effectiveKeyCol();
    return null === c ? null : mapping()[c];
  };
  // Value columns = mapped fields that aren't the key and aren't key-only (qty, cost, and — at Pro —
  // supplier SKU / barcode used as update targets). Key-only non-key columns contribute no value.
  const valueFields = createMemo<ImportField[]>(() => {
    const kf = keyField();
    return props.fields.filter((f) => f.key !== kf && !f.keyOnly && mapping().includes(f.key));
  });

  const setColMap = (col: number, fieldKey: string | null): void => {
    setMapping((m) => {
      const next = [...m];
      // A field maps to at most one column — clear any other column holding it.
      if (null !== fieldKey)
        next.forEach((v, i) => {
          if (v === fieldKey && i !== col) next[i] = null;
        });
      next[col] = fieldKey;
      return next;
    });
  };

  // A hand-made mapping: remember it, and mark the column so a "Remember" affordance can offer to teach
  // the header for next time (only if it isn't already a known target — an auto-match teaches nothing).
  const onUserMap = (col: number, fieldKey: string | null): void => {
    setColMap(col, fieldKey);
    setManualCols((s) => new Set(s).add(col));
  };

  // The header a mapped column could teach, or null when there's nothing to learn. Offered whenever the
  // column is mapped to a field the header ISN'T already an exact target of — i.e. a hand-remap OR a
  // fuzzy/partial auto-match. Clicking "Remember" promotes that inexact match to an exact learned alias.
  const learnableFor = (
    col: number,
  ): { concept: string; header: string; fieldLabel: string } | null => {
    if (!props.onLearnAlias) return null;
    const f = fieldByKey(mapping()[col]);
    const header = (headers()[col] ?? '').trim();
    if (!f || '' === header || hasExactTarget(f, header)) return null;
    return { concept: conceptOf(f), header, fieldLabel: f.label };
  };

  const rememberAlias = (col: number): void => {
    const learn = learnableFor(col);
    if (!learn) return;
    // Normalize before persisting (lowercase / de-accent / keep word boundaries) — the canonical form the
    // Settings CSV also stores. foldKey collapses this back to the header's compare key, so it auto-maps.
    const alias = normalizeAlias(learn.header);
    if ('' === alias) return;
    props.onLearnAlias?.(learn.concept, alias);
    // Apply optimistically so the row's "Remember" disappears and the header auto-maps from now on.
    setSessionLearned((prev) => ({
      ...prev,
      [learn.concept]: [...(prev[learn.concept] ?? []), alias],
    }));
    setManualCols((s) => {
      const next = new Set(s);
      next.delete(col);
      return next;
    });
  };

  // Key-icon click: activate this candidate (radio — deactivates the others). Clicking the active key
  // switches the key to the next-priority other candidate, if any (a key is required, so the last one
  // stays). Non-active key-candidate columns remain mapped as switchable alternatives.
  const toggleKey = (col: number): void => {
    if (effectiveKeyCol() !== col) {
      setKeyColumn(col);
      return;
    }
    const others = keyCandidateCols().filter((c) => c !== col);
    if (0 === others.length) return;
    others.sort(
      (a, b) =>
        (fieldByKey(mapping()[a])?.keyPriority ?? 99) -
        (fieldByKey(mapping()[b])?.keyPriority ?? 99),
    );
    setKeyColumn(others[0]);
  };

  // The MatchSelect options for a column's "Maps to" picker — each field with its alias targets, so the
  // component scores/ranks/colours them against the header. Reactive (learned aliases feed fieldTargets).
  const fieldOptions = (): Array<{
    value: string;
    label: string;
    targets: string[];
    disabled?: boolean;
  }> =>
    props.fields.map((f) => ({
      value: f.key,
      label: f.label,
      targets: fieldTargets(f),
      disabled: f.disabled,
    }));

  // A column is "imported" (an update target) when it's mapped to a non-key-only field and isn't the
  // active key — i.e. the value columns (qty / cost; supplier SKU / barcode at Pro). Drives the Import
  // column's derived indicator.
  const isImportCol = (col: number): boolean => {
    const f = fieldByKey(mapping()[col]);
    return !!f && !f.keyOnly && effectiveKeyCol() !== col;
  };

  const mappedRows = createMemo<MappedRow[]>(() =>
    dataRows()
      .map((row) => {
        const obj: MappedRow = {};
        mapping().forEach((fk, i) => {
          if (fk) obj[fk] = (row[i] ?? '').trim();
        });
        return obj;
      })
      // Drop rows with no key value — blank/trailing lines.
      .filter((o) => {
        const kf = keyField();
        return null !== kf && '' !== (o[kf] ?? '');
      }),
  );

  const requiredMissing = createMemo(() =>
    props.fields.filter((f) => f.required && !mapping().includes(f.key)).map((f) => f.label),
  );
  // At least one value column is needed to upsert (qty OR cost OR …); cost and quantity can legitimately
  // arrive from separate sources / separate imports.
  const upsertableMappedCount = createMemo(() => valueFields().length);
  const needsValueColumn = (): boolean => false !== props.requireValueColumn;
  const canContinue = createMemo(
    () =>
      mappedRows().length > 0 &&
      null !== keyField() &&
      0 === requiredMissing().length &&
      (!needsValueColumn() || upsertableMappedCount() > 0),
  );

  const matched = createMemo(() => results().filter((r) => 'matched' === r.status));
  // Columns shown in the preview table: the key field first (row header), then the value columns.
  // Paired with results() by index (onResolve returns one row per input row, in order).
  const previewFields = createMemo<ImportField[]>(() => {
    const keyDef = props.fields.find((f) => f.key === keyField());
    return keyDef ? [keyDef, ...valueFields()] : valueFields();
  });

  const doResolve = async (): Promise<void> => {
    const kf = keyField();
    if (null === kf) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await props.onResolve(mappedRows(), kf));
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : __('Could not match the pasted rows.'));
    } finally {
      setBusy(false);
    }
  };

  // Per matched row: 'add' (new line), 'update' (existing line with a real change), or 'none' (already
  // in sync). Mirrors the per-cell preview logic so the count matches what's shown.
  const rowOutcome = (r: ResolvedRow, row: MappedRow): 'add' | 'update' | 'none' => {
    if ('matched' !== r.status) return 'none';
    if (!r.existing) return 'add';
    const ex = r.existing;
    const changed = previewFields()
      .slice(1)
      .some((f) => {
        const nw = row[f.key] ?? '';
        if ('' === nw) return false; // empty → leave as is
        if ('-' === nw) return '' !== (ex[f.key] ?? ''); // delete → change only if there was a value
        return !sameValue(nw, ex[f.key] ?? ''); // set → change if it differs
      });
    return changed ? 'update' : 'none';
  };
  const outcomes = createMemo(() => results().map((r, i) => rowOutcome(r, mappedRows()[i] ?? {})));
  const addCount = createMemo(() => outcomes().filter((o) => 'add' === o).length);
  const updateCount = createMemo(() => outcomes().filter((o) => 'update' === o).length);
  const hasChanges = createMemo(() => addCount() + updateCount() > 0);

  const doCommit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Only the rows that actually add or change something — a re-import of identical data is a no-op.
      await props.onCommit(results().filter((_r, i) => 'none' !== outcomes()[i]));
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : __('Could not import the rows.'));
      setBusy(false);
    }
  };

  const commitLabel = (): string => {
    const added = addCount();
    const updated = updateCount();
    if (props.commitLabel) return props.commitLabel({ added, updated });
    if (0 === added && 0 === updated) return __('Nothing to import ✓');
    if (added > 0 && updated > 0) return sprintf(__('Add %1$d, update %2$d'), added, updated);
    if (updated > 0) return sprintf(_n('Update %d line', 'Update %d lines', updated), updated);
    return sprintf(_n('Add %d line', 'Add %d lines', added), added);
  };

  return (
    <Modal onClose={props.onClose} closeOnBackdrop={false} align="top" label={props.title}>
      <ModalPanel size="3xl" class="mt-10">
        <ModalHeader
          title={props.title}
          subtitle={stepLabel()}
          actions={
            <IconButton size="sm" label={__('Close')} onClick={props.onClose}>
              ✕
            </IconButton>
          }
        />

        <div class="flex-1 overflow-y-auto p-4 text-sm text-text">
          <Show when={'map' === step()}>
            <div class="flex items-baseline justify-between">
              <label class="block font-medium text-text">
                {__('Paste rows from a spreadsheet')}
              </label>
              <Show when={undefined !== props.onParseFile}>
                <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                  <input
                    type="file"
                    class="sr-only"
                    accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={loadingFile()}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      // Reset so re-picking the same file fires onChange again.
                      e.currentTarget.value = '';
                      if (file) void onPickFile(file);
                    }}
                  />
                  {loadingFile() ? __('Reading file…') : __('…or choose a file (CSV / Excel)')}
                </label>
              </Show>
            </div>
            <textarea
              ref={pasteRef}
              class="mt-1 h-28 w-full rounded border border-border bg-surface p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={__('Copy a cell range from Excel / Google Sheets and paste here…')}
              value={raw()}
              onInput={(e) => {
                setFileGrid(null);
                setFileName(null);
                setSkipRows(0);
                setManualCols(new Set<number>());
                setRaw(e.currentTarget.value);
              }}
            />
            <Show when={null !== fileName()}>
              <p class="mt-1 text-xs text-text-muted">
                {sprintf(
                  __('Loaded from %s — edit above to switch back to pasted text.'),
                  fileName() ?? '',
                )}
              </p>
            </Show>
            <Show when={parseErrors().length > 0}>
              <p class="mt-1 text-xs text-amber-700">{parseErrors().join(' ')}</p>
            </Show>

            <Show when={rawCount() > 0}>
              <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <label class="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    class="rounded border-border"
                    checked={hasHeader()}
                    onChange={() => setHasHeader((v) => !v)}
                  />
                  {__('First row is a header')}
                </label>
                <label class="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  {__('Skip first')}
                  <input
                    type="number"
                    min="0"
                    max={rawCount()}
                    class="w-14 rounded border border-border bg-surface px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={skipRows()}
                    onInput={(e) =>
                      setSkipRows(Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)))
                    }
                  />
                  {_n('line', 'lines', skipRows())}
                </label>
              </div>

              <Show when={0 === colCount()}>
                <p class="mt-2 text-xs text-amber-700">
                  {__('All rows are skipped — reduce the skip count.')}
                </p>
              </Show>

              <table class="mt-2 w-full border-collapse">
                <thead>
                  <tr class="text-left text-xs text-text-muted">
                    <th class="border-b border-border py-1 pr-3 font-normal">{__('Column')}</th>
                    <th class="border-b border-border py-1 pr-3 font-normal">{__('Sample')}</th>
                    <th class="border-b border-border py-1 pr-3 font-normal">{__('Maps to')}</th>
                    <th class="border-b border-border py-1 pr-3 font-normal">{__('Key')}</th>
                    <th class="border-b border-border py-1 font-normal">{__('Import')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={Array.from({ length: colCount() }, (_, i) => i)}>
                    {(i) => (
                      <tr>
                        <td class="border-b border-border py-1 pr-3 font-medium">{headers()[i]}</td>
                        <td class="border-b border-border py-1 pr-3 text-text-muted">
                          {(dataRows()[0]?.[i] ?? '').trim() || '—'}
                        </td>
                        <td class="border-b border-border py-1 pr-3">
                          <MatchSelect
                            query={headers()[i] ?? ''}
                            options={fieldOptions()}
                            value={mapping()[i] ?? null}
                            onChange={(v) => onUserMap(i, v)}
                            threshold={MATCH_THRESHOLD}
                            placeholder={__('— ignore —')}
                            ariaLabel={__('Map column to field')}
                            matchedLabel={__('Suggested')}
                            otherLabel={__('Other fields')}
                            scoreTitle={__('Match confidence')}
                          />
                          <Show when={learnableFor(i)}>
                            {(learn) => (
                              <Button
                                variant="link"
                                size="xs"
                                class="mt-1 text-left"
                                title={__('Auto-map this header to this field on future imports')}
                                onClick={() => rememberAlias(i)}
                              >
                                {sprintf(__('Remember “%s”'), learn().fieldLabel)}{' '}
                                <span class="text-text-muted">
                                  {sprintf(__('↔ “%s”'), learn().header)}
                                </span>
                              </Button>
                            )}
                          </Show>
                        </td>
                        <td class="border-b border-border py-1">
                          <Show when={keyCandidateCols().includes(i)}>
                            <button
                              type="button"
                              class={iconButtonClass('xs', false, 'hover:bg-transparent')}
                              classList={{
                                'text-primary': effectiveKeyCol() === i,
                                'text-gray-300 hover:text-gray-500': effectiveKeyCol() !== i,
                              }}
                              title={
                                effectiveKeyCol() === i
                                  ? __('Matching on this column (click to switch away)')
                                  : __('Use this column to match')
                              }
                              aria-pressed={effectiveKeyCol() === i}
                              onClick={() => toggleKey(i)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                class="h-4 w-4"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                                />
                              </svg>
                            </button>
                          </Show>
                        </td>
                        {/* Import: derived, read-only — marks columns whose values get imported (value/update columns). */}
                        <td class="border-b border-border py-1">
                          <Show when={isImportCol(i)}>
                            <span
                              class="text-primary"
                              title={props.importColumnTitle ?? __('This column is imported')}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                class="h-4 w-4"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                                />
                              </svg>
                            </span>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>

              <Show when={requiredMissing().length > 0}>
                <p class="mt-2 text-xs text-amber-700">
                  {sprintf(__('Map the required column(s): %s'), requiredMissing().join(', '))}
                </p>
              </Show>
              <Show when={null === keyField()}>
                <p class="mt-2 text-xs text-amber-700">
                  {__('Map a key column (SKU / supplier SKU / barcode) to match products.')}
                </p>
              </Show>
              <Show
                when={needsValueColumn() && null !== keyField() && 0 === upsertableMappedCount()}
              >
                <p class="mt-2 text-xs text-amber-700">
                  {props.valueColumnHint ?? __('Map at least one column to import.')}
                </p>
              </Show>
            </Show>
          </Show>

          <Show when={'preview' === step()}>
            <p class="font-medium text-text">
              {sprintf(__('%1$d of %2$d rows matched.'), matched().length, results().length)}
            </p>
            <table class="mt-2 w-full border-collapse">
              <thead>
                <tr class="text-left text-xs text-text-muted">
                  <th class="border-b border-border py-1 pr-2 font-normal" />
                  <th class="border-b border-border py-1 pr-3 font-normal">
                    {previewFields()[0]?.label}
                  </th>
                  <th class="border-b border-border py-1 pr-3 font-normal">
                    {__('Matched product')}
                  </th>
                  <For each={previewFields().slice(1)}>
                    {(f) => (
                      <th
                        class="border-b border-border py-1 pr-3 font-normal"
                        classList={{ 'text-right': f.numeric }}
                      >
                        {f.label}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={results()}>
                  {(r, i) => {
                    const row = (): MappedRow => mappedRows()[i()] ?? {};
                    return (
                      <tr classList={{ 'opacity-60': 'matched' !== r.status }}>
                        <td class="border-b border-border py-1 pr-2 align-top">
                          <span
                            classList={{
                              'text-green-600': 'matched' === r.status,
                              'text-red-600': 'unmatched' === r.status,
                              'text-amber-600': 'ambiguous' === r.status,
                            }}
                          >
                            {'matched' === r.status ? '✓' : 'unmatched' === r.status ? '✕' : '?'}
                          </span>
                        </td>
                        {/* Key column (row header) — the matched value, shown plain. */}
                        <td class="border-b border-border py-1 pr-3 align-top font-medium">
                          {row()[previewFields()[0]?.key ?? ''] ?? ''}
                        </td>
                        {/* Matched product, right after the key. */}
                        <td class="border-b border-border py-1 pr-3 align-top text-text-muted">
                          {'matched' === r.status ? r.label : (r.note ?? '—')}
                        </td>
                        {/* The remaining mapped columns, diffed against the existing line. */}
                        <For each={previewFields().slice(1)}>
                          {(f) => {
                            const nw = (): string => row()[f.key] ?? ''; // already trimmed in mappedRows
                            const old = (): string => r.existing?.[f.key] ?? '';
                            const fmt = (v: string): string => (f.format ? f.format(v) : v);
                            // Per-field positive upsert, keyed on the field's CURRENT value (old), not on
                            // whether the whole row pre-exists: no current value → a value/dash adds or
                            // blanks; a current value → empty leaves as-is (black), '-' deletes (struck red),
                            // a value sets it (unchanged → black, changed → old red / new green). Comparison
                            // uses the raw values; only the display is formatted.
                            const mode = ():
                              'add' | 'blank' | 'noop' | 'delete' | 'same' | 'change' =>
                              '' === old()
                                ? '' === nw() || '-' === nw()
                                  ? 'blank'
                                  : 'add'
                                : '' === nw()
                                  ? 'noop'
                                  : '-' === nw()
                                    ? 'delete'
                                    : sameValue(nw(), old())
                                      ? 'same'
                                      : 'change';
                            return (
                              <td
                                class="border-b border-border py-1 pr-3 align-top"
                                classList={{ 'text-right': f.numeric }}
                              >
                                {/* No product ⇒ nothing to import for this column. */}
                                <Show when={'matched' === r.status} fallback={<span />}>
                                  <Switch>
                                    <Match when={'add' === mode()}>
                                      <span class="text-green-700">{fmt(nw())}</span>
                                    </Match>
                                    <Match when={'blank' === mode()}>
                                      <span />
                                    </Match>
                                    <Match when={'noop' === mode()}>
                                      <span>{fmt(old())}</span>
                                    </Match>
                                    <Match when={'same' === mode()}>
                                      <span>{fmt(nw())}</span>
                                    </Match>
                                    <Match when={'delete' === mode()}>
                                      <span class="text-red-600 line-through">{fmt(old())}</span>
                                    </Match>
                                    <Match when={'change' === mode()}>
                                      <span class="block text-red-600 line-through">
                                        {fmt(old())}
                                      </span>
                                      <span class="block text-green-700">{fmt(nw())}</span>
                                    </Match>
                                  </Switch>
                                </Show>
                              </td>
                            );
                          }}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>

          <Show when={error()}>
            <ErrorBanner class="mt-3 text-sm">{error()}</ErrorBanner>
          </Show>
        </div>

        <ModalFooter>
          <Show
            when={'preview' === step()}
            fallback={
              <>
                <Button variant="secondary" onClick={props.onClose}>
                  {__('Cancel')}
                </Button>
                <Button disabled={!canContinue() || busy()} onClick={() => void doResolve()}>
                  {busy() ? __('Matching…') : __('Continue')}
                </Button>
              </>
            }
          >
            <Button variant="secondary" onClick={() => setStep('map')}>
              {__('Back')}
            </Button>
            <Button disabled={!hasChanges() || busy()} onClick={() => void doCommit()}>
              {busy() ? __('Importing…') : commitLabel()}
            </Button>
          </Show>
        </ModalFooter>
      </ModalPanel>
    </Modal>
  );
}
