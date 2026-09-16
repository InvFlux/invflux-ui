import { __, _x, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, SearchSelect, toast, Hint } from '@invflux/ui';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import {
  countryName,
  countryOptions,
  currencyOptions,
  stateName,
  stateOptions,
} from '../../lib/geo';
import { usePortalRoot } from '../../portal';
import type { ProcurementContext } from '../../types';
import { PoList } from '../purchase-orders/PoList';
import { SupplierContacts } from './SupplierContacts';
import { SupplierProducts } from './SupplierProducts';
import type { Supplier } from './types';
import { storeTermsLabel, useTermsSets } from '../terms/useTermsSets';
import { TermsModal, type TermsModalTarget } from '../terms/TermsModal';
import type { TermsPlace } from '../terms/types';

const INPUT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-surface';
const FIELD = 'block text-sm text-slate-700';

/**
 * Purchase tax regimes — the `value`s mirror core's `SupplierTaxTreatment` and are the wire
 * contract; the wording is ours. Labels stay lazy (`() => __()`) so they resolve at render, after
 * the translations are in.
 */
const TAX_TREATMENTS: Array<{ value: string; label: () => string; hint: () => string }> = [
  {
    value: 'standard',
    label: () => __('Standard'),
    hint: () =>
      __(
        'Ordinary domestic purchasing — the supplier charges tax and the order shows net, tax and gross.',
      ),
  },
  {
    value: 'reverse_charge',
    label: () => __('Reverse charge'),
    hint: () =>
      __(
        'Cross-border business-to-business: the supplier invoices at 0% and you account for the tax yourself. Both tax numbers must appear on the order.',
      ),
  },
  {
    value: 'export_exempt',
    label: () => __('Import / export exempt'),
    hint: () =>
      __('Bought from outside your tax area — nothing is charged here; any tax arises at customs.'),
  },
  {
    value: 'exempt',
    label: () => __('Exempt'),
    hint: () =>
      __(
        'The goods or the supply are exempt in your jurisdiction — 0%, with the exemption stated on the order.',
      ),
  },
  {
    value: 'not_registered',
    label: () => __('Supplier not registered'),
    hint: () =>
      __(
        'The supplier is below the registration threshold and charges no tax at all — the order carries no tax block.',
      ),
  },
];

/** `POST /procurement/document-languages/{locale}` — the refreshed sets after an install. */
interface InstallLanguageResponse {
  installed: string;
  available: Record<string, string>;
  installable: Record<string, string>;
}

/**
 * Languages a purchase order can be written in, served by the server rather than mirrored here:
 * the set depends on which WordPress language packs the site has installed, so a static copy would
 * offer languages this install cannot actually produce. Each is named by its **endonym** — the
 * language's own name for itself, which is what the person choosing recognises and needs no
 * translation of its own.
 */
const asOptions = (map: Record<string, string>): Array<{ value: string; label: string }> =>
  Object.entries<string>(map ?? {}).map(([value, label]) => ({ value, label }));

/** A stored locale keeps its own name even if its pack has since been removed — never a bare code. */
const documentLocaleLabel = (ctx: ProcurementContext, value: string | null): string | null =>
  null === value ? null : (ctx.documentLocales?.[value] ?? value);

/** Regimes under which a rate actually reaches the order — mirrors `SupplierTaxTreatment::chargesTax()`. */
const CHARGES_TAX = ['standard'];

const taxTreatmentLabel = (value: string): string =>
  TAX_TREATMENTS.find((t) => t.value === value)?.label() ?? value;

const TABS: Array<{ key: string; label: () => string }> = [
  { key: 'details', label: () => __('Details') },
  { key: 'contacts', label: () => __('Contacts') },
  { key: 'pos', label: () => __('Purchase Orders') },
  { key: 'products', label: () => __('Catalog') },
];

/**
 * Supplier detail page: header + a lighter sub-tab row (distinct from the section tabs), with a
 * display↔edit Details tab (D2) and PO/Products tabs stubbed until their endpoints land. The
 * active sub-tab is deep-linkable: `/suppliers/:id` (details), `/suppliers/:id/pos`, `…/products`.
 */
