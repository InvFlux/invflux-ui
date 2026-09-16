// @ts-expect-error `packages/ui` ships to a browser and carries no `@types/node`, but this file
// runs in vitest's node environment, where `node:fs` is genuinely there. Reading the stylesheet is
// the point of the block below, and the two alternatives were worse: `?raw` comes back empty
// (vitest stubs CSS imports, and the stub swallows the query), and `@types/node` is a strange
// dependency for a component library to grow for one test. If those types ever do arrive, this
// suppression starts erroring as unused — which is the right prompt to delete the line.
import { readFileSync } from 'node:fs';
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
    expect(contrastRatio('rgb(30,83,184)', WHITE)).toBeCloseTo(
      contrastRatio(WHITE, 'rgb(30,83,184)'),
      10,
    );
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

/**
 * The CSS table and the functions above are two copies of the same palette, and the table is the
 * one that renders. Nothing had ever read it back, which is how the archived fill shipped wrong:
 * `theme.css` grew a dark variant for the pairs while the archived fill and the outline ink stayed
 * literals computed in JS — from the *light* pair, on every page. Measured on the dark ground: all
 * 24 archived chips between 1.02:1 and 3.85:1, all 24 outline inks between 1.24:1 and 3.90:1.
 * Neither was a near miss; the label was gone.
 *
 * So this parses the stylesheet and re-derives it. The generator is the same code the components
 * used to call, which is the point — the table cannot drift from the definition, and a new theme
 * block cannot be added with a pair table and no derived one.
 */
