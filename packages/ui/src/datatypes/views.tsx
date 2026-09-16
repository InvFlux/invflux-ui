import { StockConcernBadge, type InboundCover } from '../StockConcernBadge';
import { For, Show, type JSX } from 'solid-js';
import { __, formatNumber } from '@invflux/i18n';
import { useHostNav } from '../hostNav';
import type { ViewProps } from './registry';
import { viewRegistry } from './registry';
import { formatDateValue, parseDateValue } from './dateValue';

/**
 * Built-in read-only view components, keyed by datatype slug, registered into the shared
 * {@link viewRegistry}. Importing this module once (side effect) populates the registry.
 *
 * Bespoke core columns with column-specific styling or behaviour (stock cells, status,
 * name/expand, orders, ledger, the editable inputs) are special-cased in WorkbenchGrid;
 * these views cover the plain-data datatypes plus the dynamic taxonomy / add-on columns.
 */

const DASH = '—';

function TextView(props: ViewProps) {
  const text = (): string => {
    const v = props.value;
    if (v === null || v === undefined) return DASH;
    const s = String(v);
    return s.trim() === '' ? DASH : s;
  };

  return <span>{text()}</span>;
}

function NumberView(props: ViewProps) {
  return (
    <span class="tabular-nums">
      {typeof props.value === 'number' ? formatNumber(props.value) : DASH}
    </span>
  );
}

function DecimalView(props: ViewProps) {
  // Decimals arrive as strings (DECIMAL form) so precision isn't lost in JS floats. Read props.value
  // inside the accessor so it stays reactive (a staged edit re-renders the cell in place).
  const text = (): string => {
    const v = props.value;
    return typeof v === 'string' && v !== '' ? v : DASH;
  };
  return <span class="tabular-nums">{text()}</span>;
}

function MoneyView(props: ViewProps) {
  // Money: fixed 2 decimals so prices line up (e.g. "12.90" not "12.9"). Value stays a string. Read
  // props.value inside the accessor so it stays reactive (a staged edit re-renders the cell in place).
  const text = (): string => {
    const v = props.value;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n.toFixed(2) : DASH;
  };
  return <span class="tabular-nums">{text()}</span>;
}

function BoolView(props: ViewProps) {
  return <span>{props.value ? 'Yes' : 'No'}</span>;
}

function DateView(props: ViewProps) {
  // Tolerant of the shapes date-ish data actually arrives in (day strings, datetimes, epoch
  // timestamps — see parseDateValue); an unparseable value renders as the empty dash, never raw.
  const text = (): string => {
    const parsed = parseDateValue(props.value);
    return parsed === null ? DASH : formatDateValue(parsed);
  };
  return <span class="whitespace-nowrap tabular-nums">{text()}</span>;
}

function ImageUrlView(props: ViewProps) {
  const url = (): string => (typeof props.value === 'string' ? props.value : '');

  return (
    <Show when={url() !== ''} fallback={<span class="text-text-muted">{DASH}</span>}>
      <img src={url()} alt="" class="h-10 w-10 rounded object-cover" loading="lazy" />
    </Show>
  );
}

function TermPickerView(props: ViewProps) {
  const taxonomyName = (): string =>
    typeof props.column.editorConfig.taxonomy === 'string'
      ? props.column.editorConfig.taxonomy
      : '';
  const ids = (): number[] => (Array.isArray(props.value) ? (props.value as number[]) : []);
  const name = (termId: number): string => {
    const space = props.ctx.taxonomySpace?.[taxonomyName()];
    return space?.values[String(termId)]?.name ?? String(termId);
  };

  return (
    <Show when={ids().length > 0} fallback={<span class="text-text-muted">{DASH}</span>}>
      <span>
        <For each={ids()}>{(termId, i) => `${i() > 0 ? ', ' : ''}${name(termId)}`}</For>
      </span>
    </Show>
  );
}

/** Subject stock-concerns bitmask → the shared StockConcernBadge (renders "—" when 0). The
 *  unfulfillable magnitude (`stockDeficitQty`) and the governance marker (`unmanaged`) both ride on
 *  the row, so the deficit reads "Deficit: N" and an untracked line still shows "⚠ Unmanaged". */
