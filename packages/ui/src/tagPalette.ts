/**
 * Fixed tag-colour palette — 24 entries modeled on Gmail's label palette, each a
 * `(background, foreground)` pair pre-tuned for WCAG-AA contrast. Tags store a
 * `colorId` index (0..23) into this palette rather than free-form hex.
 *
 * This is the canonical render-side source; the same table lives authoritatively
 * in and is guarded PHP-side by `TagColorPalette`. The list is authored in groups
 * of six — (0–5) light tones, (6–11) saturated darks, (12–23) warm/mixed — which
 * orders the entries. It is not a layout: `PaletteSwatchPicker` lays them out
 * eight to a row, so the groups do not line up with the rows on screen.
 */
export interface TagColor {
  bg: string;
  fg: string;
  name: string;
  /**
   * Optional override for {@link tagInk} — the colour an *outline* affordance draws in.
   *
   * The pair is tuned for the solid chip, and `tagInk` normally picks whichever member also works
   * on the page. For one entry neither does: `Bright green`'s `fg` is a neutral near-black (chosen
   * to read on a vivid green fill), so an outline `Bright green` tag came out looking like a plain
   * black button — legible, but no longer recognisable as *that* tag. Rather than darken `fg` and
   * cost the chip its 8.6:1, the outline form gets its own colour here.
   */
  ink?: string;
}

export const TAG_PALETTE: readonly TagColor[] = [
  { bg: 'rgb(231,231,231)', fg: 'rgb(70,70,70)', name: 'Light grey' },
  { bg: 'rgb(182,207,245)', fg: 'rgb(13,52,114)', name: 'Light blue' },
  { bg: 'rgb(152,215,228)', fg: 'rgb(13,59,68)', name: 'Light teal' },
  { bg: 'rgb(227,215,255)', fg: 'rgb(61,24,142)', name: 'Light purple' },
  { bg: 'rgb(251,211,224)', fg: 'rgb(113,26,54)', name: 'Light pink' },
  { bg: 'rgb(242,178,168)', fg: 'rgb(138,28,10)', name: 'Light coral' },
  { bg: 'rgb(117,117,117)', fg: 'rgb(255,255,255)', name: 'Grey' },
  { bg: 'rgb(30,83,184)', fg: 'rgb(255,255,255)', name: 'Blue' },
  { bg: 'rgb(0,114,134)', fg: 'rgb(255,255,255)', name: 'Teal' },
  { bg: 'rgb(120,88,195)', fg: 'rgb(255,255,255)', name: 'Purple' },
  { bg: 'rgb(194,24,91)', fg: 'rgb(255,255,255)', name: 'Magenta' },
  { bg: 'rgb(217,48,37)', fg: 'rgb(255,255,255)', name: 'Red' },
  { bg: 'rgb(255,200,175)', fg: 'rgb(122,46,11)', name: 'Peach' },
  { bg: 'rgb(255,222,181)', fg: 'rgb(122,71,6)', name: 'Light orange' },
  { bg: 'rgb(251,233,131)', fg: 'rgb(89,76,5)', name: 'Light yellow' },
  { bg: 'rgb(253,237,193)', fg: 'rgb(104,78,7)', name: 'Cream' },
  { bg: 'rgb(179,239,211)', fg: 'rgb(11,79,48)', name: 'Light green' },
  { bg: 'rgb(162,220,193)', fg: 'rgb(4,80,46)', name: 'Sage' },
  { bg: 'rgb(255,117,55)', fg: 'rgb(84,36,14)', name: 'Orange' },
  { bg: 'rgb(255,173,70)', fg: 'rgb(99,62,4)', name: 'Amber' },
  { bg: 'rgb(235,219,222)', fg: 'rgb(102,46,55)', name: 'Pale rose' },
  { bg: 'rgb(204,166,172)', fg: 'rgb(82,29,40)', name: 'Dusty rose' },
  { bg: 'rgb(66,214,146)', fg: 'rgb(32,33,36)', ink: 'rgb(20,90,20)', name: 'Bright green' },
  { bg: 'rgb(22,167,101)', fg: 'rgb(8,48,24)', name: 'Dark green' },
];