export function SupplierDetail(props: { id: string }): JSX.Element {
  const api = createApi(useProcurement());
  const location = useLocation();
  const navigate = useNavigate();
  const tab = (): string => location.pathname.split('/').filter(Boolean)[2] ?? 'details';
  // The Products tab's catalogue grid portals its Save button into this header slot (next to "Create
  // replenishment PO") while keeping its own dirty model.
  const [saveSlot, setSaveSlot] = createSignal<HTMLElement>();

  const queryClient = useQueryClient();

  const query = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', props.id],
    queryFn: () => api.get<{ supplier: Supplier }>(`/procurement/suppliers/${props.id}`),
  }));

  // Create-PO-from-low-stock: a draft pre-filled with this supplier's short products → open it, or
  // toast when nothing's below threshold / in deficit.
  const replenish = createMutation(() => ({
    mutationFn: () =>
      api.post<{ purchaseOrder: { id: number } | null }>('/procurement/purchase-orders/replenish', {
        supplier_id: Number(props.id),
      }),
    onSuccess: (data) => {
      if (null === data.purchaseOrder) {
        toast.success(__('Nothing to reorder — no products below their reorder threshold.'));
        return;
      }
      toast.success(__('Replenishment draft created.'));
      // The draft is a new purchase order, so every cached PO list is now short one row. Without
      // this, navigating back from the draft shows a list that does not contain it — and the
      // merchant's reasonable conclusion is that the creation silently failed.
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      navigate(`/purchase-orders/${data.purchaseOrder.id}`);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : __('Could not create the replenishment draft.')),
  }));

  return (
    <section>
      <Show when={query.isPending}>
        <p class="mt-4 text-slate-500">{__('Loading supplier…')}</p>
      </Show>
      <Show when={query.isError}>
        <ErrorBanner class="mt-4">{__('Failed to load supplier.')}</ErrorBanner>
      </Show>

      <Show when={query.data?.supplier}>
        {(s) => (
          <>
            <header class="mb-2 flex flex-wrap items-end gap-3">
              <div class="flex flex-wrap items-baseline gap-3">
                <h1 class="text-xl font-semibold">{s().displayName}</h1>
                <Show when={s().nickname && s().nickname !== s().name}>
                  <span class="text-sm text-text-muted">{s().name}</span>
                </Show>
                <StatusPill status={s().status} />
              </div>
              <div class="ml-auto flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={replenish.isPending}
                  onClick={() => replenish.mutate()}
                  title={__(
                    'Create a draft PO for this supplier’s products at or below their reorder threshold',
                  )}
                >
                  {__('Create replenishment PO')}
                </Button>
                {/* Products tab's catalogue Save button portals in here (display:contents = lays out as a sibling). */}
                <span ref={setSaveSlot} class="contents" />
              </div>
            </header>

            <nav class="mb-4 flex gap-5 border-b border-slate-200 text-xs bg-surface px-2 pt-2">
              <For each={TABS}>
                {(t) => (
                  <A
                    href={
                      'details' === t.key
                        ? `/suppliers/${props.id}`
                        : `/suppliers/${props.id}/${t.key}`
                    }
                    class="-mb-px border-b-2 pb-1"
                    classList={{
                      'border-primary text-primary font-medium uppercase': tab() === t.key,
                      'border-transparent text-slate-500 hover:text-slate-700': tab() !== t.key,
                    }}
                  >
                    {t.label()}
                  </A>
                )}
              </For>
            </nav>

            <div class="pl-2">
              <Switch>
                <Match when={'contacts' === tab()}>
                  <SupplierContacts supplierId={Number(props.id)} />
                </Match>
                <Match when={'pos' === tab()}>
                  <PoList supplierId={Number(props.id)} />
                </Match>
                <Match when={'products' === tab()}>
                  <SupplierProducts
                    supplierId={Number(props.id)}
                    supplierLeadTime={s().leadTimeDays}
                    supplierCostDecimals={s().costDecimals}
                    saveSlot={saveSlot()}
                  />
                </Match>
                <Match when={true}>
                  <DetailsTab supplier={s()} />
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}

/** Details tab: read view that flips in-place to an edit form (D2 — no separate edit page). */
function DetailsTab(props: { supplier: Supplier }): JSX.Element {
  const [editing, setEditing] = createSignal(false);

  return (
    <Show
      when={editing()}
      fallback={<ReadView supplier={props.supplier} onEdit={() => setEditing(true)} />}
    >
      <EditForm supplier={props.supplier} onDone={() => setEditing(false)} />
    </Show>
  );
}

/** A supplier as the terms dialog names it — what applies to it, and how to make another set apply. */
function supplierTermsPlace(
  name: string,
  appliedId: number | null,
  via: 'chosen' | 'store',
): TermsPlace {
  return {
    appliedId,
    appliesText:
      'store' === via
        ? /* translators: %s: a supplier's name */
          sprintf(__('These terms apply to %s, as the store default.'), name)
        : /* translators: %s: a supplier's name */
          sprintf(__('These terms are set for %s.'), name),
    /* translators: %s: a supplier's name */
    useLabel: sprintf(__('Use these terms for %s'), name),
    /* translators: %s: a supplier's name */
    badge: sprintf(_x('For %s', 'terms list badge: the set a supplier has'), name),
    saveAndUse: (version) =>
      null === version
        ? /* translators: %s: a supplier's name */
          sprintf(__('Save and use for %s'), name)
        : /* translators: 1: the version number a save will create, 2: a supplier's name */
          sprintf(__('Save version %1$d and use for %2$s'), version, name),
  };
}

function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <dt class="text-slate-500">{props.label}</dt>
      <dd class="text-slate-800">{props.children}</dd>
    </>
  );
}

