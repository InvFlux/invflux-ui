import { __, sprintf } from '@invflux/i18n';
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';

/**
 * The four "related rows" flags, as one value.
 *
 * Three are opt-INs and `bringParents` is an opt-OUT — `true` is its resting state, because the
 * parent is a matched variation's fold home. That asymmetry is the whole reason this control exists
 * as a group rather than four checkboxes: the flags only make sense read together, and read together
 * they are two questions ("what comes in", "what is then hidden") rather than four.
 */
export interface BringInState {
  /** Upward brought-with pass (server). Opt-OUT: on unless deliberately cleared. */
  bringParents: boolean;
  /** Downward brought-with pass (server). Opt-in. */
  bringChildren: boolean;
  /** Client-side: hide brought-in parents. Only reachable while parents are being brought in. */
  hideBroughtParents: boolean;
  /** Client-side: hide brought-in variations. Only reachable while variations are being brought in. */
  hideBroughtChildren: boolean;
}

export const BRING_IN_DEFAULTS: BringInState = {
  bringParents: true,
  bringChildren: false,
  hideBroughtParents: false,
  hideBroughtChildren: false,
};

/** Whether the state departs from rest — the single predicate deciding pill vs chip. */
export function bringInIsActive(s: BringInState): boolean {
  return (
    s.bringParents !== BRING_IN_DEFAULTS.bringParents ||
    s.bringChildren !== BRING_IN_DEFAULTS.bringChildren ||
    s.hideBroughtParents !== BRING_IN_DEFAULTS.hideBroughtParents ||
    s.hideBroughtChildren !== BRING_IN_DEFAULTS.hideBroughtChildren
  );
}

/**
 * A human summary of the state, for the chip face.
 *
 * "Bring-in: none" is the reading of an empty bring list, and it is the one phrasing that had to be
 * chosen rather than fallen into: with parents opted out and variations off, nothing is brought in
 * beyond what matched, and a chip that said "Bring-in:" followed by nothing would read as a bug.
 */
export function bringInSummary(s: BringInState): string {
  const parents = __('parents');
  const variations = __('variations');

  const brought: string[] = [];
  if (s.bringParents) brought.push(parents);
  if (s.bringChildren) brought.push(variations);

  const hidden: string[] = [];
  if (s.bringParents && s.hideBroughtParents) hidden.push(parents);
  if (s.bringChildren && s.hideBroughtChildren) hidden.push(variations);

  // The colon lives INSIDE the translated string, never in the template. French sets a space before
  // `:` (« Inclus : aucun »), and a hardcoded `${x}: ${y}` gives no translator anywhere to put it —
  // the string would be permanently mis-typeset in the shipped locale. Same reason the separator is
  // translated rather than a literal ", ".
  const list = (items: string[]): string => items.join(__(', '));
  // Annotated `string[]`: `sprintf` carries the format's literal type as a brand, so an inferred
  // array would take the FIRST format's brand and reject the second.
  const parts: string[] = [
    sprintf(__('Bring-in: %s'), brought.length > 0 ? list(brought) : __('none')),
  ];
  if (hidden.length > 0) parts.push(sprintf(__('Hide: %s'), list(hidden)));

  return parts.join(__(', '));
}

interface SegmentProps {
  label: string;
  on: boolean;
  disabled?: boolean;
  title?: string;
  first: boolean;
  onToggle: () => void;
}

/** One cell of a segmented multi-select: a toggle button, not a radio — several may be on. */
function Segment(props: SegmentProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      disabled={props.disabled}
      title={props.title}
      // `font-medium` unconditionally, NOT only when on: a weight that changes with state also
      // changes the segment's width, so toggling one cell shifted the whole group sideways and the
      // two rows stopped lining up. The violet fill already carries "on".
      class={`cursor-pointer whitespace-nowrap px-2.5 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45 ${
        props.first ? '' : 'border-l border-border'
      } ${props.on ? 'bg-violet-100 text-violet-700' : 'bg-surface text-text-muted hover:bg-muted'}`}
      onClick={() => props.onToggle()}
    >
      {props.label}
    </button>
  );
}

interface RowProps {
  legend: string;
  hint?: string;
  segments: SegmentProps[];
}

function SegmentedRow(props: RowProps): JSX.Element {
  return (
    <div class="flex items-center gap-4">
      {/* Fixed-width legend: the two legends differ in length, and left to themselves the segmented
          groups would start at different x and read as unrelated controls rather than a matrix. */}
      <span class="w-32 shrink-0 text-sm text-text" title={props.hint}>
        {props.legend}
      </span>
      <div
        role="group"
        aria-label={props.legend}
        class="ml-auto inline-flex shrink-0 overflow-hidden rounded border border-border"
      >
        <For each={props.segments}>{(s) => <Segment {...s} />}</For>
      </div>
    </div>
  );
}

export interface BringInControlProps {
  state: () => BringInState;
  /** Patch the host's query state. Receives only the changed keys. */
  onChange: (patch: Partial<BringInState>) => void;
}

