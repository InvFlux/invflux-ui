import { __, _n, sprintf } from '@invflux/i18n';
import {
  Button,
  ErrorBanner,
  Input,
  Modal,
  ModalFooter,
  ModalHeader,
  ModalPanel,
  SegmentedControl,
  type SegmentedControlOption,
} from '@invflux/ui';
import { createEffect, createSignal, For, type JSX, onCleanup, Show, untrack } from 'solid-js';
import type { OrderAddress } from '../types';
import type { OrderAddressFields, OrderAddressTarget } from '../api';

/**
 * Which of the order's addresses this correction writes to.
 *
 * `both` is the ordinary case rather than the exotic one: most orders are billed and shipped to the
 * same place, and fixing a street number there should not be two pieces of work.
 */
export type AddressEditScope = OrderAddressTarget | 'both';

/** The stated fields, in the order a person reads an address. */
const FIELDS: { key: keyof OrderAddressFields; label: () => string; wide?: boolean }[] = [
  { key: 'first_name', label: () => __('First name') },
  { key: 'last_name', label: () => __('Last name') },
  { key: 'company', label: () => __('Company'), wide: true },
  { key: 'address_1', label: () => __('Address'), wide: true },
  { key: 'address_2', label: () => __('Address line 2'), wide: true },
  { key: 'postcode', label: () => __('Postcode') },
  { key: 'city', label: () => __('City') },
  { key: 'state', label: () => __('State / region') },
  { key: 'country', label: () => __('Country code') },
];

/**
 * Correct one or both of an order's stated addresses.
 *
 * Prefilled and **whole**, not a diff: an operator fixing a street number needs the rest on screen
 * to be sure they are fixing the right address. Only changed fields are sent, so a field the
 * merchant never touched is not rewritten with a value the form happened to render.
 *
 * Who receives the edit is a control in the footer rather than a property of which link was
 * clicked. That is what lets an operator change their mind here instead of cancelling and coming
 * back through a different door — and it is why the form needs no banner explaining an effect it
 * did not ask for.
 *
 * **The offered scopes always include the address the form was opened from**, which is the
 * invariant that keeps the fields honest: an operator may only target an address whose current
 * value is in front of them. Retargeting can widen the write to both, or narrow it back, but it can
 * never point the form at values it is not showing — so nothing is ever re-prefilled underneath a
 * half-typed correction.
 *
 * The write lands in WooCommerce, which owns the order document — so this says "save to
 * WooCommerce" rather than implying InvFlux keeps its own copy.
 */
