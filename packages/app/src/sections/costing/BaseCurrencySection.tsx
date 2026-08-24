import { __, _n, sprintf } from '@invflux/i18n';
import { Button, Input, Spinner } from '@invflux/ui';
import { ApiError } from '@invflux/ui/api';
import { createQuery } from '@tanstack/solid-query';
import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { useApp } from '../../context';
import { createApi } from '../../lib/api';

/** One past conversion, as recorded server-side. */
interface ConversionRecord {
  from: string;
  to: string;
  rate: string;
  subjects: number;
  grounded: number;
  at: string;
  by: number | null;
}

interface BaseCurrencyState {
  /** The base InvFlux's stored costs are denominated in. */
  anchor: string;
  /** The base the store runs on now. */
  current: string;
  drifted: boolean;
  /** Cost rows this conversion would restate. */
  affected: number;
  /** Largest stored cost — the worked example, and the one that decides whether a rate fits. */
  largest_cost: string | null;
  /** Largest value a cost column can hold. */
  ceiling: string;
  /** Whether this store keeps WooCommerce's own COGS field — its feature is opt-in. */
  mirrors_cogs: boolean;
  history: ConversionRecord[];
  can_convert: boolean;
}

interface ConversionResponse {
  converted: { from: string; to: string; rate: string; subjects: number; grounded: number };
  state: BaseCurrencyState;
}

/** Where the screen stands. `done` keeps the result on screen instead of snapping back to a settled view. */
type Phase = 'idle' | 'running' | 'done';

/**
 * Format a cost for display at the scale costs are actually stored at (4 dp), not at the currency's
 * minor units.
 *
 * Fixed rather than 2-to-4: this screen only ever shows a stored cost *beside* its converted twin, and
 * a variable scale renders them at different precisions whenever one happens to end in zeros — "34.98
 * becomes 43.0254" reads as though the conversion invented digits, when both figures are 4 dp and one
 * was simply trimmed. Showing the stored scale also puts the rounding the conversion performs on
 * screen, which is the thing a merchant checking a rate is entitled to see.
 */
function amount(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : value;
}

/**
 * **Base-currency conversion** (`/costing/base-currency`) — the way out of a drift block.
 *
 * Changing the store's base currency does not restate what InvFlux already stored: a `seed_cost` and a
 * `weighted_avg_cost` are live figures denominated in the base that was in force when they were
 * written. So InvFlux anchors the base it operates in, and when the store's own currency moves away
 * from that anchor it stops every cost-mutating operation rather than let a moving average blend two
 * currencies into one meaningless number. That block is correct, but on its own it is a dead end —
 * this screen is the exit.
 *
 * A one-shot controlled migration, so it gets its own direct route rather than a section of Settings:
 * a store does this once in its life, if ever, and it should read as the deliberate act it is — see
 * the two currencies, choose a rate, see what it does to the largest cost you hold, confirm in
 * writing. Reached from the drift notice, and only meaningful while drift is live.
 *
 * The rate is typed, not fetched: InvFlux has no rate reference to draw on yet (arch-fx §2 is the
 * unbuilt half), and inventing one for a decision this consequential would be worse than asking. It is
 * also a judgement call that belongs to the merchant — the rate they will answer for.
 */
