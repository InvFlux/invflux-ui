import { describe, expect, it } from 'vitest';
import {
  buttonClass,
  checkboxClass,
  cx,
  iconButtonClass,
  inputClass,
  menuItemClass,
  pillClass,
  selectClass,
  spinnerClass,
  textareaClass,
  type ButtonSize,
  type ButtonVariant,
  type PillTone,
  type PillVariant,
} from './primitives';

const BUTTON_VARIANTS: ButtonVariant[] = [
  'primary',
  'secondary',
  'danger',
  'warning',
  'success',
  'ghost',
  'quiet',
  'link',
];
/** The two that sit inline in text rather than being a box. */
const INLINE_VARIANTS: ButtonVariant[] = ['link', 'quiet'];
const BUTTON_SIZES: ButtonSize[] = ['xs', 'sm', 'md'];
const PILL_TONES: PillTone[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
  'accent',
  'indigo',
  'violet',
  'none',
];
const PILL_VARIANTS: PillVariant[] = ['soft', 'outline', 'solid'];

describe('cx', () => {
  it('drops empty fragments and keeps caller order', () => {
    expect(cx('a', '', null, undefined, false, 'b')).toBe('a b');
  });
});

describe('buttonClass', () => {
  it('defaults to primary/md', () => {
    expect(buttonClass()).toBe(buttonClass('primary', 'md'));
  });

  // Two `hover:bg-*` on one element are equal specificity, so the winner is decided by stylesheet
  // order — meaning a caller's semantic hover may silently lose, and lose only in one theme or one
  // build. Nothing about the rendered markup shows it, which is why this is asserted rather than
  // eyeballed: the failure looks like "the colour I asked for didn't apply, sometimes".
  it('drops its own hover fill when the caller names one, and keeps it otherwise', () => {
    for (const variant of BUTTON_VARIANTS) {
      const own = buttonClass(variant, 'sm');
      const overridden = buttonClass(variant, 'sm', 'hover:bg-lime-50');
      expect(overridden, variant).toContain('hover:bg-lime-50');
      expect(
        (overridden.match(/(?:^|\s)(?:[\w[\]().-]+:)*hover:bg-\S+/g) ?? []).length,
        `${variant} emits exactly one hover fill`,
      ).toBe(1);
      // The rest of the variant survives — this suppresses one utility, not the tone.
      if (own.includes('border')) expect(overridden, variant).toContain('border');
    }
    expect(buttonClass('secondary', 'sm')).toContain('hover:bg-surface-raised');
  });

  // The same defect already shipped here: the base hover and `danger`'s hover were both emitted.
  it('icon buttons emit one hover fill, danger included', () => {
    for (const cls of [
      iconButtonClass(),
      iconButtonClass('sm', true),
      iconButtonClass('sm', false, 'hover:bg-lime-50'),
    ]) {
      expect((cls.match(/(?:^|\s)(?:[\w[\]().-]+:)*hover:bg-\S+/g) ?? []).length).toBe(1);
    }
    expect(iconButtonClass('sm', true)).toContain('hover:text-red-600');
  });

  // The bug that motivated the whole suite: hand-rolled buttons kept shipping without a pointer
  // cursor. Every variant/size combination must carry it, and the disabled counterpart.
  it('carries cursor-pointer and the disabled affordances on every variant and size', () => {
    for (const variant of BUTTON_VARIANTS) {
      for (const size of BUTTON_SIZES) {
        const cls = buttonClass(variant, size);
        expect(cls, `${variant}/${size}`).toContain('cursor-pointer');
        expect(cls, `${variant}/${size}`).toContain('disabled:cursor-not-allowed');
        expect(cls, `${variant}/${size}`).toContain('disabled:opacity-50');
      }
    }
  });

  it('gives each variant a distinct look', () => {
    const seen = new Set(BUTTON_VARIANTS.map((v) => buttonClass(v, 'md')));
    expect(seen.size).toBe(BUTTON_VARIANTS.length);
  });

  it('gives each size a distinct footprint', () => {
    const seen = new Set(BUTTON_SIZES.map((s) => buttonClass('primary', s)));
    expect(seen.size).toBe(BUTTON_SIZES.length);
  });

  // Regression guard: adopting Button in ConfirmModal once silently dropped its eager ring, which
  // is invisible in review — the dialog looks fine until you notice focus has no indicator.
  it('adds an eager :focus ring only when asked, for programmatically-focused buttons', () => {
    const eager = buttonClass('secondary', 'md', undefined, true);
    expect(eager).toContain('focus:ring-2');
    expect(buttonClass('secondary', 'md')).not.toContain('focus:ring-2');
    // …and never at the cost of the default, which stays focus-visible-only.
    expect(eager).toContain('focus-visible:ring-2');
    expect(eager).toContain('focus:outline-none');
  });

  // `link` is meant to sit inline in prose, where button padding would spread the surrounding
  // text and betray that it is not a real link.
  it('gives the inline variants the text scale but no box padding, unlike every other variant', () => {
    for (const variant of INLINE_VARIANTS) {
      for (const size of BUTTON_SIZES) {
        expect(buttonClass(variant, size), `${variant}/${size}`).not.toMatch(/\bp[xy]?-/);
        expect(buttonClass('primary', size), size).toMatch(/\bpx-/);
      }
      expect(buttonClass(variant, 'md'), variant).toContain('text-sm');
      expect(buttonClass(variant, 'xs'), variant).toContain('text-xs');
    }
  });

  // `outline` is what the quieter coloured affordances (a "Remove 3" in a list, a soft "Receive")
  // used to hand-roll, because only a solid form was on offer and they didn't want to shout.
  it('gives the coloured tones an outline weight that keeps the hue off the fill', () => {
    for (const variant of ['primary', 'danger', 'warning', 'success'] as ButtonVariant[]) {
      const outline = buttonClass(variant, 'sm', undefined, false, 'outline');
      expect(outline, variant).toContain('border');
      expect(outline, variant).toContain('cursor-pointer');
      expect(outline, variant).not.toContain('text-white');
      expect(outline, variant).not.toBe(buttonClass(variant, 'sm'));
    }
  });

  // The neutral names already encode a weight (`secondary` = outlined, `ghost` = neither), so
  // asking for one is a no-op rather than a silent restyle.
  it('leaves the variants that already name a weight untouched', () => {
    for (const variant of ['secondary', 'ghost', 'quiet', 'link'] as ButtonVariant[]) {
      expect(buttonClass(variant, 'sm', undefined, false, 'outline'), variant).toBe(
        buttonClass(variant, 'sm'),
      );
    }
  });

  // Tailwind picks the winner by stylesheet order, not class-attribute order, so emitting both
  // `rounded` and the caller's radius is a coin flip — and it lost once, rendering the split
  // action button square in one of its two states while looking right in the other.
  it('withholds its own radius when the caller names one', () => {
    for (const radius of ['rounded-none', 'rounded-l', 'rounded-r', 'rounded-full', 'rounded-md']) {
      const cls = buttonClass('primary', 'md', radius);
      expect(cls, radius).toContain(radius);
      expect(
        cls.split(' ').filter((c) => c === 'rounded'),
        radius,
      ).toHaveLength(0);
    }
    // …and still supplies one when the caller doesn't.
    expect(buttonClass('primary', 'md').split(' ')).toContain('rounded');
    expect(buttonClass('primary', 'md', 'w-full').split(' ')).toContain('rounded');
  });

  it('appends caller classes last so layout wins without losing the variant', () => {
    const cls = buttonClass('secondary', 'sm', 'w-full ml-auto');
    expect(cls).toContain('border-border');
    expect(cls.endsWith('w-full ml-auto')).toBe(true);
  });

  it('omits a trailing separator when no caller class is given', () => {
    expect(buttonClass('primary', 'md')).toBe(buttonClass('primary', 'md').trim());
  });

  // Palette discipline: the token colours, not raw slate/gray. Reds/ambers/emeralds have no token
  // yet, so they are the documented exception — but the neutral chrome must stay on tokens.
  it('styles the neutral variants from palette tokens, not raw greys', () => {
    for (const variant of ['secondary', 'ghost', 'quiet'] as ButtonVariant[]) {
      const cls = buttonClass(variant, 'md');
      expect(cls, variant).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|neutral)-\d/);
    }
    expect(buttonClass('secondary', 'md')).toContain('border-border');
    expect(buttonClass('ghost', 'md')).toContain('text-text');
    expect(buttonClass('primary', 'md')).toContain('bg-primary');
  });
});

