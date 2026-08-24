import { createMemo, type JSX, Show } from 'solid-js';
import * as Combobox from '@kobalte/core/combobox';
import { bestMatch, DEFAULT_MATCH_THRESHOLD, scoreColor } from './fuzzy-match';
import { usePortalRootOptional } from './portal';
import { iconButtonClass } from './primitives';

/** One selectable candidate. Provide `targets` to score against `query`, or a precomputed `score`. */
export interface MatchOption {
  value: string;
  label: string;
  /** Strings this option matches from (its own label + synonyms/aliases). Scored via {@link bestMatch}. */
  targets?: string[];
  /** Precomputed match score in [0, 1] — use instead of `targets` when the host already scored it. */
  score?: number;
  disabled?: boolean;
}

export interface MatchSelectProps {
  /** The context string the options are ranked against (e.g. a spreadsheet header). */
  query: string;
  options: MatchOption[];
  /** Selected value, or null when nothing is chosen (the "ignore" state — clearable via ✕). */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Score floor separating the "matched" group from the alpha-sorted "other" tail. */
  threshold?: number;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Show the faded right-aligned score per row (colour dot always shows). Default true. */
  showScore?: boolean;
  /** Tooltip on the per-row score (e.g. "Match confidence"). Host-supplied so the component stays i18n-agnostic. */
  scoreTitle?: string;
  /** Heading over the matched group (shown only when there's also an "other" group). */
  matchedLabel?: string;
  /** Heading over the below-threshold group. */
  otherLabel?: string;
  /** Extra classes on the control box. */
  class?: string;
  /** Portal target for the listbox (shadow-DOM SPAs pass the light-DOM portalRoot). */
  mount?: HTMLElement;
}

interface ScoredOption extends MatchOption {
  _score: number;
}

interface OptionGroup {
  label: string;
  options: ScoredOption[];
}

const CONTROL =
  'flex h-9 w-full items-center gap-1 rounded border border-border bg-surface px-2 text-sm shadow-sm ' +
  'focus-within:ring-2 focus-within:ring-primary/40 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

const ITEM =
  'group flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm text-text ' +
  'data-[highlighted]:bg-primary data-[highlighted]:text-white ' +
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60';

const pct = (score: number): string => `${Math.round(score * 100)}%`;

/**
 * A confidence-ranked single-select built on `@kobalte/core/combobox`: scores each option against a
 * context `query` (via its {@link MatchOption.targets} aliases, using the symmetric fuzzy scorer), then
 * renders them best-first — a **matched** group above a separator, a **poor/no-match** alpha-sorted tail
 * below — each row carrying a confidence colour dot (+ optional faded score), and the whole control
 * tinted by the selected option's confidence.
 *
 * Reusable wherever the shape is "rank candidates by how well they mean this string, let the operator
 * confirm": import column→field mapping, product/subject resolution, supplier disambiguation. Wrap this,
 * never reach for `@kobalte/core` directly (arch-ui-principles §4.2).
 */
export function MatchSelect(props: MatchSelectProps): JSX.Element {
  const ctxMount = usePortalRootOptional();
  const threshold = (): number => props.threshold ?? DEFAULT_MATCH_THRESHOLD;

  const scoreOf = (o: MatchOption): number => (undefined !== o.score ? o.score : o.targets ? bestMatch(props.query, o.targets).score : 0);

  const model = createMemo<{ groups: OptionGroup[]; flat: ScoredOption[] }>(() => {
    const scored: ScoredOption[] = props.options.map((o) => ({ ...o, _score: scoreOf(o) }));
    const above = scored.filter((o) => o._score >= threshold()).sort((a, b) => b._score - a._score || a.label.localeCompare(b.label));
    const below = scored.filter((o) => o._score < threshold()).sort((a, b) => a.label.localeCompare(b.label));
    const both = above.length > 0 && below.length > 0;
    const groups: OptionGroup[] = [];
    if (above.length > 0) groups.push({ label: both ? (props.matchedLabel ?? '') : '', options: above });
    if (below.length > 0) groups.push({ label: both ? (props.otherLabel ?? '') : '', options: below });
    return { groups, flat: [...above, ...below] };
  });

  const selected = (): ScoredOption | null => (null === props.value ? null : (model().flat.find((o) => o.value === props.value) ?? null));
  const controlStyle = (): { 'background-color': string } | undefined => {
    const s = selected();
    return null === s ? undefined : { 'background-color': scoreColor(s._score) };
  };

  return (
    <Combobox.Root<ScoredOption, OptionGroup>
      options={model().groups}
      optionGroupChildren="options"
      value={selected()}
      onChange={(opt) => props.onChange(opt ? opt.value : null)}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled="disabled"
      placeholder={props.placeholder}
      disabled={props.disabled}
      // "input" (not "focus"): the trigger ▾ toggles cleanly and typing opens+filters, but focus alone
      // doesn't auto-open — which is what made a ▾ click open-then-close (focus opened, trigger re-closed).
      triggerMode="input"
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class={ITEM}>
          <span class="flex min-w-0 items-center gap-2">
            <span class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ 'background-color': scoreColor(itemProps.item.rawValue._score) }} />
            <Combobox.ItemLabel class="truncate">{itemProps.item.rawValue.label}</Combobox.ItemLabel>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <Show when={false !== props.showScore}>
              <span class="text-xs tabular-nums text-text-muted group-data-[highlighted]:text-white/80" title={props.scoreTitle}>
                {pct(itemProps.item.rawValue._score)}
              </span>
            </Show>
            <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
          </span>
        </Combobox.Item>
      )}
      sectionComponent={(sectionProps) => (
        <Show
          when={'' !== sectionProps.section.rawValue.label}
          fallback={<Combobox.Section class="my-1 border-t border-border" />}
        >
          <Combobox.Section class="px-3 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {sectionProps.section.rawValue.label}
          </Combobox.Section>
        </Show>
      )}
    >
      <Combobox.Control aria-label={props.ariaLabel} class={`${CONTROL} ${props.class ?? ''}`} style={controlStyle()}>
        <Combobox.Input aria-label={props.ariaLabel} class="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-text-muted focus:ring-0" />
        <Show when={null !== props.value}>
          <button
            type="button"
            aria-label={props.placeholder ?? 'Clear'}
            class={iconButtonClass('xs', false, 'w-auto shrink-0 px-0.5')}
            // Clear = the "ignore" state; keep the click from toggling the listbox open.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => props.onChange(null)}
          >
            ✕
          </button>
        </Show>
        <Combobox.Trigger aria-label={props.ariaLabel} class="shrink-0 text-text-muted">
          <Combobox.Icon>▾</Combobox.Icon>
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal mount={props.mount ?? ctxMount}>
        <Combobox.Content class="z-popover min-w-[var(--kb-popper-anchor-width)] rounded border border-border bg-surface py-1 text-sm shadow-xl">
          <Combobox.Listbox class="max-h-[240px] overflow-y-auto focus:outline-none" />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
