import { Show, splitProps, type JSX } from 'solid-js';
import {
  iconButtonClass,
  pillClass,
  type PillShape,
  type PillSize,
  type PillTone,
  type PillVariant,
} from './primitives';
import { paletteStyle } from './tagPalette';

export type { PillShape, PillSize, PillTone, PillVariant };

export interface PillProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  /** Colour family. Default `neutral`. Use `none` when the colour arrives at runtime via `style`. */
  tone?: PillTone;
  /**
   * Draw this `TAG_PALETTE` entry instead of a tone — for a pill whose colour is **data**: a tag's
   * saved entry, a status's configured one. Implies `tone="none"`, and a caller's own `style` still
   * wins, so an override stays possible without fighting a class.
   *
   * A `colorId` rather than a colour: every entry is an AA-verified `(background, foreground)` pair,
   * so no configured status can be made unreadable, and dark-mode variants are given to the pairs
   * once rather than being impossible for arbitrary hex.
   */
  colorId?: number;
  /** Colour weight — tinted (`soft`, default), tinted + bordered (`outline`), or full (`solid`). */
  variant?: PillVariant;
  /** Text + padding scale. Default `sm`. */
  size?: PillSize;
  /** `rounded` (default) for counts and statuses; `full` for identity-ish labels like tags. */
  shape?: PillShape;
  /** When set, renders a trailing dismiss affordance. */
  onRemove?: () => void;
  /** Accessible name for the dismiss affordance. Pass a translated string — required with `onRemove`. */
  removeLabel?: string;
}

/**
 * The pill primitive: a small, non-interactive label carrying a count, a status or an identity.
 * Every badge-shaped `<span>` in the SPAs is one of these — a count pill on an order line, a
 * status chip on a PO, a tag chip — and they had drifted into a dozen near-identical class
 * strings, which is what this replaces.
 *
 * Two escape hatches keep the specialised badges derivable from it rather than hand-rolled:
 * - `tone="none"` emits **no** colour classes, so a caller whose colour is *data* (a tag's palette
 *   entry, a state's configured colour) supplies it through `style` without fighting a tone class.
 * - `onRemove` adds the dismiss affordance in the pill's own metrics, so a removable chip doesn't
 *   have to re-derive one.
 *
 * Interactive pills (a *clickable* filter chip) are not this component — a thing you click is a
 * `Button`, so it gets the focus ring, the cursor and the keyboard behaviour that go with it.
 */
export function Pill(props: PillProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'colorId',
    'style',
    'tone',
    'variant',
    'size',
    'shape',
    'onRemove',
    'removeLabel',
    'class',
    'children',
  ]);

  return (
    <span
      {...rest}
      style={
        undefined === local.colorId
          ? local.style
          : {
              ...paletteStyle(local.colorId),
              ...('object' === typeof local.style ? local.style : {}),
            }
      }
      class={pillClass(
        undefined === local.colorId ? (local.tone ?? 'neutral') : 'none',
        local.variant ?? 'soft',
        local.size ?? 'sm',
        local.shape ?? 'rounded',
        local.class,
      )}
    >
      {local.children}
      <Show when={local.onRemove}>
        <button
          type="button"
          // Inherits the pill's colour rather than the icon-button muted default: the pill's
          // background may be any runtime colour, and a fixed grey × would vanish on half of them.
          class={iconButtonClass(
            'xs',
            false,
            '-mr-0.5 rounded-full text-current opacity-70 hover:bg-black/10 hover:text-current',
          )}
          aria-label={local.removeLabel}
          onClick={(e) => {
            e.stopPropagation();
            local.onRemove?.();
          }}
        >
          ×
        </button>
      </Show>
    </span>
  );
}
