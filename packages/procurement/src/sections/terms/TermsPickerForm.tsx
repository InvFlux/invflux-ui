import { __, _n, formatDate, sprintf } from '@invflux/i18n';
import { Button, ErrorBanner, ESC_LOCAL_ATTR, PencilIcon, Spinner, toast } from '@invflux/ui';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  Show,
  untrack,
} from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { freeCopyName } from './copyName';
import { refusalBody, refusalMessage } from './errors';
import { FormattingHelp, TermsHint } from './FormattingHelp';
import { NumberingBreaks } from './NumberingBreaks';
import { RenderedTerms } from './RenderedTerms';
import { TermsTextarea } from './TermsTextarea';
import { RENDERED, TERMS_TYPOGRAPHY } from './typography';
import { TERMS_QUERY_KEY } from './useTermsSets';
import type { TermsPlace, TermsPreview, TermsSetDetail, TermsSetSummary } from './types';

/** Where a set is chosen, as one line — the store's default, suppliers, draft orders. Null when nowhere. */
function usageLine(s: TermsSetDetail): string | null {
  const parts: string[] = [];
  if (s.selectedBy.store) {
    parts.push(__('the store’s default'));
  }
  const suppliers = s.selectedBy.suppliers.length;
  if (suppliers > 0) {
    /* translators: %d: number of suppliers */
    parts.push(sprintf(_n('%d supplier', '%d suppliers', suppliers), suppliers));
  }
  const drafts = s.selectedBy.draftOrders;
  if (drafts > 0) {
    /* translators: %d: number of draft purchase orders */
    parts.push(sprintf(_n('%d draft order', '%d draft orders', drafts), drafts));
  }

  return 0 === parts.length
    ? null
    : /* translators: %s: where a set of terms is chosen, e.g. "the store’s default, 3 suppliers" */
      sprintf(__('In use for %s'), parts.join(', '));
}

type Mode = 'review' | 'edit' | 'preview';

/**
 * A set of purchase terms as a picker shows it: read first, edited on request.
 *
 * It opens on the text as it prints, since the question at a picker is usually "what are these?".
 * Editing is a step the merchant takes ([Edit]); the edit lands in this set, or in a copy ([Create a
 * copy]), and is chosen at the picker in the same move ([Save and use here]).
 *
 * **A new set or a copy exists only once saved.** Its name is chosen here — a copy's starts as "Copy
 * of X", then "Copy (2) of X"…, against every set's name, archived ones included — and goes out with
 * its text in one request. A copy has to differ from what it copies: orders record the text, not the
 * set, so identical text would share its original's printed reference and its order history.
 *
 * **The name renames in place** — commit on Enter or blur — and never rides the text's save: it is
 * internal and never printed, where the text is what orders point at.
 */
