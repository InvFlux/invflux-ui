import { describe, expect, it } from 'vitest';
import { navTabClasses, type NavTabVariant } from './primitives';

const VARIANTS: NavTabVariant[] = ['surface', 'section'];

/** Any background utility — what the active fill and the dirty tint would fight over. */
const BACKGROUND = /(?:^|\s)bg-\S+/;

describe('navTabClasses', () => {
  it.each(VARIANTS)('%s: an active tab is filled, cased and bordered', (variant) => {
    const { activeClass } = navTabClasses(variant);

    expect(activeClass).toMatch(BACKGROUND);
    expect(activeClass).toContain('uppercase');
    expect(activeClass).toContain('border-primary');
  });

  /**
   * The rule this module exists to make explicit. The dirty tint is applied by the component as a
   * `classList` entry, so if the active look ALSO carried a background, which one rendered would be
   * decided by Tailwind's stylesheet order rather than by us.
   */
  it.each(VARIANTS)("%s: a dirty tab's active look carries no background at all", (variant) => {
    const { activeClass } = navTabClasses(variant, true);

    expect(activeClass).not.toMatch(BACKGROUND);
    // ...and stays legible as the active tab by every other means.
    expect(activeClass).toContain('uppercase');
    expect(activeClass).toContain('border-primary');
  });

  it('section reads as subordinate to surface, not as a second row of the same thing', () => {
    const surface = navTabClasses('surface');
    const section = navTabClasses('section');

    expect(surface.class).toContain('text-sm');
    expect(section.class).toContain('text-xs');
    // A fainter fill: /5 against /20. Both are alpha tints deliberately — they composite with
    // whatever is behind them, so the active tab keeps its distance from the ground in either
    // theme (measured: 1.15 light / 1.09 dark at /10) instead of needing a dark-mode value.
    expect(surface.activeClass).toContain('bg-primary/20');
    expect(section.activeClass).toContain('bg-primary/5');
  });

  /**
   * `text-primary` reads as the obvious choice here and is the thing to put back only with numbers
   * in hand. `--color-primary` is deliberately one value in both themes — lifting it for the dark
   * ground breaks every `bg-primary` surface carrying hardcoded white text — so as *ink* it answers
   * to one ground while the tab has two, and it measured 3.06:1 on the dark filled tab against a
   * 4.5:1 floor (14px, weight 500 — normal text, not the 3:1 large-text case). The ramp slots are
   * themed, so `blue-900` is navy on white and pale blue on the dark ground: 7.91:1 / 10.12:1.
   */
  it.each(VARIANTS)(
    '%s: the active label uses the themed ramp slot, not the fixed primary',
    (variant) => {
      for (const dirty of [false, true]) {
        const { activeClass } = navTabClasses(variant, dirty);
        expect(activeClass).toContain('text-blue-900');
        expect(activeClass).not.toContain('text-primary');
      }
    },
  );

  it('keeps the active label one colour whether or not the tab is dirty', () => {
    // The dirty look withholds the fill, not the ink — a label that changed hue on becoming dirty
    // would read as a different kind of tab rather than the same tab with unsaved work.
    for (const variant of VARIANTS) {
      const ink = (dirty: boolean): string[] =>
        navTabClasses(variant, dirty)
          .activeClass.split(/\s+/)
          .filter((c) => c.startsWith('text-'));
      expect(ink(true)).toEqual(ink(false));
    }
  });

  it("defaults to the shell's own row", () => {
    expect(navTabClasses()).toEqual(navTabClasses('surface'));
  });

  /**
   * Tailwind v4 scans this source and emits only what it can see spelled out, so every class must
   * survive as a literal — a string built from fragments compiles to no CSS at all.
   */
  it.each(VARIANTS)('%s: emits complete literals, never fragments', (variant) => {
    const all = Object.values(navTabClasses(variant)).join(' ');

    expect(all).not.toMatch(/\$\{|undefined|\bnull\b/);
    expect(all.split(/\s+/).every((c) => c.length > 0)).toBe(true);
  });
});
