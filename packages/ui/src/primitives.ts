/**
 * The primitive class vocabulary — one place where every atomic control's look is decided.
 *
 * The components in this package (`Button`, `Input`, `Pill`, …) are thin wrappers over these
 * builders. They are exported separately because a surface sometimes *cannot* take the component:
 * a native `<input>` owned by a third-party control (Kobalte slots, the grid's cell editors) still
 * needs the house look, and hand-copying the class string is exactly the drift this module exists
 * to stop. Reach for the component first; reach for the builder when the element isn't yours.
 *
 * Rules the whole vocabulary obeys:
 * - **Palette tokens, never raw slate/gray**, wherever a token exists (`bg-surface`, `text-text`,
 *   `border-border`, `bg-primary`). The tokens are declared in each app's stylesheet `@theme`
 *   block; a bare `gray-300` here would drift the moment a palette changes.
 * - **Every clickable affordance carries `cursor-pointer`**, and every disable-able one carries
 *   `disabled:cursor-not-allowed disabled:opacity-50`. The missing cursor was the visible symptom
 *   that motivated the suite.
 * - Class strings are **complete literals**, never assembled from fragments — the Tailwind v4
 *   source scanner reads this file (`@source "../../../ui/src"`) and only generates utilities it
 *   can see spelled out.
 */

/**
 * Does a caller's `extra` already decide the corner radius?
 *
 * **Tailwind resolves conflicting utilities by stylesheet order, not by the order they appear in
 * the class attribute.** So a builder that always emits `rounded` and lets callers "override" it
 * with `rounded-none` / `rounded-l` is not overriding anything — it is a coin flip decided by
 * where the two land in the generated sheet. It bit the split action button for real: `rounded`
 * is emitted first and `rounded-none` fifth, so `rounded-none` won and the button rendered with
 * square corners, while `rounded-l` (emitted eighth) won the other way and looked right. One bug,
 * visible in only one of the two states.
 *
 * The fix is to never emit the pair: when the caller names a radius, the base keeps quiet.
 */
const RADIUS_RE = /(?:^|\s)rounded(?:-\S+)?(?=\s|$)/;

/**
 * Does a caller's `extra` already decide the ink?
 *
 * The same trap as {@link RADIUS_RE}, and it drew blood the same way. `ICON_BUTTON_BASE` emits
 * `text-text-muted`; `Pill`'s dismiss `×` asks for `text-current` so it takes the chip's own
 * foreground, because a chip's background is a runtime colour and a fixed grey vanishes on half of
 * them. Two `color:` utilities, equal specificity, resolved by stylesheet order — and the grey won.
 * Measured on a live page: `#a0a5ae` on a `#ec185b` tag, **1.08:1**. The comment claiming the
 * override worked had been sitting above it since the affordance was written.
 *
 * A caller that names the ink owns its hover too, so both base declarations stand down together —
 * a base hover colour under a caller's own colour is the same coin flip one state later.
 *
 * Matched by exclusion rather than by listing colours: Tailwind gains colours constantly and gains
 * non-colour `text-*` utilities almost never, so the closed set is the one below. Variants count
 * (`hover:text-current` decides the ink as much as `text-current` does), and an arbitrary value is
 * read as a colour only when it looks like one — `text-[11px]` is a size.
 */
const TEXT_NOT_A_COLOR = new Set([
  'xs',
  '2xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
]);
const TEXT_UTILITY_RE = /(?:^|\s)(?:[\w[\]().-]+:)*text-(\S+)/g;

