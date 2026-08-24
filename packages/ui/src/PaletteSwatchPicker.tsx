import { For, Show, type JSX } from 'solid-js';
import {
  TAG_PALETTE,
  TAG_PALETTE_DISPLAY_COLUMNS,
  TAG_PALETTE_DISPLAY_ORDER,
  type TagColor,
} from './tagPalette';

export interface PaletteSwatchPickerProps {
  /** The selected entry's index, or `null` when nothing is chosen yet. */
  value: number | null;
  onPick: (colorId: number) => void;
  /**
   * The palette to draw. Defaults to {@link TAG_PALETTE}; a caller passes its own only if it has a
   * second fixed palette, never to let someone author a colour — see the note on the component.
   *
   * A custom palette is drawn in array order, since {@link TAG_PALETTE_DISPLAY_ORDER} describes
   * that one palette's hue families and means nothing about another's.
   */
  palette?: readonly TagColor[];
  /**
   * Swatches per row. Defaults to {@link TAG_PALETTE_DISPLAY_COLUMNS}, which is the width that
   * makes each column one hue — override it and the grid keeps its colours but loses its structure.
   */
  columns?: number;
  /** Accessible name for the group of swatches. */
  ariaLabel: string;
}

/**
 * A grid of fixed-palette colour swatches — the one way anything in InvFlux offers a colour choice.
 *
 * **A `colorId` into a fixed palette, never a colour input.** Every entry is a `(background,
 * foreground)` pair pre-tuned for WCAG AA and asserted by `tagPalette.test.ts`, so a merchant cannot
 * author an unreadable combination, and a dark-mode variant can be given to the pairs *once,
 * centrally*, rather than being impossible for arbitrary hex. Twenty-four choices is not a real
 * limit on "these three must be tellable apart".
 *
 * Toggle-button semantics rather than radios: the swatches are a set of buttons of which one reads
 * as pressed, which is what they are, and `role="radio"` would advertise arrow-key navigation this
 * does not implement.
 */
export function PaletteSwatchPicker(props: PaletteSwatchPickerProps): JSX.Element {
  /**
   * Swatches paired with the `colorId` they stand for. Drawing position and identity are separate
   * here, so a swatch reports the index it *is*, never the cell it happens to sit in.
   */
  const swatches = (): Array<{ colorId: number; color: TagColor }> =>
    undefined === props.palette
      ? TAG_PALETTE_DISPLAY_ORDER.map((colorId) => ({ colorId, color: TAG_PALETTE[colorId]! }))
      : props.palette.map((color, colorId) => ({ colorId, color }));

  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      class="grid gap-x-1.5 gap-y-2.5"
      style={{
        'grid-template-columns': `repeat(${props.columns ?? TAG_PALETTE_DISPLAY_COLUMNS}, minmax(0, 1fr))`,
      }}
    >
      <For each={swatches()}>
        {({ colorId, color: c }) => (
          <button
            type="button"
            class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
            classList={{ 'ring-2 ring-gray-800': props.value === colorId }}
            style={{ 'background-color': c.bg, color: c.fg }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={props.value === colorId}
            onClick={() => props.onPick(colorId)}
          >
            <Show when={props.value === colorId}>
              <span class="text-2xs leading-none">✓</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