/**
 * Enum cell: maps the stored value (a slug like `taxable` / `heavy-items` / `reduced-rate`) to the
 * human label declared in the column's `editorConfig.options`, falling back to the raw value when no
 * option matches and to "—" when empty without a matching option. Display-only — copy/paste still
 * round-trips the raw value through the enum codec.
 */
function EnumView(props: ViewProps) {
  const label = (): string => {
    const v = props.value;
    if (v === null || v === undefined) return DASH;
    const options = Array.isArray(props.column.editorConfig.options)
      ? (props.column.editorConfig.options as Array<{ value?: unknown; label?: unknown }>)
      : [];
    const match = options.find((o) => o !== null && typeof o === 'object' && o.value === v);
    if (match !== undefined && typeof match.label === 'string' && match.label.trim() !== '') {
      return match.label;
    }
    const s = String(v);
    return s.trim() === '' ? DASH : s;
  };

  return <span>{label()}</span>;
}

/**
 * The `text:product-type` view (the Type column): an ATUM-style per-type icon + the constituent
 * count, replacing the raw slug. `role` (parent/variation) takes precedence over the `productType`
 * slug — a variation row carries its parent's slug. The count (variation count) is server-supplied
 * on parents only; other types show the icon alone. The WC term lives in the title for scannability.
 */
type ProductTypeRow = { role?: string; productType?: string; childCount?: number };

export function productTypeKind(value: unknown, row: ProductTypeRow): string {
  if (row.role === 'variation') return 'variation';
  if (row.role === 'parent') return 'variable';
  const v = typeof value === 'string' && value !== '' ? value : row.productType;
  return v ?? 'simple';
}