/**
 * The order {@link PaletteSwatchPicker} *draws* the palette in — a permutation of the indices
 * above, never a reordering of the array itself.
 *
 * The distinction is the whole point: a `colorId` **is** an index into `TAG_PALETTE`, it is stored
 * on every tag, and `TagColorPalette` mirrors the same positions PHP-side. Rearranging the array to
 * make the picker read better would silently recolour every tag ever saved. Presentation moves; the
 * identity does not.
 *
 * Read as a grid {@link TAG_PALETTE_DISPLAY_COLUMNS} wide, this puts **hue across and lightness
 * down**: each column is one hue family, the first row its light member and the second its dark
 * one. That is not a shape imposed on the palette — it is the shape the palette turns out to have.
 * Measured in HSL, the twenty-four entries fall into exactly twelve hue families of two, and within
 * a family the pair differs by lightness while saturation barely moves (blue 76% vs 72%, teal 58%
 * vs 100% being the widest). So the honest second axis is lightness, not saturation.
 *
 * Columns run neutral, rose 350°, pink 336°, red 4°, orange 19°, amber 33°, yellow 51°, green 152°,
 * mint 152°, teal 190°, blue 216°, purple 258°. The neutrals are parked first because they have no
 * hue to place, and the rose family follows them rather than closing the row: at 29% and 27%
 * saturation it is the closest thing here to a second pair of greys, so it belongs with them.
 * Saturation then climbs into pink and red, and hue carries the rest of the sweep to purple.
 */
export const TAG_PALETTE_DISPLAY_ORDER: readonly number[] = [
  //  neutral  rose  pink  red  orange      amber  yellow  green  mint  teal  blue  purple
  /* light */ 0, 20, 4, 5, 12, 13, 15, 16, 17, 2, 1, 3,
  /* dark  */ 6, 21, 10, 11, 18, 19, 14, 23, 22, 8, 7, 9,
];

/**
 * Swatches per row for {@link TAG_PALETTE_DISPLAY_ORDER}. Twelve is not a taste call: it is what
 * makes each column one hue. Draw the same order at any other width and the columns stop meaning
 * anything — the order and this number are one decision, not two.
 */
export const TAG_PALETTE_DISPLAY_COLUMNS = 12;

/**
 * A palette entry as inline style for a badge — the one way a colour that is *data* reaches the
 * DOM. Pairs with `Pill`'s `tone="none"`, which emits no colour classes precisely so this can.
 *
 * Inline rather than a class because the colour is chosen at runtime (a tag's entry, a status's
 * configured entry); there is no class to name it.
 */
export function paletteStyle(colorId: number): { 'background-color': string; color: string } {
  const c = tagColor(colorId);

  return { 'background-color': c.bg, color: c.fg };
}

/** Resolve a `colorId` to its palette entry, clamping out-of-range to the grey default. */
export function tagColor(colorId: number): TagColor {
  return TAG_PALETTE[colorId] ?? TAG_PALETTE[0];
}

