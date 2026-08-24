import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createStore, reconcile } from 'solid-js/store';
import { createQuery, useQueryClient } from '@tanstack/solid-query';
import { __, sprintf } from '@invflux/i18n';
import {
  Button,
  Checkbox,
  Input,
  PaletteSwatchPicker,
  Pill,
  Select,
  TAG_PALETTE,
  WC_ORDER_STATUS_COLOR,
  WC_ORDER_STATUS_FALLBACK_COLOR,
  fetchImportAliases,
  Modal,
  resolveSettingControl,
  type SettingMeta,
} from '@invflux/ui';
import { ImportAliasSection, IMPORT_ALIASES_QUERY_KEY } from './ImportAliasSection';
import {
  commitSettings,
  fetchSettings,
  fetchOrderStatusPolicies,
  fetchPluginPolicies,
  saveOrderStatusPolicies,
  savePluginPolicies,
  type SettingRow,
  type OrderStatusPolicy,
  type PluginPolicyRow,
  type PluginPolicyData,
} from '../api';
import type { AdminContext } from '../types';
// Brand SVGs inlined as markup (?raw → bundled into the JS, no separate asset file to enqueue).
import invfluxMark from '@invflux/ui/assets/invflux-mark.svg?raw';

const QUERY_KEY = ['invflux-settings'] as const;
const OS_QUERY_KEY = ['invflux-order-status-policies'] as const;
const PM_QUERY_KEY = ['invflux-plugin-policies'] as const;
const UNGROUPED = '__ungrouped__';
// Synthetic outline/section keys for the two bespoke policy-table sections (not catalog groups).
const SECTION_ORDER_STATUS = '__order_status__';
const SECTION_PLUGIN_META = '__plugin_meta__';
const SECTION_IMPORT_ALIASES = '__import_aliases__';

interface SettingsViewProps {
  context: AdminContext;
}

