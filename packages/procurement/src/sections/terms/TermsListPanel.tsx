import { __, _n, _x, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, Spinner, toast } from '@invflux/ui';
import { createMutation, useQueryClient } from '@tanstack/solid-query';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { refusalBody, refusalMessage, stillChosenMessage } from './errors';
import type { RetireAnswer, TermsSetSummary } from './types';
import { TERMS_QUERY_KEY, useTermsSets } from './useTermsSets';

/**
 * Every set of purchase terms on file, as the terms dialog's second tab: open one, choose one where
 * the dialog came from a picker, write a new one, or remove one.
 *
 * Each row carries the fact its remove action turns on — whether any order went out under the set —
 * so the button says *Delete* or *Archive* before it is clicked rather than explaining afterwards.
 * The confirmation is a line under the list, not a dialog over the dialog.
 */
export function TermsListPanel(props: {
  /** The set that applies where the dialog was opened. */
  currentId: number | null;
  /**
   * Its mark in the list, in that place's words ("On Draft #123"); "Used here" without one, and none
   * when empty — where the row already says it another way.
   */
  currentBadge?: string;
  /** Chooses a set where the dialog was opened; absent where nothing can be chosen. */
  useHere?: (setId: number) => void | Promise<void>;
  onOpen: (setId: number) => void;
  onNew: () => void;
  /** A set was removed, so the dialog lets go of it if it had it open. */
  onRemoved: (setId: number) => void;
  onDone: () => void;
}): JSX.Element {
  const api = createApi(useProcurement());
  const queryClient = useQueryClient();
  const sets = useTermsSets();

  const [removing, setRemoving] = createSignal<TermsSetSummary | null>(null);
  // Delete or archive, as the row offered: a set orders went out under is archived, never deleted.
  const remove = createMutation(() => ({
    mutationFn: (set: TermsSetSummary) =>
      set.orders > 0
        ? api.post<RetireAnswer>(`/procurement/terms/${set.id}/archive`, {})
        : api.del<RetireAnswer>(`/procurement/terms/${set.id}`),
    onSuccess: (data, set) => {
      setRemoving(null);
      const done =
        'archived' === data.outcome
          ? __('Archived. The terms stay readable for the orders issued under them.')
          : __('Deleted.');
      const released =
        data.releasedDrafts > 0
          ? sprintf(
              /* translators: %d: number of draft purchase orders that followed the removed terms */
              _n(
                '%d draft order now uses its supplier’s or the store’s terms.',
                '%d draft orders now use their supplier’s or the store’s terms.',
                data.releasedDrafts,
              ),
              data.releasedDrafts,
            )
          : '';
      toast.success('' === released ? done : `${done} ${released}`);
      void queryClient.invalidateQueries({ queryKey: [...TERMS_QUERY_KEY] });
      // The drafts it released now inherit, which their pages have to show.
      if (data.releasedDrafts > 0) {
        void queryClient.invalidateQueries({ queryKey: ['procurement', 'purchase-orders'] });
      }
      props.onRemoved(set.id);
    },
    onError: (e: unknown, set) => {
      void queryClient.invalidateQueries({ queryKey: [...TERMS_QUERY_KEY] });
      // An order went out under the set since the list was loaded: say so, and offer to archive it.
      if ('issued' === refusalBody(e).reason) {
        toast.error(refusalMessage(e, __('Could not delete these terms.')));
        setRemoving({ ...set, orders: Math.max(1, Number(refusalBody(e).orders ?? 1)) });

        return;
      }
      setRemoving(null);
      toast.error(stillChosenMessage(e) ?? refusalMessage(e, __('Could not remove these terms.')));
    },
  }));

  const useSet = async (set: TermsSetSummary): Promise<void> => {
    try {
      await props.useHere?.(set.id);
    } catch (e: unknown) {
      toast.error(refusalMessage(e, __('Could not choose these terms here.')));

      return;
    }
    toast.success(
      sprintf(
        /* translators: %s: the name of a set of purchase terms */
        __('“%s” chosen here.'),
        set.name,
      ),
    );
    props.onDone();
  };

  /** The remove button's word, decided by usage — the consequence is visible before the click. */
  const removeLabel = (set: TermsSetSummary): string =>
    set.orders > 0 ? _x('Archive', 'verb: retire a set of terms to the archive') : __('Delete');
  const removeTitle = (set: TermsSetSummary): string =>
    set.orders > 0
      ? sprintf(
          /* translators: %d: number of purchase orders issued under these terms */
          _n(
            'Used by %d order, so the terms stay in your archive for it.',
            'Used by %d orders, so the terms stay in your archive for them.',
            set.orders,
          ),
          set.orders,
        )
      : __('No order was issued under these terms, so they can be deleted outright.');

  return (
    <div data-testid="terms-list">
      <div class="mb-3 flex items-start justify-between gap-4">
        <p class="text-sm text-text-muted">
          {__(
            'The terms and conditions purchase orders carry. Once an order goes out under a text, that text is kept exactly as sent: editing it saves a new version.',
          )}
        </p>
        <Button
          size="sm"
          class="shrink-0 whitespace-nowrap"
          data-testid="terms-new"
          onClick={() => props.onNew()}
        >
          {__('+ New terms')}
        </Button>
      </div>

      <Show
        when={!sets.isError}
        fallback={<ErrorBanner>{__('Could not load the purchase terms.')}</ErrorBanner>}
      >
        <Show when={sets.data} fallback={<Spinner />}>
          {(data) => (
            <Show
              when={data().sets.length > 0}
              fallback={
                <p class="rounded border border-dashed border-slate-300 bg-surface p-6 text-center text-sm text-text-muted">
                  {__('No purchase terms yet. Write the terms your orders should carry.')}
                </p>
              }
            >
              <table class="w-full border-collapse rounded border border-slate-200 bg-surface text-sm">
                <thead>
                  <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-text-muted">
                    <th class="px-3 py-2 font-medium">{__('Name')}</th>
                    <th class="px-3 py-2 font-medium">{__('Version')}</th>
                    <th class="px-3 py-2 font-medium">{__('Orders issued')}</th>
                    <th class="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  <For each={data().sets}>
                    {(set) => (
                      <tr
                        class="border-b border-slate-100 last:border-b-0"
                        data-testid="terms-list-row"
                        data-terms-id={set.id}
                        data-current={set.id === props.currentId ? '1' : '0'}
                      >
                        <td class="px-3 py-2">
                          <button
                            type="button"
                            class="text-left font-medium text-primary hover:underline"
                            data-testid="terms-list-open"
                            onClick={() => props.onOpen(set.id)}
                          >
                            {set.name}
                          </button>
                          <Show when={set.isStoreDefault}>
                            <span class="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {__("Store's terms")}
                            </span>
                          </Show>
                          <Show when={set.id === props.currentId && '' !== props.currentBadge}>
                            <span class="ml-2 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                              {props.currentBadge ?? __('Used here')}
                            </span>
                          </Show>
                        </td>
                        <td class="px-3 py-2 tabular-nums">
                          {null === set.ordinal ? '—' : set.ordinal}
                        </td>
                        <td class="px-3 py-2 tabular-nums">{set.orders}</td>
                        <td class="px-3 py-2">
                          <div class="flex items-center justify-end gap-2">
                            <Show when={props.useHere && set.id !== props.currentId}>
                              <Button
                                size="sm"
                                variant="secondary"
                                class="whitespace-nowrap"
                                data-testid="terms-list-use"
                                onClick={() => void useSet(set)}
                              >
                                {__('Use this')}
                              </Button>
                            </Show>
                            {/* The store's default is what every order falls back to, so it is never
                                removed — the server refuses it too; choose another default first. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid="terms-list-remove"
                              title={
                                set.isStoreDefault
                                  ? __(
                                      'These are the store’s default terms. Choose other default terms in the settings before removing these.',
                                    )
                                  : removeTitle(set)
                              }
                              disabled={remove.isPending || set.isStoreDefault}
                              onClick={() => setRemoving(set)}
                            >
                              {removeLabel(set)}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </Show>
      </Show>

      <Show when={removing()}>
        {(set) => (
          <div
            class="mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="terms-remove-confirm"
            data-terms-id={set().id}
          >
            <span class="mr-auto">
              <span class="font-medium">
                {set().orders > 0
                  ? sprintf(
                      /* translators: %s: the name of a set of purchase terms */
                      __('Archive “%s”?'),
                      set().name,
                    )
                  : sprintf(
                      /* translators: %s: the name of a set of purchase terms */
                      __('Delete “%s”?'),
                      set().name,
                    )}
              </span>{' '}
              {removeTitle(set())}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setRemoving(null)}>
              {__('Cancel')}
            </Button>
            <Button
              size="sm"
              data-testid="terms-remove-confirm-button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(set())}
            >
              {removeLabel(set())}
            </Button>
          </div>
        )}
      </Show>
    </div>
  );
}
