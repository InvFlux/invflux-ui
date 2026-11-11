import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  Button,
  ErrorBanner,
  FieldError,
  focusFirstInvalid,
  IconButton,
  Input,
  ModalFooter,
  SearchSelect,
  Textarea,
  TrashIcon,
} from '@invflux/ui';
import { wireMethod } from '@invflux/ui/api';
import { __, _n, _x, sprintf } from '@invflux/i18n';
import type { WorkbenchWorksheet, WorksheetColumnDef, WorksheetColumnSource } from '../types';
import {
  afterRefused,
  afterSaved,
  canAddColumn,
  columnKindLabel,
  columnName,
  columnNameError,
  draftFrom,
  hasErrors,
  isUnchanged,
  MAX_COLUMNS,
  newColumn,
  newColumnNameError,
  PLAIN_TYPES,
  plainTypeLabel,
  saveRequests,
  valuesRemoved,
  worksheetNameError,
  type DraftColumn,
  type SaveRequest,
  type WorksheetDraft,
} from './worksheetDraft';

interface Ctx {
  apiRoot: string;
  nonce: string;
}

/** A request's outcome, keeping the server's refusal (its message and the field it names). */
async function send<T>(
  ctx: Ctx,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const wire = wireMethod(method);
  const res = await fetch(`${ctx.apiRoot.replace(/\/$/, '')}/invflux/v1${path}`, {
    method: wire.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-WP-Nonce': ctx.nonce,
      ...wire.headers,
    },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body: the status says enough */
  }
  if (!res.ok) {
    const error = (data ?? {}) as { error?: string; message?: string };
    return {
      ok: false,
      message: error.error ?? error.message ?? sprintf(__('Request failed (%d)'), res.status),
    };
  }
  return { ok: true, data: data as T };
}

/** A column's kind with where its values come from, when known: "Like Color (Custom field)". */
function withOrigin(kind: string, origin: string | null | undefined): string {
  return origin == null || origin === ''
    ? kind
    : sprintf(
        /* translators: 1: what a worksheet column holds, e.g. "Like Color"; 2: where those values come from, e.g. "Custom field". */
        _x('%1$s (%2$s)', 'a worksheet column kind, then where its values come from'),
        kind,
        origin,
      );
}

/**
 * Edit one worksheet: its name, its notes, and its own columns (Workbench columns shown after Qty
 * while the grid is filtered on it). Everything is staged and sent on Save
 * ({@link saveRequests}); Save is disabled only while nothing has changed.
 *
 * A column with unsaved edits in the grid cannot be removed: the edits would be sent to a column that
 * no longer exists, or dropped. Removing a saved column deletes the values it holds, so a Save that
 * does so says how many first.
 */