function productTypeLabel(kind: string): string {
  switch (kind) {
    case 'variable':
      return __('Variable');
    case 'variation':
      return __('Variation');
    case 'grouped':
      return __('Grouped');
    case 'external':
      return __('External');
    case 'bundle':
      return __('Bundle');
    case 'simple':
      return __('Simple');
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function ProductTypeIcon(props: { kind: string }): JSX.Element {
  const svg = (children: JSX.Element): JSX.Element => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
  switch (props.kind) {
    case 'variable': // stacked layers — an aggregate of variations
      return svg(
        <>
          <path d="M12 2 2 7l10 5 10-5z" />
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
        </>,
      );
    case 'variation': // a sub-item branching off its parent
      return svg(
        <>
          <path d="M6 4v8a4 4 0 0 0 4 4h8" />
          <path d="M14 12l4 4-4 4" />
        </>,
      );
    case 'grouped': // a folder of independent members
      return svg(
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
      );
    case 'external': // links out to another store
      return svg(
        <>
          <path d="M15 3h6v6" />
          <path d="M21 3l-9 9" />
          <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </>,
      );
    case 'bundle': // a package of fulfilled-together items
      return svg(
        <>
          <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
          <path d="M3 8l9 5 9-5M12 13v9" />
        </>,
      );
    default: // simple — a single product
      return svg(<rect x="4" y="4" width="16" height="16" rx="2" />);
  }
}

function ProductTypeView(props: ViewProps) {
  const row = (): ProductTypeRow => (props.row as ProductTypeRow | null) ?? {};
  const kind = (): string => productTypeKind(props.value, row());
  const count = (): number =>
    typeof row().childCount === 'number' ? (row().childCount as number) : 0;
  // Variable and variation take the workbench's family hue; every other type stays muted. The
  // colour is doing real work here — it is the fastest way to see, mid-scroll, which rows belong to
  // a parent/variation family and which are standalone, without reading the label.
  const isFamily = (): boolean => 'variable' === kind() || 'variation' === kind();
  return (
    <span
      class={`inline-flex items-center gap-1 ${isFamily() ? 'text-violet-500' : 'text-text-muted'}`}
      title={productTypeLabel(kind())}
    >
      <ProductTypeIcon kind={kind()} />
      <Show when={count() > 0}>
        <span class="tabular-nums">({count()})</span>
      </Show>
    </span>
  );
}

/**
 * The `supplier-pills` view (the read-only "Suppliers" column): the suppliers whose catalogue lists
 * the product, as deep-linked pills into the Procurement app's Supplier → Products tab. The list is
 * shipped inline on the row (`extra['suppliers']` → `{supplierId, nickname}`), so — unlike taxonomy —
 * no `taxonomySpace`-style lookup is needed. Renders "—" when the product has no supplier.
 */
type SupplierPill = { supplierId: number; nickname: string };

function SupplierPillsView(props: ViewProps) {
  const hostNav = useHostNav();
  const suppliers = (): SupplierPill[] =>
    Array.isArray(props.value)
      ? (props.value as SupplierPill[]).filter(
          (s) => s !== null && typeof s === 'object' && typeof s.supplierId === 'number',
        )
      : [];
  // In the grid's no-wrap display mode, keep the pills on a single line (the cell clips) instead of
  // wrapping to new rows; flex defaults to nowrap, so we only add flex-wrap when wrapping is on.
  const noWrap = (): boolean => props.ctx.wrap === 'no-wrap';
  return (
    <Show when={suppliers().length > 0} fallback={<span class="text-text-muted">{DASH}</span>}>
      <span class="flex gap-1" classList={{ 'flex-wrap': !noWrap() }}>
        <For each={suppliers()}>
          {(s) => (
            <a
              href={hostNav.routeHref(`/procurement/suppliers/${s.supplierId}/products`)}
              class="inline-flex items-center rounded bg-slate-100 px-1 py-0.5 text-xs font-medium text-slate-700 no-underline hover:bg-slate-200 hover:text-slate-900"
              title={s.nickname}
            >
              {s.nickname === '' ? __('(unnamed)') : s.nickname}
            </a>
          )}
        </For>
      </span>
    </Show>
  );
}

function StockConcernsView(props: ViewProps) {
  const bits = (): number => (typeof props.value === 'number' ? props.value : 0);
  const deficitQty = (): number | undefined => {
    const row = props.row as { stockDeficitQty?: unknown } | null;
    const n = row?.stockDeficitQty;
    return typeof n === 'number' ? n : undefined;
  };
  /**
   * The governance marker rides on the row too, and must be forwarded: this view *replaces* the
   * badge its hosts would otherwise render themselves, so anything it fails to pass on simply
   * stops existing there. That is what hid "⚠ Unmanaged" on the order page, where the registered
   * view wins over the host's own fallback.
   *
   * Absent on rows that do not carry the field (the workbench states governance in its own
   * column), where `undefined` correctly renders nothing.
   */
  const unmanaged = (): boolean | undefined => {
    const row = props.row as { unmanaged?: unknown } | null;
    return typeof row?.unmanaged === 'boolean' ? row.unmanaged : undefined;
  };
  /** The deficit's operands, where the row carries them (the order page does, the workbench not). */
  const operand = (key: 'stockDemandQty' | 'stockCtdQty' | 'stockShortQty'): number | undefined => {
    const n = (props.row as Record<string, unknown> | null)?.[key];
    return typeof n === 'number' ? n : undefined;
  };
  /** Inbound cover rides the row like the other two; absent on rows that carry none. */
  const inbound = (): InboundCover | undefined => {
    const row = props.row as { inbound?: unknown } | null;
    const v = row?.inbound;
    return v !== null && typeof v === 'object' && 'onOrder' in v ? (v as InboundCover) : undefined;
  };
  return (
    <StockConcernBadge
      bits={bits()}
      deficitQty={deficitQty()}
      demandQty={operand('stockDemandQty')}
      ctdQty={operand('stockCtdQty')}
      shortQty={operand('stockShortQty')}
      unmanaged={unmanaged()}
      inbound={inbound()}
    />
  );
}

/**
 * The generic `link` datatype view — renders a cell as an anchor whose href is composed *client-side*
 * from static column config plus data the row already holds. It's the platform-neutral way for a
 * native column OR a third-party add-on column to link somewhere without the server ever emitting a
 * per-row URL (the anti-pattern arch-identity-keying §3 forbids for InvFlux-internal routes): the
 * server declares a template once (in `editorConfig`) and supplies a plain value; this view builds
 * the actual href.
 *
 * `editorConfig` (all optional, exactly one href source):
 *  - `route`  — an InvFlux SPA route (`/dispatch`, `/ledger/{subjectId}`); href via {@link HostNav.routeHref}
 *               so it is an in-app hash link under the unified app and an admin-page link standalone.
 *  - `page`   — a host admin page slug that is NOT an SPA route (a 3rd-party add-on's own page); href
 *               via {@link HostNav.pageHref}. Legitimately host-specific, so the server owns the slug.
 *  - `url`    — an absolute / off-site URL, authored whole; used verbatim (auto new-tab when http(s)).
 *  - `query`  — a query template (no leading `?`) appended to route/page/url.
 *  - `label`  — display-text template; defaults to `{value}` (the cell value, e.g. an order count).
 *  - `external` — force (or, =false, forbid) a new tab; auto-true for an absolute `url`.
 *  - `hideWhen` — `"zero"` | `"empty"`: render an em-dash instead of a link based on the cell value
 *                 (so an Orders count of 0 shows "—", not a link to an empty queue).
 *  - `hideForRole` — a row `role` (or list of roles) for which the whole cell is an em-dash: the
 *                 Ledger column sets `"parent"` because a variable parent is an aggregate, not one
 *                 subject with its own ledger.
 *
 * Templates interpolate `{value}` (the cell value) and `{fieldName}` — any row field (`{sku}`,
 * `{subjectId}`) OR any key in the row's `extra` bag (`{orders_subject_ids}`), so a non-core column's
 * data is templatable too. Path/url substitutions are URL-encoded. If a token in the *path*
 * (route/url, not the query) resolves empty — `/ledger/{subjectId}` with no subject — the cell
 * degrades to an em-dash; an empty *query* token instead renders the value unlinked (see below).
 */
interface LinkConfig {
  route?: string;
  page?: string;
  url?: string;
  query?: string;
  label?: string;
  external?: boolean;
  hideWhen?: 'zero' | 'empty';
  hideForRole?: string | string[];
}

/** The resolved render decision: `"hide"` → em-dash; otherwise a label with an optional href (a null
 *  href means "show the value unlinked" — the target is indeterminate but the value is still real). */
export type LinkModel = 'hide' | { href: string | null; label: string; external: boolean };

/** A HostNav-shaped subset the pure link builder needs — kept minimal so it's trivially fakeable. */
export interface LinkHostNav {
  routeHref(route: string, query?: string): string;
  pageHref(page: string): string | null;
  opensNewTab: boolean;
}

/**
 * Pure href/label composer for the `link` datatype — extracted from {@link LinkView} so the routing
 * rules (path- vs query-token emptiness, provenance dispatch, hide policies) are unit-testable without
 * rendering. Given the column config, the cell value, the row, and a host-nav port, returns what to
 * draw. See {@link LinkView}'s docblock for the `editorConfig` contract.
 */
export function computeLinkModel(
  cfg: LinkConfig,
  value: unknown,
  row: unknown,
  hostNav: LinkHostNav,
): LinkModel {
  const r = row as (Record<string, unknown> & { extra?: Record<string, unknown> }) | null;
  const interpolate = (tpl: string, encode: boolean): { text: string; hadEmpty: boolean } => {
    let hadEmpty = false;
    const text = tpl.replace(/\{(\w+)\}/g, (_m, token: string) => {
      // A token resolves from the cell value, then a core row field, then the row's `extra` bag — so a
      // non-core column's data (e.g. `orders_subject_ids`) is templatable alongside `{sku}`.
      const raw = token === 'value' ? value : (r?.[token] ?? r?.extra?.[token]);
      const s = raw === null || raw === undefined ? '' : String(raw);
      if (s === '') hadEmpty = true;
      return encode ? encodeURIComponent(s) : s;
    });
    return { text, hadEmpty };
  };

  if (cfg.hideForRole !== undefined) {
    const roles = Array.isArray(cfg.hideForRole) ? cfg.hideForRole : [cfg.hideForRole];
    const role = r?.role;
    if (typeof role === 'string' && roles.includes(role)) return 'hide';
  }

  if (
    cfg.hideWhen === 'zero' &&
    (value === 0 ||
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'number' && Number.isNaN(value)))
  )
    return 'hide';
  if (cfg.hideWhen === 'empty' && (value === null || value === undefined || value === ''))
    return 'hide';

  const q =
    typeof cfg.query === 'string' ? interpolate(cfg.query, true) : { text: '', hadEmpty: false };
  const query = typeof cfg.query === 'string' ? q.text : undefined;
  const withQuery = (base: string): string =>
    query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base;
  // An empty query token makes the target indeterminate → render the value unlinked (not a dash).
  const linkable = !q.hadEmpty;

  let href: string | null = null;
  let external = cfg.external ?? false;

  if (typeof cfg.route === 'string') {
    const rr = interpolate(cfg.route, true);
    if (rr.hadEmpty) return 'hide'; // path token empty (e.g. /ledger/{subjectId}) — no target at all
    if (linkable) {
      href = hostNav.routeHref(rr.text, query);
      if (cfg.external === undefined) external = hostNav.opensNewTab;
    }
  } else if (typeof cfg.page === 'string') {
    const base = hostNav.pageHref(cfg.page);
    if (base === null) return 'hide';
    if (linkable) href = withQuery(base);
  } else if (typeof cfg.url === 'string') {
    const u = interpolate(cfg.url, false);
    if (u.hadEmpty) return 'hide';
    if (linkable) {
      href = withQuery(u.text);
      if (cfg.external === undefined && /^https?:\/\//i.test(href)) external = true;
    }
  }

  const label = interpolate(typeof cfg.label === 'string' ? cfg.label : '{value}', false).text;
  return { href, label: label.trim() === '' ? DASH : label, external };
}

function LinkView(props: ViewProps) {
  const hostNav = useHostNav();
  const model = (): LinkModel =>
    computeLinkModel(
      (props.column?.editorConfig ?? {}) as LinkConfig,
      props.value,
      props.row,
      hostNav,
    );

  return (
    <Show when={model() !== 'hide'} fallback={<span class="text-text-muted">{DASH}</span>}>
      {(() => {
        const m = model() as Exclude<LinkModel, 'hide'>;
        return (
          <Show when={m.href !== null} fallback={<span class="tabular-nums">{m.label}</span>}>
            <a
              class="tabular-nums text-blue-700 hover:underline"
              href={m.href ?? undefined}
              target={m.external ? '_blank' : undefined}
              rel="noopener noreferrer"
            >
              {m.label}
            </a>
          </Show>
        );
      })()}
    </Show>
  );
}

viewRegistry.register('text', 'core.text', TextView, { default: true });
viewRegistry.register('number', 'core.number', NumberView, { default: true });
viewRegistry.register('decimal', 'core.decimal', DecimalView, { default: true });
viewRegistry.register('decimal:money', 'core.money', MoneyView, { default: true });
viewRegistry.register('enum', 'core.enum', EnumView, { default: true });
viewRegistry.register('bool', 'core.bool', BoolView, { default: true });
viewRegistry.register('date', 'core.date', DateView, { default: true });
viewRegistry.register('image:url', 'core.image', ImageUrlView, { default: true });
viewRegistry.register('term-picker:wc-taxonomy', 'core.term-list', TermPickerView, {
  default: true,
});
viewRegistry.register('stock-concerns', 'core.stock-concerns', StockConcernsView, {
  default: true,
});
viewRegistry.register('supplier-pills', 'core.supplier-pills', SupplierPillsView, {
  default: true,
});
viewRegistry.register('text:product-type', 'core.product-type', ProductTypeView, { default: true });
// `link:count` (Orders) and any `link:*` variant resolve to this via the datatype parent chain.
viewRegistry.register('link', 'core.link', LinkView, { default: true });
