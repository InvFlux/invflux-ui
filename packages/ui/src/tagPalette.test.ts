import { describe, expect, it } from 'vitest';
import {
  TAG_PALETTE,
  TAG_PALETTE_DISPLAY_COLUMNS,
  TAG_PALETTE_DISPLAY_ORDER,
  contrastRatio,
  relativeLuminance,
  tagColor,
  tagInk,
  tagArchivedFill,
} from './tagPalette';

const WHITE = 'rgb(255,255,255)';
const BLACK = 'rgb(0,0,0)';

describe('relativeLuminance / contrastRatio', () => {
  it('anchors on the WCAG reference values', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 2);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('rgb(30,83,184)', WHITE)).toBeCloseTo(contrastRatio(WHITE, 'rgb(30,83,184)'), 10);
  });
});

describe('the palette pairs themselves', () => {
  // The `(bg, fg)` pair is what a *solid* chip paints. It has always been claimed AA-tuned;
  // this pins the claim so a palette edit can't quietly break a chip's own legibility.
  it.each(TAG_PALETTE.map((c, i) => [i, c.name, c] as const))(
    '%i %s: fg on bg clears AA',
    (_i, _name, c) => {
      expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('tagInk', () => {
  // The reported bug: a light-toned tag drawn as an outline affordance used its `bg` as ink,
  // and `Cream` against white is 1.16:1 — invisible. Every entry must clear AA on the page.
  it.each(TAG_PALETTE.map((c, i) => [i, c.name, c] as const))(
    '%i %s: ink clears AA against the page surface',
    (_i, _name, c) => {
      expect(contrastRatio(tagInk(c), WHITE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('picks fg for the light tones and bg for the saturated ones', () => {
    const cream = tagColor(15);
    const blue = tagColor(7);
    expect(tagInk(cream)).toBe(cream.fg);
    expect(tagInk(blue)).toBe(blue.bg);
  });

  it('returns a colour the entry actually declares, never a computed one', () => {
    for (const c of TAG_PALETTE) {
      expect([c.bg, c.fg, c.ink].filter(Boolean)).toContain(tagInk(c));
    }
  });

  // The escape hatch for an entry whose usable member carries no hue — `Bright green`'s `fg` is a
  // neutral near-black, so its outline form read as a plain black button.
  it('prefers an explicit ink over the bg/fg pick, and that ink still clears AA', () => {
    const bright = tagColor(22);
    expect(bright.ink).toBeDefined();
    expect(tagInk(bright)).toBe(bright.ink);
    expect(contrastRatio(bright.ink!, WHITE)).toBeGreaterThanOrEqual(4.5);
    // …and it did not cost the solid chip its legibility, which was the reason not to touch `fg`.
    expect(contrastRatio(bright.fg, bright.bg)).toBeGreaterThan(8);
  });
});

describe('tagColor', () => {
  it('clamps an unknown colorId to the grey default', () => {
    expect(tagColor(999)).toBe(TAG_PALETTE[0]);
    expect(tagColor(-1)).toBe(TAG_PALETTE[0]);
  });
});

describe('tagArchivedFill', () => {
  it('keeps every entry legible in its archived form', () => {
    // The point of draining at constant luminance rather than washing toward white: the `fg` tuned
    // against the live fill must still clear WCAG AA against the archived one, for the dark half of
    // the palette (white text) as much as the light half.
    for (const c of TAG_PALETTE) {
      expect(contrastRatio(tagArchivedFill(c), c.fg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('preserves luminance, which is what makes that hold', () => {
    // Mixing in linear light leaves luminance untouched but for the rounding back to 8-bit
    // channels, so a archived chip's contrast is the live pair's contrast — not merely "close enough
    // on the entries we happened to check".
    for (const c of TAG_PALETTE) {
      expect(relativeLuminance(tagArchivedFill(c))).toBeCloseTo(relativeLuminance(c.bg), 2);
    }
  });

  it('drains the hue without collapsing to grey', () => {
    // Halfway, so a archived Red still reads as the red tag rather than as the Light grey one.
    const red = TAG_PALETTE.find((c) => c.name === 'Red');
    expect(red).toBeDefined();
    const [r, g, b] = /rgb\((\d+),(\d+),(\d+)\)/.exec(tagArchivedFill(red!))!.slice(1).map(Number);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(20);
  });
});

describe('display order', () => {
  // A `colorId` is an index into TAG_PALETTE and is stored on every tag, so the picker reorders a
  // list of indices rather than the palette. That indirection is only safe while the list stays a
  // permutation: drop an entry and a colour becomes unpickable, repeat one and two swatches claim
  // the same id, and neither shows up as a type error.
  it('is a permutation of every palette index', () => {
    expect(TAG_PALETTE_DISPLAY_ORDER).toHaveLength(TAG_PALETTE.length);
    expect([...TAG_PALETTE_DISPLAY_ORDER].sort((a, b) => a - b)).toEqual(TAG_PALETTE.map((_, i) => i));
  });

  it('fills whole rows at the documented width', () => {
    expect(TAG_PALETTE_DISPLAY_ORDER.length % TAG_PALETTE_DISPLAY_COLUMNS).toBe(0);
  });

  // The grid's claim is that a column is one hue. Assert it, so an entry added or moved without
  // re-deriving the order is caught here rather than by someone noticing a scrambled picker.
  it('puts one hue family in each column, lightest first', () => {
    const hsl = (rgb: string): { h: number; l: number } => {
      const [r, g, b] = rgb.match(/\d+/g)!.map((n) => Number(n) / 255);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const d = mx - mn;
      let h = 0;
      if (0 !== d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);

      return { h: h < 0 ? h + 360 : h, l: (mx + mn) / 2 };
    };

    for (let col = 0; col < TAG_PALETTE_DISPLAY_COLUMNS; col++) {
      const column = [];
      for (let row = 0; row * TAG_PALETTE_DISPLAY_COLUMNS + col < TAG_PALETTE_DISPLAY_ORDER.length; row++) {
        column.push(hsl(TAG_PALETTE[TAG_PALETTE_DISPLAY_ORDER[row * TAG_PALETTE_DISPLAY_COLUMNS + col]!]!.bg));
      }
      // Neutrals have no meaningful hue, so only their lightness ordering is asserted.
      const chromatic = column.filter((c) => 0 !== c.h);
      for (const c of chromatic) expect(Math.abs(c.h - chromatic[0]!.h)).toBeLessThanOrEqual(10);
      for (let i = 1; i < column.length; i++) expect(column[i]!.l).toBeLessThan(column[i - 1]!.l);
    }
  });
});