function ReadView(props: { supplier: Supplier; onEdit: () => void }): JSX.Element {
  const ctx = useProcurement();
  const termsSets = useTermsSets();
  const [termsModal, setTermsModal] = createSignal<TermsModalTarget | null>(null);
  const s = (): Supplier => props.supplier;
  const api = createApi(ctx);
  const queryClient = useQueryClient();
  /** Chosen from the read view, where there is no form Save: the supplier is saved at once. */
  const chooseForSupplierNow = async (id: number): Promise<void> => {
    if (
      id === (s().termsLineageId ?? termsSets.data?.sets.find((t) => t.isStoreDefault)?.id ?? null)
    ) {
      return;
    }
    await api.patch(`/procurement/suppliers/${s().id}`, { terms_lineage_id: id });
    await queryClient.invalidateQueries({ queryKey: ['procurement', 'suppliers'] });
  };
  const dash = (v: string | number | null): JSX.Element =>
    null === v || '' === v ? <span class="text-text-muted">—</span> : <>{v}</>;
  const address = (): string =>
    [
      s().addressLine,
      s().address2,
      [s().postcode, s().city].filter(Boolean).join(' '),
      stateName(ctx, s().country, s().state),
      countryName(ctx, s().country),
    ]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');

  return (
    <div>
      <dl class="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <Row label={__('Legal name')}>{s().name}</Row>
        <Row label={__('Nickname')}>{dash(s().nickname)}</Row>
        <Row label={__('Code')}>{dash(s().code)}</Row>
        <Row label={__('Our account no.')}>{dash(s().accountNumber)}</Row>
        <Row label={__('Tax registration number')}>{dash(s().taxNumber)}</Row>
        <Row label={__('Currency')}>{dash(s().currency)}</Row>
        <Row label={__('Payment terms')}>{dash(s().paymentTerms)}</Row>
        <Row label={__('Lead time')}>
          {null === s().leadTimeDays ? dash(null) : <>{s().leadTimeDays} d</>}
        </Row>
        <Row label={__('Email')}>{dash(s().email)}</Row>
        <Row label={__('Phone')}>{dash(s().phone)}</Row>
        <Row label={__('Website')}>{dash(s().website)}</Row>
        <Row label={__('Ordering URL')}>{dash(s().orderingUrl)}</Row>
        <Row label={__('Address')}>{dash(address())}</Row>
        <Row label={__('Tax treatment')}>{taxTreatmentLabel(s().taxTreatment)}</Row>
        {/* The rate is only meaningful under a regime that charges tax — under reverse charge or an
            exemption the supplier invoices at 0%, so showing a stored rate there would mislead. */}
        <Row label={__('Purchase tax rate')}>
          <Show
            when={CHARGES_TAX.includes(s().taxTreatment)}
            fallback={<span class="text-text-muted">{__('n/a under this regime')}</span>}
          >
            {null === s().defaultTaxRate ? dash(null) : <>{s().defaultTaxRate}%</>}
          </Show>
        </Row>
        <Show when={s().quotesIncludeTax}>
          <Row label={__('Quoted prices')}>{__('Tax-inclusive')}</Row>
        </Show>
        <Row label={__('Terms & conditions')}>
          <Show when={termsModal()}>
            {(target) => <TermsModal target={target()} onClose={() => setTermsModal(null)} />}
          </Show>
          <Show
            when={s().termsLineageId}
            fallback={
              <>
                <span class="text-text-muted">{storeTermsLabel(termsSets.data?.sets)}</span>
                {/* Inheriting: the store's set, or — with none — the list of sets to choose from. */}
                <Show when={ctx.capabilities.managePurchaseOrders}>
                  <button
                    type="button"
                    class="ml-2 text-xs text-primary hover:underline"
                    data-testid="supplier-terms-view"
                    onClick={() =>
                      setTermsModal({
                        kind: 'set',
                        id: termsSets.data?.sets.find((t) => t.isStoreDefault)?.id ?? null,
                        useHere: chooseForSupplierNow,
                        place: supplierTermsPlace(
                          s().displayName,
                          termsSets.data?.sets.find((t) => t.isStoreDefault)?.id ?? null,
                          'store',
                        ),
                      })
                    }
                  >
                    {undefined === termsSets.data?.sets.find((t) => t.isStoreDefault)
                      ? __('Choose or write purchase terms')
                      : __('View or edit purchase terms')}
                  </button>
                </Show>
              </>
            }
          >
            {(id) => (
              <>
                {termsSets.data?.sets.find((t) => t.id === id())?.name ?? __('A set of terms')}
                <Show when={ctx.capabilities.managePurchaseOrders}>
                  <button
                    type="button"
                    class="ml-2 text-xs text-primary hover:underline"
                    data-testid="supplier-terms-view"
                    onClick={() =>
                      setTermsModal({
                        kind: 'set',
                        id: id(),
                        useHere: chooseForSupplierNow,
                        place: supplierTermsPlace(s().displayName, id(), 'chosen'),
                      })
                    }
                  >
                    {__('View or edit purchase terms')}
                  </button>
                </Show>
              </>
            )}
          </Show>
        </Row>
        <Row label={__('Document language')}>
          <Show
            when={documentLocaleLabel(ctx, s().documentLanguage)}
            fallback={<span class="text-text-muted">{__('Store default')}</span>}
          >
            {(label) => <>{label()}</>}
          </Show>
        </Row>
        <Row label={__('Status')}>
          <StatusPill status={s().status} />
        </Row>
      </dl>
      <Button variant="secondary" class="mt-5" onClick={props.onEdit}>
        {__('Edit')}
      </Button>
    </div>
  );
}