export function SettingsView(props: SettingsViewProps) {
  const queryClient = useQueryClient();
  const query = createQuery(() => ({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSettings(props.context),
  }));

  // Staged edits, keyed by setting name — the dirty set.
  const [dirty, setDirty] = createStore<Record<string, unknown>>({});
  const [serverErrors, setServerErrors] = createSignal<Record<string, string>>({});
  const [search, setSearch] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  // The two bespoke policy tables (not catalog settings): their own queries + staged-edit stores,
  // folded into the same pending-count + commit bar as the catalog dirty set.
  const osQuery = createQuery(() => ({ queryKey: OS_QUERY_KEY, queryFn: () => fetchOrderStatusPolicies(props.context) }));
  const pmQuery = createQuery(() => ({ queryKey: PM_QUERY_KEY, queryFn: () => fetchPluginPolicies(props.context) }));
  const aliasQuery = createQuery(() => ({ queryKey: IMPORT_ALIASES_QUERY_KEY, queryFn: () => fetchImportAliases(props.context) }));
  const [osDirty, setOsDirty] = createStore<
    Record<string, { stock_bucket: string; dispatch_status: string; color_id: number | null }>
  >({});
  const [pmDirty, setPmDirty] = createStore<Record<string, { policy: string; acknowledged: boolean }>>({});
  const [pmRegister, setPmRegister] = createSignal('');

  const osRows = (): OrderStatusPolicy[] => osQuery.data ?? [];
  const pmInfo = (): PluginPolicyData => pmQuery.data ?? { installed: [], available: {}, knownSlugs: [] };
  const osValue = (r: OrderStatusPolicy): { stock_bucket: string; dispatch_status: string; color_id: number | null } =>
    osDirty[r.status_slug] ?? {
      stock_bucket: r.stock_bucket,
      dispatch_status: r.dispatch_status,
      color_id: r.color_id,
    };
  const pmValue = (r: PluginPolicyRow): { policy: string; acknowledged: boolean } =>
    pmDirty[r.plugin_slug] ?? { policy: r.policy, acknowledged: r.acknowledged };
  const osRowDirty = (r: OrderStatusPolicy): boolean =>
    r.status_slug in osDirty &&
    (osDirty[r.status_slug].stock_bucket !== r.stock_bucket ||
      osDirty[r.status_slug].dispatch_status !== r.dispatch_status ||
      osDirty[r.status_slug].color_id !== r.color_id);
  const pmRowDirty = (r: PluginPolicyRow): boolean =>
    r.plugin_slug in pmDirty && (pmDirty[r.plugin_slug].policy !== r.policy || pmDirty[r.plugin_slug].acknowledged !== r.acknowledged);
  const osChanges = createMemo(() => osRows().filter(osRowDirty));
  const pmChanges = createMemo(() => pmInfo().installed.filter(pmRowDirty));

  const rows = (): SettingRow[] => query.data ?? [];
  const effectiveValue = (row: SettingRow): unknown => (row.name in dirty ? dirty[row.name] : row.value);
  const isDirty = (row: SettingRow): boolean =>
    row.name in dirty && JSON.stringify(dirty[row.name]) !== JSON.stringify(row.value);
  const dirtyRows = createMemo(() => rows().filter(isDirty));
  // Group keys (row.group / UNGROUPED) that hold at least one unsaved row — drives the outline's
  // per-section dirty tint (the shared `bg-dirty-bg` signal).
  const dirtyGroupKeys = createMemo(() => {
    const keys = new Set(dirtyRows().map((r) => r.group ?? UNGROUPED));
    if (osChanges().length > 0) keys.add(SECTION_ORDER_STATUS);
    if (pmChanges().length > 0 || '' !== pmRegister()) keys.add(SECTION_PLUGIN_META);

    return keys;
  });
  // Total unsaved items across catalog settings + both policy tables + a pending plugin
  // registration. Declared after dirtyRows: createMemo runs its fn eagerly at creation, so a
  // forward reference to dirtyRows would hit the temporal dead zone.
  const pendingCount = createMemo(
    () => dirtyRows().length + osChanges().length + pmChanges().length + ('' !== pmRegister() ? 1 : 0),
  );
  // Modified = the effective (staged-or-persisted) value differs from the catalog default — the
  // persistent blue gutter indicator (VSCode's "modified" marker), distinct from unsaved/dirty.
  const isModified = (row: SettingRow): boolean =>
    JSON.stringify(effectiveValue(row)) !== JSON.stringify(row.defaultValue);
  const isLocked = (row: SettingRow): boolean => 'locked' === row.gate;

  // "Hide locked settings" — a per-browser UI pref (localStorage), off by default so Pro teasers
  // are visible. Display-only: the write path still re-checks the gate server-side.
  const HIDE_LOCKED_KEY = 'invflux-admin-hide-locked';
  const [hideLocked, setHideLockedSignal] = createSignal<boolean>(readHideLocked());
  const setHideLocked = (value: boolean): void => {
    setHideLockedSignal(value);
    try {
      localStorage.setItem(HIDE_LOCKED_KEY, value ? '1' : '0');
    } catch {
      /* localStorage unavailable — fall back to in-memory only */
    }
  };
  function readHideLocked(): boolean {
    try {
      return '1' === localStorage.getItem(HIDE_LOCKED_KEY);
    } catch {
      return false;
    }
  }

  /** Light client-side validation from `config` (the server validator is authoritative). */
  function validate(row: SettingRow, value: unknown): string | null {
    if (row.dataType === 'number' || row.dataType.startsWith('number:')) {
      if (value === null || value === '') return null;
      if (typeof value !== 'number' || Number.isNaN(value)) return __('Must be a number.');
      const min = typeof row.config.min === 'number' ? row.config.min : undefined;
      const max = typeof row.config.max === 'number' ? row.config.max : undefined;
      if (min !== undefined && value < min) return sprintf(__('Must be at least %d.'), min);
      if (max !== undefined && value > max) return sprintf(__('Must be at most %d.'), max);
    }

    return null;
  }

  const clientErrors = createMemo<Record<string, string>>(() => {
    const errs: Record<string, string> = {};
    for (const row of dirtyRows()) {
      const err = validate(row, effectiveValue(row));
      if (err) errs[row.name] = err;
    }

    return errs;
  });
  const rowError = (row: SettingRow): string | null => serverErrors()[row.name] ?? clientErrors()[row.name] ?? null;
  const hasBlockingErrors = (): boolean => Object.keys(clientErrors()).length > 0;

  const stage = (name: string, value: unknown): void => {
    setDirty(name, value);
    // Clear any stale server error for this key as soon as the merchant edits it.
    if (serverErrors()[name]) {
      const next = { ...serverErrors() };
      delete next[name];
      setServerErrors(next);
    }
  };

  const metaOf = (row: SettingRow): SettingMeta => ({
    name: row.name,
    dataType: row.dataType,
    config: row.config,
    title: row.title,
    description: row.description,
    group: row.group,
    tier: row.tier,
    gate: row.gate,
  });

  const groups = createMemo(() => {
    const term = search().trim().toLowerCase();
    const hide = hideLocked();
    const matches = (row: SettingRow): boolean => {
      if (hide && isLocked(row)) return false;

      return (
        term === '' ||
        [row.title, row.name, row.description, row.group].some((s) => (s ?? '').toLowerCase().includes(term))
      );
    };

    const byGroup = new Map<string, SettingRow[]>();
    for (const row of rows()) {
      if (!matches(row)) continue;
      const key = row.group ?? UNGROUPED;
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }

    return [...byGroup.entries()]
      .map(([key, list]) => ({
        key,
        label: key === UNGROUPED ? __('General') : key,
        allLocked: list.every(isLocked),
        // Locked teasers sink to the bottom of their group.
        rows: list.sort(
          (a, b) =>
            (isLocked(a) ? 1 : 0) - (isLocked(b) ? 1 : 0) ||
            a.order - b.order ||
            (a.title ?? a.name).localeCompare(b.title ?? b.name),
        ),
      }))
      // Fully-locked groups sort after groups with any editable setting.
      .sort((a, b) => (a.allLocked ? 1 : 0) - (b.allLocked ? 1 : 0) || a.label.localeCompare(b.label));
  });

  const save = async (): Promise<void> => {
    if (0 === pendingCount() || hasBlockingErrors()) return;

    const changes = dirtyRows().map((row) => ({ name: row.name, value: effectiveValue(row) }));
    const osPayload: Record<string, { stock_bucket: string; dispatch_status: string; color_id: number | null }> = {};
    for (const r of osChanges()) osPayload[r.status_slug] = osValue(r);
    const pmPayload: Record<string, { policy: string; acknowledged: boolean }> = {};
    for (const r of pmChanges()) pmPayload[r.plugin_slug] = pmValue(r);
    const register = pmRegister();

    setSaving(true);
    const errors: Record<string, string> = {};
    try {
      if (changes.length > 0) {
        const r = await commitSettings(props.context, changes);
        if (!r.ok) Object.assign(errors, r.errors);
      }
      if (Object.keys(osPayload).length > 0) {
        const r = await saveOrderStatusPolicies(props.context, osPayload);
        if (!r.ok) for (const [k, v] of Object.entries(r.errors)) errors[`order-status:${k}`] = v;
      }
      if (Object.keys(pmPayload).length > 0 || '' !== register) {
        const r = await savePluginPolicies(props.context, pmPayload, '' !== register ? register : undefined);
        if (!r.ok) for (const [k, v] of Object.entries(r.errors)) errors[`plugin:${k}`] = v;
      }
    } finally {
      setSaving(false);
    }

    if (0 === Object.keys(errors).length) {
      setServerErrors({});
      setDirty(reconcile({}));
      setOsDirty(reconcile({}));
      setPmDirty(reconcile({}));
      setPmRegister('');
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: OS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: PM_QUERY_KEY });
    } else {
      // Nothing (or only some endpoints) persisted; surface errors and keep the modal open.
      setServerErrors(errors);
    }
  };

  // Ctrl/Cmd+Enter opens the review modal when there are staged changes (the workbench gesture).
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !modalOpen() && pendingCount() > 0) {
      e.preventDefault();
      setModalOpen(true);
    }
  };
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  // Section elements keyed by group.key, so the outline can scroll to one. We can't use
  // document.getElementById here — the sections live inside the SPA's shadow root, which
  // document queries don't pierce; a ref map is both shadow-safe and free of id-escaping concerns
  // (group keys carry '/', spaces, em-dashes). scrollIntoView scrolls the content pane (the
  // nearest scrollable ancestor), leaving the outline pane untouched.
  const sectionEls = new Map<string, HTMLElement>();
  const scrollToGroup = (key: string): void => {
    sectionEls.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // True when a search term is narrowing the list — drives the per-group hit counts (VSCode shows
  // them only while filtering).
  const filtering = (): boolean => '' !== search().trim();

  // The two bespoke policy-table sections: labels + search matching. When searching, a section
  // shows only if its title or one of its rows matches (the whole small table is then shown).
  const osSectionLabel = (): string => __('Order statuses');
  const pmSectionLabel = (): string => __('Stock-writing plugins');
  const matchesTerm = (text: string): boolean => {
    const t = search().trim().toLowerCase();

    return '' === t || text.toLowerCase().includes(t);
  };
  const showOrderStatus = (): boolean =>
    osRows().length > 0 && (matchesTerm(osSectionLabel()) || osRows().some((r) => matchesTerm(r.label) || matchesTerm(r.status_slug)));
  const showPluginMeta = (): boolean =>
    (pmInfo().installed.length > 0 || Object.keys(pmInfo().available).length > 0) &&
    (matchesTerm(pmSectionLabel()) || pmInfo().installed.some((r) => matchesTerm(r.plugin_name) || matchesTerm(r.plugin_slug)));
  const aliasSectionLabel = (): string => __('Import aliases');
  const aliasConcepts = (): string[] => Object.keys(aliasQuery.data ?? {});
  // Show once the query has resolved — even with no learned aliases yet — so the panel (and its
  // empty-state "teach one via Remember" guidance) is discoverable. Under a search term, gate on a match.
  const showImportAliases = (): boolean =>
    undefined !== aliasQuery.data &&
    (matchesTerm(aliasSectionLabel()) || aliasConcepts().some((c) => matchesTerm(c)) || Object.values(aliasQuery.data ?? {}).some((list) => list.some((a) => matchesTerm(a))));

  // 2-level outline for the sidebar: top-level group segment → its
  // sections, each carrying its matching-row count. A single-level group (no '/') is its own item.
  const outline = createMemo(() => {
    const tops = new Map<string, { label: string; count: number; sections: Array<{ key: string; label: string; count: number }> }>();
    for (const group of groups()) {
      const segments = group.key === UNGROUPED ? [group.label] : group.key.split('/');
      const top = segments[0];
      const entry = tops.get(top) ?? { label: top, count: 0, sections: [] };
      entry.count += group.rows.length;
      entry.sections.push({ key: group.key, label: segments.length > 1 ? segments.slice(1).join(' / ') : top, count: group.rows.length });
      tops.set(top, entry);
    }

    const extra: Array<{ label: string; count: number; sections: Array<{ key: string; label: string; count: number }> }> = [];
    if (showOrderStatus()) {
      const label = osSectionLabel();
      extra.push({ label, count: osRows().length, sections: [{ key: SECTION_ORDER_STATUS, label, count: osRows().length }] });
    }
    if (showPluginMeta()) {
      const label = pmSectionLabel();
      const count = pmInfo().installed.length;
      extra.push({ label, count, sections: [{ key: SECTION_PLUGIN_META, label, count }] });
    }
    if (showImportAliases()) {
      const label = aliasSectionLabel();
      const count = aliasConcepts().length;
      extra.push({ label, count, sections: [{ key: SECTION_IMPORT_ALIASES, label, count }] });
    }

    return [...tops.values(), ...extra];
  });

  /** " (n)" hit-count suffix, only while filtering. */
  const countSuffix = (n: number): string => (filtering() ? ` (${n})` : '');

  return (
    <div class="flex flex-col bg-surface text-text max-w-5xl mx-auto" style={{'height':'calc(100vh - 46px)'}}>
      <header class="shrink-0 border-b border-border p-4">
        {/* The InvFlux lockup is the app's top-left surface picker now (LockupLauncher), so the page
            title is just the plain surface name — no redundant lockup in the h1. */}
        <Input
          type="search"
          size="md"
          class="w-full"
          placeholder={__('Search settings…')}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <label class="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-text-muted">
          <Checkbox
            checked={hideLocked()}
            onChange={(e) => setHideLocked(e.currentTarget.checked)}
          />
          {__('Hide locked settings')}
        </label>
      </header>

      {/* Body: two independently-scrolling panes (VSCode settings). `min-h-0` lets the flex
          children own their overflow instead of stretching the row. */}
      <div class="flex min-h-0 flex-1">
        <Show when={query.isLoading}>
          <p class="p-4 text-text-muted">{__('Loading settings…')}</p>
        </Show>
        <Show when={query.isError}>
          <p class="p-4 text-red-700">{__('Failed to load settings.')}</p>
        </Show>

        <Show when={!query.isLoading && !query.isError}>
          {/* 2-level topical outline — scope tabs hidden until >1 scope (§10.8). */}
          <nav class="w-56 shrink-0 overflow-y-auto border-r border-border p-4 text-sm">
            <For each={outline()}>
              {(top) => (
                <div class="mb-2">
                  <Show
                    when={top.sections.length === 1 && top.sections[0].label === top.label}
                    fallback={
                      <>
                        <div class="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                          {top.label}{countSuffix(top.count)}
                        </div>
                        <For each={top.sections}>
                          {(s) => (
                            <button
                              type="button"
                              class="block w-full cursor-pointer rounded px-2 py-1 pl-4 text-left text-text-muted hover:bg-surface-raised hover:text-text"
                              classList={{ 'bg-dirty-bg text-text': dirtyGroupKeys().has(s.key) }}
                              onClick={() => scrollToGroup(s.key)}
                            >
                              {s.label}{countSuffix(s.count)}
                            </button>
                          )}
                        </For>
                      </>
                    }
                  >
                    <button
                      type="button"
                      class="block w-full cursor-pointer rounded px-2 py-1 text-left font-medium hover:bg-surface-raised"
                      classList={{ 'bg-dirty-bg': dirtyGroupKeys().has(top.sections[0].key) }}
                      onClick={() => scrollToGroup(top.sections[0].key)}
                    >
                      {top.label}{countSuffix(top.count)}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </nav>

          <div class="min-w-0 flex-1 space-y-10 overflow-y-auto p-4">
            <For each={groups()}>
              {(group) => (
                <section ref={(el) => sectionEls.set(group.key, el)} class="scroll-mt-4">
                  <h2 class="mb-4 text-lg font-semibold">{group.label.replace('/', ' › ')}</h2>
                  <div class="space-y-6">
                    <For each={group.rows}>{(row) => <SettingRowView row={row} />}</For>
                  </div>
                </section>
              )}
            </For>

            {/* Bespoke policy-table sections (not catalog settings — see SettingsPolicyController). */}
            <Show when={showOrderStatus()}>
              <section ref={(el) => sectionEls.set(SECTION_ORDER_STATUS, el)} class="scroll-mt-4">
                <h2 class="mb-1 text-lg font-semibold">{osSectionLabel()}</h2>
                <p class="mb-4 text-sm text-text-muted">
                  {__('Map WooCommerce order statuses to InvFlux stock and dispatch semantics. Stock and dispatch meaning is fixed for WooCommerce’s own statuses and set by you for custom ones; the colour is yours on every status.')}
                </p>
                <OrderStatusSection />
              </section>
            </Show>

            <Show when={showPluginMeta()}>
              <section ref={(el) => sectionEls.set(SECTION_PLUGIN_META, el)} class="scroll-mt-4">
                <h2 class="mb-1 text-lg font-semibold">{pmSectionLabel()}</h2>
                <p class="mb-4 text-sm text-text-muted">
                  {__('Once you let InvFlux manage a product’s stock, other plugins can no longer change it — that is what keeps the numbers trustworthy. If you need one of them to update stock anyway, allow it here, preferably only for as long as you need it. Plugins appear in this list once they try to write stock.')}
                </p>
                <PluginPolicySection />
              </section>
            </Show>

            <Show when={showImportAliases()}>
              <section ref={(el) => sectionEls.set(SECTION_IMPORT_ALIASES, el)} class="scroll-mt-4">
                <h2 class="mb-1 text-lg font-semibold">{aliasSectionLabel()}</h2>
                <p class="mb-4 text-sm text-text-muted">
                  {__('Header labels the importer remembers for each column. Taught via “Remember” during an import; prune or add them here.')}
                </p>
                <ImportAliasSection context={props.context} />
              </section>
            </Show>
          </div>
        </Show>
      </div>

      {/* Commit bar — a fixed (shrink-0) footer of the bounded-height column, so it's always
          visible below the scrolling panes and never overlaps WP's admin footer. */}
      <Show when={pendingCount() > 0}>
        <div class="flex shrink-0 items-center justify-end gap-4 border-t border-border bg-surface-raised px-6 py-3">
          <span class="text-sm text-text-muted">
            {sprintf(__('%d unsaved change(s)'), pendingCount())}
            {' · '}
            {__('Ctrl+Enter to review')}
          </span>
          <Button onClick={() => setModalOpen(true)}>
            {__('Review & save')}
          </Button>
        </div>
      </Show>

      <Show when={modalOpen()}>
        <SummaryModal
          changes={dirtyRows()}
          policyChanges={[
            ...osChanges().map((r) => {
              // Only name what actually moved. A colour edit on a core status leaves the two
              // semantics values untouched, and listing them anyway reads as "you are about to
              // change the stock bucket too" on the one screen where that must not be ambiguous.
              const v = osValue(r);
              const parts: string[] = [];
              if (v.stock_bucket !== r.stock_bucket || v.dispatch_status !== r.dispatch_status) {
                parts.push(`${v.stock_bucket} / ${v.dispatch_status}`);
              }
              if (v.color_id !== r.color_id) {
                parts.push(null === v.color_id ? __('colour: default') : sprintf(__('colour: %s'), TAG_PALETTE[v.color_id]?.name ?? String(v.color_id)));
              }

              return { label: r.label, detail: parts.join(' · ') };
            }),
            ...pmChanges().map((r) => ({
              label: '' !== r.plugin_name ? r.plugin_name : r.plugin_slug,
              detail: pmValue(r).acknowledged ? `${pmValue(r).policy} · ${__('notices silenced')}` : pmValue(r).policy,
            })),
            ...('' !== pmRegister() ? [{ label: pmRegister(), detail: __('register plugin') }] : []),
          ]}
          oldValue={(row) => row.value}
          newValue={(row) => effectiveValue(row)}
          error={(row) => clientErrors()[row.name] ?? null}
          canSave={!hasBlockingErrors() && !saving()}
          saving={saving()}
          onConfirm={() => void save()}
          onCancel={() => setModalOpen(false)}
        />
      </Show>
    </div>
  );

  // ── Order-status policy table (bespoke section) ──────────────────────────
  function OrderStatusSection() {
    const bucketOptions: Array<[string, string]> = [
      ['none', __('None')],
      ['res', __('Reserved')],
      ['ctd', __('Awaiting dispatch')],
    ];
    const dispatchOptions: Array<[string, string]> = [
      ['none', __('None')],
      ['queue', __('Queue')],
      ['hold', __('Hold')],
      ['complete', __('Complete')],
      ['archive', __('Archive')],
    ];
    const setBucket = (r: OrderStatusPolicy, v: string): void =>
      setOsDirty(r.status_slug, { ...osValue(r), stock_bucket: v });
    const setDispatch = (r: OrderStatusPolicy, v: string): void =>
      setOsDirty(r.status_slug, { ...osValue(r), dispatch_status: v });
    const setColor = (r: OrderStatusPolicy, v: number | null): void =>
      setOsDirty(r.status_slug, { ...osValue(r), color_id: v });

    /** Which row has its swatch grid open. One at a time — this is a picker, not a comparison. */
    const [colorOpenFor, setColorOpenFor] = createSignal<string | null>(null);

    /**
     * What the pill actually draws: the merchant's choice, else the shipped default, else grey.
     *
     * The same three-step resolution the queue uses, so what the merchant previews here is what
     * they will see there — including for a status InvFlux has no default for, which is the whole
     * reason this column exists.
     */
    const effectiveColor = (r: OrderStatusPolicy): number =>
      osValue(r).color_id ?? WC_ORDER_STATUS_COLOR[r.status_slug] ?? WC_ORDER_STATUS_FALLBACK_COLOR;

    return (
      <div class="overflow-x-auto rounded border border-border">
        <table>
          <thead class="bg-surface-raised text-left text-text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">{__('Status')}</th>
              <th class="px-3 py-2 font-medium">{__('Slug')}</th>
              <th class="px-3 py-2 font-medium">{__('Colour')}</th>
              <th class="px-3 py-2 font-medium">{__('Stock bucket')}</th>
              <th class="px-3 py-2 font-medium">{__('Dispatch status')}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border text-xs">
            <For each={osRows()}>
              {(r) => (
                <>
                <tr classList={{ 'bg-dirty-bg': osRowDirty(r) }}>
                  <td class="px-3 py-2">
                    {r.label}
                    <Show when={!r.is_core && r.requires_review}>
                      <span class="ml-2 rounded bg-dirty-bg px-1.5 py-0.5 text-xs font-medium text-text">
                        {__('Needs review')}
                      </span>
                    </Show>
                  </td>
                  <td class="px-3 py-2"><code class="text-xs text-text-muted">{r.status_slug}</code></td>
                  <td class="px-3 py-2">
                    {/* Enabled for core statuses too, unlike the two Selects beside it: a colour
                        carries no WooCommerce semantics, so there is nothing to protect. */}
                    <button
                      type="button"
                      class="cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      aria-expanded={colorOpenFor() === r.status_slug}
                      aria-label={sprintf(__('Colour for %s'), r.label)}
                      onClick={() => setColorOpenFor(colorOpenFor() === r.status_slug ? null : r.status_slug)}
                    >
                      <Pill colorId={effectiveColor(r)}>
                        {r.label}
                        <Show when={null === osValue(r).color_id}>
                          <span class="ml-1 opacity-60">{__('(default)')}</span>
                        </Show>
                      </Pill>
                    </button>
                  </td>
                  <td class="px-3 py-2">
                    <Select disabled={r.is_core} value={osValue(r).stock_bucket} onChange={(e) => setBucket(r, e.currentTarget.value)}>
                      <For each={bucketOptions}>{([v, l]) => <option value={v}>{l}</option>}</For>
                    </Select>
                  </td>
                  <td class="px-3 py-2">
                    <Select disabled={r.is_core} value={osValue(r).dispatch_status} onChange={(e) => setDispatch(r, e.currentTarget.value)}>
                      <For each={dispatchOptions}>{([v, l]) => <option value={v}>{l}</option>}</For>
                    </Select>
                  </td>
                </tr>
                {/* The swatch grid lives in its own row rather than a popover: the table wrapper is
                    `overflow-x-auto`, which forces overflow-y to `auto` as well, so anything
                    absolutely positioned out of a cell would be clipped or scroll away. A
                    disclosure row needs no positioning and cannot be cut off. */}
                <Show when={colorOpenFor() === r.status_slug}>
                  <tr classList={{ 'bg-dirty-bg': osRowDirty(r) }}>
                    <td class="px-3 pb-3" colSpan={5}>
                      <div class="flex flex-wrap items-start gap-4">
                        <PaletteSwatchPicker
                          ariaLabel={sprintf(__('Colour for %s'), r.label)}
                          value={osValue(r).color_id}
                          onPick={(id) => setColor(r, id)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={null === osValue(r).color_id}
                          onClick={() => setColor(r, null)}
                        >
                          {__('Use default')}
                        </Button>
                      </div>
                      <Show when={null === osValue(r).color_id}>
                        <p class="mt-2 text-2xs text-text-muted">
                          {__('No colour set — this status follows the shipped default, and will keep following it if that default changes.')}
                        </p>
                      </Show>
                    </td>
                  </tr>
                </Show>
                </>
              )}
            </For>
          </tbody>
        </table>
      </div>
    );
  }

  // ── Third-party stock-plugin policy table (bespoke section) ──────────────
  function PluginPolicySection() {
    // `protect` is the stance every plugin starts at, so it has to be selectable — without it the
    // <Select> has no option matching the stored value and every unconfigured row renders as
    // whatever happens to be first, which is the opposite of what it does.
    const policyOptions: Array<[string, string]> = [
      ['protect', __('Protect (block, no notice)')],
      ['deny', __('Deny (block and notify)')],
      ['allow', __('Allow (let it write, record in the ledger)')],
    ];
    const setPolicy = (r: PluginPolicyRow, v: string): void =>
      setPmDirty(r.plugin_slug, { policy: v, acknowledged: pmValue(r).acknowledged });
    const setAck = (r: PluginPolicyRow, v: boolean): void =>
      setPmDirty(r.plugin_slug, { policy: pmValue(r).policy, acknowledged: v });
    const availableEntries = (): Array<[string, string]> => Object.entries(pmInfo().available);
    const isKnown = (slug: string): boolean => pmInfo().knownSlugs.includes(slug);

    return (
      <>
        <div class="overflow-x-auto rounded border border-border">
          <table>
            <thead class="bg-surface-raised text-left text-text-muted">
              <tr>
                <th class="px-3 py-2 font-medium">{__('Plugin')}</th>
                <th class="px-3 py-2 font-medium">{__('Slug')}</th>
                <th class="px-3 py-2 font-medium">{__('Policy')}</th>
                <th class="px-3 py-2 font-medium">{__('Silence notices')}</th>
                <th class="px-3 py-2 font-medium">{__('Last seen')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border text-xs">
              <For each={pmInfo().installed}>
                {(r) => (
                  <tr classList={{ 'bg-dirty-bg': pmRowDirty(r) }}>
                    <td class="px-3 py-2">
                      {'' !== r.plugin_name ? r.plugin_name : r.plugin_slug}
                      <Show when={isKnown(r.plugin_slug)}>
                        <span class="ml-2 text-xs text-text-muted" title={__('Known inventory plugin')}>⚑</span>
                      </Show>
                    </td>
                    <td class="px-3 py-2"><code class="text-xs text-text-muted">{r.plugin_slug}</code></td>
                    <td class="px-3 py-2">
                      <Select value={pmValue(r).policy} onChange={(e) => setPolicy(r, e.currentTarget.value)}>
                        <For each={policyOptions}>{([v, l]) => <option value={v}>{l}</option>}</For>
                      </Select>
                    </td>
                    <td class="px-3 py-2">
                      <Checkbox
                        checked={pmValue(r).acknowledged}
                        disabled={'deny' !== pmValue(r).policy}
                        onChange={(e) => setAck(r, e.currentTarget.checked)}
                      />
                    </td>
                    <td class="px-3 py-2 text-text-muted">{r.last_seen_at ?? __('Never')}</td>
                  </tr>
                )}
              </For>
              <Show when={0 === pmInfo().installed.length}>
                <tr>
                  <td colspan="5" class="px-3 py-2 text-text-muted">
                    {__('No third-party stock plugins are tracked yet. Known inventory plugins appear here once installed.')}
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </div>
        <Show when={availableEntries().length > 0}>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label for="invflux-register-plugin" class="font-medium">{__('Register installed plugin:')}</label>
            <Select
              id="invflux-register-plugin"
              value={pmRegister()}
              onChange={(e) => setPmRegister(e.currentTarget.value)}
            >
              <option value="">{__('— Select a plugin —')}</option>
              <For each={availableEntries()}>{([slug, name]) => <option value={slug}>{sprintf('%s (%s)', name, slug)}</option>}</For>
            </Select>
          </div>
        </Show>
      </>
    );
  }

  // ── Per-setting row ──────────────────────────────────────────────────────
  function SettingRowView(localProps: { row: SettingRow }) {
    const row = localProps.row;
    const control = resolveSettingControl(row.dataType);
    const locked = (): boolean => row.gate === 'locked';
    const disabled = (): boolean => locked() || row.policyLocked;

    const isBool = (): boolean => 'bool' === row.dataType || row.dataType.startsWith('bool:');

    const controlEl = () => (
      <Show when={control} fallback={<span class="text-sm text-text-muted">{__('No control available.')}</span>}>
        {(C) => (
          <Dynamic
            component={C()}
            value={effectiveValue(row)}
            definition={metaOf(row)}
            disabled={disabled()}
            effectivePolicy={row.effectivePolicy}
            onChange={(value: unknown) => stage(row.name, value)}
          />
        )}
      </Show>
    );

    // Optional reference link, from the catalog's `config.docUrl` — for a setting whose value has a
    // syntax of its own (the export filename's date patterns) and whose spec lives off-site. Any
    // dataType may carry one. http(s) only: `config` is add-on-extensible, so a `javascript:` URL
    // must never reach an href. The label is catalog data (like `description`); without one, the
    // host stands in rather than inventing a name for someone else's document.
    const docUrl = (): string | null => {
      const url = row.config?.docUrl;

      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    };
    const docEl = () => (
      <Show when={docUrl()}>
        {(url) => {
          const label = row.config?.docLabel;

          return (
            <p class="mt-0.5 text-sm">
              <a
                href={url()}
                target="_blank"
                rel="noreferrer noopener"
                class="text-primary hover:underline"
              >
                {typeof label === 'string' && label !== '' ? label : new URL(url()).host} ↗
              </a>
            </p>
          );
        }}
      </Show>
    );

    const extrasEl = () => (
      <>
        {/* Locked state is conveyed by the faded row + the "(tier)" chip on the title; a future
            enhancement links that chip to the Licenses page's Pro section. */}
        <Show when={rowError(row)}>
          {(msg) => <p class="mt-1 text-xs text-red-600">{msg()}</p>}
        </Show>
        {/* Replication badge (read-only until Federation — §10.4/§6). */}
        <Show when={row.policyLocked}>
          <p class="mt-1 text-xs text-text-muted">🔒 {sprintf(__('%s (locked)'), row.effectivePolicy)}</p>
        </Show>
      </>
    );

    return (
      <div
        // Persistent left gutter when the value differs from the catalog default (VSCode's modified
        // marker); full focus ring while a control inside is focused. Locked teasers are faded.
        class="rounded-sm border-l-2 py-1 pl-3 pr-2 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary"
        classList={{
          'border-primary': isModified(row),
          'border-transparent': !isModified(row),
          // Unsaved rows carry the shared dirty tint (same signal as the outline + workbench cells).
          'bg-dirty-bg': isDirty(row),
          'opacity-60': locked(),
        }}
      >
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-semibold">{row.title ?? row.name}</span>
          <Show when={locked()}>
            <span class="inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-yellow-200">
              {/* eslint-disable-next-line solid/no-innerhtml -- build-time `?raw` SVG import, not user or server data. */}
              <span class="inline-flex [&_svg]:h-3.5 [&_svg]:w-auto" innerHTML={invfluxMark} aria-hidden="true" />
              {row.tier ?? 'Pro'}
            </span>
          </Show>
          <Show when={isDirty(row)}>
            <span class="text-xs italic text-text-muted">({__('unsaved')})</span>
          </Show>
        </div>

        <Show
          when={isBool()}
          fallback={
            <>
              <Show when={row.description}>
                <p class="mt-0.5 text-sm text-text-muted">{row.description}</p>
              </Show>
              {docEl()}
              <div class="mt-2 max-w-md">
                {controlEl()}
                {extrasEl()}
              </div>
            </>
          }
        >
          {/* Bool: checkbox inline with the description, wrapped in a <label> so clicking the
              description text toggles the checkbox (VSCode form). */}
          <label class="mt-1 flex w-fit cursor-pointer items-start gap-2">
            <span class="pt-0.5">{controlEl()}</span>
            <Show when={row.description}>
              <span class="text-sm text-text-muted">{row.description}</span>
            </Show>
          </label>
          {/* Outside the <label>: a click on the link must open it, not toggle the checkbox. */}
          {docEl()}
          {extrasEl()}
        </Show>
      </div>
    );
  }
}

// ── Review-&-save summary modal ─────────────────────
interface SummaryModalProps {
  changes: SettingRow[];
  /** Non-catalog changes (the two policy tables) shown as simple label → new-value lines. */
  policyChanges: Array<{ label: string; detail: string }>;
  oldValue: (row: SettingRow) => unknown;
  newValue: (row: SettingRow) => unknown;
  error: (row: SettingRow) => string | null;
  canSave: boolean;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '""' : value;

  return JSON.stringify(value);
}

function SummaryModal(props: SummaryModalProps) {
  // Inside the modal, Ctrl/Cmd+Enter confirms (when allowed). stopPropagation so the view-level
  // opener doesn't also see it.
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (props.canSave) props.onConfirm();
    }
  };

  // Open focused on Cancel (the safe default); Tab → Save, Enter saves. `:focus` (not
  // `:focus-visible`) on the buttons so this programmatic focus shows its ring.
  let cancelBtn: HTMLButtonElement | undefined;
  onMount(() => cancelBtn?.focus());

  return (
    <Modal
      onClose={props.onCancel}
      label={__('Review changes')}
      backdropClass="flex items-center justify-center bg-black/30 p-6"
    >
      <div
        class="w-[32rem] max-w-[90vw] rounded-lg bg-surface p-5 text-text shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 class="mb-3 text-lg font-semibold">{__('Review changes')}</h2>
        <ul class="mb-4 max-h-80 space-y-2 overflow-auto">
          <For each={props.changes}>
            {(row) => {
              const err = props.error(row);

              return (
                <li class="rounded border border-border p-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium">{row.title ?? row.name}</span>
                    <Show when={err}>
                      <span class="text-xs text-red-600">{err}</span>
                    </Show>
                  </div>
                  <div class="mt-1 text-xs text-text-muted">
                    <span class="line-through">{display(props.oldValue(row))}</span>
                    {' → '}
                    <span class="text-text">{display(props.newValue(row))}</span>
                  </div>
                </li>
              );
            }}
          </For>
          <For each={props.policyChanges}>
            {(change) => (
              <li class="rounded border border-border p-2">
                <div class="font-medium">{change.label}</div>
                <div class="mt-1 text-xs text-text-muted">{change.detail}</div>
              </li>
            )}
          </For>
        </ul>
        <div class="flex justify-end gap-2">
          <Button ref={cancelBtn} variant="secondary" eagerFocusRing onClick={props.onCancel}>
            {__('Cancel')}
          </Button>
          <Button eagerFocusRing disabled={!props.canSave} onClick={props.onConfirm}>
            {props.saving ? __('Saving…') : __('Save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
