import { __, _n, sprintf } from '@invflux/i18n';
import { Button, Spinner } from '@invflux/ui';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { useApp } from '../../context';
import type { WelcomeProps } from '../../welcomeCatalog';
import { createWelcomeApi } from './api';

/** How many products one `adopt-all` request takes. Matches the endpoint's own default. */
const CHUNK = 100;

/** Where the adoption has got to. `idle` covers both "not started" and "start again after a failure". */
type AdoptPhase = 'idle' | 'running' | 'done' | 'declined' | 'failed';

/**
 * A numbered step card: the number badge, a title, and whatever the step needs to say or offer.
 *
 * Takes an optional `data-testid` so a step can publish which branch it is currently rendering — the
 * copy is translated, so the state has to be assertable without reading it.
 */
function Step(props: {
  n: number;
  title: string;
  done?: boolean;
  children: JSX.Element;
  'data-testid'?: string;
}): JSX.Element {
  return (
    <li class="flex gap-4 border-b border-slate-200 py-6 last:border-b-0" data-testid={props['data-testid']}>
      <span
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        classList={{
          'bg-green-100 text-green-800': true === props.done,
          'bg-slate-100 text-slate-600': true !== props.done,
        }}
        aria-hidden="true"
      >
        {props.done === true ? '✓' : props.n}
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-slate-900">{props.title}</h2>
        <div class="mt-2 space-y-3 text-sm text-slate-700">{props.children}</div>
      </div>
    </li>
  );
}

/**
 * The base install's **first-run screen** (`/welcome-to-essentials`) — the one guided pass from a cold
 * install to a governed catalogue.
 *
 * One contribution to the `onboarding.welcome` slot, the seam every family plugin uses for its own
 * first run. What is specific to this one is only its content: the HPOS gate and the catalogue
 * hand-over. The slug, the route, the tab and the settling all come from the seam.
 *
 * It exists because governance is opt-in: a fresh install *observes* and governs nothing, so a
 * merchant who never adopts has InvFlux installed and doing nothing visible. Everything here already
 * existed as machinery (the HPOS check, the chunked adopt endpoint, the workbench) — what was missing
 * was a place that puts them in order and says what each one means. Deliberately three steps on one
 * page rather than a multi-page wizard: there is no branching, and a merchant who wants to skip ahead
 * should be able to see the whole shape at once.
 *
 * Reached three ways: the one-time post-activation redirect, the post-install admin notice, and a
 * landing visit while the offer is outstanding. All three are *entrances*, not traps — nothing here
 * blocks navigating away, and leaving without acting settles nothing.
 *
 * Adoption drives the same keyset-chunked endpoint the merchant would hit from a bulk workbench edit,
 * looping from the browser so a catalogue of any size lands in bounded requests with no background
 * job. HPOS gates it: InvFlux requires HPOS as authoritative, so adopting into a store whose order
 * features cannot work would be handing over stock InvFlux then can't track through an order.
 */