const SECTION = 'mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted';

function EditForm(props: { supplier: Supplier; onDone: () => void }): JSX.Element {
  const ctx = useProcurement();
  const termsSets = useTermsSets();
  const api = createApi(ctx);
  const queryClient = useQueryClient();
  const s = props.supplier;

  const [name, setName] = createSignal(s.name);
  const [nickname, setNickname] = createSignal(s.nickname ?? '');
  const [code, setCode] = createSignal(s.code ?? '');
  const [taxNumber, setTaxNumber] = createSignal(s.taxNumber ?? '');
  const [currency, setCurrency] = createSignal(s.currency || ctx.geo.baseCurrency || 'EUR');
  const [paymentTerms, setPaymentTerms] = createSignal(s.paymentTerms ?? '');
  const [leadTime, setLeadTime] = createSignal(
    null === s.leadTimeDays ? '' : String(s.leadTimeDays),
  );
  const [costDecimals, setCostDecimals] = createSignal(String(s.costDecimals));
  const [email, setEmail] = createSignal(s.email ?? '');
  const [phone, setPhone] = createSignal(s.phone ?? '');
  const [website, setWebsite] = createSignal(s.website ?? '');
  const [orderingUrl, setOrderingUrl] = createSignal(s.orderingUrl ?? '');
  const [address1, setAddress1] = createSignal(s.address1 ?? '');
  const [buildingNumber, setBuildingNumber] = createSignal(s.buildingNumber ?? '');
  const [address2, setAddress2] = createSignal(s.address2 ?? '');
  const [city, setCity] = createSignal(s.city ?? '');
  const [state, setState] = createSignal(s.state ?? '');
  const [postcode, setPostcode] = createSignal(s.postcode ?? '');
  const [country, setCountry] = createSignal(s.country || ctx.geo.baseCountry || '');
  const [accountNumber, setAccountNumber] = createSignal(s.accountNumber ?? '');
  const [termsLineageId, setTermsLineageId] = createSignal(
    null === s.termsLineageId ? '' : String(s.termsLineageId),
  );
  const [termsModal, setTermsModal] = createSignal<TermsModalTarget | null>(null);
  /** The set the picker stands on: the one chosen, else the store's default the supplier inherits. */
  const pickedSetId = (): number | null =>
    '' !== termsLineageId()
      ? Number(termsLineageId())
      : (termsSets.data?.sets.find((t) => t.isStoreDefault)?.id ?? null);
  // A set made from here — new, or an edited copy of a shared one — is chosen in the picker, and the
  // supplier's Save commits it with the rest of the form. Choosing the store's set while the supplier
  // inherits it leaves it inheriting, so it keeps following the store.
  const chooseForSupplier = (id: number): void => {
    if ('' === termsLineageId() && id === pickedSetId()) {
      return;
    }
    setTermsLineageId(String(id));
  };
  const [documentLanguage, setDocumentLanguage] = createSignal(s.documentLanguage ?? '');
  // Both sets are local copies of the boot context, because installing a language changes them and
  // the merchant should see the result in place rather than after a reload.
  const [availableLocales, setAvailableLocales] = createSignal(ctx.documentLocales ?? {});
  const [installableLocales, setInstallableLocales] = createSignal(ctx.installableLocales ?? {});
  const [installingLocale, setInstallingLocale] = createSignal<string | null>(null);

  // Adding a WordPress translation so a purchase order can be written in that language. Deliberately
  // an explicit action: it fetches from wordpress.org and took ~3s in testing, so it can never be
  // something a render sets off. The affordance appears only when the server said this user could
  // do it — it re-checks anyway, since a client-side absence is a courtesy, not a gate.
  const installLanguage = async (locale: string): Promise<void> => {
    setInstallingLocale(locale);
    try {
      const r = await api.post<InstallLanguageResponse>(
        `/procurement/document-languages/${locale}`,
        {},
      );
      setAvailableLocales(r.available);
      setInstallableLocales(r.installable);
      setDocumentLanguage(r.installed); // they asked for this language — select it, don't make them hunt
      toast.success(
        sprintf(
          __('%s added. Purchase orders can now be written in it.'),
          r.available[r.installed] ?? locale,
        ),
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : __('Could not add that language.'));
    } finally {
      setInstallingLocale(null);
    }
  };
  const [defaultTaxRate, setDefaultTaxRate] = createSignal(s.defaultTaxRate ?? '');
  const [taxTreatment, setTaxTreatment] = createSignal(s.taxTreatment);
  const [quotesIncludeTax, setQuotesIncludeTax] = createSignal(s.quotesIncludeTax);
  const [status, setStatus] = createSignal(s.status);

  const portalRoot = usePortalRoot();

  const chargesTax = (): boolean => CHARGES_TAX.includes(taxTreatment());
  const taxTreatmentHint = (): string =>
    TAX_TREATMENTS.find((t) => t.value === taxTreatment())?.hint() ?? '';

  // Show a state dropdown only when WC has a list for the chosen country AND the current value fits
  // it (a legacy free-text value falls back to a text input so it stays visible/editable).
  const stateSelectable = (): boolean => {
    const opts = stateOptions(ctx, country());
    return opts.length > 0 && ('' === state() || opts.some((o) => o.value === state()));
  };

  const mutation = createMutation(() => ({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<{ supplier: Supplier }>(`/procurement/suppliers/${s.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['procurement', 'suppliers'] });
      toast.success(__('Supplier saved.'));
      props.onDone();
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
  }));

  const submit = (e: Event): void => {
    e.preventDefault();
    if ('' === name().trim()) return;
    const body: Record<string, unknown> = {
      name: name().trim(),
      nickname: nickname().trim() || null,
      code: code().trim() || null,
      tax_number: taxNumber().trim() || null,
      default_currency: currency(),
      payment_terms: paymentTerms().trim() || null,
      lead_time_days: '' === leadTime().trim() ? null : Number(leadTime()),
      cost_decimals: Number(costDecimals()),
      email: email().trim() || null,
      phone: phone().trim() || null,
      website: website().trim() || null,
      ordering_url: orderingUrl().trim() || null,
      address_1: address1().trim() || null,
      building_number: buildingNumber().trim() || null,
      address_2: address2().trim() || null,
      city: city().trim() || null,
      state: state().trim() || null,
      postcode: postcode().trim() || null,
      country: country().trim() || null,
      account_number: accountNumber().trim() || null,
      terms_lineage_id: '' === termsLineageId() ? null : Number(termsLineageId()),
      document_language: documentLanguage() || null,
      default_tax_rate: '' === defaultTaxRate().trim() ? null : defaultTaxRate().trim(),
      tax_treatment: taxTreatment(),
      quotes_include_tax: quotesIncludeTax(),
      status: status(),
    };
    mutation.mutate(body);
  };

  return (
    <>
      {/* Outside the form, so no button in the dialog can submit the supplier. */}
      <Show when={termsModal()}>
        {(target) => <TermsModal target={target()} onClose={() => setTermsModal(null)} />}
      </Show>
      <form class="max-w-lg" onSubmit={submit}>
        <div class="grid grid-cols-2 gap-3">
          <label class={FIELD}>
            {__('Legal name')} <span class="text-red-600">*</span>
            <input
              class={INPUT}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              required
            />
          </label>
          <label class={FIELD}>
            {__('Nickname')}{' '}
            <Hint
              text={__(
                'A short display name used where space is tight (lists, badges, PO headers) when the legal name is long.',
              )}
            />
            <input
              class={INPUT}
              value={nickname()}
              onInput={(e) => setNickname(e.currentTarget.value)}
            />
          </label>
          <label class={FIELD}>
            {__('Code')}{' '}
            <Hint
              text={__(
                'Your internal reference for this supplier — e.g. an accounting or ERP supplier number. Free-form; not a URL slug, and not shown to the supplier.',
              )}
            />
            <input class={INPUT} value={code()} onInput={(e) => setCode(e.currentTarget.value)} />
          </label>
          <label class={FIELD}>
            {__('Tax registration number')}{' '}
            <Hint
              text={__(
                "The supplier's number with their own tax authority — a VAT number in the EU, a GSTIN in India, an INN in Russia, a CNPJ in Brazil. Purchase orders name it after the supplier's country. Where a country issues several at once, enter them together.",
              )}
            />
            <input
              class={INPUT}
              value={taxNumber()}
              onInput={(e) => setTaxNumber(e.currentTarget.value)}
            />
          </label>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-3">
          <div class={FIELD}>
            {__('Currency')}
            <div class="mt-1">
              <SearchSelect
                ariaLabel={__('Currency')}
                options={currencyOptions(ctx)}
                value={currency() || null}
                onChange={(v) => setCurrency(v ?? '')}
                placeholder={__('Select a currency…')}
                mount={portalRoot}
              />
            </div>
          </div>
          <label class={FIELD}>
            {__('Lead time (days)')}
            <input
              class={INPUT}
              type="number"
              min="0"
              value={leadTime()}
              onInput={(e) => setLeadTime(e.currentTarget.value)}
            />
          </label>
          <label class={FIELD}>
            {__('Cost decimals')}
            <select
              class={INPUT}
              value={costDecimals()}
              onChange={(e) => setCostDecimals(e.currentTarget.value)}
            >
              <For each={['0', '1', '2', '3', '4']}>{(d) => <option value={d}>{d}</option>}</For>
            </select>
          </label>
        </div>
        <label class={`${FIELD} mt-3`}>
          {__('Payment terms')}
          <input
            class={INPUT}
            value={paymentTerms()}
            onInput={(e) => setPaymentTerms(e.currentTarget.value)}
          />
        </label>

        <h3 class={SECTION}>{__('Contact')}</h3>
        <div class="grid grid-cols-2 gap-3">
          <label class={FIELD}>
            {__('Email')}
            <input
              class={INPUT}
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label class={FIELD}>
            {__('Phone')}
            <input class={INPUT} value={phone()} onInput={(e) => setPhone(e.currentTarget.value)} />
          </label>
          <label class={FIELD}>
            {__('Website')}
            <input
              class={INPUT}
              type="url"
              value={website()}
              onInput={(e) => setWebsite(e.currentTarget.value)}
            />
          </label>
          <label class={FIELD}>
            {__('Ordering URL')}
            <input
              class={INPUT}
              type="url"
              value={orderingUrl()}
              onInput={(e) => setOrderingUrl(e.currentTarget.value)}
            />
          </label>
        </div>

        <h3 class={SECTION}>{__('Address')}</h3>
        <div class="grid grid-cols-[1fr_7rem] gap-3">
          <label class={FIELD}>
            {__('Street')}
            <input
              class={INPUT}
              value={address1()}
              onInput={(e) => setAddress1(e.currentTarget.value)}
            />
          </label>
          <label class={FIELD}>
            {_x('No.', 'abbreviation for house number, on a supplier address form')}
            <input
              class={INPUT}
              value={buildingNumber()}
              onInput={(e) => setBuildingNumber(e.currentTarget.value)}
            />
          </label>
        </div>
        <label class={`${FIELD} mt-3`}>
          {__('Address line 2')}
          <input
            class={INPUT}
            value={address2()}
            onInput={(e) => setAddress2(e.currentTarget.value)}
          />
        </label>
        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class={FIELD}>
            {__('City')}
            <input class={INPUT} value={city()} onInput={(e) => setCity(e.currentTarget.value)} />
          </label>
          <label class={FIELD}>
            {__('Postcode')}
            <input
              class={INPUT}
              value={postcode()}
              onInput={(e) => setPostcode(e.currentTarget.value)}
            />
          </label>
          <div class={FIELD}>
            {__('Country')}
            <div class="mt-1">
              <SearchSelect
                ariaLabel={__('Country')}
                options={countryOptions(ctx)}
                value={country() || null}
                onChange={(v) => {
                  const next = v ?? '';
                  if (next !== country()) setState(''); // a new country invalidates the previous state
                  setCountry(next);
                }}
                placeholder={__('Select a country…')}
                mount={portalRoot}
              />
            </div>
          </div>
          <div class={FIELD}>
            {__('State / region')}
            <div class="mt-1">
              <Show
                when={stateSelectable()}
                fallback={
                  <input
                    class={INPUT}
                    // The visible name sits on a `<div class={FIELD}>`, not a `<label>`, so there is
                    // no implicit association to inherit — the same string has to be stated here.
                    aria-label={__('State / region')}
                    value={state()}
                    onInput={(e) => setState(e.currentTarget.value)}
                  />
                }
              >
                <SearchSelect
                  ariaLabel={__('State / region')}
                  options={stateOptions(ctx, country())}
                  value={state() || null}
                  onChange={(v) => setState(v ?? '')}
                  placeholder={__('Select a state…')}
                  mount={portalRoot}
                />
              </Show>
            </div>
          </div>
        </div>

        {/* Commercial & tax — Essentials, not Pro. A purchase order that states the wrong tax (or
          states none where the regime demands a mention) is simply an incorrect document, and
          correctness is what the entry tier covers. */}
        <h3 class={SECTION}>{__('Commercial & tax')}</h3>
        <label class={FIELD}>
          {__('Our account no.')}{' '}
          <Hint
            text={__(
              'The customer reference the supplier holds for you — what their accounts department quotes. The mirror of “Code”, which is your reference for them.',
            )}
          />
          <input
            class={INPUT}
            value={accountNumber()}
            onInput={(e) => setAccountNumber(e.currentTarget.value)}
          />
        </label>
        <div class="mt-3 grid grid-cols-2 gap-3">
          <div class={FIELD}>
            {__('Tax treatment')} <Hint text={taxTreatmentHint()} />
            <select
              class={INPUT}
              aria-label={__('Tax treatment')}
              value={taxTreatment()}
              onChange={(e) => setTaxTreatment(e.currentTarget.value)}
            >
              <For each={TAX_TREATMENTS}>{(t) => <option value={t.value}>{t.label()}</option>}</For>
            </select>
          </div>
          {/* Only the charging regimes take a rate — under reverse charge or an exemption the supplier
            invoices at 0%, so an editable rate there would be a field that does nothing. */}
          <label class={FIELD} classList={{ 'opacity-50': !chargesTax() }}>
            {__('Purchase tax rate (%)')}
            <input
              class={INPUT}
              type="number"
              min="0"
              step="0.01"
              disabled={!chargesTax()}
              placeholder={chargesTax() ? '' : __('n/a under this regime')}
              value={defaultTaxRate()}
              onInput={(e) => setDefaultTaxRate(e.currentTarget.value)}
            />
          </label>
        </div>
        <label class="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={quotesIncludeTax()}
            onChange={(e) => setQuotesIncludeTax(e.currentTarget.checked)}
          />
          <span>
            {__('This supplier quotes tax-inclusive prices')}{' '}
            <Hint
              text={__(
                'Only changes how you type a cost in: a gross price is converted down on entry, so what is stored — and what every cost figure means — stays net.',
              )}
            />
          </span>
        </label>
        <label class={`${FIELD} mt-3`}>
          {__('Terms & conditions')}{' '}
          <Hint
            text={__(
              'The set of purchase terms printed on this supplier’s orders. Choose none to use the store’s terms; a single order can still choose another.',
            )}
          />
          <select
            class={INPUT}
            value={termsLineageId()}
            onChange={(e) => setTermsLineageId(e.currentTarget.value)}
          >
            {/* `selected` per option: a set made in the dialog is chosen before its option arrives. */}
            <option value="" selected={'' === termsLineageId()}>
              {storeTermsLabel(termsSets.data?.sets)}
            </option>
            <For each={termsSets.data?.sets ?? []}>
              {(t) => (
                <option value={String(t.id)} selected={String(t.id) === termsLineageId()}>
                  {t.name}
                </option>
              )}
            </For>
          </select>
        </label>
        {/* Outside the label: a click inside a label is forwarded to its field. */}
        {/* With no set to show — none chosen, and no store default — the dialog opens on the list. */}
        <Show when={ctx.capabilities.managePurchaseOrders}>
          <button
            type="button"
            class="mt-1 text-xs text-primary hover:underline"
            data-testid="supplier-terms-open"
            onClick={() =>
              setTermsModal({
                kind: 'set',
                id: pickedSetId(),
                useHere: chooseForSupplier,
                place: supplierTermsPlace(
                  s.displayName,
                  pickedSetId(),
                  '' === termsLineageId() ? 'store' : 'chosen',
                ),
              })
            }
          >
            {null === pickedSetId()
              ? __('Choose or write purchase terms')
              : __('View or edit purchase terms')}
          </button>
        </Show>
        <label class={`${FIELD} mt-3`}>
          {__('Document language')}{' '}
          {/* States what the list *is*, so an absent language is not a mystery — but no procedure:
            adding one is a WordPress step, and that belongs beside the store-wide setting where
            there is room for it, not in a tooltip. */}
          <Hint
            text={__(
              'Purchase orders for this supplier are written in this language. The list holds the languages WordPress already has a translation for on this site and that InvFlux has purchase-order wording for; English always counts. Leave it empty to use the default purchase order language.',
            )}
          />
          <select
            class={INPUT}
            value={documentLanguage()}
            onChange={(e) => setDocumentLanguage(e.currentTarget.value)}
          >
            {/* Not "your store's language" — an empty value falls to the store-wide *default purchase
              order language* setting, which ships as English rather than the admin's own. */}
            <option value="">{__('Use the default purchase order language')}</option>
            <For each={asOptions(availableLocales())}>
              {(l) => <option value={l.value}>{l.label}</option>}
            </For>
          </select>
        </label>
        {/* The languages this site could speak but does not yet. Absent entirely when the server said
          this user cannot install them, so nobody is shown a door they cannot open. */}
        <Show when={asOptions(installableLocales()).length > 0}>
          <p class="mt-2 text-sm text-slate-500">
            {__('Not installed yet:')}{' '}
            <For each={asOptions(installableLocales())}>
              {(l, i) => (
                <>
                  {i() > 0 ? ' · ' : ''}
                  <button
                    type="button"
                    class="underline decoration-dotted underline-offset-2 hover:text-slate-800 disabled:no-underline disabled:opacity-50"
                    title={sprintf(
                      __('Add %s to WordPress so purchase orders can be written in it'),
                      l.label,
                    )}
                    disabled={null !== installingLocale()}
                    onClick={() => void installLanguage(l.value)}
                  >
                    {installingLocale() === l.value ? sprintf(__('Adding %s…'), l.label) : l.label}
                  </button>
                </>
              )}
            </For>
          </p>
        </Show>

        <label class={`${FIELD} mt-6`}>
          {__('Status')}
          <select class={INPUT} value={status()} onChange={(e) => setStatus(e.currentTarget.value)}>
            <option value="active">{__('Active')}</option>
            <option value="inactive">{__('Inactive')}</option>
          </select>
        </label>

        <Show when={mutation.isError}>
          <ErrorBanner class="mt-3 text-sm">{(mutation.error as Error).message}</ErrorBanner>
        </Show>

        <div class="mt-5 flex gap-2">
          <Button type="submit" disabled={mutation.isPending || '' === name().trim()}>
            {mutation.isPending ? __('Saving…') : __('Save')}
          </Button>
          <Button variant="ghost" onClick={props.onDone}>
            {__('Cancel')}
          </Button>
        </div>
      </form>
    </>
  );
}