export function WorksheetEditPanel(props: {
  ctx: Ctx;
  worksheet: WorkbenchWorksheet;
  /** The Workbench columns a new column may be made like (the server lists only those this user can see). */
  sources: WorksheetColumnSource[];
  /** How many unsaved grid edits a column holds. */
  stagedEditCount: (columnId: string) => number;
  /** Something was saved: the list and the grid should read again. */
  onSaved: () => void;
  /** Back to the worksheet list. */
  onBack: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal<WorksheetDraft>(draftFrom(props.worksheet));
  const [attempted, setAttempted] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  let root: HTMLDivElement | undefined;

  // The add row: a name and what the column holds, both required once an Add has been tried.
  const [newName, setNewName] = createSignal('');
  const [newChoice, setNewChoice] = createSignal<string | null>(null);
  const [addAttempted, setAddAttempted] = createSignal(false);
  let addRow: HTMLDivElement | undefined;

  const choices = createMemo(() => [
    ...PLAIN_TYPES.map((t) => ({ value: `type:${t}`, label: plainTypeLabel(t) })),
    ...props.sources.map((s) => ({
      value: `like:${s.id}`,
      label: withOrigin(columnKindLabel({ type: null, like: s.id, likeLabel: s.label }), s.origin),
    })),
  ]);
  const sourceOf = (choice: string) => props.sources.find((s) => `like:${s.id}` === choice);
  const sourceLabel = (choice: string): string | null => sourceOf(choice)?.label ?? null;

  const update = (fn: (d: WorksheetDraft) => WorksheetDraft): void => {
    setDraft(fn);
    setNotice(null);
  };
  const updateColumn = (localId: string, fn: (c: DraftColumn) => DraftColumn): void =>
    update((d) => ({ ...d, columns: d.columns.map((c) => (c.localId === localId ? fn(c) : c)) }));

  const newNameError = (): string | null =>
    addAttempted()
      ? newColumnNameError(
          draft(),
          newName(),
          newChoice() ?? 'type:text',
          newChoice() === null ? null : sourceLabel(newChoice() as string),
        )
      : null;
  const newChoiceError = (): string | null =>
    addAttempted() && newChoice() === null ? __('Choose what the column holds.') : null;

  function addColumn(): void {
    setAddAttempted(true);
    if (newNameError() !== null || newChoiceError() !== null) {
      focusFirstInvalid(addRow);
      return;
    }
    const choice = newChoice() as string;
    update((d) => ({
      ...d,
      columns: [
        ...d.columns,
        newColumn(newName(), choice, sourceLabel(choice), sourceOf(choice)?.origin ?? null),
      ],
    }));
    setNewName('');
    setNewChoice(null);
    setAddAttempted(false);
  }

  function removeColumn(column: DraftColumn): void {
    const staged = column.columnId === null ? 0 : props.stagedEditCount(column.columnId);
    if (staged > 0) {
      setNotice(
        sprintf(
          /* translators: 1: the worksheet column's name; 2: how many unsaved edits the grid holds in it. */
          _n(
            '“%1$s” has %2$d unsaved edit in the grid. Save or discard it before removing the column.',
            '“%1$s” has %2$d unsaved edits in the grid. Save or discard them before removing the column.',
            staged,
          ),
          column.name,
          staged,
        ),
      );
      return;
    }
    if (column.key === null) {
      update((d) => ({ ...d, columns: d.columns.filter((c) => c.localId !== column.localId) }));
    } else {
      updateColumn(column.localId, (c) => ({ ...c, removed: true }));
    }
  }

  async function save(): Promise<void> {
    setAttempted(true);
    setError(null);
    if (hasErrors(draft())) {
      focusFirstInvalid(root);
      return;
    }
    const lost = valuesRemoved(draft());
    if (
      lost > 0 &&
      !window.confirm(
        sprintf(
          /* translators: %d = how many values the removed worksheet columns hold. */
          _n(
            'Saving deletes %d value held in the removed columns. This cannot be undone.',
            'Saving deletes %d values held in the removed columns. This cannot be undone.',
            lost,
          ),
          lost,
        ),
      )
    ) {
      return;
    }

    setBusy(true);
    let changed = false;
    let failed = false;
    for (const request of saveRequests(draft())) {
      const outcome = await sendRequest(request);
      if (outcome.ok) {
        changed = true;
        setDraft((d) => afterSaved(d, request, outcome.added));
      } else {
        failed = true;
        if (request.kind === 'worksheet') setError(outcome.message);
        else setDraft((d) => afterRefused(d, request, outcome.message));
      }
    }
    setBusy(false);
    if (changed) props.onSaved();
    if (!failed) props.onBack();
  }

  async function sendRequest(
    request: SaveRequest,
  ): Promise<{ ok: true; added?: WorksheetColumnDef } | { ok: false; message: string }> {
    const base = `/workbench/worksheets/${draft().id}`;
    switch (request.kind) {
      case 'worksheet':
        return send(props.ctx, base, 'PATCH', request.body);
      case 'remove':
        return send(props.ctx, `${base}/columns/${request.key}`, 'DELETE');
      case 'rename':
        return send(props.ctx, `${base}/columns/${request.key}`, 'PATCH', request.body);
      case 'add': {
        const res = await send<{ column: WorksheetColumnDef }>(
          props.ctx,
          `${base}/columns`,
          'POST',
          request.body,
        );
        return res.ok ? { ok: true, added: res.data.column } : res;
      }
    }
  }

  const shown = (message: string | null): string | null => (attempted() ? message : null);

  return (
    <>
      <div ref={root} class="flex-1 overflow-auto p-4" data-testid="worksheet-edit">
        <Show when={error()}>
          <ErrorBanner class="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm">
            {error()}
          </ErrorBanner>
        </Show>

        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-text">{__('Name')}</span>
            <Input
              size="md"
              value={draft().name}
              invalid={shown(worksheetNameError(draft())) !== null}
              disabled={busy()}
              onInput={(e) => {
                const value = e.currentTarget.value;
                update((d) => ({ ...d, name: value }));
              }}
              data-testid="worksheet-edit-name"
            />
            <FieldError message={shown(worksheetNameError(draft()))} />
          </label>

          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-text">{__('Notes')}</span>
            <Textarea
              lines={1}
              autoGrowMaxLines={8}
              value={draft().description}
              disabled={busy()}
              placeholder={__('What this worksheet is for, when it was taken…')}
              onInput={(e) => {
                const value = e.currentTarget.value;
                update((d) => ({ ...d, description: value }));
              }}
              data-testid="worksheet-edit-notes"
            />
          </label>

          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-medium text-text">{__('Columns')}</h3>
            <p class="text-xs text-text-muted">
              {__(
                'Columns of your own, one value per product, shown after Qty while the grid is filtered on this worksheet.',
              )}
            </p>
            <Show when={notice()}>
              <p
                class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                role="status"
              >
                {notice()}
              </p>
            </Show>
            <ul
              class="flex flex-col gap-1 rounded border border-border p-2"
              data-testid="worksheet-edit-columns"
            >
              <Show when={draft().columns.length > 0}>
                <li
                  class="mb-1 flex gap-2 text-xs font-medium text-text"
                  aria-hidden="true"
                  data-testid="worksheet-columns-header"
                >
                  <span class="w-60 shrink-0">{__('Column type')}</span>
                  <span class="min-w-0 flex-1">{__('Column name')}</span>
                </li>
              </Show>
              <For
                each={draft().columns}
                fallback={<li class="px-1 text-sm text-text-muted">{__('No columns yet.')}</li>}
              >
                {(column) => (
                  <li class="flex items-start gap-2" data-column-key={column.key ?? ''}>
                    <Show
                      when={!column.removed}
                      fallback={
                        <>
                          <span class="min-w-0 flex-1 pt-1 text-sm text-text-muted line-through">
                            {columnName(column)}
                          </span>
                          <span class="text-xs text-text-muted">
                            {column.values > 0
                              ? sprintf(
                                  /* translators: %d = how many products hold a value in the removed column. */
                                  _n(
                                    'Removed on save, with %d value',
                                    'Removed on save, with %d values',
                                    column.values,
                                  ),
                                  column.values,
                                )
                              : __('Removed on save')}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy()}
                            onClick={() =>
                              updateColumn(column.localId, (c) => ({ ...c, removed: false }))
                            }
                          >
                            {__('Keep')}
                          </Button>
                        </>
                      }
                    >
                      <span
                        class="w-60 shrink-0 truncate pt-1.5 text-sm text-text-muted"
                        title={withOrigin(columnKindLabel(column), column.likeOrigin)}
                        data-testid="worksheet-column-kind"
                      >
                        {columnKindLabel(column)}
                        <Show when={column.like !== null && column.likeOrigin}>
                          {(origin) => (
                            <span class="text-xs" data-testid="worksheet-column-origin">
                              {' '}
                              ({origin()})
                            </span>
                          )}
                        </Show>
                      </span>
                      <div class="min-w-0 flex-1">
                        <Input
                          size="sm"
                          class="w-full"
                          aria-label={__('Column name')}
                          value={column.name}
                          placeholder={column.like !== null ? (column.likeLabel ?? '') : undefined}
                          invalid={
                            (shown(columnNameError(draft(), column)) ?? column.serverError) !== null
                          }
                          disabled={busy()}
                          onInput={(e) => {
                            const value = e.currentTarget.value;
                            updateColumn(column.localId, (c) => ({
                              ...c,
                              name: value,
                              serverError: null,
                            }));
                          }}
                        />
                        <FieldError
                          message={shown(columnNameError(draft(), column)) ?? column.serverError}
                        />
                      </div>
                      <IconButton
                        label={__('Remove column')}
                        danger={true}
                        class="text-rose-500"
                        disabled={busy()}
                        onClick={() => removeColumn(column)}
                        data-testid="worksheet-remove-column"
                      >
                        <TrashIcon />
                      </IconButton>
                    </Show>
                  </li>
                )}
              </For>
            </ul>

            <Show
              when={canAddColumn(draft())}
              fallback={
                <p class="text-xs text-text-muted">
                  {sprintf(
                    /* translators: %d = how many columns a worksheet may have. */
                    __('A worksheet can have at most %d columns.'),
                    MAX_COLUMNS,
                  )}
                </p>
              }
            >
              {/* Inset like the list's rows (its border and padding), so the two fields line up with its columns. */}
              <div
                ref={addRow}
                class="flex items-start gap-2 border-x border-transparent px-2"
                data-testid="worksheet-add-column"
              >
                <div class="w-60 shrink-0">
                  <SearchSelect
                    options={choices()}
                    value={newChoice()}
                    onChange={setNewChoice}
                    placeholder={__('Holds…')}
                    ariaLabel={__('What the column holds')}
                    invalid={newChoiceError() !== null}
                    disabled={busy()}
                    fuzzy={true}
                  />
                  <FieldError message={newChoiceError()} />
                </div>
                <div class="min-w-0 flex-1">
                  <Input
                    size="md"
                    class="w-full"
                    placeholder={
                      (newChoice() === null ? null : sourceLabel(newChoice() as string)) ??
                      __('New column name')
                    }
                    aria-label={__('New column name')}
                    value={newName()}
                    invalid={newNameError() !== null}
                    disabled={busy()}
                    onInput={(e) => setNewName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addColumn();
                    }}
                    data-testid="worksheet-new-column-name"
                  />
                  <FieldError message={newNameError()} />
                </div>
                <Button
                  disabled={busy()}
                  onClick={addColumn}
                  data-testid="worksheet-add-column-button"
                >
                  {__('Add')}
                </Button>
              </div>
            </Show>
          </section>
        </div>
      </div>

      <ModalFooter>
        <Button variant="secondary" disabled={busy()} onClick={props.onBack}>
          {__('Back')}
        </Button>
        <Button
          disabled={busy() || isUnchanged(draft())}
          onClick={() => void save()}
          data-testid="worksheet-edit-save"
        >
          {__('Save')}
        </Button>
      </ModalFooter>
    </>
  );
}