function namesInk(extra: string | undefined): boolean {
  if (undefined === extra) return false;
  for (const [, value] of extra.matchAll(TEXT_UTILITY_RE)) {
    if (value.startsWith('[')) {
      if (/^\[(?:#|rgb|hsl|oklch|lab|color-mix|var\()/.test(value)) return true;
      continue;
    }
    if (!TEXT_NOT_A_COLOR.has(value)) return true;
  }

  return false;
}

/**
 * Does a caller's `extra` already decide the hover background?
 *
 * The third face of the same trap as {@link RADIUS_RE} and {@link namesInk}, and the one with the
 * most call sites able to hit it: nearly every variant here ends in a `hover:bg-*`, so a caller
 * that wants a semantic hover — a lime "stage this", a red "give it back" — emits a second
 * `background-color` at equal specificity, and which one wins is decided by stylesheet order
 * rather than by the caller. Not a rule that can be worked around with `!` either, since that
 * would then beat `disabled:` too.
 *
 * `iconButtonClass`'s own `danger` flag was already doing this: the base emits
 * `hover:bg-surface-raised` and `danger` adds `hover:bg-red-50`, both, on every destructive glyph.
 *
 * So the base stands down when the caller speaks, exactly as it does for radius and ink. Matched
 * loosely on purpose — any variant prefix (`sm:hover:bg-…`, `group-hover:bg-…`) is still a caller
 * deciding a hover fill, and the safe reading of an ambiguous case is to let the caller win.
 */
const HOVER_BG_RE = /(?:^|\s)(?:[\w[\]().-]+:)*hover:bg-\S+/;

function namesHoverBg(extra: string | undefined): boolean {
  return undefined !== extra && HOVER_BG_RE.test(extra);
}

/** Strip a `hover:bg-*` out of a builder's own class string, for when the caller supplies one. */
function withoutHoverBg(classes: string): string {
  return classes
    .replace(/(?:^|\s)(?:[\w[\]().-]+:)*hover:bg-\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Join class fragments, dropping empties. Caller classes go last so they win on equal specificity. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ─────────────────────────────── Button ─────────────────────────────── */

export type ButtonVariant =
  'primary' | 'secondary' | 'danger' | 'warning' | 'success' | 'ghost' | 'quiet' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-medium cursor-pointer transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-text shadow-sm hover:bg-surface-raised',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  // amber-600, not the lighter amber-500: this is a *filled* button with white text, and
  // amber-500 behind white is far too low-contrast to read.
  warning: 'bg-amber-600 text-white hover:bg-amber-700',
  // A *confirming* affordance (receive, settle, complete) — distinct from `primary`, which is
  // merely the dominant action on the surface. Emerald is the house "this completed a workflow".
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  ghost: 'text-text hover:bg-surface-raised',
  // An inline text affordance in a dense meta row — "Edit", "Delete", a version stepper's ‹ ›,
  // a diff toggle beside a timestamp. Unlike `ghost` it is not a box: no padding, no hover fill,
  // just muted text that darkens. Those rows are laid out to the pixel, so a button's metrics
  // would visibly push them apart — which is why every one of them was hand-rolled instead.
  quiet: 'text-text-muted hover:text-text',
  // Reads as a link, behaves as a button — for in-prose affordances that must stay keyboard- and
  // screen-reader-honest (a real `<button>`, never an `<a href="#">`).
  link: 'text-primary underline hover:no-underline',
};

/**
 * How much ink a button spends. `solid` (default) is the filled form above; `outline` keeps the
 * tone's hue as border + text on the page background, with a tinted hover.
 *
 * It exists because the tinted tones each have a *quieter* form the surfaces were already
 * hand-rolling — a "Remove 3" in a list, a "Report an issue" beside a row, a soft "Receive" — and
 * with only a solid variant on offer those sites stayed raw `<button>`s rather than shout in
 * saturated red. The neutral tone already had both forms named outright (`secondary` = outlined,
 * `ghost` = neither), so `weight` only applies to the coloured tones; on `secondary`/`ghost`/`link`
 * it is a no-op rather than an error, since those names already encode a weight.
 */
export type ButtonWeight = 'solid' | 'outline';

const BUTTON_OUTLINE: Partial<Record<ButtonVariant, string>> = {
  primary: 'border border-primary/40 bg-surface text-primary hover:bg-primary/5',
  danger: 'border border-red-300 bg-surface text-red-700 hover:bg-red-50',
  warning: 'border border-amber-300 bg-surface text-amber-800 hover:bg-amber-50',
  success: 'border border-emerald-300 bg-surface text-emerald-700 hover:bg-emerald-50',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-1.5 text-sm',
};

/**
 * `link` and `quiet` take the text scale but **not** the box padding. They exist to sit inline — in
 * a sentence, a table cell, a meta row under a note — where button padding would push the
 * surrounding text apart and give away that they aren't really text. Every other variant is a box
 * and wants its padding.
 */
const LINK_SIZE: Record<ButtonSize, string> = {
  xs: 'text-xs',
  sm: 'text-xs',
  md: 'text-sm',
};

/**
 * Ring on plain `:focus`, not only `:focus-visible`. For controls the app focuses
 * **programmatically** — a dialog focusing its dismiss button on open, a form focusing Save.
 * `:focus-visible` deliberately does *not* match a scripted focus that followed a mouse click, so
 * without this the ring stays invisible in exactly the case where the user most needs to be told
 * where focus went. Opt-in, because on a click-focused button it would otherwise read as noise.
 */
const FOCUS_RING_EAGER = 'focus:ring-2 focus:ring-primary/40 focus:ring-offset-1';

/** Full class string for a button. `extra` is appended so callers add layout without losing the variant. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string,
  eagerFocusRing = false,
  weight: ButtonWeight = 'solid',
): string {
  const tone =
    ('outline' === weight ? BUTTON_OUTLINE[variant] : undefined) ?? BUTTON_VARIANT[variant];

  return cx(
    BUTTON_BASE,
    RADIUS_RE.test(extra ?? '') ? '' : 'rounded',
    namesHoverBg(extra) ? withoutHoverBg(tone) : tone,
    'link' === variant || 'quiet' === variant ? LINK_SIZE[size] : BUTTON_SIZE[size],
    eagerFocusRing ? FOCUS_RING_EAGER : '',
    extra,
  );
}

/* ───────────────────────────── IconButton ───────────────────────────── */

export type IconButtonSize = 'xs' | 'sm' | 'md';

const ICON_BUTTON_BASE =
  'inline-flex items-center justify-center cursor-pointer transition-colors ' +
  'hover:bg-surface-raised ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** The default ink, emitted only when the caller has not named one — see {@link namesInk}. */
const ICON_BUTTON_INK = 'text-text-muted hover:text-text';

const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  xs: 'h-5 w-5 p-0.5 text-xs',
  sm: 'h-6 w-6 p-1 text-sm',
  md: 'h-8 w-8 p-1.5 text-base',
};

/** Square icon-only button. `danger` recolours the hover for destructive glyphs (×, trash). */
export function iconButtonClass(
  size: IconButtonSize = 'sm',
  danger = false,
  extra?: string,
): string {
  // `danger` names a hover fill of its own, so it stands the base's down the same way a caller's
  // `extra` does — otherwise every destructive glyph ships two competing hover backgrounds.
  const base = danger || namesHoverBg(extra) ? withoutHoverBg(ICON_BUTTON_BASE) : ICON_BUTTON_BASE;

  return cx(
    base,
    namesInk(extra) ? '' : ICON_BUTTON_INK,
    RADIUS_RE.test(extra ?? '') ? '' : 'rounded',
    ICON_BUTTON_SIZE[size],
    danger && !namesHoverBg(extra)
      ? 'hover:bg-red-50 hover:text-red-600'
      : danger
        ? 'hover:text-red-600'
        : '',
    extra,
  );
}

/* ──────────────────────────────  Menu row  ──────────────────────────── */

/**
 * A full-width row in a menu, popover or list — a context-menu entry, a dropdown option, a
 * collapsible section header, a nav row.
 *
 * These are not {@link buttonClass} material: a Button is an inline box with centred content and
 * committed padding, whereas these span their container, align left, and often hold a label on one
 * side and a shortcut or chevron on the other. Forcing button metrics on them fights the layout,
 * which is exactly why each surface hand-rolled its own — and drifted: the same row was written
 * with `hover:bg-blue-50` in the grid's context menu, `hover:bg-gray-50` in the tag menu, and no
 * hover at all in the context card. They also, uniformly, forgot the cursor.
 *
 * So the row gets its own vocabulary rather than being bent into a Button. `active` marks the
 * keyboard-highlighted row (the two must look the same, or hover and arrow-key navigation
 * disagree about where you are).
 */
export function menuItemClass(active = false, disabled = false, extra?: string): string {
  return cx(
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
    disabled
      ? 'cursor-not-allowed text-text-muted opacity-60'
      : cx('cursor-pointer text-text hover:bg-surface-hover', active ? 'bg-surface-hover' : ''),
    extra,
  );
}

/* ────────────────────────── Fields (text-like) ──────────────────────── */

export type FieldSize = 'sm' | 'md';

// No background here: the resting and invalid fills are both emitted by `fieldTone()`, so exactly
// one `bg-*` utility ever lands on a field. Two of them (a base `bg-surface` plus an invalid
// `bg-red-50`) would be resolved by *stylesheet* order, not by the order they appear in `class` —
// which is how a tint silently loses to the base fill it was meant to override.
const FIELD_BASE =
  'rounded border text-text transition-colors ' +
  'placeholder:text-text-muted ' +
  'focus:outline-none focus-visible:ring-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-raised';

const FIELD_SIZE: Record<FieldSize, string> = {
  sm: 'h-8 px-2 text-sm',
  md: 'h-9 px-3 text-sm',
};

/** Textareas size by rows, not height — the height utilities in FIELD_SIZE would fight `rows`. */
const TEXTAREA_SIZE: Record<FieldSize, string> = {
  sm: 'px-2 py-1 text-sm',
  md: 'px-3 py-1.5 text-sm',
};

/**
 * Resting vs invalid field skin: border, fill and focus ring together.
 *
 * The invalid state tints the fill as well as the border, matching the error convention the toasts
 * and review modals already use. A border alone is easy to miss on a small control in a dense form —
 * and on a field the operator is *looking at*, the border is the part their cursor covers.
 *
 * Colour is never the only signal: {@link inputClass} is paired with `aria-invalid` by the field
 * components, and the caller still owns the message that says what is wrong.
 */
function fieldTone(invalid: boolean): string {
  return invalid
    ? 'border-red-400 bg-red-50 focus-visible:ring-red-400/40'
    : 'border-border bg-surface focus-visible:border-primary focus-visible:ring-primary/40';
}

/** `<input type="text|number|…">` and anything that should look like one. */
export function inputClass(size: FieldSize = 'sm', invalid = false, extra?: string): string {
  return cx(FIELD_BASE, fieldTone(invalid), FIELD_SIZE[size], extra);
}

/** `<select>` — same field look; `cursor-pointer` because it opens a menu on click. */
export function selectClass(size: FieldSize = 'sm', invalid = false, extra?: string): string {
  return cx(FIELD_BASE, fieldTone(invalid), FIELD_SIZE[size], 'cursor-pointer', extra);
}

/** `<textarea>` — field look minus the fixed height. */
export function textareaClass(size: FieldSize = 'sm', invalid = false, extra?: string): string {
  return cx(FIELD_BASE, fieldTone(invalid), TEXTAREA_SIZE[size], extra);
}

/** `<input type="checkbox|radio">` — a box, not a field; sized in `em`-ish fixed units. */
export function checkboxClass(extra?: string): string {
  return cx(
    'h-4 w-4 shrink-0 rounded border-border accent-primary cursor-pointer',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
    'disabled:cursor-not-allowed disabled:opacity-50',
    extra,
  );
}

/* ──────────────────────────────── Pill ──────────────────────────────── */

/**
 * Pill tones. `none` emits no colour classes at all — for a pill whose colour comes from a
 * runtime palette via `style` (the tag chips, whose colour is per-tag data, not a design choice).
 */
/**
 * `lime` is **pending a good change** — the thing is under way and going well, but has not landed:
 * an order line staged (the stock is picked and in the box) the way WooCommerce's own `processing`
 * status means it. `success` is the landing itself. Note what that makes lime NOT: it is not a
 * weaker `success`, and it is not `warning` either — nothing is wrong and nobody is being asked to
 * intervene, which is the distinction `warning` carries.
 *
 * The two greens are meant to be read together along one row as a progression, which is why they
 * sit at opposite ends of green rather than beside each other: lime is yellow-green (hue ~125),
 * `success` is emerald, blue-green (hue ~164). A hue between them would read as a rendering
 * inconsistency rather than as two states.
 */
export type PillTone =
  | 'neutral'
  | 'info'
  | 'lime'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent'
  | 'indigo'
  | 'violet'
  | 'none';
/** `soft` = tinted background (the house default), `outline` = tint + border, `solid` = full-weight. */
export type PillVariant = 'soft' | 'outline' | 'solid';
export type PillSize = 'xs' | 'sm';

const PILL_BASE = 'inline-flex items-center gap-1 font-medium leading-none whitespace-nowrap';

const PILL_SOFT: Record<PillTone, string> = {
  neutral: 'bg-gray-100 text-text-muted',
  info: 'bg-blue-100 text-blue-700',
  lime: 'bg-lime-100 text-lime-800',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
  accent: 'bg-primary/10 text-primary',
  indigo: 'bg-indigo-100 text-indigo-800',
  violet: 'bg-violet-100 text-violet-700',
  none: '',
};

const PILL_OUTLINE: Record<PillTone, string> = {
  neutral: 'border border-border bg-surface text-text-muted',
  info: 'border border-blue-200 bg-blue-50 text-blue-700',
  lime: 'border border-lime-200 bg-lime-50 text-lime-800',
  success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border border-red-200 bg-red-50 text-red-700',
  accent: 'border border-primary/30 bg-primary/5 text-primary',
  indigo: 'border border-indigo-200 bg-indigo-50 text-indigo-800',
  violet: 'border border-violet-200 bg-violet-50 text-violet-700',
  none: '',
};

const PILL_SOLID: Record<PillTone, string> = {
  neutral: 'bg-text-muted text-white',
  info: 'bg-blue-600 text-white',
  lime: 'bg-lime-600 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  danger: 'bg-red-600 text-white',
  accent: 'bg-primary text-white',
  indigo: 'bg-indigo-600 text-white',
  violet: 'bg-violet-600 text-white',
  none: '',
};

const PILL_VARIANT: Record<PillVariant, Record<PillTone, string>> = {
  soft: PILL_SOFT,
  outline: PILL_OUTLINE,
  solid: PILL_SOLID,
};

const PILL_SIZE: Record<PillSize, string> = {
  xs: 'px-1.5 py-0.5 text-2xs',
  sm: 'px-2 py-0.5 text-xs',
};

/** `full` = lozenge (tag chips, identity-ish labels); `rounded` = the subtle radius (counts, statuses). */
export type PillShape = 'rounded' | 'full';

const PILL_SHAPE: Record<PillShape, string> = {
  rounded: 'rounded',
  full: 'rounded-full',
};

export function pillClass(
  tone: PillTone = 'neutral',
  variant: PillVariant = 'soft',
  size: PillSize = 'sm',
  shape: PillShape = 'rounded',
  extra?: string,
): string {
  return cx(PILL_BASE, PILL_SHAPE[shape], PILL_SIZE[size], PILL_VARIANT[variant][tone], extra);
}

/* ─────────────────────────────── Spinner ────────────────────────────── */

export type SpinnerSize = 'xs' | 'sm' | 'md';

const SPINNER_SIZE: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3 border-2',
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-5 w-5 border-2',
};

/**
 * Borrows `currentColor` for the ring so a spinner inherits its context's colour (inside a primary
 * button it goes white, in muted text it goes muted) — no per-site colour prop.
 */
export function spinnerClass(size: SpinnerSize = 'sm', extra?: string): string {
  return cx(
    'inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent',
    SPINNER_SIZE[size],
    extra,
  );
}

/* ─────────────────────────────── Nav tabs ─────────────────────────────── */

/**
 * Which navigation row a tab belongs to — named for what the row *means*, not where it sits, so a
 * third row would be `"subsection"` rather than a `3`.
 *
 * The rows are **stacked on screen**, not alternatives: the shell's surface tabs run along the top
 * (Workbench · Procurement · Dispatch · open detail tabs), and a surface may render its own section
 * tabs directly beneath them (Purchase orders · Suppliers). Styling both identically would put two
 * rows of the same thing above each other and lose the hierarchy, so `section` is deliberately
 * quieter: smaller, tighter, and a fainter active fill.
 */
export type NavTabVariant = 'surface' | 'section';

interface VariantStyle {
  base: string;
  inactive: string;
  active: string;
  /** The active look with its fill withheld — see the `dirty` prop. */
  activeDirty: string;
}

/**
 * Each string is a **complete literal**, per the rule in `primitives.ts`: Tailwind v4's scanner
 * reads this file and generates only what it can see spelled out, so a class assembled from
 * fragments silently produces no CSS.
 *
 * **No tab carries a top offset of its own.** The gap that lets a filled tab clear whatever sits
 * above it is padding on the row container (`pt-1` on the shell's, `pt-2` on a surface's), which is
 * the only version that keeps every label on one baseline — an offset on the active tab alone drops
 * its text relative to its neighbours, and the row then reads as misaligned rather than as tabbed.
 *
 * **The active label is `text-blue-900`, not `text-primary`, and that is not a lapse back into
 * naming a colour.** `--color-primary` is one value in both themes on purpose — lifting it for the
 * dark ground breaks every `bg-primary` surface carrying hardcoded white text — so as ink it cannot
 * answer to two different grounds, and it was under AA on three of the four active looks: measured
 * 3.67:1 / 3.06:1 (light / dark) on the filled tab, and 4.81:1 / 3.73:1 unfilled. The label is
 * 14px at weight 500, so the floor is 4.5:1, not the 3:1 large-text one.
 *
 * The ramp slots *are* themed here — inverted, so `blue-900` is navy on white and a pale blue on
 * the dark ground — which is exactly the property that lets one literal serve both: 7.91:1 / 10.12:1
 * filled, 10.37:1 / 12.33:1 unfilled. A `dark:` variant would have been the other way to fix it and
 * is the one this stylesheet does not use anywhere.
 */
const VARIANTS: Record<NavTabVariant, VariantStyle> = {
  surface: {
    base: 'shrink-0 border-b-2 px-2 py-2.5 text-sm font-medium transition-colors',
    inactive: 'border-transparent text-slate-500 hover:text-slate-800',
    active: 'border-primary text-blue-900 uppercase bg-primary/20 rounded-t',
    activeDirty: 'border-primary text-blue-900 uppercase rounded-t',
  },
  section: {
    base: 'shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
    inactive: 'border-transparent text-slate-500 hover:text-slate-800',
    active: 'border-primary text-blue-900 uppercase bg-primary/5 rounded-t',
    activeDirty: 'border-primary text-blue-900 uppercase rounded-t',
  },
};

/**
 * The three class strings a router `<A>` needs for one tab. Exported alongside {@link NavTab} for
 * the same reason `primitives.ts` exports its builders: a row that cannot take the component — the
 * supplier detail's `classList` tabs, the grid's own — still needs the house look, and copying the
 * strings is the drift this exists to stop.
 */
export function navTabClasses(
  variant: NavTabVariant = 'surface',
  dirty = false,
): { class: string; inactiveClass: string; activeClass: string } {
  const style = VARIANTS[variant];

  return {
    class: style.base,
    inactiveClass: style.inactive,
    // Active *and* dirty resolves here, not in the stylesheet — see `NavTab`s `dirty` prop.
    activeClass: dirty ? style.activeDirty : style.active,
  };
}