export function AddressEditModal(props: {
  /** The block whose Edit was clicked. Always among the offered scopes. */
  openedFrom: OrderAddressTarget;
  /**
   * The two addresses currently state the same thing, so one block was rendered for both.
   *
   * Both addresses' values are therefore on screen, which is what makes it legitimate to offer
   * either of them alone — picking one is how an order gets a billing address of its own.
   */
  merged: boolean;
  address: OrderAddress | null;
  onSave: (fields: OrderAddressFields, targets: OrderAddressTarget[]) => Promise<unknown>;
  onClose: () => void;
}): JSX.Element {
  const initial = (): Record<string, string> => ({
    first_name: props.address?.firstName ?? '',
    last_name: props.address?.lastName ?? '',
    company: props.address?.company ?? '',
    address_1: props.address?.line1 ?? '',
    address_2: props.address?.line2 ?? '',
    postcode: props.address?.postcode ?? '',
    city: props.address?.city ?? '',
    state: props.address?.state ?? '',
    country: props.address?.country ?? '',
  });

  const before = initial();
  const [values, setValues] = createSignal<Record<string, string>>({ ...before });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Both by default when the two agree — the common order, and the answer that keeps them agreeing.
  // Read once, deliberately: the form is mounted fresh per open, and its scope is the operator's
  // from the first render on. An order refetched underneath must not move a control they have set.
  const [scope, setScope] = createSignal<AddressEditScope>(
    untrack(() => (props.merged ? 'both' : props.openedFrom)),
  );

  const other = (): OrderAddressTarget => ('billing' === props.openedFrom ? 'shipping' : 'billing');

  const scopeOptions = (): SegmentedControlOption<AddressEditScope>[] => {
    const one: SegmentedControlOption<AddressEditScope> = {
      value: props.openedFrom,
      label: 'billing' === props.openedFrom ? __('Bill to') : __('Ship to'),
    };
    const both: SegmentedControlOption<AddressEditScope> = {
      value: 'both',
      label: __('Both addresses'),
    };

    // Only the merged block can offer the other address alone: it is the only case where that
    // address's current value is the one already in the fields.
    return props.merged
      ? [
          { value: 'shipping', label: __('Ship to') },
          { value: 'billing', label: __('Bill to') },
          both,
        ]
      : [one, both];
  };

  const targets = (): OrderAddressTarget[] =>
    'both' === scope() ? ['shipping', 'billing'] : [scope() as OrderAddressTarget];

  const title = (): string => {
    if ('both' === scope()) return __('Edit both addresses');

    return 'billing' === scope() ? __('Edit billing address') : __('Edit shipping address');
  };

  /**
   * The scope reaches an address whose current value is not the one in the fields.
   *
   * Only "both" from a differing pair can do that: every other combination targets addresses the
   * form is already showing. It is the hinge for three separate decisions below — the warning, what
   * counts as a change, and how much of the form is sent — because all three are asking the same
   * question in different words.
   */
  const conformsOther = (): boolean => !props.merged && 'both' === scope();

  /** The one thing the operator cannot see the consequence of. */
  const replacesUnseen = (): string =>
    !conformsOther()
      ? ''
      : 'billing' === other()
        ? __('The billing address currently differs, and saving replaces it with this one.')
        : __('The shipping address currently differs, and saving replaces it with this one.');

  /** Only what moved. Sending the whole form would rewrite fields nobody edited. */
  const changed = (): OrderAddressFields => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(values())) {
      if (value.trim() !== (before[key] ?? '').trim()) out[key] = value.trim();
    }

    return out as OrderAddressFields;
  };

  const changedCount = (): number => Object.keys(changed()).length;

  /**
   * What to send — and it is not always the diff.
   *
   * The diff is relative to the address the form was opened from, so it says nothing about the
   * other one. Conforming a differing address to this one means every field, or the fields the
   * operator did not touch would keep whatever that address said and the two would still disagree.
   *
   * Everywhere else the diff is right, and for a reason worth keeping: the form holds a snapshot,
   * so posting all nine fields would silently overwrite a field someone else corrected while this
   * dialog was open.
   */
  const payload = (): OrderAddressFields => {
    if (!conformsOther()) return changed();
    const whole: Record<string, string> = {};
    for (const [key, value] of Object.entries(values())) whole[key] = value.trim();

    return whole as OrderAddressFields;
  };

  /**
   * Widening the scope is itself an edit.
   *
   * Reaching an address that does not already say this is a change to that address, whether or not
   * a single field was typed into — so the Save button must be live, and "No changes yet" is a lie.
   */
  const dirty = (): boolean => changedCount() > 0 || conformsOther();

  /**
   * Guards itself rather than trusting the button's disabled state.
   *
   * Three routes reach it and only one is the button: Enter from a field, Ctrl/Cmd+Enter from
   * anywhere in the form, and Ctrl/Cmd+S from the document. None of them consults whether the
   * button would have been clickable, so a second submit is a keystroke away without this line.
   */
  const save = async (): Promise<void> => {
    if (!dirty() || busy()) return;
    setBusy(true);
    setError(null);
    try {
      // The caller reports the outcome, because only it knows how many addresses were named.
      await props.onSave(payload(), targets());
      props.onClose();
    } catch (e: unknown) {
      // Kept open with the draft intact: the operator has just retyped an address, and closing
      // the form on a failure would make them do it twice.
      setError(e instanceof Error ? e.message : __('The address could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  // Ctrl/Cmd+S, from the document because the browser claims that chord at document level — the
  // form would never see it. Capture phase for the same reason. Ctrl/Cmd+Enter is handled on the
  // form instead: focus is trapped inside the dialog, so there is nowhere else for it to land, and
  // one listener per chord keeps a keystroke from reaching `save()` twice.
  createEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== 's' && event.key !== 'S') return;
      event.preventDefault();
      event.stopPropagation();
      void save();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  return (
    <Modal onClose={props.onClose} label={title()}>
      <ModalPanel size="xl">
        <ModalHeader
          title={title()}
          subtitle={__('Saved to WooCommerce, which prints the labels and sends the emails.')}
        />
        {/*
          A real form, so Enter saves the way Enter saves everywhere: implicit submission is the
          browser's, and a dialog built from a `div` forfeits it and then has to reimplement it badly.
          It also puts the guard in the right place — implicit submission is defined to do nothing
          when the default button is disabled, so Enter with nothing changed is already a no-op.

          `autocomplete="off"` because this form edits *someone else's* address. A form is exactly
          what browser and password-manager address autofill key off, so offering it here would let a
          support agent's own home address land in a customer's order with one keystroke.
        */}
        <form
          autocomplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            // The house chord (CorrectionReviewModal, BulkEditModal, AnnotationsPanel). A modifier
            // suppresses implicit submission, so this is not the same keystroke reaching onSubmit.
            if ((e.ctrlKey || e.metaKey) && 'Enter' === e.key) {
              e.preventDefault();
              void save();
            }
          }}
        >
          <div class="p-4">
            <Show when={error()}>
              <ErrorBanner class="mb-3">{error()!}</ErrorBanner>
            </Show>

            <div class="grid grid-cols-2 gap-3">
              <For each={FIELDS}>
                {(field) => (
                  <label
                    class={`flex flex-col gap-1 text-xs ${true === field.wide ? 'col-span-2' : ''}`}
                  >
                    <span class="text-text-muted">{field.label()}</span>
                    <Input
                      value={values()[field.key] ?? ''}
                      onInput={(e) =>
                        setValues((prev) => ({ ...prev, [field.key]: e.currentTarget.value }))
                      }
                    />
                  </label>
                )}
              </For>
            </div>

            {/* Appears only for the one choice whose effect is off-screen — see `replacesUnseen`. */}
            <Show when={replacesUnseen()}>
              <p class="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                {replacesUnseen()}
              </p>
            </Show>
          </div>
          <ModalFooter layout="between">
            <div class="flex items-center gap-3">
              {/* The scope sits with the action it scopes. It can only widen or narrow the write —
                  never re-point the form at values it is not showing — so meeting it after typing
                  costs the operator nothing. */}
              <SegmentedControl<AddressEditScope>
                ariaLabel={__('Which addresses to correct')}
                size="sm"
                options={scopeOptions()}
                value={scope()}
                onChange={setScope}
                disabled={busy()}
              />
              {/* Counts typed fields only. A save that carries no field edit is still a real change
                  — the scope reaches an address that does not say this yet — but "0 fields changed"
                  would describe it as nothing happening, and the warning above already names it. */}
              <span class="text-xs text-text-muted">
                <Show when={dirty()} fallback={__('No changes yet')}>
                  <Show when={changedCount() > 0}>
                    {sprintf(
                      /* translators: %d: how many address fields the operator has changed */
                      _n('%d field changed', '%d fields changed', changedCount()),
                      changedCount(),
                    )}
                  </Show>
                </Show>
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="quiet" size="sm" onClick={props.onClose} disabled={busy()}>
                {__('Cancel')}
              </Button>
              {/* The form's default button, so Enter reaches `save()` through submission rather than
                  a key handler — and so a disabled Save disables Enter with it. */}
              <Button type="submit" size="sm" disabled={!dirty() || busy()}>
                {busy() ? __('Saving…') : __('Save address')}
              </Button>
            </div>
          </ModalFooter>
        </form>
      </ModalPanel>
    </Modal>
  );
}
