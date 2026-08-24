import { __, formatDate, sprintf } from '@invflux/i18n';
import { Button, ConfirmModal, buttonClass, toast } from '@invflux/ui';
import { A } from '@solidjs/router';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { useApp } from '../../context';
import { ESSENTIALS_WELCOME, welcomePage, welcomePath } from '../../welcomeCatalog';
import { ApiError, createLicensesApi } from './api';
import {
  type AccountOutcome,
  classify,
  mergeCatalog,
  pendingEmail,
  shouldShowOwnedLicenses,
} from './catalog';
import type {
  AddonAction,
  AddonState,
  CatalogRow,
  CatalogSku,
  OwnedLicense,
  Seat,
  SiteSeat,
  SiteStatus,
} from './types';

/** State → a pill caption + Tailwind classes. Unknown states fall back to a neutral slate pill. */
function stateMeta(state: string): { label: string; class: string } {
  switch (state) {
    case 'active':
      return { label: __('Active'), class: 'bg-green-100 text-green-800' };
    case 'lapsed':
      return { label: __('Lapsed'), class: 'bg-amber-100 text-amber-800' };
    case 'cancelled':
      return { label: __('Cancelled'), class: 'bg-slate-200 text-slate-700' };
    case 'revoked':
      return { label: __('Revoked'), class: 'bg-red-100 text-red-800' };
    default:
      return { label: state, class: 'bg-slate-100 text-slate-700' };
  }
}