export default function WelcomeSection(props: WelcomeProps): JSX.Element {
  const app = useApp();
  const api = createWelcomeApi(app);
  const navigate = useNavigate();

  const status = createQuery(() => ({
    queryKey: ['onboarding'],
    queryFn: () => api.status(),
    staleTime: 0,
  }));

  const [phase, setPhase] = createSignal<AdoptPhase>('idle');
  const [adopted, setAdopted] = createSignal(0);
  /**
   * The count the merchant was actually offered, frozen when the loop starts.
   *
   * `adoptable` is **not** a stable denominator: it counts `_manage_stock = yes` products, and
   * adopting a family sets that flag on the variable *parent* too — so the pool grows as the loop
   * runs (measured: 1449 → 1644 over one run, exactly the 195 parents). Left live, a refetch mid-run
   * moves the goalposts and the bar stalls or walks backwards. The number the merchant agreed to is
   * the honest one to report against.
   */
  const [offered, setOffered] = createSignal(0);

  const total = (): number => status.data?.adoptable ?? 0;
  const hposOn = (): boolean => true === status.data?.hpos_enabled;
  /**
   * Nothing left to adopt — for one of two opposite reasons, which must not be conflated.
   *
   * `managed === 0` is a store WooCommerce tracks no stock for; `adoptable === 0` with products
   * managed is a catalogue InvFlux already governs end to end. Reporting the first when the second is
   * true tells a merchant their catalogue is empty right after they handed all of it over.
   */
  const nothingToAdopt = (): boolean => undefined !== status.data && 0 === total();
  const nothingManaged = (): boolean => undefined !== status.data && 0 === (status.data.managed ?? 0);
  /**
   * The offer was already settled — by another tab, an earlier visit, or a run this page reloaded
   * away from.
   *
   * The first chunk clears the server's pending flag, so `pending === false` while this tab has done
   * nothing means someone already acted. Re-presenting the primary offer there is a lie the merchant
   * can act on: refreshing mid-adoption (because it "seems slow") would otherwise show the untouched
   * offer again and start a second concurrent loop. Re-running is idempotent, so this is a clarity
   * fix rather than a correctness one — but the first screen a merchant sees should not misreport
   * what their store just did.
   */
  const settledElsewhere = (): boolean =>
    'idle' === phase() && undefined !== status.data && false === status.data.pending && total() > 0;

  /**
   * Loop the chunked endpoint to completion.
   *
   * Stops on `done`, and also on a chunk that processed nothing while reporting work remaining —
   * without that second guard a product the writer cannot advance would spin the loop forever on the
   * same cursor.
   */
  async function adoptAll(): Promise<void> {
    setPhase('running');
    setAdopted(0);
    setOffered(total());
    let cursor = 0;
    try {
      for (;;) {
        const chunk = await api.adoptChunk(cursor, CHUNK);
        setAdopted((n) => n + chunk.processed);
        if (chunk.done || 0 === chunk.processed) break;
        cursor = chunk.last_id;
      }
      props.settle();
      setPhase('done');
    } catch {
      setPhase('failed');
    }
  }

  async function decline(): Promise<void> {
    try {
      await api.dismiss();
      props.settle();
      setPhase('declined');
    } catch {
      setPhase('failed');
    }
  }

  return (
    <div class="mx-auto max-w-3xl px-6 py-8">
      <h1 class="text-2xl font-semibold text-slate-900">{__('Welcome to InvFlux Essentials')}</h1>
      {/* Deliberately makes no claim about how much is already governed. The lead is rendered in
          every state this screen has — including a store that has just handed its whole catalogue
          over — so "it is not managing any stock yet" was false the moment anything was adopted, and
          on the "already all governed" branch it contradicted the step directly beneath it. Stating
          the rule instead of the current count is true in all of them. */}
      <p class="mt-2 text-sm text-slate-600">
        {__(
          'InvFlux is installed and watching your catalogue. Nothing has changed for your customers — and for every product you hand over, InvFlux takes authority over its stock.',
        )}
      </p>

      <Show
        when={undefined !== status.data}
        fallback={
          <div class="mt-8 flex items-center gap-2 text-sm text-slate-600">
            <Spinner />
            <span>{__('Checking your store…')}</span>
          </div>
        }
      >
        <ol class="mt-6">
          {/* ── 1. HPOS ─────────────────────────────────────────────────────────────────── */}
          <Step n={1} title={__('WooCommerce order storage')} done={hposOn()}>
            <Show
              when={hposOn()}
              fallback={
                <>
                  <p>
                    {__(
                      'InvFlux needs WooCommerce’s High-Performance Order Storage, which is currently off. Until it is on, InvFlux cannot follow your orders — so stock it manages could not be reserved or shipped correctly.',
                    )}
                  </p>
                  <p class="text-slate-600">
                    {__('Turn it on under WooCommerce → Settings → Advanced → Features, then check again.')}
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <a
                      class="text-primary underline"
                      href={status.data?.hpos_settings_url ?? '#'}
                    >
                      {__('Open WooCommerce settings')}
                    </a>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={status.isFetching}
                      onClick={() => void status.refetch()}
                    >
                      {__('Check again')}
                    </Button>
                  </div>
                </>
              }
            >
              <p>{__('High-Performance Order Storage is on. InvFlux can follow your orders.')}</p>
            </Show>
          </Step>

          {/* ── 2. Adopt ────────────────────────────────────────────────────────────────── */}
          <Step
            n={2}
            data-testid={`first-run-step2-${
              'done' === phase() || nothingToAdopt()
                ? 'settled'
                : settledElsewhere()
                  ? 'settled-elsewhere'
                  : phase()
            }`}
            title={__('Hand your catalogue to InvFlux')}
            done={'done' === phase() || nothingToAdopt() || settledElsewhere()}
          >
            <Switch>
              <Match when={nothingToAdopt() && nothingManaged()}>
                <p>
                  {__(
                    'WooCommerce is not managing stock for any product yet, so there is nothing to hand over. Any product you set to “Track stock” from now on can be given to InvFlux from its Inventory tab or from the workbench.',
                  )}
                </p>
              </Match>

              <Match when={nothingToAdopt()}>
                <p>
                  {sprintf(
                    /* translators: %d: number of products InvFlux already manages. */
                    _n(
                      'Your whole catalogue is already managed by InvFlux — %d product, nothing left to hand over.',
                      'Your whole catalogue is already managed by InvFlux — %d products, nothing left to hand over.',
                      status.data?.managed ?? 0,
                    ),
                    status.data?.managed ?? 0,
                  )}
                </p>
              </Match>

              <Match when={'done' === phase()}>
                <p>
                  {sprintf(
                    /* translators: %d: number of products adopted. */
                    _n(
                      '%d product is now managed by InvFlux. Its current WooCommerce stock became its opening balance.',
                      '%d products are now managed by InvFlux. Their current WooCommerce stock became their opening balance.',
                      adopted(),
                    ),
                    adopted(),
                  )}
                </p>
              </Match>

              <Match when={'declined' === phase()}>
                <p>
                  {__(
                    'Left as it is — WooCommerce still manages your stock. You can hand products to InvFlux one at a time from their Inventory tab, or in bulk from the workbench, whenever you are ready.',
                  )}
                </p>
              </Match>

              <Match when={'running' === phase()}>
                <p aria-live="polite">
                  {sprintf(
                    /* translators: %1$d: products adopted so far. %2$d: total to adopt. */
                    __('Adopting… %1$d of %2$d'),
                    adopted(),
                    offered(),
                  )}
                </p>
                <div class="h-1.5 w-full overflow-hidden rounded bg-slate-200">
                  <div
                    class="h-full bg-primary transition-[width]"
                    // Clamped: adoption pulls in family members the offer never counted, so the
                    // processed count can overrun the frozen denominator.
                    style={{
                      width: `${offered() > 0 ? Math.min(100, Math.round((adopted() / offered()) * 100)) : 0}%`,
                    }}
                  />
                </div>
              </Match>

              <Match when={settledElsewhere()}>
                <p>
                  {__(
                    'This step has already been handled — an adoption is running, or one has already been made, in another tab or an earlier visit.',
                  )}
                </p>
                <Button
                  data-testid="first-run-adopt-remaining"
                  variant="secondary"
                  disabled={!hposOn()}
                  onClick={() => void adoptAll()}
                >
                  {sprintf(
                    /* translators: %d: number of products still eligible for adoption. */
                    _n('Adopt the %d remaining product', 'Adopt the %d remaining products', total()),
                    total(),
                  )}
                </Button>
              </Match>

              <Match when={true}>
                <p>
                  {sprintf(
                    /* translators: %d: number of products WooCommerce currently manages. */
                    _n(
                      'WooCommerce manages stock for %d product. Adopting it makes InvFlux the source of truth: its current stock becomes the opening balance, every movement is recorded in the ledger, and WooCommerce keeps showing the right number — InvFlux updates it for you.',
                      'WooCommerce manages stock for %d products. Adopting them makes InvFlux the source of truth: their current stock becomes the opening balance, every movement is recorded in the ledger, and WooCommerce keeps showing the right number — InvFlux updates it for you.',
                      total(),
                    ),
                    total(),
                  )}
                </p>
                <Show when={'failed' === phase()}>
                  <p class="text-red-700" role="alert">
                    {__('Something went wrong. Nothing was lost — adopting again picks up where it stopped.')}
                  </p>
                </Show>
                <p class="text-slate-600">
                  {__('This is reversible: a product can be handed back to WooCommerce at any time.')}
                </p>
                {/* Said here rather than only in Settings: this is the one moment the merchant is
                    deciding to hand stock over, so it is the moment the trade-off is worth knowing.
                    Finding out later — when an import silently stops sticking — is far worse. */}
                <p class="text-slate-600">
                  {__(
                    'While InvFlux manages a product, other plugins can no longer change its stock — that is what keeps the numbers trustworthy. If you need one of them to keep updating stock, you can allow it under Settings → Stock-writing plugins.',
                  )}
                </p>
                {/* `data-testid` because every visible string here is translated and the store this
                    runs against is fr_FR — a text locator would assert the copy, not the behaviour,
                    and would break on any rewording. */}
                <div class="flex flex-wrap items-center gap-2">
                  <Button data-testid="first-run-adopt" disabled={!hposOn()} onClick={() => void adoptAll()}>
                    {sprintf(
                      /* translators: %d: number of products to adopt. */
                      _n('Adopt %d product', 'Adopt %d products', total()),
                      total(),
                    )}
                  </Button>
                  <Button data-testid="first-run-decline" variant="secondary" onClick={() => void decline()}>
                    {__('Not now')}
                  </Button>
                </div>
                <Show when={!hposOn()}>
                  <p class="text-slate-500">{__('Finish step 1 first.')}</p>
                </Show>
              </Match>
            </Switch>
          </Step>

          {/* ── 3. Land somewhere useful ────────────────────────────────────────────────── */}
          <Step n={3} title={__('Start working')}>
            <p>
              {__(
                'The workbench is your catalogue at a glance: what each product has on hand, what is promised to orders, and what is running low.',
              )}
            </p>
            <Button data-testid="first-run-workbench" onClick={() => navigate('/workbench')}>
              {__('Open the workbench')}
            </Button>
          </Step>
        </ol>
      </Show>
    </div>
  );
}
