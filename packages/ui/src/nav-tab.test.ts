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
    // A fainter fill: /5 against /10.
    expect(surface.activeClass).toContain('bg-primary/10');
    expect(section.activeClass).toContain('bg-primary/5');
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