/** A small status pill. */
function StatePill(props: { state: string }): JSX.Element {
  const meta = (): { label: string; class: string } => stateMeta(props.state);
  return (
    <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta().class}`}>
      {meta().label}
    </span>
  );
}

/**
 * The **Licenses & Add-ons** section (unified SPA, `/licenses`) — the customer-facing surface for the
 * whole licence lifecycle: owned licences & seats, cancel a subscription, free a remote seat, and one
 * catalogue holding the whole product family in whatever state each product is in here. It talks only
 * to the same-origin account proxy (`invflux/v1/account/*`); the account bearer never reaches the
 * browser (adapter attaches it server-side), and the catalogue read carries no bearer at all.
 *
 * A direct route (like Settings / Ledger), so it mounts on visit — its refocus-poll listeners are
 * scoped to while the page is open. After a checkout hands off to the MoR in a new tab, returning to
 * this tab re-reads owned state (the webhook already minted; no activate step).
 */
export default function LicensesSection(): JSX.Element {
  const app = useApp();
  const api = createLicensesApi(app);
  const queryClient = useQueryClient();

  const account = createQuery(() => ({
    queryKey: ['account'],
    queryFn: () => api.getAccount(),
    // A 409 (not linked yet) is a terminal prompt-to-activate, not a transient error — don't retry it.
    retry: (count: number, err: unknown) => !(err instanceof ApiError) && count < 1,
  }));

  /**
   * The product estate. Keyed **outside** `['account']` deliberately: the refocus poll below
   * invalidates that whole prefix, and a public product list has no business being re-read every
   * time the window regains focus. One read per visit, which is what makes it user-initiated.
   */
  const catalog = createQuery(() => ({
    queryKey: ['catalog'],
    queryFn: () => api.getCatalog(),
    staleTime: 12 * 60 * 60 * 1000,
  }));

  // Refocus-poll: after handing off to the MoR's hosted checkout in another tab, returning here
  // re-reads owned licences so a freshly-minted entitlement shows without a manual refresh (§5).
  onMount(() => {
    const refetch = (): void => void queryClient.invalidateQueries({ queryKey: ['account'] });
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refetch();
    };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  /**
   * The last account outcome that actually *settled* — what the page renders from.
   *
   * A query holding no data (an unlinked site's 409, a failed read) is reset to `pending` with its
   * error cleared for the duration of every refetch, so reading the query directly would blank the
   * register card and flash a loading line each time the refocus poll above fires — on a page that
   * has been sitting there fully rendered. A read in flight is not a state change: keep showing the
   * last conclusion until a new one lands. Reads that carry data need none of this; their data
   * stays put across a refetch.
   */
  const [outcome, setOutcome] = createSignal<AccountOutcome>('ok');
  /** The address a confirmation link went to, while this site waits for it to be opened. */
  const [awaitingEmail, setAwaitingEmail] = createSignal<string | null>(null);
  createEffect(() => {
    const error: unknown = account.error;
    if (!account.isFetching) {
      setOutcome(classify(error));
      setAwaitingEmail(pendingEmail(error));
    }
  });

  /**
   * The merchant asked to register a different address than the one waiting for confirmation.
   *
   * Why is not knowable from here — a typo, an inbox they cannot reach, or a different account
   * entirely all arrive as the same click — so nothing downstream should assume one. What the flag
   * means is only that they want the form back.
   */
  const [changingAddress, setChangingAddress] = createSignal(false);

  /**
   * What to seed the registration field with — the reader's own WordPress address, unless that is
   * the one already waiting on a confirmation.
   *
   * The narrower rule is the defensible one. Why someone opened "use a different address" is not
   * knowable from here: a typo, an inbox they cannot reach, or simply a different account are all
   * the same click. What *is* knowable is that offering the address that just produced a
   * confirmation-required cannot help — pressing Register on it again only mails a second link.
   *
   * So the check is against the pending address, not against how the merchant got here. When they
   * typed something custom and it collided, the WordPress address is still a fresh, useful default
   * and is offered; when the collision *was* the WordPress address, the field starts empty.
   */
  const registrationDefaultEmail = (): string => {
    const own = app.currentUser.email ?? '';
    return own !== '' && own === awaitingEmail() ? '' : own;
  };

  /** No account, and none on the way — show the register card, not an error. */
  const notLinked = (): boolean => outcome() === 'not_linked';

  /**
   * Registered, licensed, and one click in someone's inbox away from an account.
   *
   * Deliberately not folded into `notLinked`: this site has already registered, and offering it the
   * registration form again would mail a second confirmation and resolve nothing.
   */
  const awaitingConfirmation = (): boolean => outcome() === 'awaiting_confirmation';

  /**
   * Registered once, then deliberately left — usually to stop the daily check-in.
   *
   * The page owes this state a *quieter* answer than the register card, not a different offer. The
   * way back is the same one sentence and the same form; what changes is that it stops being the
   * first thing on the page, which is the whole substance of respecting the decision.
   */
  const withdrawn = (): boolean => outcome() === 'withdrawn';

  /** Nothing to attach a purchase to — any of the three. */
  const noAccount = (): boolean => notLinked() || awaitingConfirmation() || withdrawn();

  /**
   * The licensing service didn't answer *and* the adapter had no snapshot to fall back on. With a
   * snapshot the read succeeds instead, flagged `stale` — hence two separate signals.
   */
  const serviceDown = (): boolean => outcome() === 'unreachable';
  /** A failure that is neither of the two the page has an answer for. */
  const hardError = (): boolean => outcome() === 'failed';
  /** The very first read. A refetch behind an already-rendered page is not a loading state. */
  const firstLoad = (): boolean => account.isPending && outcome() === 'ok';
  /**
   * Rendering a remembered payload: everything shows, but nothing here was confirmed just now.
   *
   * Suppressed while the unreachable panel is up. Both describe the same outage, and one read
   * falling back to a snapshot while another has none is a distinction the merchant cannot act on —
   * two stacked notices saying the service is down read as two problems.
   */
  const showingSnapshot = (): boolean =>
    !serviceDown() && (account.data?.stale === true || catalog.data?.stale === true);

  // One list. A licence is a licence — which SKU it names, and whether that SKU happens to ship a
  // plugin, is not a property of the licence and was never a reason to file it somewhere else.
  const licenses = (): OwnedLicense[] => account.data?.licenses ?? [];

  // A pending checkout URL kept visible as a manual fallback in case the popup was blocked (§6).
  const [checkoutUrl, setCheckoutUrl] = createSignal<string | null>(null);
  const [pendingPlan, setPendingPlan] = createSignal<string | null>(null);
  // The licence key awaiting a cancel confirmation, or the seat awaiting a deactivate confirmation.
  const [cancelId, setCancelId] = createSignal<string | null>(null);
  const [seatToFree, setSeatToFree] = createSignal<Seat | null>(null);
  /** Whether the un-register confirmation is up. */
  const [confirmWithdraw, setConfirmWithdraw] = createSignal(false);

  const checkout = createMutation(() => ({
    mutationFn: (plan: string) => api.checkout({ plan }),
    onMutate: (plan: string) => setPendingPlan(plan),
    onSettled: () => setPendingPlan(null),
    onSuccess: (res) => {
      setCheckoutUrl(res.checkout_url);
      const win = window.open(res.checkout_url, '_blank', 'noopener,noreferrer');
      if (win === null) {
        toast.warning(__('Your browser blocked the checkout window — use the “Open checkout” link below.'));
      } else {
        toast.info(__('Complete your purchase in the new tab. We’ll refresh this page when you return.'));
      }
    },
    onError: (err: unknown) => toast.error(checkoutErrorMessage(err)),
  }));

  const cancel = createMutation(() => ({
    mutationFn: (key: string) => api.cancelSubscription(key),
    onSuccess: () => {
      toast.success(__('Cancellation requested. You keep your features until the end of the paid period.'));
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (err: unknown) => toast.error(cancelErrorMessage(err)),
    onSettled: () => setCancelId(null),
  }));

  const deactivate = createMutation(() => ({
    mutationFn: (activationId: string) => api.deactivateSeat(activationId),
    onSuccess: () => {
      toast.success(__('Seat released. You can activate the licence on another site.'));
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      void queryClient.invalidateQueries({ queryKey: ['license', 'site'] });
    },
    onError: (err: unknown) => toast.error(seatErrorMessage(err)),
    onSettled: () => setSeatToFree(null),
  }));

  // Claiming the free Essentials licence — the only call this plugin makes that says anything about
  // the merchant, and the only one started by typing something and pressing a button.
  const register = createMutation(() => ({
    mutationFn: (email: string) => api.registerFree(email),
    onSuccess: (res) => {
      setChangingAddress(false);

      // Registered, but not linked: the address already has an account, so it was mailed a
      // confirmation instead of being taken at face value. Saying "you're linked" here would be
      // the one message that guarantees nobody opens that email.
      if (res.account_status === 'verification_required') {
        setAwaitingEmail(res.pending_email ?? null);
        setOutcome('awaiting_confirmation');
        toast.info(__('Almost there — open the link we just emailed you to finish linking this site.'));

        return;
      }

      toast.success(__('Registered. This site is now linked to your account.'));
      // Settle it here rather than waiting for the read: there *is* an account now, and the card
      // that says otherwise should go with the click that made it untrue.
      setOutcome('ok');
      // The whole page is a function of the account, and there wasn't one a second ago.
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      void queryClient.invalidateQueries({ queryKey: ['license', 'site'] });
    },
    onError: (err: unknown) => toast.error(registerErrorMessage(err)),
  }));

  // Leaving. Not a destructive action dressed up as one: the base licence grants nothing, so what
  // ends here is the daily check-in and the account, and every inventory feature on this site
  // carries on exactly as before.
  const withdraw = createMutation(() => ({
    mutationFn: () => api.withdrawRegistration(),
    onSuccess: (res) => {
      if (res.status === 'withdrawn_seat_not_released') {
        // Said, not hidden — but as an aside, because the merchant's request is complete either way
        // and the remainder is the service's to settle.
        toast.info(
          __(
            'This site no longer contacts the licensing service. We couldn’t reach it to release the seat, which it will free on its own.',
          ),
        );
      } else {
        toast.success(__('Un-registered. This site no longer contacts the licensing service.'));
      }
      setConfirmWithdraw(false);
      setChangingAddress(false);
      setOutcome('withdrawn');
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      void queryClient.invalidateQueries({ queryKey: ['license', 'site'] });
    },
    onError: (err: unknown) => {
      setConfirmWithdraw(false);
      toast.error(withdrawErrorMessage(err));
    },
  }));

  // "I've confirmed" — ask whether the emailed link has been opened, and collect the account token
  // if it has. A question with three ordinary answers, only one of which is cause for celebration.
  const claimLink = createMutation(() => ({
    mutationFn: () => api.claimAccountLink(),
    onSuccess: (res) => {
      if (res.account_status === 'linked') {
        toast.success(__('Confirmed. This site is now linked to your account.'));
        setAwaitingEmail(null);
        setOutcome('ok');
        void queryClient.invalidateQueries({ queryKey: ['account'] });
        void queryClient.invalidateQueries({ queryKey: ['license', 'site'] });

        return;
      }

      // The seat is gone — freed from another site, or never registered from this one. Back to the
      // invitation, which is the honest offer for a site with no account and none pending.
      if (res.account_status === 'unlinked') {
        setAwaitingEmail(null);
        setOutcome('not_linked');

        return;
      }

      // Not an error, and worded as the ordinary thing it is: most people press this before
      // opening their mail, not after.
      toast.info(__('Not confirmed yet. Open the link in the email, then check again.'));
    },
    onError: (err: unknown) => toast.error(claimErrorMessage(err)),
  }));

  // This install's own facts. A local read, so it answers during a licensing outage — a site should
  // never be unable to say whether it is registered because the service it registered with is down.
  const site = createQuery(() => ({
    queryKey: ['license', 'site'],
    queryFn: () => api.getSiteStatus(),
  }));

  /**
   * Every live claim against this site, whoever made it — the converse of the account read above.
   *
   * Administrator-only server-side (`manage_options`), so a 403 is an ordinary answer for a shop
   * manager rather than a fault: the panel simply omits the list. Not retried for that reason.
   */
  const siteSeats = createQuery(() => ({
    queryKey: ['license', 'site-seats'],
    queryFn: () => api.getSiteSeats(),
    retry: (count: number, err: unknown) => !(err instanceof ApiError) && count < 1,
  }));

  /** The claim awaiting a release confirmation. */
  const [seatToReject, setSeatToReject] = createSignal<SiteSeat | null>(null);

  /**
   * Give up one claim on this site — but by two different routes, because the two cases are not the
   * same operation.
   *
   * A seat belonging to **another account** is purely remote: rejecting it changes nothing here.
   * This install's **own** seat is not, and going through the remote route for it would free the
   * seat while leaving this install holding a blob, its tokens, and an armed daily check — the
   * orphan half-state the panel has a whole warning for. `POST /license/deactivate` frees the seat
   * *and* clears local state, which is what giving up your own seat means.
   *
   * What it deliberately does not do is set the withdrawal opt-out. Releasing a seat is "I am done
   * with this licence here"; withdrawing is "stop contacting the service at all". A site that
   * released its seat is still willing to register or activate again tomorrow.
   */
  const rejectSeat = createMutation(() => ({
    mutationFn: (seat: SiteSeat) =>
      seat.is_current ? api.deactivateThisSite() : api.releaseSiteSeat(seat.activation_id),
    onSuccess: () => {
      toast.success(__('Released. That licence no longer names this site.'));
      void queryClient.invalidateQueries({ queryKey: ['license', 'site-seats'] });
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      void queryClient.invalidateQueries({ queryKey: ['license', 'site'] });
    },
    onError: (err: unknown) => toast.error(seatErrorMessage(err)),
    onSettled: () => setSeatToReject(null),
  }));

  /** @see shouldShowOwnedLicenses — kept pure so its four branches can be tested directly. */
  const showOwnedLicenses = createMemo((): boolean =>
    shouldShowOwnedLicenses(licenses(), site.data?.activation_id ?? null),
  );

  /** The seat in the account payload that is *this* install, matched on activation id. */
  const thisSeat = createMemo((): Seat | null => {
    const id = site.data?.activation_id;
    if (id == null) return null;
    for (const license of licenses()) {
      const seat = license.seats.find((s) => s.activation_id === id);
      if (seat) return seat;
    }
    return null;
  });

  /** This install's own seat as the *server* identifies it — authoritative, and account-blind. */
  const currentSiteSeat = createMemo(
    (): SiteSeat | null => siteSeats.data?.seats.find((s) => s.is_current) ?? null,
  );

  /**
   * This install is activated on a licence held by a **different account** than the one shown.
   *
   * Entirely legitimate and often permanent: an agency's Pro key on a client's site, a licence
   * bought under the company address while the site registered under someone's own. Entitlement
   * comes from the licence the install is activated on; the account surface comes from whoever this
   * site registered as. They were never required to be the same account.
   *
   * Worth stating anyway, because otherwise the page silently contradicts itself — Pro is running
   * and "Your licenses" does not list it. Stated as a fact, not a warning.
   */
  const seatOnAnotherAccount = createMemo(
    (): SiteSeat | null =>
      account.isSuccess && account.data !== undefined && thisSeat() === null ? currentSiteSeat() : null,
  );

  /**
   * This install holds an activation that no longer exists anywhere — released from here or from
   * another site, or expired.
   *
   * Asserted only when **both** reads succeeded: the account read (so there are seats to match
   * against) *and* the site-seats read (so "no seat of mine" is an observation rather than an
   * absence of data). Without the second, an install activated under another account looks
   * identical to one whose seat is gone — and the previous version of this said so, predicting an
   * un-registration that was never going to happen. Silence beats a confident wrong answer.
   */
  const seatOrphaned = createMemo(
    (): boolean =>
      site.data?.registered === true
      && account.isSuccess
      && account.data !== undefined
      && siteSeats.isSuccess
      && currentSiteSeat() === null
      && thisSeat() === null,
  );

  // The install-state of each entitled downloadable plugin (`pro` + any add-on slug). Returns an
  // empty list when the site isn't linked or nothing is entitled, so the panel simply hides.
  const addons = createQuery(() => ({
    queryKey: ['account', 'addons'],
    queryFn: () => api.getAddons(),
    retry: (count: number, err: unknown) => !(err instanceof ApiError) && count < 1,
  }));

  const entitledAddons = (): AddonState[] => addons.data?.addons ?? [];
  const invalidateAddons = (): void =>
    void queryClient.invalidateQueries({ queryKey: ['account', 'addons'] });

  // One mutation for every declared action, because the section can't enumerate them. Some of
  // these download and unpack server-side and take a few seconds, so the row that owns the running
  // action shows it as pending — keyed by path, which is unique per row per action.
  const runAddonAction = createMutation(() => ({
    mutationFn: (action: AddonAction) => api.runAddonAction(action.path),
    onSuccess: () => {
      toast.success(__('Done. The add-on list has been refreshed.'));
      invalidateAddons();
    },
    onError: (err: unknown) => toast.error(addonErrorMessage(err)),
  }));

  const runningAction = (): string | null =>
    runAddonAction.isPending ? (runAddonAction.variables?.path ?? null) : null;

  // A plugin the account owns, that isn't here, and that nothing on this site can go and get.
  // That is the bootstrap gap rather than an error — the very first paid plugin is a manual
  // upload, and the ability to install the rest comes bundled inside it.
  const needsManualSetup = (): boolean =>
    entitledAddons().some((a) => !a.installed && a.actions.length === 0);

  /** The catalogue joined to what this account owns and what this site runs — see `mergeCatalog`. */
  const catalogRows = createMemo((): CatalogRow[] =>
    mergeCatalog(catalog.data?.skus ?? [], licenses(), entitledAddons()),
  );

  return (
    <div class="mx-auto max-w-4xl p-4">
      <header class="mb-4">
        <h1 class="text-lg font-semibold text-slate-900">{__('Licenses & Add-ons')}</h1>
        <Show when={account.data}>
          {(data) => (
            <p class="mt-0.5 text-sm text-slate-500">
              {sprintf(
                /* translators: %s = the account email address. */
                __('Signed in as %s'),
                data().account.email,
              )}
            </p>
          )}
        </Show>
      </header>

      {/* Not linked to an account yet (409) — the register card below *is* the response to that, so
          this is an invitation, not a warning. The catalogue still shows (it's public), but a
          purchase needs an account to attach to, so the Buy buttons are disabled with a hint.
          Also the way back for someone who mistyped their address: `changingAddress`. */}
      <Show when={notLinked() || changingAddress()}>
        <RegisterCard
          defaultEmail={registrationDefaultEmail()}
          pending={register.isPending}
          onRegister={(email) => register.mutate(email)}
        />
      </Show>

      {/* Left on purpose. The offer is not repeated here — a line saying where the site stands, and
          the way back for whoever wants it. */}
      <Show when={withdrawn()}>
        {/* Coming back is the not-linked state, not the changing-address one. Both reveal the same
            card, but only one of them should arrive with the address field blank: a merchant who
            withdrew is most likely returning with the address they left with. */}
        <WithdrawnCard onRegisterAgain={() => setOutcome('not_linked')} />
      </Show>

      {/* This install, before anything belonging to the account. Everything below describes things
          that exist whether or not this site does; this is the only part that is about the site the
          merchant is looking at, which is why the action on it lives here. */}
      <Show when={site.data?.registered === true && site.data}>
        {(s) => (
          <ThisSitePanel
            site={s()}
            seat={thisSeat()}
            seatOrphaned={seatOrphaned()}
            seatOnAnotherAccount={seatOnAnotherAccount()}
            siteSeats={siteSeats.data?.seats ?? []}
            onRejectSeat={(seat) => setSeatToReject(seat)}
            onWithdraw={() => setConfirmWithdraw(true)}
          />
        )}
      </Show>

      {/* Registered against an address that already had an account, so the account itself is held
          back until that address says yes. The site is licensed throughout; only this panel waits. */}
      <Show when={awaitingConfirmation() && !changingAddress()}>
        <AwaitingConfirmationCard
          email={awaitingEmail()}
          checking={claimLink.isPending}
          onCheck={() => claimLink.mutate()}
          onUseAnotherAddress={() => setChangingAddress(true)}
        />
      </Show>

      {/* The service didn't answer and there was nothing remembered to fall back on. */}
      <Show when={serviceDown()}>
        <div class="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>{serviceDownMessage()}</strong>
          <p class="mt-1">
            {__(
              'Your licence and every paid feature keep working — this page just can’t show your account until the service is back.',
            )}
          </p>
        </div>
      </Show>

      {/* Answered from the last known payload. Everything renders; it just isn't a live reading. */}
      <Show when={showingSnapshot()}>
        <div class="mb-4 rounded border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          {__(
            'Showing your last known account state — the licensing service isn’t reachable right now, so this may be out of date.',
          )}
        </div>
      </Show>

      {/* A hard error that is neither the not-linked case nor a reachability problem. */}
      <Show when={hardError()}>
        <div class="mb-4 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {__('Could not load your account. Please try again later.')}
        </div>
      </Show>

      <Show when={firstLoad()}>
        <p class="text-sm text-slate-500">{__('Loading your licenses…')}</p>
      </Show>

      {/* What this account owns. One list: see `licenses()`. Suppressed when it would only restate
          what the panel above and the catalogue below already say — see `showOwnedLicenses`. */}
      <Show when={showOwnedLicenses()}>
        <section class="mb-6">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {__('Your licenses')}
          </h2>
          <p class="mb-3 text-sm text-slate-500">
            {__('What this account owns, and the sites each licence is activated on.')}
          </p>
          <div class="grid grid-cols-2 gap-3">
            <For each={licenses()}>
              {(license) => (
                <LicenseCard
                  license={license}
                  onCancel={() => setCancelId(license.id)}
                  onFreeSeat={(seat) => setSeatToFree(seat)}
                  currentActivationId={site.data?.activation_id ?? null}
                  cancelPending={cancel.isPending && cancelId() === license.id}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* One list for the whole family: what is running here, what this account owns, and what
          exists but isn't bought — because they are the same products in three states, and the gap
          between them is exactly what a merchant comes to this page to close. */}
      <section>
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{__('Catalog')}</h2>
        <p class="mb-3 text-sm text-slate-500">
          {__('Every InvFlux product, what it costs, and where each one stands on this site.')}
        </p>

        <Show when={needsManualSetup()}>
          <div class="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p class="font-medium">{__('One-time setup for your first paid plugin')}</p>
            <p class="mt-1">
              {__(
                'This site can’t fetch a paid plugin on its own — that ability arrives inside the plugin itself. Download it from your account page (your licence key is already embedded, so there is nothing to type in), then add it under Plugins → Add New → Upload Plugin.',
              )}
            </p>
            <p class="mt-1">
              {__(
                'After that it updates itself, and any further plugins install from this page in one click.',
              )}
            </p>
          </div>
        </Show>

        <Show
          when={catalogRows().length > 0}
          fallback={
            <p class="text-sm text-slate-500">
              {catalog.isError
                ? catalog.error instanceof ApiError && catalog.error.unreachable
                  ? serviceDownMessage()
                  : __('Could not load the product catalog.')
                : __('Loading the catalog…')}
            </p>
          }
        >
          <div class="grid gap-3 sm:grid-cols-2">
            <For each={catalogRows()}>
              {(row) => (
                <CatalogCard
                  row={row}
                  noAccount={noAccount()}
                  noAccountHint={
                    awaitingConfirmation()
                      ? __('Confirm your email address first.')
                      : __('Activate or register a licence first.')
                  }
                  buyPending={checkout.isPending && pendingPlan() === row.sku.sku}
                  onBuy={() => checkout.mutate(row.sku.sku)}
                  runningPath={runningAction()}
                  onRun={(action) => runAddonAction.mutate(action)}
                />
              )}
            </For>
          </div>
        </Show>

        {/* Popup-blocked fallback: a manual link to the last-issued checkout URL. */}
        <Show when={checkoutUrl()}>
          {(url) => (
            <p class="mt-3 text-sm">
              <a href={url()} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                {__('Open checkout')}
              </a>
            </p>
          )}
        </Show>
      </section>

      {/* Un-register confirmation. Warning rather than danger: nothing on this site stops working,
          which is the one thing the copy has to establish before anyone can decide. */}
      <Show when={confirmWithdraw()}>
        <ConfirmModal
          title={__('Un-register this site?')}
          message={
            <span>
              {__(
                'This site will stop contacting the licensing service, and its seat and account link will be released. Every inventory feature keeps working exactly as it does now — nothing here depends on being registered. You can register again at any time.',
              )}
            </span>
          }
          confirmLabel={withdraw.isPending ? __('Un-registering…') : __('Un-register')}
          cancelLabel={__('Stay registered')}
          variant="warning"
          onConfirm={() => withdraw.mutate()}
          onCancel={() => setConfirmWithdraw(false)}
        />
      </Show>

      {/* Reject-a-claim confirmation. The two warnings it can carry are the ones a merchant cannot
          recover from by pressing the button again. */}
      <Show when={seatToReject()}>
        {(seat) => (
          <ConfirmModal
            title={__('Release this licence from this site?')}
            message={
              <span>
                {sprintf(
                  /* translators: %s = the account email the licence belongs to. */
                  __('The licence held by %s will no longer name this site.'),
                  seat().email,
                )}{' '}
                {/* The two cases differ in what happens *here*, which is the part a merchant is
                    deciding about. Rejecting someone else's claim changes nothing on this site;
                    giving up your own takes effect immediately and locally. */}
                <Show
                  when={seat().is_current}
                  fallback={__('Nothing changes on this site — it is not the licence this install uses.')}
                >
                  {__(
                    'This is the licence this install uses, so it becomes un-registered straight away. It will keep checking for a licence, so you can register or activate another one here whenever you like — to stop the daily check as well, use “Un-register this site”.',
                  )}
                </Show>{' '}
                <Show when={seat().paid}>
                  {__(
                    'This is a paid licence — whoever pays for it will have to activate it again to use it here.',
                  )}
                </Show>
              </span>
            }
            confirmLabel={rejectSeat.isPending ? __('Releasing…') : __('Release')}
            cancelLabel={__('Keep it')}
            variant={seat().paid || seat().is_current ? 'danger' : 'warning'}
            onConfirm={() => rejectSeat.mutate(seat())}
            onCancel={() => setSeatToReject(null)}
          />
        )}
      </Show>

      {/* Cancel-subscription confirmation. */}
      <Show when={cancelId()}>
        {(id) => (
          <ConfirmModal
            title={__('Cancel subscription?')}
            message={
              <span>
                {__(
                  'Your subscription will stop renewing. You keep all paid features until the end of the current billing period.',
                )}
              </span>
            }
            confirmLabel={cancel.isPending ? __('Cancelling…') : __('Cancel subscription')}
            cancelLabel={__('Keep it')}
            variant="danger"
            onConfirm={() => cancel.mutate(id())}
            onCancel={() => setCancelId(null)}
          />
        )}
      </Show>

      {/* Free-a-seat confirmation. */}
      <Show when={seatToFree()}>
        {(seat) => (
          <ConfirmModal
            title={__('Release this seat?')}
            message={
              <span>
                {sprintf(
                  /* translators: %s = the site URL of the seat being freed. */
                  __(
                    'This releases the activation on %s so you can activate the licence on another site. The site there will fall back to Essentials until re-activated.',
                  ),
                  seat().site_url,
                )}
              </span>
            }
            confirmLabel={deactivate.isPending ? __('Releasing…') : __('Release seat')}
            cancelLabel={__('Keep it')}
            variant="warning"
            onConfirm={() => deactivate.mutate(seat().activation_id)}
            onCancel={() => setSeatToFree(null)}
          />
        )}
      </Show>
    </div>
  );
}

/** The privacy policy the consent copy points at. */
const PRIVACY_URL = 'https://invflux.com/privacy';

/**
 * Claim the free Essentials licence — the site's entry into having an account at all.
 *
 * Registering is worth something on its own: it opens the public roadmap, next-feature voting and
 * the suggestion box, and it is what a later purchase attaches to. None of that is a capability
 * withheld from an install that declines — every inventory feature this plugin has works, forever,
 * without ever registering. That is deliberate and it is also the rule: registration is a
 * phone-home, so it has to be opt-in, it has to say what it sends, and declining has to cost
 * nothing.
 *
 * Hence the shape of this card: nothing is transmitted until an email is typed and the button is
 * pressed, and the list of what leaves the site is next to the button rather than behind a link.
 */
function RegisterCard(props: {
  /** Seed for the field — the reader's WordPress address, or '' to start empty. */
  defaultEmail: string;
  pending: boolean;
  onRegister: (email: string) => void;
}): JSX.Element {
  // Read once, as a seed. A reactive value here would overwrite whatever the merchant is halfway
  // through typing the moment anything upstream re-evaluated.
  const [email, setEmail] = createSignal(props.defaultEmail);
  const valid = (): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim());

  const submit = (e: Event): void => {
    e.preventDefault();
    if (valid() && !props.pending) props.onRegister(email().trim());
  };

  return (
    <section class="mb-6 rounded border border-primary/30 bg-primary/5 p-4">
      {/* Named, not generic: "your free licence" reads as a formality, while the product's own name
          is the thing the merchant already knows they are running. */}
      <h2 class="text-base font-semibold text-slate-900">{__('Register your free Essentials licence')}</h2>
      <p class="mt-1 text-sm text-slate-600">
        {__(
          'Free and permanent. It links this site to an account, which is what a licence — free or paid — is held against.',
        )}
      </p>

      <ul class="mt-2 space-y-1 text-sm text-slate-600">
        <li>· {__('The public roadmap: what’s being built, and in what order.')}</li>
        <li>· {__('A vote on what gets built next.')}</li>
        <li>· {__('The suggestion box — ask for the thing your shop actually needs.')}</li>
      </ul>

      <form class="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label class="sr-only" for="invflux-register-email">
          {__('Email address')}
        </label>
        <input
          id="invflux-register-email"
          type="email"
          required
          autocomplete="email"
          class="min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
          placeholder={__('you@example.com')}
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
        <Button type="submit" disabled={!valid()} loading={props.pending}>
          {props.pending ? __('Registering…') : __('Register')}
        </Button>
      </form>

      {/* The way back into the welcome screen, which otherwise hangs off a licence card this site
          does not have yet — and an unregistered install is precisely the one most likely to have
          closed that tab without finishing it. */}
      <div class="mt-3">
        <WelcomeLink slug={ESSENTIALS_WELCOME} />
      </div>

      {/* The disclosure sits at the point of consent, not behind the link — the link is for the
          full policy, and a reader who never clicks it has still been told. Keep this list matched
          to what the wire actually carries (LicenseServerClient::register, then the daily
          refresh); it is the sentence a reviewer checks against the code. */}
      <p class="mt-3 text-xs text-slate-500">
        {__(
          'Pressing Register sends your email address, this site’s address and the plugin version to the InvFlux licensing service. After that it checks your licence status once a day, sending the site address and whether WordPress reports this site as debug or staging. Your products, stock and orders are never sent.',
        )}{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" class="text-primary underline">
          {__('Privacy policy')}
        </a>
      </p>
      <p class="mt-1 text-xs text-slate-500">
        {__('Every inventory feature works without registering. You can skip this.')}
      </p>
    </section>
  );
}

/**
 * What is true of *this install*, as opposed to the account.
 *
 * The rest of the page is the account's: licences, seats and the catalogue all describe things that
 * exist whether or not this particular site does. Site-level facts had nowhere to be stated, which
 * is why the action on them — un-registering — had nowhere to live either and ended up in a footer.
 * This panel is that home, and it sits first because "which site am I looking at" precedes
 * everything below it.
 *
 * The licence and seat are **joined on `activation_id`**, not on the site URL. A URL comparison
 * between a WordPress `get_site_url()` and whatever the licensing service stored is exactly the
 * un-canonicalised string match that should not decide an install's identity. When the join finds
 * nothing — an account read that failed, a seat freed from another site — the panel simply shows
 * fewer facts rather than guessing at them.
 *
 * The check-in line is the reason the un-register control is here rather than on a licence card:
 * what a merchant withdrawing wants to stop is a property of the *site*, and this is where the site
 * says what it does. Keep it matched to the disclosure on {@link RegisterCard} — the two describe
 * one wire, and if they disagree one of them is selling something.
 */
function ThisSitePanel(props: {
  site: SiteStatus;
  seat: Seat | null;
  /** Registered locally against a seat that exists nowhere — released or expired. */
  seatOrphaned: boolean;
  /** Activated on a live licence held by a different account than the one shown. */
  seatOnAnotherAccount: SiteSeat | null;
  /** Every live claim against this site, across accounts. Empty when the caller may not see them. */
  siteSeats: SiteSeat[];
  onRejectSeat: (seat: SiteSeat) => void;
  onWithdraw: () => void;
}): JSX.Element {
  return (
    <section class="mb-6 rounded border border-slate-200 bg-slate-50/60 p-4">
      <h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">{__('This site')}</h2>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-medium text-slate-900">{props.site.site_url}</span>
        {/* The server's classification, not this site's own report — it is what decides whether the
            activation consumes a production seat, so the merchant should see the verdict. */}
        {/* From the site-seats read, not the account payload: that read is account-blind, so the
            classification still shows when this install is activated under another account. */}
        <Show when={props.seatOnAnotherAccount?.env_class ?? props.seat?.env_class}>
          {(env) => <span class="text-xs text-slate-500">({env()})</span>}
        </Show>
      </div>

      {/* No "Licence:" row here. Which licence this install uses is the `(this install)` row in the
          list below, and saying it twice on one card is how a reader starts wondering whether the
          two are describing different things. */}
      <dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <div>
          <dt class="inline text-text-muted">{__('Licence check')}: </dt>
          <dd class="inline">
            <Show when={props.site.next_check_at} fallback={__('stopped')}>
              {(next) => (
                <>
                  {sprintf(
                    /* translators: %s = a date, when this site next checks its licence. */
                    __('daily, next on %s'),
                    formatDate(next()),
                  )}
                </>
              )}
            </Show>
          </dd>
        </div>
        <p class="text-xs text-slate-500">
          {__(
            'The check sends this site’s address and whether WordPress reports it as debug or staging — nothing else, and never your products, stock or orders.',
          )}
        </p>
        {/* Disabled rather than hidden, and rather than left to fail. The server refuses a
            withdrawal while a paid entitlement is held — the check-in is how that entitlement stays
            verified — and a control that reveals its refusal only once pressed is worse than one
            that says why. The way through is the seat list below, in this same card. */}
        <Show
          when={props.site.paid_skus.length === 0}
          fallback={
            <p class="mt-2 text-sm text-slate-500">
              {__(
                'Un-registering is unavailable while this site uses a paid licence — the daily check is how that licence stays verified. Release it below first.',
              )}
            </p>
          }
        >
          <button
            type="button"
            class="mt-2 text-sm text-slate-500 underline cursor-pointer"
            onClick={() => props.onWithdraw()}
          >
            {__('Un-register this site')}
          </button>
        </Show>
      </dl>

      {/* States the fact and the consequence, and stops there. The plugin knows its activation is
          not on this account; it cannot know *why* — released from here or elsewhere, superseded by
          a later registration, or made under a different address than the one this account belongs
          to are all indistinguishable from inside the install, and naming one would be a guess
          dressed as an explanation. */}
      <Show when={props.seatOrphaned}>
        <p class="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          {__(
            'This install’s licence no longer exists — its seat was released, from here or from another site. Nothing stops working right now: at its next licence check this install will become un-registered, and you can register or activate one again whenever you like.',
          )}
        </p>
      </Show>

      {/* Not a problem, and not amber. Said only because the page would otherwise contradict itself:
          the licence running here is real and active, and "Your licenses" does not list it. */}
      <Show when={props.seatOnAnotherAccount}>
        {(seat) => (
          <p class="mt-2 text-sm text-slate-600">
            {sprintf(
              /* translators: 1: product name, 2: the account email holding that licence. */
              __('This site runs %1$s on a licence held by %2$s — a different account from the one signed in here. That is fine: what runs on a site comes from the licence it is activated on, while this page shows the account the site registered with.'),
              seat().name,
              seat().email,
            )}
          </p>
        )}
      </Show>

      {/* Who has registered this site — the question no account credential can answer, since each
          account sees only its own. Hidden entirely when the list is empty, which for a shop manager
          means "you may not see this" and for an administrator means there is nothing to show. */}
      <Show when={props.siteSeats.length > 0}>
        <div class="mt-3 border-t border-slate-200 pt-3">
          <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {__('Licences registered to this site')}
          </h3>
          <ul class="mt-1 space-y-1 text-sm">
            <For each={props.siteSeats}>
              {(seat) => (
                <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span class="flex items-center gap-x-2 min-w-0">
                    {/* The product first: three rows of identical keys are unreadable, and which
                        product a licence is for is the thing being scanned for. Server-resolved
                        from the catalogue — never rebuilt from the SKU. */}
                    <span class="font-medium text-slate-800">{seat.name}</span>{' '}
                    <span class="font-mono text-xs text-text-muted">{seat.license_key}</span>{' '}
                    <span class="text-slate-600">{seat.email}</span>
                    <Show when={seat.is_current}>
                      <span class="ml-1 text-xs font-medium text-slate-500">{__('(this install)')}</span>
                    </Show>
                    <Show when={seat.paid}>
                      <span class="ml-1 text-xs font-medium text-amber-700">{__('(paid)')}</span>
                    </Show>
                  </span>
                  {/* Offered for every row including this install's own: a claim on your site is
                      yours to reject, and which one is yours is the server's answer, not a guess. */}
                  <Button
                    variant="quiet"
                    size="xs"
                    class="shrink-0"
                    onClick={() => props.onRejectSeat(seat)}
                  >
                    {__('Release')}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}

/**
 * The panel for a site that registered and then left.
 *
 * Deliberately not the register card. Someone who withdrew has already read that offer and declined
 * it; showing it again on every visit is precisely the behaviour they opted out of, and it would
 * make the opt-out feel provisional. So this states where the site stands, confirms the thing they
 * left for is actually true, and keeps the way back to one click without arguing for it.
 */
function WithdrawnCard(props: { onRegisterAgain: () => void }): JSX.Element {
  return (
    <section class="mb-6 rounded border border-slate-200 bg-slate-50 p-4">
      <h2 class="text-base font-semibold text-slate-900">{__('This site is not registered')}</h2>
      <p class="mt-1 text-sm text-slate-600">
        {__(
          'It no longer contacts the licensing service. Every inventory feature works as it always has.',
        )}
      </p>
      <button
        type="button"
        class="mt-2 text-sm text-primary underline"
        onClick={() => props.onRegisterAgain()}
      >
        {__('Register again')}
      </button>
    </section>
  );
}

/**
 * The panel for a site that registered against an address which already had an account.
 *
 * That case cannot be taken on trust — registration is unauthenticated, so anyone could type
 * someone else's address — and the licensing service answers it by mailing that address rather than
 * by handing this install the keys to an account it has not proved it owns. The site is fully
 * licensed the whole time; what is waiting is only the account surface.
 *
 * Two things make this a resolvable wait rather than a dead end. It **names the address**, which is
 * the one fact that reveals a typo — a mistyped address can only be someone *else's* real account,
 * since an unknown one links outright, so the mail went somewhere real and silent. And it offers a
 * way to **use a different address**, because noticing the typo is worth nothing without it.
 *
 * The check is a button rather than a poll: the merchant knows when they have clicked, and a page
 * that quietly retries a remote call every few seconds on the chance that something changed in
 * someone's inbox is a poor trade for a wait that is usually one click long.
 */
function AwaitingConfirmationCard(props: {
  email: string | null;
  checking: boolean;
  onCheck: () => void;
  onUseAnotherAddress: () => void;
}): JSX.Element {
  return (
    <section class="mb-6 rounded border border-amber-300 bg-amber-50 p-4">
      <h2 class="text-base font-semibold text-slate-900">{__('One more step: confirm your email')}</h2>

      <p class="mt-1 text-sm text-slate-700">
        <Show
          when={props.email}
          fallback={__(
            'This site is registered and licensed. To reach your account, open the link we emailed to the address you registered with.',
          )}
        >
          {(email) =>
            sprintf(
              /* translators: %s = the email address a confirmation link was sent to. */
              __(
                'This site is registered and licensed. To reach your account, open the link we emailed to %s.',
              ),
              email(),
            )
          }
        </Show>
      </p>

      {/* Said plainly, because the panel is amber and reads as a problem otherwise — and a merchant
          who thinks their stock control is on hold will go looking for a way to undo something. */}
      <p class="mt-1 text-sm text-slate-600">
        {__('Nothing is on hold in the meantime — every feature this site is licensed for keeps working.')}
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={() => props.onCheck()} loading={props.checking}>
          {props.checking ? __('Checking…') : __('I’ve confirmed — check again')}
        </Button>
        <button
          type="button"
          class="text-sm text-primary underline"
          onClick={() => props.onUseAnotherAddress()}
        >
          {__('Use a different address')}
        </button>
      </div>
    </section>
  );
}

/**
 * Link back into a plugin's own welcome screen, when one is installed here.
 *
 * A welcome screen is a *closeable tab*, which is what keeps it from trapping anyone — and also what
 * makes it genuinely gone once dismissed. A merchant who closed it half-way through had no way back
 * short of knowing the URL. This page is already where they come to see what they have installed, so
 * it is where each plugin's way back in belongs.
 *
 * The caption is the page's own registered label, so an add-on names its own link rather than the
 * shell inventing a caption for a screen it knows nothing about. Renders nothing for a plugin that
 * registered no welcome screen, which is most of them.
 */
function WelcomeLink(props: { slug: string }): JSX.Element {
  return (
    <Show when={welcomePage(props.slug)}>
      {(page) => (
        <A href={welcomePath(props.slug)} class="text-sm text-primary underline">
          {page().label}
        </A>
      )}
    </Show>
  );
}

/** One owned-licence card: identity, state, dates, seats, and the cancel action. */
function LicenseCard(props: {
  license: OwnedLicense;
  /** This install's activation, so its own seat can be named among the others. Null if unknown. */
  currentActivationId: string | null;
  cancelPending: boolean;
  onCancel: () => void;
  onFreeSeat: (seat: Seat) => void;
}): JSX.Element {
  const l = (): OwnedLicense => props.license;
  // The catalogue's display name. Never rebuild one from the identifier: a SKU key
  // is not a label, and upper-casing `free` renders "FREE" at the merchant.
  const title = (): string => l().name || l().sku;

  return (
    <div class="rounded border border-slate-200 p-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-semibold text-slate-900">{title()}</span>
        <StatePill state={l().state} />
        <Show when={l().is_founder}>
          <span class="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {__('Founder')}
          </span>
        </Show>
        <span class="font-mono text-xs text-text-muted">{l().key}</span>
        {/* Beside the state pill, not instead of it: the licence really is active — entitlement
            runs from activation on purpose — and this is the billing half of the answer. A
            merchant of record can take a couple of days to confirm a first charge, and silence
            for two days reads as a failed payment. */}
        <Show when={l().awaiting_first_payment}>
          <span
            class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
            title={__('Your payment has been requested and is not confirmed yet. Everything works in the meantime.')}
          >
            {__('Payment pending')}
          </span>
        </Show>
      </div>

      <dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <Show when={l().cadence}>
          {(cadence) => (
            <div>
              <dt class="inline text-text-muted">{__('Billing')}: </dt>
              <dd class="inline">{cadence()}</dd>
            </div>
          )}
        </Show>
        <Show when={l().paid_through}>
          {(pt) => (
            <div>
              <dt class="inline text-text-muted">
                {l().state === 'cancelled' ? __('Access until') : __('Renews')}:{' '}
              </dt>
              <dd class="inline">{formatDate(pt())}</dd>
            </div>
          )}
        </Show>
        <Show when={(l().quantity ?? 0) > 1}>
          <div>
            <dt class="inline text-text-muted">{__('Seats')}: </dt>
            <dd class="inline">{l().quantity}</dd>
          </div>
        </Show>
      </dl>

      {/* The base install is the one family member with no plugin card of its own — there is nothing
          to download — so its way back to its welcome screen hangs off its licence instead. */}
      <Show when={l().kind !== 'addon'}>
        <div class="mt-3">
          <WelcomeLink slug={ESSENTIALS_WELCOME} />
        </div>
      </Show>

      {/* Live activations, each with a "free" action for the same-account transfer case. */}
      <Show when={l().seats.length > 0}>
        <ul class="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          <For each={l().seats}>
            {(seat) => (
              <li class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate text-slate-600" title={seat.site_url}>
                  {seat.site_url}
                  <Show when={seat.env_class}>
                    <span class="ml-1 text-xs text-text-muted">({seat.env_class})</span>
                  </Show>
                  {/* Named, because "Release seat" on a list of URLs is otherwise a guess about
                      which row is the site you are standing on — and the wrong guess logs this
                      install out of its licence. Matched on activation id, never on the URL. */}
                  <Show when={seat.activation_id === props.currentActivationId}>
                    <span class="ml-1 text-xs font-medium text-slate-500">{__('(this site)')}</span>
                  </Show>
                </span>
                <Button variant="quiet" size="xs" class="shrink-0" onClick={() => props.onFreeSeat(seat)}>
                  {__('Release seat')}
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={l().cancellable && l().state !== 'cancelled'}>
        <div class="mt-3 border-t border-slate-100 pt-3">
          <Button
            variant="danger"
            weight="outline"
            disabled={props.cancelPending}
            onClick={() => props.onCancel()}
          >
            {__('Cancel subscription')}
          </Button>
        </div>
      </Show>
    </div>
  );
}

/** Install-state → a pill caption + Tailwind classes. */
function addonStateMeta(state: string): { label: string; class: string } {
  switch (state) {
    case 'active':
      return { label: __('Active'), class: 'bg-green-100 text-green-800' };
    case 'installed_inactive':
      return { label: __('Inactive'), class: 'bg-amber-100 text-amber-800' };
    case 'not_installed':
      return {
        label: __('Not installed'),
        class: 'bg-slate-100 text-slate-600',
      };
    default:
      return { label: state, class: 'bg-slate-100 text-slate-700' };
  }
}

/** The installed version, when there is one — the only version fact this plugin can know locally. */
function addonVersionLine(a: AddonState): string {
  if (!a.installed || a.installed_version === null) return '';

  /* translators: %s = installed version. */
  return sprintf(__('Installed %s'), a.installed_version);
}

/**
 * One product of the estate: what it is, what it costs, where it stands on this site, and the one
 * thing there is to do about it.
 *
 * A row is in exactly one of four situations and gets exactly one control for it — owned (the
 * actions declared for it), included in something already held (a chip, no price), for sale (Buy),
 * or not yet for sale (a disabled "Coming soon"). **Which one is the server's answer, not this
 * file's:** `availability` is what flips a product from announced to buyable, so launch day costs
 * one field on one row and no plugin update anywhere.
 *
 * The actions are rendered without being interpreted — no branch here knows that installing,
 * updating or activating exist. That is what lets a capability arrive (or not) at runtime and
 * change what a row offers without touching this file; an entitled plugin with nothing able to
 * fetch it simply shows no button, which is the honest rendering of that situation.
 *
 * A lapsed/cancelled entitlement is surfaced with the licence pill; the server still enforces it
 * (the action then fails with a clear message), so buttons stay enabled.
 */
function CatalogCard(props: {
  row: CatalogRow;
  /** No account yet: the catalogue is public, but a purchase needs something to attach to. */
  noAccount: boolean;
  /** Why not, in one line — "register first" and "confirm your address first" are different fixes. */
  noAccountHint: string;
  buyPending: boolean;
  onBuy: () => void;
  /** The path of the action currently in flight, across all rows — at most one runs at a time. */
  runningPath: string | null;
  onRun: (action: AddonAction) => void;
}): JSX.Element {
  const row = (): CatalogRow => props.row;
  const sku = (): CatalogSku => props.row.sku;
  const addon = (): AddonState | null => props.row.addon;
  const actions = (): AddonAction[] => props.row.addon?.actions ?? [];
  const busy = (): boolean => props.runningPath !== null;

  /** The install-state chip. The platform's is a statement of fact: it is drawing this card. */
  const installMeta = (): { label: string; class: string } | null => {
    if (row().platform) return addonStateMeta('active');
    const a = addon();

    return a === null ? null : addonStateMeta(a.state);
  };

  const versionLine = (): string => {
    const a = addon();

    return a === null ? '' : addonVersionLine(a);
  };

  /** The entitling licence, when it is in a state worth showing (lapsed, cancelled, revoked). */
  const licenseState = (): string | null => {
    const a = addon();

    return a !== null && a.license_state !== 'active' ? a.license_state : null;
  };

  /** Nothing to decide about a product that is already yours. */
  const undecided = (): boolean => !row().entitled && null === row().includedIn;
  const buyable = (): boolean => undecided() && sku().availability === 'available';
  const announced = (): boolean => undecided() && sku().availability === 'coming_soon';

  /**
   * A price is quoted only for what can be bought right now. An announced product's price would be
   * a number nobody can act on and that nothing holds us to — the pricing page is where a figure
   * belongs before there is a checkout behind it.
   */
  const showPrice = (): boolean => sku().availability === 'available';

  // Only an *active* plugin: an installed-but-inactive one has registered nothing, so its screen
  // would not be there to open.
  const welcomeSlug = (): string | null => {
    if (row().platform) return ESSENTIALS_WELCOME;
    const a = addon();

    return a !== null && a.active && undefined !== welcomePage(a.slug) ? a.slug : null;
  };

  const hasControls = (): boolean =>
    actions().length > 0 || null !== welcomeSlug() || buyable() || announced();

  return (
    <div class="flex flex-col rounded border border-slate-200 p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span class="font-semibold text-slate-900">{sku().name}</span>
        <Show when={showPrice()}>
          <span class="text-sm font-semibold text-slate-900">{sku().price_label}</span>
        </Show>
      </div>

      <Show when={showPrice() && sku().founder}>
        <p class="text-right text-xs text-indigo-700">
          {__('Founding price — kept for as long as the subscription runs.')}
        </p>
      </Show>

      <Show when={null !== installMeta() || null !== row().includedIn || null !== licenseState()}>
        <div class="mt-1.5 flex flex-wrap items-center gap-2">
          <Show when={installMeta()}>
            {(meta) => (
              <span
                class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta().class}`}
              >
                {meta().label}
              </span>
            )}
          </Show>
          {/* Held through something else, and it says which — "your plan" is exactly the word a
              merchant holding two products cannot resolve. Said plainly, too, because the
              alternative reading of a price-less card with no button is "not for you". */}
          <Show when={row().includedIn}>
            {(plan) => (
              <span class="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                {sprintf(
                  /* translators: %s = the product that already grants this one, e.g. "InvFlux Pro". */
                  __('Included in %s'),
                  plan(),
                )}
              </span>
            )}
          </Show>
          <Show when={licenseState()}>{(state) => <StatePill state={state()} />}</Show>
        </div>
      </Show>

      <Show when={sku().tagline}>{(tagline) => <p class="mt-1 text-sm text-slate-500">{tagline()}</p>}</Show>

      <Show when={versionLine() !== ''}>
        <p class="mt-1 text-sm text-slate-500">{versionLine()}</p>
      </Show>

      <Show when={sku().features && sku().features!.length > 0}>
        <ul class="mt-2 flex-1 space-y-1 text-sm text-slate-600">
          <For each={sku().features}>{(feature) => <li>· {feature}</li>}</For>
        </ul>
      </Show>

      <Show when={hasControls()}>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <For each={actions()}>
            {(action) => {
              const running = (): boolean => props.runningPath === action.path;

              return (
                <button
                  type="button"
                  class={buttonClass(action.group === 'primary' ? 'primary' : 'ghost', 'md')}
                  // Every button locks while any action runs: they mutate the same plugin list, so
                  // a second click during an install would race the refetch it is about to cause.
                  disabled={busy()}
                  onClick={() => props.onRun(action)}
                >
                  {running() ? action.pending_label : action.label}
                </button>
              );
            }}
          </For>
          <Show when={welcomeSlug()}>{(slug) => <WelcomeLink slug={slug()} />}</Show>

          <Show when={buyable()}>
            <Button
              class="w-full"
              disabled={props.noAccount || props.buyPending}
              title={props.noAccount ? props.noAccountHint : undefined}
              onClick={() => props.onBuy()}
            >
              {props.buyPending ? __('Starting checkout…') : (sku().cta_label ?? __('Buy'))}
            </Button>
          </Show>

          {/* Announced, not sellable. A dead control that says why beats an upgrade CTA that
              leads to a checkout the server would refuse. */}
          <Show when={announced()}>
            <Button
              class="w-full"
              disabled
              title={__('Not on sale yet. This page will offer it the day it is.')}
            >
              {__('Coming soon')}
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The service-unreachable sentence, wherever a failed call has to explain itself. */
function serviceDownMessage(): string {
  return __('The licensing service isn’t reachable right now. Please try again later.');
}

/** Map an add-on install/activate failure to a user message (adapter `AddonController` error slugs). */
function addonErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.unreachable) return serviceDownMessage();
    switch (err.code) {
      case 'not_activated':
        return __('Link this site to an account before installing add-ons.');
      case 'not_entitled':
        return __('Your licence doesn’t cover this add-on, or it has lapsed.');
      case 'not_found':
        return __('This add-on isn’t available to download yet.');
      case 'checksum_mismatch':
      case 'identity_mismatch':
        return __('The download failed a safety check. Please try again.');
      default:
        break;
    }
  }
  return __('The action could not be completed. Please try again.');
}

/** Map a checkout failure to a user message — `not_activated` (409) is the common linked-account case. */
function checkoutErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.unreachable) return serviceDownMessage();
    if (err.code === 'not_activated') return __('Activate or register a licence before buying.');
  }
  return __('Could not start checkout. Please try again.');
}

/** Map a cancel failure to a user message — `no_subscription` means nothing to cancel. */
function cancelErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.unreachable) return serviceDownMessage();
    if (err.code === 'no_subscription') return __('This licence has no subscription to cancel.');
  }
  return __('Could not request cancellation. Please try again.');
}

/** Freeing a seat is a server write, so an unreachable service is its most likely failure. */
function seatErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.unreachable) return serviceDownMessage();
  return __('Could not release the seat. Please try again.');
}

/**
 * Map a registration failure to a user message. `registration_failed` covers both "the service
 * refused" and "the service didn't answer" — the adapter cannot tell them apart, so neither can
 * this, and the message says the honest thing rather than picking one.
 */
function registerErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_email') return __('Please enter a valid email address.');
    if (err.code === 'registration_failed') {
      return __(
        'Registration could not be completed — the licensing service may be unreachable. Please try again later.',
      );
    }
  }
  return __('Registration could not be completed. Please try again.');
}

/**
 * Map a failed confirmation check to a user message.
 *
 * Only reachability failures land here — "not confirmed yet" is a successful answer, not an error,
 * and is handled where the mutation succeeds. So this says the service could not be asked, never
 * that the confirmation was refused.
 */
function claimErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.unreachable) return serviceDownMessage();

  return __('Could not check your confirmation just now. Please try again in a moment.');
}

/**
 * Map a withdrawal refusal to a user message.
 *
 * The one refusal names the way through rather than only the obstacle: a paid entitlement is
 * verified by the very check-in being switched off, so releasing the seat is the step that makes
 * un-registering possible rather than an unrelated suggestion.
 */
function withdrawErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'paid_entitlement_held') {
    return __(
      'This site is using a paid licence, which is checked with the licensing service. Release this site’s seat from the licence first, then un-register.',
    );
  }

  return __('Could not un-register this site just now. Please try again in a moment.');
}