describe('iconButtonClass radius', () => {
  // Same trap: Pill's dismiss and the grid's gear both pass their own radius.
  it('withholds its own radius when the caller names one', () => {
    for (const radius of ['rounded-full', 'rounded-md']) {
      const cls = iconButtonClass('sm', false, radius);
      expect(cls, radius).toContain(radius);
      expect(
        cls.split(' ').filter((c) => c === 'rounded'),
        radius,
      ).toHaveLength(0);
    }
    expect(iconButtonClass('sm').split(' ')).toContain('rounded');
  });
});

describe('iconButtonClass ink', () => {
  // The radius trap again, one property over. Pill's dismiss `×` passes `text-current` so it takes
  // the chip's own foreground — a chip's background is a runtime colour and a fixed grey vanishes
  // on half of them. Measured on a live page before this: `#a0a5ae` on a `#ec185b` tag, 1.08:1.
  it('withholds its own ink when the caller names one', () => {
    for (const ink of ['text-current', 'text-rose-500', 'text-[#abcdef]', 'hover:text-current']) {
      const cls = iconButtonClass('xs', false, ink);
      expect(cls.split(' '), ink).not.toContain('text-text-muted');
      expect(cls.split(' '), ink).not.toContain('hover:text-text');
      expect(cls, ink).toContain(ink);
    }
  });

  // The discriminator is "is this `text-*` a colour", and the utilities that are NOT are the closed
  // set. A caller passing a size or an alignment must still get the default ink, or every icon
  // button that sets its own font size silently loses its colour.
  it('keeps its ink when the caller names only a size or a layout', () => {
    for (const other of ['text-xs', 'text-2xs', 'text-[11px]', 'text-center', 'text-nowrap', '']) {
      const cls = iconButtonClass('xs', false, other);
      expect(cls.split(' '), other || '(none)').toContain('text-text-muted');
      expect(cls.split(' '), other || '(none)').toContain('hover:text-text');
    }
  });
});