/**
 * "Related rows" as one affordance: a dashed pill at rest, a chip once any flag departs from its
 * default, and a popover carrying two segmented multi-selects.
 *
 * It replaces four checkboxes that cost a row of horizontal space to say nothing most of the time —
 * the resting state is the common one, and a control should not spend width restating it. The chip
 * takes a violet hue to stay legibly distinct from the blue filter chips beside it: these flags do
 * not narrow the result set, they decide what CONTEXT joins it, and reading them as another filter
 * is the misunderstanding worth designing against.
 */
export function BringInControl(props: BringInControlProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  // Dismiss on an outside click or Escape. `composedPath()` rather than `event.target`: the SPA
  // mounts in a shadow root, which retargets `target` to the host before a document listener sees
  // it — so a plain `contains()` check would read every inside click as an outside one.
  onMount(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!open() || !rootRef) return;
      if (event.composedPath().includes(rootRef)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (open() && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    });
  });

  // Turning a pass off takes its "hide" with it: a hide flag whose pass is off is unreachable in the
  // UI, and leaving it set means the next re-enable silently hides rows the merchant never asked to
  // hide. The existing checkbox pair did this for variations; parents now get the same treatment.
  const setBringParents = (on: boolean): void =>
    props.onChange({ bringParents: on, ...(on ? {} : { hideBroughtParents: false }) });
  const setBringChildren = (on: boolean): void =>
    props.onChange({ bringChildren: on, ...(on ? {} : { hideBroughtChildren: false }) });

  const parentsLabel = (): string => __('Variable parents');
  const variationsLabel = (): string => __('Variations');

  return (
    <div ref={rootRef} class="relative">
      <Show
        when={bringInIsActive(props.state())}
        fallback={
          <button
            type="button"
            data-bring-in-add
            data-fb-cycle
            // Muted at rest like the neighbouring "Add filter" pill — the two are the same kind of
            // affordance — but it hovers to the family violet rather than the generic primary,
            // so the hue that marks variable/variation is what previews on the way in.
            class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-dashed border-border bg-surface px-3 py-5 text-sm text-text-muted hover:border-violet-500 hover:text-violet-500"
            aria-expanded={open()}
            onClick={() => setOpen(!open())}
          >
            ＋ {__('Bring in')}
          </button>
        }
      >
        {/* Only violet steps the theme remaps for dark (50/100/200/600/700). 300 and 900 are not
            remapped, so they keep their light values in dark mode — which put near-black text on a
            dark ground. Check theme.css before reaching for a step. */}
        <span class="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-sm text-violet-700 focus-within:ring-2 focus-within:ring-primary">
          <button
            type="button"
            data-bring-in-chip
            data-fb-cycle
            class="flex cursor-pointer flex-col items-start leading-tight focus:outline-none"
            aria-expanded={open()}
            onClick={() => setOpen(!open())}
          >
            <span class="text-2xs font-semibold uppercase tracking-wide opacity-70">
              {__('Bring in / hide')}
            </span>
            <span class="inline-flex items-center gap-1">
              <span>{bringInSummary(props.state())}</span>
              <span class="opacity-60">▾</span>
            </span>
          </button>
          <button
            type="button"
            tabindex={-1}
            class="-mr-1.5 flex cursor-pointer items-center self-stretch rounded px-2 text-base leading-none hover:bg-violet-200"
            aria-label={__('Reset related rows to their default')}
            onClick={() => {
              props.onChange({ ...BRING_IN_DEFAULTS });
              setOpen(false);
            }}
          >
            ×
          </button>
        </span>
      </Show>

      <Show when={open()}>
        <div class="absolute top-full z-40 mt-1 w-max rounded border border-border bg-surface p-3 shadow-xl">
          <div class="flex flex-col gap-3">
            <SegmentedRow
              legend={__('Bring in')}
              hint={__(
                'Load related rows as context, even when they do not match the current filters',
              )}
              segments={[
                {
                  label: parentsLabel(),
                  on: props.state().bringParents,
                  first: true,
                  title: __(
                    'The variable parent of a matched variation, as its fold home. On by default — without it a variation shows as a top-level row with no indication of the product it belongs to.',
                  ),
                  onToggle: () => setBringParents(!props.state().bringParents),
                },
                {
                  label: variationsLabel(),
                  on: props.state().bringChildren,
                  first: false,
                  title: __('Every variation of a matched parent, not only the ones that matched'),
                  onToggle: () => setBringChildren(!props.state().bringChildren),
                },
              ]}
            />
            <SegmentedRow
              legend={__('Hide brought-in')}
              hint={__('Keep the rows loaded, but hide the ones present only as context')}
              segments={[
                {
                  label: parentsLabel(),
                  on: props.state().hideBroughtParents,
                  first: true,
                  disabled: !props.state().bringParents,
                  title: props.state().bringParents
                    ? undefined
                    : __('Nothing to hide while parents are not brought in'),
                  onToggle: () =>
                    props.onChange({ hideBroughtParents: !props.state().hideBroughtParents }),
                },
                {
                  label: variationsLabel(),
                  on: props.state().hideBroughtChildren,
                  first: false,
                  disabled: !props.state().bringChildren,
                  title: props.state().bringChildren
                    ? undefined
                    : __('Nothing to hide while variations are not brought in'),
                  onToggle: () =>
                    props.onChange({ hideBroughtChildren: !props.state().hideBroughtChildren }),
                },
              ]}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}
