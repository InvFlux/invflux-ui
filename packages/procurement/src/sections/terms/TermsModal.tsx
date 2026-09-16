import { __ } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  IconButton,
  Modal,
  MODAL_BAR_TINT,
  ModalDragHandle,
  ModalHeader,
  ModalPanel,
  Spinner,
} from '@invflux/ui';
import { createQuery } from '@tanstack/solid-query';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import { RenderedTerms } from './RenderedTerms';
import { TermsComposer } from './TermsComposer';
import { TermsListPanel } from './TermsListPanel';
import { TermsPickerForm } from './TermsPickerForm';
import { RENDERED } from './typography';
import type { NumberingBreak, TermsPlace, TermsPreview } from './types';

/** What the dialog opens on. */
export type TermsModalTarget =
  /**
   * A set on file — or, with a null id, the list of every set, for a picker that has none to show.
   * `useHere`, when given, chooses what is saved at the picker the dialog came from; `readOnly` shows
   * the set alone, without editing, where the terms can no longer change; `place` names where the
   * dialog was opened, so it can say which set applies there.
   */
  | {
      kind: 'set';
      id: number | null;
      useHere?: (setId: number) => void | Promise<void>;
      readOnly?: boolean;
      place?: TermsPlace;
    }
  /** The terms numbering fixed on an order: read only, and not the set's current text if it moved on. */
  | { kind: 'issued'; text: string; name: string | null }
  /**
   * An order's own terms, never saved as a set. `onSave` resolves `true` once saved, else with the
   * numbering breaks it was refused for (empty for any other refusal, which it reports itself).
   */
  | { kind: 'one-off'; value: string; onSave: (text: string) => Promise<true | NumberingBreak[]> };

type Tab = 'set' | 'list';

/** A tab in the strip under the title, drawn as the column manager's are. */
const tabClass = (active: boolean): string =>
  `-mb-px cursor-pointer rounded-t border-b-2 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
    active
      ? 'border-primary bg-surface text-primary'
      : 'border-transparent bg-surface-hover text-text-muted hover:text-text'
  }`;

/**
 * Purchase terms read and written beside the picker that chooses them, so choosing and editing never
 * cost the merchant the page they were on. It is the one place terms are written: a set opens on its
 * own tab, and every set on file is the second.
 *
 * Closing with unsaved work asks first, inside the dialog: a stray Escape or click should not throw
 * away a clause someone just wrote. While a set has unsaved changes the list tab waits too, so moving
 * between tabs never drops an edit.
 */