/** Parse `rgb(r,g,b)` into channels. Returns black for anything unparseable. */
function channels(css: string): [number, number, number] {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** WCAG 2.x relative luminance of an `rgb(r,g,b)` colour. */
export function relativeLuminance(css: string): number {
  const [r, g, b] = channels(css).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb(r,g,b)` colours — 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The default page surface an outline affordance sits on. */
const SURFACE = 'rgb(255,255,255)';

/**
 * The palette member to use as **ink** — text and border — when a tag is drawn as an *outline*
 * affordance on the page surface rather than as a solid chip.
 *
 * A solid chip paints `bg` and writes `fg` on top, and the pair is tuned for that. An outline
 * affordance has no chip: it draws on the page, so it must contrast with the *page*, and neither
 * member is unconditionally right. Half the palette is light tones whose `bg` is near-white
 * (`Cream` is 1.16:1 against white — effectively invisible, which is the reported bug); the other
 * half is saturated darks whose `fg` is pure white, equally invisible. So pick per entry: whichever
 * member contrasts better with the surface. That resolves to `fg` for every light tone and `bg` for
 * every dark one, and every one of the 24 entries clears WCAG AA (4.5:1) — asserted in the tests,
 * so a future palette edit can't silently reintroduce an unreadable tag.
 *
 * The tag stays recognisable either way, because the chosen member is the saturated one: an
 * outline `Cream` tag reads as brown-gold ink, its solid form as gold with brown text. Where even
 * that fails — a pair whose usable member carries no hue — the entry names an explicit
 * {@link TagColor.ink}, which wins outright.
 */
export function tagInk(color: TagColor): string {
  if (color.ink) return color.ink;
  return contrastRatio(color.bg, SURFACE) >= contrastRatio(color.fg, SURFACE) ? color.bg : color.fg;
}

/**
 * Diagonal hatch marking a **archived** tag that is still attached to something — present, but no
 * longer doing anything.
 *
 * It has to be a channel of its own, because the chip vocabulary is already spoken for: solid means
 * present, an outline means absent-but-appliable, and struck-through means *just removed* in a
 * change delta. Fading alone could not carry it either — `Light grey` is a real palette entry, so a
 * chip drained all the way would be indistinguishable from a genuinely grey tag. So the two work
 * together: {@link tagArchivedFill} drains the colour halfway, which is what catches the eye across
 * a row, and this pattern says *why* on inspection. It survives greyscale and colour-blindness,
 * being a pattern rather than a hue — though it is decoration either way, so the words belong in
 * the element's `title`.
 *
 * The stripes are drawn in the pair's **own `fg`**, not a fixed white: half this palette is dark
 * fills carrying white text and half is near-white fills carrying dark text, so one fixed stripe
 * colour would vanish on one half. `fg` is by definition the member tuned to be legible on `bg`,
 * which makes contrast automatic for every entry. Alpha is kept low — the hatch must stay under
 * the label, never compete with it.
 */
export function tagHatch(color: TagColor): string {
  const [r, g, b] = channels(color.fg);
  const stripe = `rgba(${r}, ${g}, ${b}, 0.28)`;
  return `repeating-linear-gradient(45deg, transparent 0 3px, ${stripe} 3px 5px)`;
}

/**
 * The fill for a **archived** tag: the palette entry's own colour, half drained toward grey.
 *
 * The hatch says *what* changed; this says it at a glance, from across the row, before anyone reads
 * a pattern. Together they read as faded-and-struck-out-of-service, which is the state — still
 * attached, no longer acting.
 *
 * **Desaturated at constant luminance**, never lightened. Each channel is mixed toward the colour's
 * own luminance, which drains the hue while leaving brightness where it was — so the `fg` that was
 * tuned against this `bg` still contrasts with it. Lightening would have been the obvious way to
 * "fade" a chip and is the wrong one here: half this palette is dark fills carrying white text, and
 * washing those out walks the label straight into unreadability. The tests assert every entry still
 * clears WCAG AA in its archived form.
 *
 * A fully grey result would collide with the real `Light grey` entry, which is why this drains only
 * halfway: `Red` retires to a muted brick, still recognisably the red tag.
 */
export function tagArchivedFill(color: TagColor): string {
  // Mixed in LINEAR light, not in sRGB. Relative luminance is a linear combination of the
  // linear-light channels, so draining each of them toward that same luminance leaves it unchanged
  // — bar the rounding back to 8-bit — and with it the contrast ratio against `fg`. The intuitive
  // version of this (mixing the sRGB bytes) is off by the gamma curve, and drops `Bright green` to
  // 4.11:1 — under AA, and caught by the test rather than by a user.
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (l: number): number => {
    const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(255, Math.max(0, s * 255)));
  };
  const [lr, lg, lb] = channels(color.bg).map(toLinear) as [number, number, number];
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const drain = (c: number): number => toSrgb(c + (luminance - c) * 0.5);
  return `rgb(${drain(lr)},${drain(lg)},${drain(lb)})`;
}