describe('the CSS variable table in styles/theme.css', () => {
  const css: string = readFileSync(new URL('./styles/theme.css', import.meta.url), 'utf8');

  /** The page each block's colours are solved against, in file order. */
  const BLOCKS = [
    { name: 'light (:root, :host)', surface: 'rgb(255,255,255)' },
    // `oklch(20.5% 0.012 264)` — `--color-surface` in both dark blocks, converted once here so the
    // test does not carry an oklch implementation. Re-derive it if that token ever moves.
    { name: 'dark (@media prefers-color-scheme)', surface: 'rgb(20,23,29)' },
    { name: "dark ([data-theme='dark'])", surface: 'rgb(20,23,29)' },
  ] as const;

  /**
   * Compare colours, not their spelling.
   *
   * These assertions read declarations out of the stylesheet as text, so anything that rewrites the
   * text without changing the colour used to fail them: `rgb(231, 231, 231)` against
   * `rgb(231,231,231)` is the same colour and was not the same string. A repo-wide formatter run
   * caught this — it collapsed the alignment padding the file used to line values up, and four
   * tests reported a palette mismatch that did not exist. Whitespace is not part of a colour.
   */
  const canon = (value: string): string => value.replace(/\s+/g, '');

  /** Slice the file into one record per `--tag-*` block, keyed by variable name. */
  const blocks = ((): Map<string, string>[] => {
    const starts = [...css.matchAll(/--tag-0-bg:/g)].map((m) => m.index);
    return starts.map((start, i) => {
      const chunk = css.slice(start, starts[i + 1] ?? css.length);
      return new Map(
        [...chunk.matchAll(/(--tag-\d+-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, canon(m[2]!)]),
      );
    });
  })();

  it('has exactly the three blocks this test knows how to check', () => {
    // A fourth theme would be silently unchecked — and unchecked is how this broke.
    expect(blocks).toHaveLength(BLOCKS.length);
  });

  it.each(BLOCKS.map((b, i) => [i, b.name, b.surface] as const))(
    'block %i — %s: defines all four variables for all 24 entries',
    (i, _name, _surface) => {
      const vars = blocks[i]!;
      for (let id = 0; id < TAG_PALETTE.length; id++) {
        for (const suffix of ['bg', 'fg', 'archived-bg', 'ink']) {
          expect(vars.get(`--tag-${id}-${suffix}`), `--tag-${id}-${suffix}`).toBeDefined();
        }
      }
    },
  );

  it.each(BLOCKS.map((b, i) => [i, b.name] as const))(
    'block %i — %s: the archived fill is tagArchivedFill of THAT block’s own bg',
    (i, _name) => {
      const vars = blocks[i]!;
      for (let id = 0; id < TAG_PALETTE.length; id++) {
        const bg = vars.get(`--tag-${id}-bg`)!;
        expect(vars.get(`--tag-${id}-archived-bg`), `--tag-${id}`).toBe(
          canon(tagArchivedFill({ bg, fg: '', name: '' })),
        );
      }
    },
  );

  it.each(BLOCKS.map((b, i) => [i, b.name, b.surface] as const))(
    'block %i — %s: an archived chip stays legible, and an outline clears the page',
    (i, _name, surface) => {
      const vars = blocks[i]!;
      for (let id = 0; id < TAG_PALETTE.length; id++) {
        const fg = vars.get(`--tag-${id}-fg`)!;
        // The label over the drained fill — the reported bug, in the theme that renders it.
        expect(
          contrastRatio(vars.get(`--tag-${id}-archived-bg`)!, fg),
          `--tag-${id} archived`,
        ).toBeGreaterThanOrEqual(4.5);
        // …and over the live one, which is the claim the pairs were tuned to and never asserted
        // for the dark block.
        expect(
          contrastRatio(vars.get(`--tag-${id}-bg`)!, fg),
          `--tag-${id} solid`,
        ).toBeGreaterThanOrEqual(4.5);
        // An outline affordance draws on the page, so it answers to the page, not to the chip.
        expect(
          contrastRatio(vars.get(`--tag-${id}-ink`)!, surface),
          `--tag-${id} ink`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('solves the outline ink per theme, and it really does invert', () => {
    // Not a tautology worth skipping: if the dark block were copy-pasted from the light one every
    // assertion above about *fills* would still pass, and only the inks would be wrong — which is
    // exactly the state this replaced.
    const [light, dark] = blocks as [Map<string, string>, Map<string, string>];
    const differing = TAG_PALETTE.filter(
      (_, id) => light.get(`--tag-${id}-ink`) !== dark.get(`--tag-${id}-ink`),
    );
    expect(differing.length).toBe(TAG_PALETTE.length);
  });

  it('keeps the two dark blocks identical — the stamp and the media query are one theme', () => {
    // They are separate selectors only because a `:host()` stamp cannot be expressed as a media
    // query. Any divergence means one of them was edited by hand.
    expect(Object.fromEntries(blocks[2]!)).toEqual(Object.fromEntries(blocks[1]!));
  });

  it('the light block still agrees with tagInk, which generated it', () => {
    const light = blocks[0]!;
    for (const [id, c] of TAG_PALETTE.entries()) {
      expect(light.get(`--tag-${id}-ink`), `--tag-${id}`).toBe(canon(tagInk(c)));
    }
  });
});

describe('display order', () => {
  // A `colorId` is an index into TAG_PALETTE and is stored on every tag, so the picker reorders a
  // list of indices rather than the palette. That indirection is only safe while the list stays a
  // permutation: drop an entry and a colour becomes unpickable, repeat one and two swatches claim
  // the same id, and neither shows up as a type error.
  it('is a permutation of every palette index', () => {
    expect(TAG_PALETTE_DISPLAY_ORDER).toHaveLength(TAG_PALETTE.length);
    expect([...TAG_PALETTE_DISPLAY_ORDER].sort((a, b) => a - b)).toEqual(
      TAG_PALETTE.map((_, i) => i),
    );
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
      if (0 !== d)
        h =
          mx === r
            ? 60 * (((g - b) / d) % 6)
            : mx === g
              ? 60 * ((b - r) / d + 2)
              : 60 * ((r - g) / d + 4);

      return { h: h < 0 ? h + 360 : h, l: (mx + mn) / 2 };
    };

    for (let col = 0; col < TAG_PALETTE_DISPLAY_COLUMNS; col++) {
      const column = [];
      for (
        let row = 0;
        row * TAG_PALETTE_DISPLAY_COLUMNS + col < TAG_PALETTE_DISPLAY_ORDER.length;
        row++
      ) {
        column.push(
          hsl(TAG_PALETTE[TAG_PALETTE_DISPLAY_ORDER[row * TAG_PALETTE_DISPLAY_COLUMNS + col]!]!.bg),
        );
      }
      // Neutrals have no meaningful hue, so only their lightness ordering is asserted.
      const chromatic = column.filter((c) => 0 !== c.h);
      for (const c of chromatic) expect(Math.abs(c.h - chromatic[0]!.h)).toBeLessThanOrEqual(10);
      for (let i = 1; i < column.length; i++) expect(column[i]!.l).toBeLessThan(column[i - 1]!.l);
    }
  });
});