export function TermsModal(props: { target: TermsModalTarget; onClose: () => void }): JSX.Element {
  const [dirty, setDirty] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const requestClose = (): void => {
    if (dirty()) {
      setConfirming(true);
    } else {
      props.onClose();
    }
  };

  const title = (): string =>
    'one-off' === props.target.kind ? __('Terms written for this order') : __('Purchase terms');

  // The tabs, for a set that can be edited: the set being read or written, and every set.
  const setTarget = (): Extract<TermsModalTarget, { kind: 'set' }> | null =>
    'set' === props.target.kind ? props.target : null;
  const opening = untrack(() => setTarget()?.id ?? null);
  const [tab, setTab] = createSignal<Tab>(null === opening ? 'list' : 'set');
  /** What the first tab shows: the set opened on, then whichever the list opens; 'new' while one is written. */
  const [shown, setShown] = createSignal<number | 'new' | null>(opening);
  const tabbed = (): boolean => null !== setTarget() && true !== setTarget()?.readOnly;
  const go = (next: Tab): void => {
    if (next === tab()) {
      return;
    }
    setDirty(false);
    setTab(next);
  };

  return (
    <Modal onClose={requestClose} closeOnBackdrop={false} label={title()}>
      <ModalPanel size="3xl">
        {/* With tabs, the title bar carries them beside the title, sitting on its rule as the column
            manager's do — the same bar `ModalHeader` draws, which has no place for them. */}
        <Show
          when={tabbed()}
          fallback={
            <ModalHeader
              title={title()}
              actions={
                <IconButton label={__('Close')} onClick={requestClose}>
                  <span aria-hidden="true">×</span>
                </IconButton>
              }
            />
          }
        >
          <ModalDragHandle
            class={`sticky top-0 flex items-end gap-4 border-b border-border px-4 pt-2 ${MODAL_BAR_TINT}`}
          >
            <h2 class="min-w-0 pb-2 text-base font-semibold text-text">{title()}</h2>
            <div
              role="tablist"
              aria-label={__('Purchase terms')}
              data-testid="terms-dialog-tabs"
              class="flex items-end gap-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={'set' === tab()}
                data-testid="terms-tab-set"
                class={tabClass('set' === tab())}
                disabled={null === shown()}
                onClick={() => go('set')}
              >
                {__('These terms')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={'list' === tab()}
                data-testid="terms-tab-list"
                class={tabClass('list' === tab())}
                disabled={dirty()}
                title={dirty() ? __('Save or cancel the changes first.') : undefined}
                onClick={() => go('list')}
              >
                {__('All terms')}
              </button>
            </div>
            <div data-modal-actions class="ml-auto flex shrink-0 items-center gap-2 self-center">
              <IconButton label={__('Close')} onClick={requestClose}>
                <span aria-hidden="true">×</span>
              </IconButton>
            </div>
          </ModalDragHandle>
        </Show>
        <div class="p-4" data-testid="terms-dialog" data-kind={props.target.kind}>
          <Show when={confirming()}>
            <div class="mb-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span class="mr-auto">{__('These terms have changes that are not saved.')}</span>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                {__('Keep editing')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onClose()}>
                {__('Discard changes')}
              </Button>
            </div>
          </Show>
          <Switch>
            <Match when={setTarget()}>
              {(t) => (
                <SetsBody
                  target={t()}
                  tab={tab()}
                  shown={shown()}
                  onShow={setShown}
                  onTab={go}
                  onDirtyChange={setDirty}
                  onDone={() => props.onClose()}
                />
              )}
            </Match>
            <Match when={'issued' === props.target.kind && props.target}>
              {(t) => <IssuedTerms target={t() as Extract<TermsModalTarget, { kind: 'issued' }>} />}
            </Match>
            <Match when={'one-off' === props.target.kind && props.target}>
              {(t) => (
                <OneOffForm
                  target={t() as Extract<TermsModalTarget, { kind: 'one-off' }>}
                  onDirtyChange={setDirty}
                  onDone={() => props.onClose()}
                />
              )}
            </Match>
          </Switch>
        </div>
      </ModalPanel>
    </Modal>
  );
}

/**
 * The body under the tabs: the set being read or written, or every set. The list opens a set on the
 * first tab, or starts a new one there.
 */
function SetsBody(props: {
  target: Extract<TermsModalTarget, { kind: 'set' }>;
  tab: Tab;
  shown: number | 'new' | null;
  onShow: (shown: number | 'new' | null) => void;
  onTab: (tab: Tab) => void;
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}): JSX.Element {
  // One form per set: opening another starts afresh, never carrying the last one's state.
  const form = createMemo(() =>
    null === props.shown ? null : { id: 'new' === props.shown ? null : props.shown },
  );

  return (
    <div data-testid="terms-dialog-sets" data-tab={props.tab}>
      <Show when={'list' === props.tab}>
        <TermsListPanel
          currentId={props.target.place?.appliedId ?? props.target.id}
          currentBadge={props.target.place?.badge}
          useHere={props.target.useHere}
          onOpen={(id) => {
            props.onShow(id);
            props.onTab('set');
          }}
          onNew={() => {
            props.onShow('new');
            props.onTab('set');
          }}
          onRemoved={(id) => {
            if (props.shown === id) {
              props.onShow(null);
            }
          }}
          onDone={props.onDone}
        />
      </Show>
      <Show when={'set' === props.tab && form()} keyed>
        {(f) => (
          <TermsPickerForm
            id={f.id}
            useHere={props.target.useHere}
            readOnly={props.target.readOnly}
            place={props.target.place}
            onDone={props.onDone}
            onDirtyChange={props.onDirtyChange}
            onCancelNew={() => {
              props.onShow(null);
              props.onTab('list');
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** The terms an order was numbered with, as they print — there is nothing to edit or choose. */
function IssuedTerms(props: {
  target: Extract<TermsModalTarget, { kind: 'issued' }>;
}): JSX.Element {
  const api = createApi(useProcurement());
  const rendered = createQuery(() => ({
    queryKey: ['procurement', 'terms-rendered', props.target.text],
    queryFn: () =>
      api.post<TermsPreview>('/procurement/terms/preview', { body: props.target.text }),
  }));

  return (
    <>
      <header class="mb-3">
        <Show when={props.target.name}>
          {(name) => <h3 class="text-base font-semibold">{name()}</h3>}
        </Show>
        <p class="mt-1 text-sm text-text-muted">
          {__('As fixed when this order was numbered. Editing the set later does not change them.')}
        </p>
      </header>
      <Show
        when={!rendered.isError}
        fallback={<ErrorBanner>{__('Could not load these terms.')}</ErrorBanner>}
      >
        <Show when={rendered.data} fallback={<Spinner />}>
          {(r) => <RenderedTerms class={RENDERED} html={r().html} />}
        </Show>
      </Show>
    </>
  );
}

/** An order's own terms: the composer, and a save that goes straight to the order. */
function OneOffForm(props: {
  target: Extract<TermsModalTarget, { kind: 'one-off' }>;
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}): JSX.Element {
  const [text, setText] = createSignal(untrack(() => props.target.value));
  const [refused, setRefused] = createSignal<NumberingBreak[]>([]);
  const [saving, setSaving] = createSignal(false);

  createEffect(() => props.onDirtyChange(text().trim() !== props.target.value.trim()));

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const answer = await props.target.onSave(text());
      if (true === answer) {
        props.onDone();
      } else {
        setRefused(answer);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TermsComposer
        label={__('Terms')}
        value={text()}
        onInput={setText}
        minRows={8}
        placeholder={__('Terms for this order alone. They are not saved as a set.')}
        refused={refused()}
      />
      <div class="mt-4 flex justify-end">
        <Button
          disabled={saving() || text().trim() === props.target.value.trim()}
          onClick={() => void save()}
        >
          {__('Save')}
        </Button>
      </div>
    </>
  );
}