export function TermsPickerForm(props: {
  /** The set to show; null writes a new one from scratch. */
  id: number | null;
  /**
   * Chooses a set where the dialog was opened: in a picker, for its form's Save to commit, or saved
   * straight away from a page that is only being read. Absent where nothing can be chosen.
   */
  useHere?: (setId: number) => void | Promise<void>;
  /** The set as it prints, without [Edit] — where the terms opened on can no longer change. */
  readOnly?: boolean;
  /** Where the dialog was opened, in that place's words: which set applies there, and how to use another. */
  place?: TermsPlace;
  onDone: () => void;
  /** A new set given up before it was saved: back to wherever it was started from. */
  onCancelNew?: () => void;
  /** Whether there is work that closing would lose, so the dialog can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const api = createApi(useProcurement());
  const queryClient = useQueryClient();
  const bodyId = createUniqueId();
  const nameId = createUniqueId();
  const nameLabelId = createUniqueId();
  const isNew = (): boolean => null === props.id;

  const detail = createQuery(() => ({
    queryKey: [...TERMS_QUERY_KEY, props.id],
    queryFn: () => api.get<{ set: TermsSetDetail }>(`/procurement/terms/${props.id}`),
    enabled: !isNew(),
  }));
  const set = (): TermsSetDetail | undefined => detail.data?.set;

  // The dialog mounts one form per set, so whether it writes a new one is fixed for its lifetime. A
  // new set starts where a copy does: named here, written in the box, created when saved.
  const fresh = untrack(isNew);
  const [mode, setMode] = createSignal<Mode>(fresh ? 'edit' : 'review');
  const [body, setBody] = createSignal('');
  /** The name a new set or a copy will take; null while working on the set itself. */
  const [newName, setNewName] = createSignal<string | null>(fresh ? '' : null);
  /** The set as it prints, rendered once on opening. */
  const [printed, setPrinted] = createSignal<TermsPreview | null>(null);
  const [preview, setPreview] = createSignal<TermsPreview | null>(null);
  const [flagged, setFlagged] = createSignal<ReadonlySet<number>>(new Set());

  const creating = (): boolean => null !== newName();
  const original = (): string => set()?.body ?? '';
  const changed = (): boolean => body().trim() !== original().trim();
  const breaks = (): number => preview()?.numberingBreaks.length ?? 0;
  createEffect(() =>
    props.onDirtyChange?.(
      isNew() ? '' !== body().trim() || '' !== (newName() ?? '').trim() : changed() || creating(),
    ),
  );

  const render = (text: string): Promise<TermsPreview> =>
    api.post<TermsPreview>('/procurement/terms/preview', {
      body: text,
      lineageId: props.id,
      copy: creating(),
    });

  // Seed the text and render it once per loaded set.
  createEffect(
    on(
      () => detail.data?.set,
      (loaded) => {
        if (undefined === loaded) {
          return;
        }
        setBody(loaded.body);
        render(loaded.body).then(setPrinted, (e: unknown) =>
          toast.error(refusalMessage(e, __('Could not preview these terms.'))),
        );
      },
    ),
  );

  const runPreview = createMutation(() => ({
    mutationFn: () => render(body()),
    onSuccess: (data) => {
      // The box takes the text as it will be stored, so a line the check names is the line on screen.
      setBody(data.source);
      setFlagged(new Set(data.numberingBreaks.map((b) => b.line)));
      setPreview(data);
      setMode('preview');
    },
    onError: (e: unknown) => toast.error(refusalMessage(e, __('Could not preview these terms.'))),
  }));

  /** Drop every edit — and the copy, if one was being made — and go back to the set as it prints. */
  const cancel = (): void => {
    if (isNew()) {
      props.onCancelNew?.();

      return;
    }
    setBody(original());
    setNewName(null);
    setFlagged(new Set<number>());
    setPreview(null);
    setMode('review');
  };

  const startCopy = async (): Promise<void> => {
    const current = set();
    if (undefined === current) {
      return;
    }
    try {
      // Every name, archived sets' included: they keep their names, so a copy cannot take one.
      const all = await queryClient.fetchQuery({
        queryKey: [...TERMS_QUERY_KEY, 'with-archived'],
        queryFn: () =>
          api.get<{ sets: TermsSetSummary[] }>('/procurement/terms', { archived: '1' }),
      });
      setNewName(
        freeCopyName(
          current.name,
          all.sets.map((s) => s.name),
        ),
      );
      setMode('edit');
    } catch (e: unknown) {
      toast.error(refusalMessage(e, __('Could not start a copy.')));
    }
  };

  const save = createMutation(() => ({
    mutationFn: async (): Promise<number> => {
      const name = newName();
      if (null !== name) {
        const data = await api.post<{ set: TermsSetDetail }>('/procurement/terms', {
          name: name.trim(),
          body: body(),
          copyOf: props.id,
        });

        return data.set.id;
      }
      await api.put<{ outcome: string; set: TermsSetDetail | null }>(
        `/procurement/terms/${props.id}/content`,
        {
          body: body(),
          editedFromOrdinal: set()?.ordinal ?? 0,
        },
      );

      return props.id as number;
    },
    onSuccess: async (id) => {
      // Waits for the refreshed list, so the picker has the set's option before it is chosen.
      await queryClient.invalidateQueries({ queryKey: [...TERMS_QUERY_KEY] });
      try {
        await props.useHere?.(id);
      } catch (e: unknown) {
        // The terms are saved either way; only choosing them failed, so say exactly that.
        toast.error(refusalMessage(e, __('Saved, but could not choose these terms here.')));
        props.onDone();

        return;
      }
      if (creating()) {
        toast.success(
          props.useHere ? __('Saved as new terms, chosen here.') : __('Terms created.'),
        );
      } else {
        toast.success(props.useHere ? __('Saved, and chosen here.') : __('Saved.'));
      }
      props.onDone();
    },
    onError: (e: unknown) => {
      // Someone saved while this was open: reload their version rather than save over it.
      if ('stale_edit' === refusalBody(e).reason) {
        void queryClient.invalidateQueries({ queryKey: [...TERMS_QUERY_KEY] });
      }
      toast.error(refusalMessage(e, __('Could not save these terms.')));
    },
  }));

  /** Use a set that already reads as the edit does, instead of saving a second one. */
  const useSame = async (same: { id: number; name: string }): Promise<void> => {
    try {
      await props.useHere?.(same.id);
    } catch (e: unknown) {
      toast.error(refusalMessage(e, __('Could not choose these terms here.')));

      return;
    }
    toast.success(
      sprintf(
        /* translators: %s: the name of a set of purchase terms */
        __('“%s” chosen here.'),
        same.name,
      ),
    );
    props.onDone();
  };

  // Rename: commits on Enter or blur. Escape puts the name back *before* the blur that follows the
  // input's removal lands, so that commit finds nothing to save.
  const [renaming, setRenaming] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const beginRename = (): void => {
    setNameDraft(set()?.name ?? '');
    setRenaming(true);
  };
  const rename = createMutation(() => ({
    mutationFn: (next: string) =>
      api.put<{ set: TermsSetDetail }>(`/procurement/terms/${props.id}/name`, { name: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...TERMS_QUERY_KEY] });
      setRenaming(false);
    },
    // A taken name keeps the box open, so the merchant can choose another without starting over.
    onError: (e: unknown) => toast.error(refusalMessage(e, __('Could not rename these terms.'))),
  }));
  const commitRename = (): void => {
    // One save at a time: a pending save disables the input, which blurs it, which lands here again.
    if (rename.isPending) {
      return;
    }
    const next = nameDraft().trim();
    if ('' === next || next === (set()?.name ?? '').trim()) {
      setRenaming(false);

      return;
    }
    rename.mutate(next);
  };

  /** What saving does, said on the button: a new version where orders went out under this text. */
  const saveLabel = (): string => {
    const current = set();
    const versioned = !creating() && true === current?.locked;
    const next = (current?.ordinal ?? 0) + 1;
    if (props.useHere) {
      if (props.place) {
        return props.place.saveAndUse(versioned ? next : null);
      }

      return versioned
        ? /* translators: %d: the version number a save will create */
          sprintf(__('Save version %d and use here'), next)
        : __('Save and use here');
    }

    return versioned
      ? /* translators: %d: the version number a save will create */
        sprintf(__('Save version %d'), next)
      : __('Save');
  };

  return (
    <Show
      when={!detail.isError}
      fallback={<ErrorBanner>{__('Could not load these terms.')}</ErrorBanner>}
    >
      <Show when={isNew() || undefined !== set()} fallback={<Spinner />}>
        <div
          data-testid="terms-set-form"
          data-mode={mode()}
          data-terms-id={null === props.id ? 'new' : String(props.id)}
        >
          <header class="mb-3">
            <Show
              when={creating()}
              fallback={
                <Show when={set()}>
                  {(s) => (
                    <>
                      {/* A field, not a heading: labelled, at body weight, and underlined the way text
                          you can click to edit is — so it never reads as the dialog's title or as the
                          text's own first heading. */}
                      <div class="flex items-center gap-2">
                        <span id={nameLabelId} class="shrink-0 text-xs text-text-muted">
                          {__('Name (not printed)')}
                        </span>
                        <Show
                          when={renaming()}
                          fallback={
                            <Show
                              when={!props.readOnly}
                              fallback={
                                <span
                                  class="text-sm font-medium text-text"
                                  data-testid="terms-name"
                                >
                                  {s().name}
                                </span>
                              }
                            >
                              <button
                                type="button"
                                data-testid="terms-rename"
                                aria-label={sprintf(
                                  /* translators: %s: the name of a set of purchase terms */
                                  __('Rename “%s”'),
                                  s().name,
                                )}
                                class="group inline-flex min-w-0 items-center gap-1.5 rounded border border-transparent px-1.5 py-0.5 text-left text-sm font-medium text-text hover:border-slate-300 hover:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                                onClick={beginRename}
                              >
                                <span class="truncate underline decoration-slate-400 decoration-dashed underline-offset-4">
                                  {s().name}
                                </span>
                                <PencilIcon class="h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-text" />
                              </button>
                            </Show>
                          }
                        >
                          {/* Escape here cancels the rename; the dialog, which listens for it first,
                              stands aside rather than closing. */}
                          <input
                            {...{ [ESC_LOCAL_ATTR]: '' }}
                            data-testid="terms-rename-input"
                            aria-labelledby={nameLabelId}
                            class="w-full max-w-md rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={nameDraft()}
                            disabled={rename.isPending}
                            ref={(el) => queueMicrotask(() => el.select())}
                            onInput={(e) => setNameDraft(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if ('Enter' === e.key) {
                                e.preventDefault();
                                commitRename();
                              } else if ('Escape' === e.key) {
                                e.preventDefault();
                                setNameDraft(s().name);
                                setRenaming(false);
                              }
                            }}
                            onBlur={commitRename}
                          />
                        </Show>
                      </div>
                      <p class="mt-1 text-sm text-text-muted">
                        {sprintf(
                          /* translators: %d: version number */
                          __('Version %d'),
                          s().ordinal ?? 0,
                        )}
                        {' · '}
                        {s().orders > 0
                          ? sprintf(
                              /* translators: %d: number of purchase orders */
                              _n(
                                '%d order issued under these terms',
                                '%d orders issued under these terms',
                                s().orders,
                              ),
                              s().orders,
                            )
                          : __('No order issued under these terms yet')}
                        <Show when={usageLine(s())}>
                          {(line) => (
                            <>
                              {' · '}
                              {line()}
                            </>
                          )}
                        </Show>
                      </p>
                    </>
                  )}
                </Show>
              }
            >
              <label class="block text-sm text-slate-700" for={nameId}>
                {__('Name (not printed)')}
              </label>
              <input
                id={nameId}
                data-testid="terms-name-input"
                class="mt-1 w-full max-w-md rounded border border-slate-300 bg-surface px-2 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder={isNew() ? __('e.g. Standard purchase terms') : undefined}
                value={newName() ?? ''}
                onInput={(e) => setNewName(e.currentTarget.value)}
              />
              <Show when={!isNew()}>
                <p class="mt-1 text-xs text-text-muted">
                  {sprintf(
                    /* translators: %s: the name of the terms being copied */
                    __(
                      'A copy of “%s”. It is created when you save it, and has to differ from the original.',
                    ),
                    set()?.name ?? '',
                  )}
                </p>
              </Show>
            </Show>
          </header>

          <Show when={'review' === mode()}>
            <section>
              <div class="mb-2 flex items-center gap-2">
                <h2 class="text-sm font-medium text-slate-600">{__('As it will print')}</h2>
                <Show when={props.useHere && !props.readOnly}>
                  <Button
                    size="sm"
                    variant="secondary"
                    class="ml-auto"
                    data-testid="terms-create-copy"
                    onClick={() => void startCopy()}
                  >
                    {__('Create a copy')}
                  </Button>
                </Show>
              </div>
              <Show when={printed()} fallback={<Spinner />}>
                {(p) => <RenderedTerms class={RENDERED} html={p().html} />}
              </Show>
              {/* [Edit] on the left; on the right, what this set is where the dialog was opened —
                  or, for any other set, the button that makes it so. */}
              <Show when={!props.readOnly || props.place}>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <Show when={!props.readOnly}>
                    <Button data-testid="terms-edit" onClick={() => setMode('edit')}>
                      {__('Edit')}
                    </Button>
                  </Show>
                  <Show when={props.place}>
                    {(place) => (
                      <div
                        class="ml-auto text-sm"
                        data-testid="terms-place"
                        data-applies={set()?.id === place().appliedId ? '1' : '0'}
                      >
                        <Show
                          when={set()?.id === place().appliedId}
                          fallback={
                            <Show when={props.useHere && !props.readOnly}>
                              <Button
                                size="sm"
                                variant="secondary"
                                data-testid="terms-use-here"
                                onClick={() => {
                                  const s = set();
                                  if (undefined !== s) {
                                    void useSame({ id: s.id, name: s.name });
                                  }
                                }}
                              >
                                {place().useLabel}
                              </Button>
                            </Show>
                          }
                        >
                          <span class="text-text-muted">{place().appliesText}</span>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              {/* A single version has no history to show. */}
              <Show when={(set()?.versions.length ?? 0) > 1}>
                <details class="mt-4 text-sm" data-testid="terms-versions">
                  <summary class="cursor-pointer text-slate-600">{__('Versions')}</summary>
                  <ul class="mt-2 space-y-1">
                    <For each={[...(set()?.versions ?? [])].reverse()}>
                      {(v) => (
                        <li class="flex items-baseline gap-2">
                          <span class="tabular-nums">
                            {sprintf(
                              /* translators: %d: version number */
                              __('Version %d'),
                              v.ordinal,
                            )}
                          </span>
                          <span class="text-xs text-text-muted">
                            {v.current
                              ? __('current')
                              : sprintf(
                                  /* translators: %s: the date a version was superseded */
                                  __('replaced %s'),
                                  formatDate(v.retiredAt),
                                )}
                            {' · '}
                            {sprintf(
                              /* translators: %d: number of purchase orders */
                              _n('%d order', '%d orders', v.orders),
                              v.orders,
                            )}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>
            </section>
          </Show>

          <Show when={'edit' === mode()}>
            <section>
              {/* A div, not a wrapping label: the formatting help between them is clickable, and a
                  click inside a label is forwarded to its field. */}
              <div class="text-sm text-slate-700">
                <label for={bodyId}>{__('Terms')}</label> <TermsHint />
                <FormattingHelp typography={TERMS_TYPOGRAPHY} />
                <TermsTextarea
                  id={bodyId}
                  minRows={8}
                  value={body()}
                  onInput={setBody}
                  flagged={flagged()}
                />
              </div>
              <div class="mt-3 flex items-center gap-2">
                <Button
                  data-testid="terms-preview-changes"
                  disabled={!changed() || runPreview.isPending}
                  onClick={() => runPreview.mutate()}
                >
                  {__('Preview changes')}
                </Button>
                <Show when={creating() && !isNew() && !changed()}>
                  <span class="text-xs text-text-muted">
                    {__(
                      'Change the copy before saving it — as it stands it is the same text as the original.',
                    )}
                  </span>
                </Show>
                <Button variant="ghost" class="ml-auto" data-testid="terms-cancel" onClick={cancel}>
                  {__('Cancel')}
                </Button>
              </div>
            </section>
          </Show>

          <Show when={'preview' === mode()}>
            <section>
              <h2 class="mb-2 text-sm font-medium text-slate-600">{__('As it will print')}</h2>
              <RenderedTerms class={RENDERED} html={preview()?.html ?? ''} />
              <Show when={breaks() > 0}>
                <NumberingBreaks class="mt-3" breaks={preview()?.numberingBreaks ?? []} />
              </Show>
              <Show when={(preview()?.renumbered.length ?? 0) > 0}>
                <div class="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    {__(
                      'These clauses now carry a different number. Check anything that refers to them by number before saving.',
                    )}
                  </p>
                  <ul class="mt-1 list-disc pl-5">
                    <For each={preview()?.renumbered ?? []}>
                      {(m) => (
                        <li>
                          {sprintf(
                            /* translators: 1: the clause's text, 2: its old number, 3: its new number */
                            __('“%1$s” — was %2$d, now %3$d'),
                            m.text,
                            m.from,
                            m.to,
                          )}
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
              {/* Wording already on file under another name: use that set rather than make a second. */}
              <Show when={(preview()?.sameText.length ?? 0) > 0}>
                <div
                  class="mt-3 rounded border border-slate-200 bg-surface-raised p-3 text-sm"
                  data-testid="terms-same-text"
                >
                  <p>{__('Other terms already have exactly this text:')}</p>
                  <ul class="mt-1 space-y-1">
                    <For each={preview()?.sameText ?? []}>
                      {(same) => (
                        <li class="flex items-baseline gap-3">
                          <span class="font-medium">{same.name}</span>
                          <Show when={props.useHere}>
                            <button
                              type="button"
                              class="text-xs text-primary hover:underline"
                              data-testid="terms-same-text-use"
                              data-terms-id={same.id}
                              onClick={() => void useSame(same)}
                            >
                              {__('Use this')}
                            </button>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
              <div class="mt-4 flex items-center gap-2">
                <Button
                  variant="secondary"
                  data-testid="terms-back-to-edit"
                  onClick={() => setMode('edit')}
                >
                  {__('Back to edit')}
                </Button>
                <Button
                  class="ml-auto"
                  data-testid="terms-save"
                  disabled={
                    save.isPending ||
                    !changed() ||
                    breaks() > 0 ||
                    (creating() && '' === (newName() ?? '').trim())
                  }
                  onClick={() => save.mutate()}
                >
                  {saveLabel()}
                </Button>
              </div>
            </section>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
