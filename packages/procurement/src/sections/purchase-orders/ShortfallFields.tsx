import { __, _n, _x, sprintf } from '@invflux/i18n';
import { FieldError, focusFirstInvalid, Select, Textarea } from '@invflux/ui';
import { createEffect, For, type JSX, on, Show } from 'solid-js';
import {
  partsPresent,
  type ShortfallPart,
  type ShortfallSplit,
  type ShortfallState,
  type ShortfallVocabulary,
} from './shortfall';

/**
 * The close-short prompt's body: one row per part of what is written off — not confirmed, not
 * delivered, arrived damaged — with its quantity from the counts, the causes that fit that part, and
 * who answers for it (the suggestion from the cause and the order's Incoterm until someone changes it).
 * A part spread over several lines can be told per line. Shared by the order page and the count, so the
 * same decision reads the same way wherever it is taken.
 */
export function ShortfallFields(props: {
  vocab: ShortfallVocabulary;
  split: ShortfallSplit;
  state: ShortfallState;
  /** A line's name for the per-line overrides. */
  lineLabel: (subjectId: number) => string;
}): JSX.Element {
  const present = (): Partial<Record<ShortfallPart, number>> => partsPresent(props.split);
  const partyLabel = (party: string): string =>
    props.vocab.parties.find((p) => p.party === party)?.label ?? party;
  const linesWith = (part: ShortfallPart): [number, number][] =>
    Object.entries(props.split)
      .map(([id, parts]): [number, number] => [Number(id), parts[part] ?? 0])
      .filter(([, qty]) => qty > 0);
  const unknownChosen = (): boolean =>
    Object.values(props.state.state.parts).some((c) => 'unknown' === c?.cause) ||
    Object.values(props.state.state.lines).some((l) =>
      Object.values(l).some((c) => 'unknown' === c?.cause),
    );
  // Nothing is marked before the first confirm; from then on each missing value shows on its own
  // field, and clears the moment it is filled.
  const tried = (): boolean => props.state.state.attempts > 0;
  const issues = () => props.state.issues(props.split);
  const causeMissing = (part: ShortfallPart): boolean => tried() && issues().causes.includes(part);
  const noteMissing = (): boolean => tried() && issues().note;
  let root: HTMLDivElement | undefined;
  // Each refused confirm takes the operator to the first field still missing.
  createEffect(
    on(
      () => props.state.state.attempts,
      (attempts) => {
        if (attempts > 0) focusFirstInvalid(root);
      },
      { defer: true },
    ),
  );

  return (
    <div ref={root} class="space-y-3 text-sm" data-testid="shortfall-fields">
      <For each={props.vocab.parts.filter((p) => (present()[p.part] ?? 0) > 0)}>
        {(p) => {
          const choice = () => props.state.state.parts[p.part];
          const suggested = (): string | null => {
            const cause = choice()?.cause;
            const entry = p.causes.find((c) => c.cause === cause);
            return undefined === entry ? null : entry.party;
          };
          return (
            <div
              class="rounded border border-border px-3 py-2"
              data-testid={`shortfall-part-${p.part}`}
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-medium">{p.label}</span>
                <span class="tabular-nums text-text-muted">
                  {sprintf(
                    /* translators: %d is a number of units written off in this part. */
                    _n('%d unit', '%d units', present()[p.part] ?? 0),
                    present()[p.part] ?? 0,
                  )}
                </span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <label class="block">
                  <span class="mb-1 block text-xs text-text-muted">
                    {_x('Why', 'shortfall: the cause of a part not arriving')}
                  </span>
                  <Select
                    class="w-full"
                    invalid={causeMissing(p.part)}
                    value={choice()?.cause ?? ''}
                    onChange={(e) =>
                      props.state.setPart(p.part, {
                        cause: e.currentTarget.value,
                        party: choice()?.party ?? null,
                      })
                    }
                    data-testid={`shortfall-cause-${p.part}`}
                  >
                    <option value="" disabled>
                      {__('Choose…')}
                    </option>
                    <For each={p.causes}>{(c) => <option value={c.cause}>{c.label}</option>}</For>
                  </Select>
                  <FieldError
                    message={causeMissing(p.part) && __('Choose why these units did not arrive.')}
                    testId={`shortfall-cause-${p.part}-error`}
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-xs text-text-muted">
                    {_x('Who answers for it', 'shortfall: the party responsible for a part')}
                  </span>
                  <Select
                    class="w-full"
                    value={choice()?.party ?? ''}
                    disabled={undefined === choice()}
                    onChange={(e) =>
                      props.state.setPart(p.part, {
                        cause: choice()?.cause ?? '',
                        party: '' === e.currentTarget.value ? null : e.currentTarget.value,
                      })
                    }
                  >
                    <option value="">
                      {null === suggested()
                        ? '—'
                        : sprintf(
                            /* translators: %s is the suggested party, e.g. "Supplier" or "Carrier". */
                            _x(
                              'Suggested: %s',
                              'shortfall: the party suggested from the cause and the Incoterm',
                            ),
                            partyLabel(suggested() ?? ''),
                          )}
                    </option>
                    <For each={props.vocab.parties}>
                      {(party) => <option value={party.party}>{party.label}</option>}
                    </For>
                  </Select>
                  <Show when={undefined === choice()}>
                    <span class="mt-1 block text-xs text-text-muted">
                      {__('Suggested once a cause is chosen')}
                    </span>
                  </Show>
                </label>
              </div>
              <Show when={linesWith(p.part).length > 1}>
                <details class="mt-2">
                  <summary class="cursor-pointer text-xs text-text-muted">
                    {__('A different cause for some lines…')}
                  </summary>
                  <div class="mt-2 space-y-1">
                    <For each={linesWith(p.part)}>
                      {([subjectId, qty]) => (
                        <label class="grid grid-cols-[1fr_auto_12rem] items-center gap-2">
                          <span class="truncate">{props.lineLabel(subjectId)}</span>
                          <span class="tabular-nums text-text-muted">{qty}</span>
                          <Select
                            value={props.state.state.lines[subjectId]?.[p.part]?.cause ?? ''}
                            onChange={(e) =>
                              props.state.setLine(
                                subjectId,
                                p.part,
                                '' === e.currentTarget.value
                                  ? undefined
                                  : { cause: e.currentTarget.value, party: null },
                              )
                            }
                          >
                            <option value="">{__('Same as above')}</option>
                            <For each={p.causes}>
                              {(c) => <option value={c.cause}>{c.label}</option>}
                            </For>
                          </Select>
                        </label>
                      )}
                    </For>
                  </div>
                </details>
              </Show>
            </div>
          );
        }}
      </For>
      <label class="block">
        <span class="mb-1 block font-medium">
          {unknownChosen() ? __('Note (required: say what is known)') : __('Note (optional)')}
        </span>
        <Textarea
          rows="2"
          class="w-full"
          invalid={noteMissing()}
          value={props.state.state.note}
          onInput={(e) => props.state.setNote(e.currentTarget.value)}
          data-testid="shortfall-note"
        />
        <FieldError
          message={noteMissing() && __('Say what is known so far.')}
          testId="shortfall-note-error"
        />
      </label>
    </div>
  );
}