describe('menuItemClass', () => {
  it('is clickable when enabled and refuses the click when not', () => {
    expect(menuItemClass()).toContain('cursor-pointer');
    expect(menuItemClass(false, true)).toContain('cursor-not-allowed');
    expect(menuItemClass(false, true)).not.toContain('cursor-pointer');
  });

  // Hover and keyboard highlight must land on the same look, or arrow-key navigation and the
  // mouse disagree about which row is "current".
  it('gives the active row the same surface as hover', () => {
    expect(menuItemClass(true)).toContain('bg-surface-hover');
    expect(menuItemClass(true)).toContain('hover:bg-surface-hover');
  });

  // A menu row is a REGION, so it takes the hover tone; a Button or IconButton sitting inside one
  // is a CONTROL and must keep `surface-raised`, or hovering the control repaints it to exactly the
  // shade the row underneath already took and the control vanishes into it.
  it('takes the region hover tone, not the control one', () => {
    expect(menuItemClass()).not.toContain('hover:bg-surface-raised');
    expect(buttonClass('ghost')).toContain('hover:bg-surface-raised');
    expect(iconButtonClass()).toContain('hover:bg-surface-raised');
  });

  it('stays on palette tokens rather than the raw greys each surface had drifted to', () => {
    expect(menuItemClass()).not.toMatch(/\b(bg|text)-(slate|gray|zinc|blue)-\d/);
  });
});

describe('iconButtonClass', () => {
  it('is clickable and disable-aware', () => {
    const cls = iconButtonClass();
    expect(cls).toContain('cursor-pointer');
    expect(cls).toContain('disabled:cursor-not-allowed');
  });

  it('recolours the hover when danger', () => {
    expect(iconButtonClass('sm', true)).toContain('hover:text-red-600');
    expect(iconButtonClass('sm', false)).not.toContain('hover:text-red-600');
  });

  it('is square at every size', () => {
    for (const size of ['xs', 'sm', 'md'] as const) {
      const cls = iconButtonClass(size);
      const h = /\bh-([\d.]+)\b/.exec(cls)?.[1];
      const w = /\bw-([\d.]+)\b/.exec(cls)?.[1];
      expect(h, size).toBeDefined();
      expect(w, size).toBe(h);
    }
  });
});

