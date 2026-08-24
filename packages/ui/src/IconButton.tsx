import { splitProps, type JSX } from 'solid-js';
import { iconButtonClass, type IconButtonSize } from './primitives';

export type { IconButtonSize };

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Accessible name — **required**, because an icon-only button has no text for a screen reader to
   * read. Pass a translated string; the primitive never bakes English copy.
   */
  label: string;
  /** Square footprint. Default `sm`. */
  size?: IconButtonSize;
  /** Destructive glyph (×, trash) — recolours the hover to red. */
  danger?: boolean;
  /** Show the label as a native tooltip too. Default true. */
  titled?: boolean;
}

/**
 * Icon-only button: a square, quiet affordance for row actions, dismissals and toolbar glyphs.
 * Separate from {@link Button} because the two differ in more than styling — this one is square,
 * has no text, and therefore *requires* an accessible name. Keeping it distinct is what stops
 * unlabelled icon buttons shipping.
 */
export function IconButton(props: IconButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ['label', 'size', 'danger', 'titled', 'class', 'children']);

  return (
    <button
      type="button"
      {...rest}
      class={iconButtonClass(local.size ?? 'sm', local.danger ?? false, local.class)}
      aria-label={local.label}
      title={(local.titled ?? true) ? local.label : undefined}
    >
      {local.children}
    </button>
  );
}
