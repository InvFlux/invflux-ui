import { __ } from '@invflux/i18n';
import { Button, IconButton, toast } from '@invflux/ui';
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { StatusPill } from '../../components/StatusPill';
import { useProcurement } from '../../context';
import { createApi } from '../../lib/api';
import type { SupplierContact, SupplierContactsResponse } from './types';

const INPUT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
const FIELD = 'block text-sm text-slate-700';

/**
 * Contacts sub-panel for a supplier: the people you deal with (sales, logistics, accounting).
 * Any number may be flagged `po_recipient` — who a purchase order is addressed to. The flag is
 * recorded here and read by whoever addresses the order; InvFlux itself sends nothing today.
 * A departed contact is set inactive rather than deleted, so orders that named them stay readable.
 */
export function SupplierContacts(props: { supplierId: number }): JSX.Element {
  const api = createApi(useProcurement());
  // null = nothing open, 0 = adding a new contact, >0 = editing that contact.
  const [editingId, setEditingId] = createSignal<number | null>(null);

  const query = createQuery(() => ({
    queryKey: ['procurement', 'suppliers', props.supplierId, 'contacts'],
    queryFn: () =>
      api.get<SupplierContactsResponse>(`/procurement/suppliers/${props.supplierId}/contacts`),
  }));

  return (
    <div class="max-w-2xl">
      <div class="mb-3 flex items-center justify-between">
        <Button size="sm" onClick={() => setEditingId(0)}>
          {__('+ Add contact')}
        </Button>
      </div>

      <Show when={0 === editingId()}>
        <ContactForm supplierId={props.supplierId} onDone={() => setEditingId(null)} />
      </Show>

      <Show when={query.isPending}>
        <p class="text-sm text-slate-500">{__('Loading contacts…')}</p>
      </Show>
      {/* `?.contacts` like the list below, not a bare `.contacts`: the two read the same field off
          the same response and only one of them defended it. */}
      <Show when={query.data && 0 === (query.data.contacts?.length ?? 0) && 0 !== editingId()}>
        <p class="text-sm text-slate-500">
          {__('No contacts yet — add the people you order from.')}
        </p>
      </Show>

      <ul class="divide-y divide-slate-100">
        <For each={query.data?.contacts ?? []}>
          {(c) => (
            <Show
              when={editingId() === c.id}
              fallback={
                <ContactRow
                  contact={c}
                  supplierId={props.supplierId}
                  onEdit={() => setEditingId(c.id)}
                />
              }
            >
              <li class="py-2">
                <ContactForm
                  supplierId={props.supplierId}
                  contact={c}
                  onDone={() => setEditingId(null)}
                />
              </li>
            </Show>
          )}
        </For>
      </ul>
    </div>
  );
}

function ContactRow(props: {
  contact: SupplierContact;
  supplierId: number;
  onEdit: () => void;
}): JSX.Element {
  const api = createApi(useProcurement());
  const queryClient = useQueryClient();
  const c = (): SupplierContact => props.contact;
  const invalidate = (): void =>
    void queryClient.invalidateQueries({
      queryKey: ['procurement', 'suppliers', props.supplierId, 'contacts'],
    });

  const del = createMutation(() => ({
    mutationFn: () => api.del(`/procurement/suppliers/${props.supplierId}/contacts/${c().id}`),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  }));

  return (
    <li
      class="flex items-center gap-3 py-2 text-sm"
      classList={{ 'opacity-60': 'inactive' === c().status }}
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-slate-800">{c().name}</span>
          <Show when={c().role}>
            <span class="text-xs text-text-muted">{c().role}</span>
          </Show>
          <Show when={c().poRecipient}>
            <span class="rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium tracking-wide text-primary">
              {__('PO recipient')}
            </span>
          </Show>
          <Show when={'inactive' === c().status}>
            <StatusPill status={c().status} />
          </Show>
        </div>
        <div class="text-xs text-slate-500">
          {[c().email, c().phone].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={props.onEdit}>
        {__('Edit')}
      </Button>
      <IconButton
        size="xs"
        danger
        label={__('Remove contact')}
        title={__('Remove')}
        disabled={del.isPending}
        onClick={() => del.mutate()}
      >
        ✕
      </IconButton>
    </li>
  );
}

function ContactForm(props: {
  supplierId: number;
  contact?: SupplierContact;
  onDone: () => void;
}): JSX.Element {
  const api = createApi(useProcurement());
  const queryClient = useQueryClient();
  const existing = props.contact;

  const [name, setName] = createSignal(existing?.name ?? '');
  const [role, setRole] = createSignal(existing?.role ?? '');
  const [email, setEmail] = createSignal(existing?.email ?? '');
  const [phone, setPhone] = createSignal(existing?.phone ?? '');
  const [notes, setNotes] = createSignal(existing?.notes ?? '');
  const [poRecipient, setPoRecipient] = createSignal(existing?.poRecipient ?? false);
  const [status, setStatus] = createSignal(existing?.status ?? 'active');

  const mutation = createMutation(() => ({
    mutationFn: (body: Record<string, unknown>) =>
      undefined === existing
        ? api.post(`/procurement/suppliers/${props.supplierId}/contacts`, body)
        : api.patch(`/procurement/suppliers/${props.supplierId}/contacts/${existing.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['procurement', 'suppliers', props.supplierId, 'contacts'],
      });
      toast.success(__('Contact saved.'));
      props.onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  }));

  const submit = (e: Event): void => {
    e.preventDefault();
    if ('' === name().trim()) return;
    mutation.mutate({
      name: name().trim(),
      role: role().trim() || null,
      email: email().trim() || null,
      phone: phone().trim() || null,
      notes: notes().trim() || null,
      po_recipient: poRecipient(),
      status: status(),
    });
  };

  return (
    <form class="rounded border border-slate-200 bg-slate-50/60 p-3" onSubmit={submit}>
      <div class="grid grid-cols-2 gap-3">
        <label class={FIELD}>
          {__('Name')} <span class="text-red-600">*</span>
          <input
            class={INPUT}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            required
            autofocus
          />
        </label>
        <label class={FIELD}>
          {__('Role')}
          <input
            class={INPUT}
            value={role()}
            placeholder={__('Sales rep, Logistics…')}
            onInput={(e) => setRole(e.currentTarget.value)}
          />
        </label>
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
      </div>
      <label class={`${FIELD} mt-3`}>
        {__('Notes')}
        <textarea
          class={INPUT}
          rows="2"
          value={notes()}
          onInput={(e) => setNotes(e.currentTarget.value)}
        />
      </label>
      <div class="mt-3 flex items-center gap-4">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={poRecipient()}
            onChange={(e) => setPoRecipient(e.currentTarget.checked)}
          />
          {__('PO recipient')}
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-700">
          {__('Status')}
          <select
            class="rounded border border-slate-300 px-2 py-1 text-sm"
            value={status()}
            onChange={(e) => setStatus(e.currentTarget.value)}
          >
            <option value="active">{__('Active')}</option>
            <option value="inactive">{__('Inactive')}</option>
          </select>
        </label>
      </div>

      <div class="mt-3 flex gap-2">
        <Button type="submit" disabled={mutation.isPending || '' === name().trim()}>
          {mutation.isPending ? __('Saving…') : __('Save')}
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          {__('Cancel')}
        </Button>
      </div>
    </form>
  );
}