describe('field classes', () => {
  it('share the field chrome across input/select/textarea', () => {
    for (const cls of [inputClass(), selectClass(), textareaClass()]) {
      expect(cls).toContain('bg-surface');
      expect(cls).toContain('text-text');
      expect(cls).toContain('rounded border');
      expect(cls).toContain('disabled:cursor-not-allowed');
    }
  });

  it('marks invalid with a red border, fill and ring, and only then', () => {
    for (const build of [inputClass, selectClass, textareaClass]) {
      expect(build('sm', true)).toContain('border-red-400');
      expect(build('sm', true)).toContain('bg-red-50');
      expect(build('sm', true)).toContain('focus-visible:ring-red-400/40');
      expect(build('sm', false)).toContain('border-border');
      expect(build('sm', false)).not.toContain('border-red-400');
      expect(build('sm', false)).not.toContain('bg-red-50');
    }
  });

  /**
   * Tailwind resolves competing utilities by stylesheet order, not by their order in the class
   * attribute — so a field emitting both `bg-surface` and `bg-red-50` would pick a winner at build
   * time, and the error tint would be a coin flip rather than an override. Exactly one background
   * utility per state is what makes it deterministic.
   */
  it('emits exactly one background utility per state', () => {
    for (const build of [inputClass, selectClass, textareaClass]) {
      for (const invalid of [true, false]) {
        const backgrounds = (build('sm', invalid).match(/(?:^|\s)bg-\S+/g) ?? []).filter(
          (c) => !c.includes(':'),
        ); // variant fills (disabled:…) are a different state
        expect(backgrounds).toHaveLength(1);
      }
    }
  });

  it('gives select a pointer cursor, unlike the text fields', () => {
    expect(selectClass()).toContain('cursor-pointer');
    expect(inputClass()).not.toContain(' cursor-pointer');
    expect(textareaClass()).not.toContain(' cursor-pointer');
  });

  // A fixed height would fight the native `rows` attribute.
  it('sizes textarea by padding only, never a fixed height', () => {
    for (const size of ['sm', 'md'] as const) {
      expect(textareaClass(size)).not.toMatch(/\bh-\d/);
      expect(inputClass(size)).toMatch(/\bh-\d/);
    }
  });

  it('checkbox is a clickable box on the brand accent', () => {
    const cls = checkboxClass();
    expect(cls).toContain('accent-primary');
    expect(cls).toContain('cursor-pointer');
    expect(cls).toContain('h-4 w-4');
  });
});

describe('pillClass', () => {
  it('defaults to a soft neutral rounded pill', () => {
    expect(pillClass()).toBe(pillClass('neutral', 'soft', 'sm', 'rounded'));
  });

  it('gives every tone a distinct colour in every variant', () => {
    for (const variant of PILL_VARIANTS) {
      const coloured = PILL_TONES.filter((t) => t !== 'none').map((t) => pillClass(t, variant));
      expect(new Set(coloured).size, variant).toBe(coloured.length);
    }
  });

  // The escape hatch that lets TagPill (per-tag runtime colour) derive from Pill instead of
  // hand-rolling: `none` must contribute no colour class for the inline style to own it.
  it('emits no colour classes for tone none', () => {
    // Colour utilities only — `text-xs` is a *size*, which tone `none` still needs.
    const COLOUR = /\b(bg-|border-(?!\d)|text-(?:[a-z]+-\d|white|black|text|primary|current))/;
    for (const variant of PILL_VARIANTS) {
      expect(pillClass('none', variant), variant).not.toMatch(COLOUR);
    }
    // …and the coloured tones do carry one, so the assertion above can actually fail.
    expect(pillClass('info', 'soft')).toMatch(COLOUR);
    expect(pillClass('neutral', 'outline')).toMatch(COLOUR);
  });

  it('switches radius on shape', () => {
    expect(pillClass('info', 'soft', 'sm', 'full')).toContain('rounded-full');
    expect(pillClass('info', 'soft', 'sm', 'rounded')).not.toContain('rounded-full');
  });

  it('stays on one line — a pill never wraps', () => {
    expect(pillClass()).toContain('whitespace-nowrap');
  });

  it('appends caller classes last', () => {
    expect(
      pillClass('info', 'soft', 'sm', 'rounded', 'tabular-nums').endsWith('tabular-nums'),
    ).toBe(true);
  });
});

describe('spinnerClass', () => {
  it('spins, is round, and inherits its context colour', () => {
    const cls = spinnerClass();
    expect(cls).toContain('animate-spin');
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('border-current');
    expect(cls).toContain('border-t-transparent');
  });

  it('is square at every size', () => {
    for (const size of ['xs', 'sm', 'md'] as const) {
      const cls = spinnerClass(size);
      expect(/\bh-([\d.]+)\b/.exec(cls)?.[1], size).toBe(/\bw-([\d.]+)\b/.exec(cls)?.[1]);
    }
  });
});