export default function BaseCurrencySection(): JSX.Element {
  const app = useApp();
  const api = createApi(app);

  const state = createQuery(() => ({
    queryKey: ['costing', 'base-currency'],
    queryFn: () => api.get<BaseCurrencyState>('/costing/base-currency'),
    staleTime: 0,
  }));

  const [rate, setRate] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [failure, setFailure] = createSignal('');
  const [result, setResult] = createSignal<ConversionResponse['converted'] | null>(null);

  const data = (): BaseCurrencyState | undefined => state.data;
  const parsedRate = createMemo(() => Number(rate().trim().replace(',', '.')));
  const rateUsable = (): boolean => Number.isFinite(parsedRate()) && parsedRate() > 0;

  /** What the largest stored cost becomes at the typed rate — the sanity check that catches a rate
   *  entered upside down, which is the classic FX error and otherwise only shows up in the books. */
  const projected = createMemo<string | null>(() => {
    const largest = data()?.largest_cost;
    if (undefined === largest || null === largest || !rateUsable()) return null;
    return (Number(largest) * parsedRate()).toFixed(4);
  });

  const overflows = createMemo(() => {
    const p = projected();
    const ceiling = data()?.ceiling;
    return null !== p && undefined !== ceiling && Number(p) > Number(ceiling);
  });

  const confirmed = (): boolean => confirmation().trim().toUpperCase() === (data()?.current ?? '');

  /**
   * Wrong *so far*, as opposed to merely incomplete: what has been typed is not the start of the
   * currency code. `C` and `CH` are on their way to `CHF` and stay neutral; `0.815` never will be, so
   * it reddens on the first character. Flagging any non-match instead would paint the field red
   * throughout normal typing, which trains the operator to ignore the colour.
   */
  const confirmationWrong = (): boolean => {
    const typed = confirmation().trim().toUpperCase();
    return '' !== typed && !(data()?.current ?? '').startsWith(typed);
  };

  /** A rate that cannot be used as entered — not merely half-typed. */
  const rateWrong = (): boolean => '' !== rate().trim() && (!rateUsable() || overflows());
  const ready = (): boolean =>
    rateUsable() && !overflows() && confirmed() && true === data()?.can_convert && 'running' !== phase();

  /**
   * Why the button is disabled, in the merchant's terms — never a disabled control with no account of
   * itself. Ordered by what to fix first, so it reads as one instruction rather than a checklist, and
   * silent once the form is ready.
   */
  const blocker = (): string => {
    if ('' === rate().trim()) return __('Enter your exchange rate above to continue.');
    if (!rateUsable()) return __('The exchange rate must be a number greater than zero.');
    if (overflows()) return __('Choose a rate that keeps your largest cost within the storable range.');
    if ('' === confirmation().trim())
      return sprintf(__('Type the currency code %s in the confirmation box to continue.'), data()?.current ?? '');
    if (!confirmed())
      // Says what is wrong, not merely that something is — the red field already carries "wrong",
      // and colour must never be the only thing carrying it.
      return sprintf(
        __('That is not the currency code. Type %s exactly — this box confirms the change, it does not take the rate.'),
        data()?.current ?? '',
      );
    return '';
  };

  async function convert(): Promise<void> {
    setPhase('running');
    setFailure('');
    try {
      const response = await api.post<ConversionResponse>('/costing/base-currency/convert', {
        rate: rate().trim().replace(',', '.'),
      });
      setResult(response.converted);
      setPhase('done');
      void state.refetch();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : __('The conversion could not be completed.'));
      setPhase('idle');
    }
  }

  return (
    <div class="mx-auto max-w-3xl p-6">
      <h1 class="text-xl font-semibold text-slate-900">{__('Base currency conversion')}</h1>

      <Switch fallback={<div class="mt-8 flex justify-center"><Spinner /></div>}>
        {/* Finished — report what happened, and say plainly that the host is still catching up. */}
        <Match when={'done' === phase() && null !== result()}>
          {(() => {
            const done = result();
            if (null === done) return <></>;
            return (
              <div class="mt-6 rounded border border-green-300 bg-green-50 p-4">
                <h2 class="font-semibold text-green-900">
                  {sprintf(__('Stored costs now read in %s.'), done.to)}
                </h2>
                <p class="mt-2 text-sm text-green-900">
                  {sprintf(
                    /* translators: 1: number of products, 2: old currency, 3: new currency, 4: rate */
                    _n(
                      '%1$d product’s cost was restated from %2$s to %3$s at %4$s.',
                      '%1$d products’ costs were restated from %2$s to %3$s at %4$s.',
                      done.subjects,
                    ),
                    done.subjects, done.from, done.to, done.rate,
                  )}
                </p>
                <Show when={done.grounded > 0}>
                  <p class="mt-2 text-sm text-green-900">
                    {sprintf(
                      _n(
                        '%1$d past stock-adjustment line was labelled %2$s so its recorded value stays readable. Those are history — they keep their original amounts.',
                        '%1$d past stock-adjustment lines were labelled %2$s so their recorded values stay readable. Those are history — they keep their original amounts.',
                        done.grounded,
                      ),
                      done.grounded, done.from,
                    )}
                  </p>
                </Show>
                <p class="mt-2 text-sm text-green-900">
                  {true === data()?.mirrors_cogs
                    ? __('Goods receipts and cost edits work again immediately. WooCommerce’s own cost fields are being updated in the background and may lag by a few minutes.')
                    : __('Goods receipts and cost edits work again immediately.')}
                </p>
              </div>
            );
          })()}
        </Match>

        {/* Nothing to do — the two currencies already agree. */}
        <Match when={undefined !== data() && false === data()?.drifted}>
          <p class="mt-4 rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {sprintf(
              __('Your stored costs already read in %s, the currency your store runs on. Nothing to convert.'),
              data()?.current ?? '',
            )}
          </p>
        </Match>

        <Match when={undefined !== data() && true === data()?.drifted}>
          <p class="mt-3 text-sm text-slate-700">
            {sprintf(
              /* translators: 1: currency stored costs are in, 2: the store's current currency */
              __('Your store now runs on %2$s, but every cost InvFlux has stored is denominated in %1$s. Until they are restated, goods receipts and cost edits stay blocked — a moving-average cost must never mix two currencies. Converting is one deliberate step, and it cannot be undone automatically.'),
              data()?.anchor ?? '', data()?.current ?? '',
            )}
          </p>

          <ol class="mt-6 space-y-6">
            <li>
              <h2 class="text-sm font-semibold text-slate-900">{__('1. What will change')}</h2>
              <p class="mt-2 text-sm text-slate-700">
                {sprintf(
                  _n(
                    '%1$d product’s stored cost will be restated from %2$s to %3$s.',
                    '%1$d products’ stored costs will be restated from %2$s to %3$s.',
                    data()?.affected ?? 0,
                  ),
                  data()?.affected ?? 0, data()?.anchor ?? '', data()?.current ?? '',
                )}
              </p>
              <p class="mt-1 text-sm text-slate-500">
                {__('Orders, shipments, purchase orders and past stock adjustments keep the amounts and currencies they were recorded in. They are history, and are never converted.')}
              </p>
            </li>

            <li>
              <h2 class="text-sm font-semibold text-slate-900">{__('2. Your exchange rate')}</h2>
              <label class="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <span>{sprintf(__('1 %s ='), data()?.anchor ?? '')}</span>
                <Input
                  inputmode="decimal"
                  class="w-32 text-right font-mono"
                  value={rate()}
                  onInput={(e) => setRate(e.currentTarget.value)}
                  placeholder="0.0000"
                  invalid={rateWrong()}
                  aria-label={sprintf(__('Exchange rate: how many %1$s one %2$s buys'), data()?.current ?? '', data()?.anchor ?? '')}
                />
                <span>{data()?.current ?? ''}</span>
              </label>
              <Show when={rateUsable() && null !== projected()}>
                <p class="mt-2 text-sm text-slate-700">
                  {sprintf(
                    /* translators: 1: largest stored cost, 2: old currency, 3: converted amount, 4: new currency */
                    __('Check the direction: your largest stored cost, %1$s %2$s, becomes %3$s %4$s.'),
                    amount(data()?.largest_cost ?? '0'), data()?.anchor ?? '',
                    amount(projected() ?? '0'), data()?.current ?? '',
                  )}
                </p>
              </Show>
              <Show when={overflows()}>
                <p class="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                  {sprintf(
                    __('That rate would take your largest cost past %s, the most InvFlux can store. Check the rate is the right way round, or correct that cost first.'),
                    amount(data()?.ceiling ?? '0'),
                  )}
                </p>
              </Show>
            </li>

            <li>
              <h2 class="text-sm font-semibold text-slate-900">{__('3. Confirm')}</h2>
              <label class="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <span>{sprintf(__('Type the currency code %s to confirm:'), data()?.current ?? '')}</span>
                <Input
                  class="w-24 uppercase"
                  value={confirmation()}
                  onInput={(e) => setConfirmation(e.currentTarget.value)}
                  placeholder={data()?.current ?? ''}
                  invalid={confirmationWrong()}
                  aria-label={sprintf(__('Type the currency code %s to confirm'), data()?.current ?? '')}
                />
              </label>
            </li>
          </ol>

          <Show when={false === data()?.can_convert}>
            <p class="mt-6 rounded border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
              {__('You can see this page but not run the conversion — it restates every stored cost, so it needs permission to change costs. Ask a shop manager.')}
            </p>
          </Show>

          <Show when={'' !== failure()}>
            <p class="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{failure()}</p>
          </Show>

          <div class="mt-6 flex items-center gap-3">
            <Button disabled={!ready()} onClick={() => void convert()}>
              {'running' === phase()
                ? __('Converting…')
                : sprintf(__('Convert stored costs to %s'), data()?.current ?? '')}
            </Button>
            <Show when={'running' === phase()}><Spinner /></Show>
            <Show when={'' !== blocker() && true === data()?.can_convert}>
              <p class="text-sm text-slate-600">{blocker()}</p>
            </Show>
          </div>
        </Match>
      </Switch>

      <Show when={(data()?.history.length ?? 0) > 0}>
        <section class="mt-10">
          <h2 class="text-sm font-semibold text-slate-900">{__('Past conversions')}</h2>
          <p class="mt-1 text-sm text-slate-500">
            {__('Every stored cost depends on the rate that was used, so the record is kept.')}
          </p>
          <ul class="mt-3 divide-y divide-slate-200 border-t border-slate-200 text-sm">
            <For each={[...(data()?.history ?? [])].reverse()}>
              {(entry) => (
                <li class="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span class="font-mono">{entry.from} → {entry.to}</span>
                  <span class="font-mono text-slate-600">{entry.rate}</span>
                  <span class="text-slate-600">
                    {sprintf(
                      _n('%d product', '%d products', entry.subjects),
                      entry.subjects,
                    )}
                  </span>
                  <span class="text-slate-500">{new Date(entry.at).toLocaleString()}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
