import { __, _x, sprintf } from '@invflux/i18n';
import { createApi } from '@invflux/procurement/src/lib/api';
import type { TermsModalTarget } from '@invflux/procurement/src/sections/terms/TermsModal';
import type { TermsSetSummary } from '@invflux/procurement/src/sections/terms/types';
import { TERMS_QUERY_KEY } from '@invflux/procurement/src/sections/terms/useTermsSets';
import { Select, type SettingControlProps } from '@invflux/ui';
import { createQuery } from '@tanstack/solid-query';
import { createSignal, For, type JSX, lazy, Show } from 'solid-js';
import { hasCapability } from '../../capabilities';
import { useApp } from '../../context';

// The dialog and its editor load on first open, never with the settings screen.
const TermsDialogHost = lazy(() => import('./TermsDialogHost'));

/**
 * The settings control for the store's set of purchase terms (`enum:terms-set`): the select an `enum`
 * gets, over the sets on file, and the purchase-terms dialog — where terms are read, written, copied
 * and removed.
 *
 * The select lists the sets live, from the cache the dialog refreshes, so a set made or renamed there
 * is offered at once. The definition's options stand in until that list arrives, and for a viewer who
 * may not manage purchase orders, who gets no dialog. Choosing a set in the dialog sets the select,
 * and the settings screen's Save stores it, as any other edit here.
 */
export function TermsSetControl(props: SettingControlProps): JSX.Element {
  const app = useApp();
  const canManage = hasCapability('managePurchaseOrders');
  const api = createApi(app);
  const sets = createQuery(() => ({
    queryKey: [...TERMS_QUERY_KEY],
    queryFn: () => api.get<{ sets: TermsSetSummary[] }>('/procurement/terms'),
    enabled: canManage,
  }));
  const [dialog, setDialog] = createSignal<TermsModalTarget | null>(null);

  const value = (): string =>
    null === props.value || undefined === props.value ? '' : String(props.value);
  const options = (): Array<{ value: string; label: string }> => {
    const fromDefinition = Array.isArray(props.definition.config.options)
      ? (props.definition.config.options as Array<{ value: string; label: string }>)
      : [];
    const live = sets.data?.sets;
    if (undefined === live) {
      return fromDefinition;
    }

    // "None" comes from the definition; the sets themselves are live.
    return [
      ...fromDefinition.filter((o) => !/^\d+$/.test(o.value)),
      ...live.map((s) => ({ value: String(s.id), label: s.name })),
    ];
  };
  // Opens on the store's set, or on the list of sets while it has none.
  const open = (): void => {
    const current = value();
    setDialog({
      kind: 'set',
      id: '' === current ? null : Number(current),
      useHere: (id) => props.onChange(String(id)),
      place: {
        appliedId: '' === current ? null : Number(current),
        appliesText: __('These are the store’s default terms.'),
        useLabel: __('Make these the store’s default terms'),
        // No mark while the choice is the store's saved default: the list already badges that row.
        badge:
          current === String(sets.data?.sets.find((s) => s.isStoreDefault)?.id ?? '')
            ? ''
            : _x('Selected', 'terms list badge: the set chosen in the store setting'),
        saveAndUse: (version) =>
          null === version
            ? __('Save and make the store default')
            : /* translators: %d: the version number a save will create */
              sprintf(__('Save version %d and make the store default'), version),
      },
    });
  };

  return (
    <div>
      <Select
        id={props.controlId}
        aria-describedby={props.describedBy}
        class="block w-full"
        value={value()}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        {/* `selected` per option: a set made in the dialog is chosen before its option arrives. */}
        <For each={options()}>
          {(opt) => (
            <option value={opt.value} selected={opt.value === value()}>
              {opt.label}
            </option>
          )}
        </For>
      </Select>
      <Show when={canManage}>
        <button
          type="button"
          class="mt-1 text-xs text-primary hover:underline disabled:opacity-50"
          data-testid="terms-setting-open"
          disabled={props.disabled}
          onClick={open}
        >
          {'' === value()
            ? __('Choose or write purchase terms')
            : __('View or edit purchase terms')}
        </button>
      </Show>
      <Show when={dialog()}>
        {(target) => <TermsDialogHost target={target()} onClose={() => setDialog(null)} />}
      </Show>
    </div>
  );
}
