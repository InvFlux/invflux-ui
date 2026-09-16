import { splitProps, type JSX } from 'solid-js';

/**
 * Shared inline icons.
 *
 * **Why components and not glyphs.** Much of the UI reaches for a Unicode character (`⚙`, `✕`, `▾`)
 * because it costs nothing to type. The cost shows up later: a glyph renders in the *system font*,
 * so its weight and baseline differ per platform, several of them flip to full-colour emoji on
 * Windows and macOS, and none of them can be stroked to match neighbouring iconography. Two
 * surfaces reaching for "a gear" that way end up with two different gears — which is exactly what
 * happened between the app shell and the data grid.
 *
 * So: one definition per icon, stroked with `currentColor` so it inherits the colour of whatever
 * affordance holds it (an `IconButton`'s muted-to-text hover, a coloured toast, a disabled control),
 * and sized by class so the caller controls it. Icons are decorative — the *affordance* carries the
 * accessible name (`IconButton.label`), so they are `aria-hidden` by default.
 */

export interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
  /** Size + colour classes. Default `h-4 w-4`; colour comes from `currentColor`. */
  class?: string;
}

/**
 * An icon *component*, which is how icons travel between modules — never a rendered element.
 * Solid's JSX evaluates to real DOM nodes, so a pre-built `<PrinterIcon />` stored in a long-lived
 * registry would be one node shared by every consumer, and rendering it twice would *move* it rather
 * than draw two. Passing the component defers construction to each render site.
 */
export type IconComponent = (props: IconProps) => JSX.Element;

/** Shared props for the stroked, currentColor icon set. */
function strokeProps(): JSX.SvgSVGAttributes<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
}

/**
 * Settings / options cog. The single gear in the product: the app shell's contextual settings
 * popover and the data grid's hover-revealed options button render the same one.
 */
export function GearIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * Refresh — two half-circle arrows chasing each other. Drives the workbench's re-query button;
 * spin it (`animate-spin`) while a fetch is in flight.
 */
export function RefreshIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-8.06-5" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 8.06 5" />
      <polyline points="21 3 21 8 16 8" />
      <polyline points="3 21 3 16 8 16" />
    </svg>
  );
}

/**
 * Eye — "someone is looking at this" (the viewer badge on an order).
 *
 * Deliberately an *outline* with a filled iris, not a solid silhouette. A solid one at badge size
 * loses the pupil entirely and reads as a lens or a lemon rather than an eye; the shape only says
 * "eye" when the sclera is open and a disc sits inside it. The iris is filled rather than stroked
 * because at 12px a stroked ring of this radius collapses into a smudge.
 */
export function EyeIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Pencil — "edit this in place".
 *
 * Drawn as the classic diagonal nib with a separate stroke for the tip, rather than a single
 * lozenge: at 14px a one-piece pencil reads as a stray tick mark, while the break between body and
 * point is what makes the shape legible. It carries no baseline of its own, so it sits correctly
 * beside text of any size — which the `✎` it replaces did not, sitting high in some system fonts
 * and low in others.
 *
 * The one pencil that is deliberately *not* this: `linkIcon()`'s `✏️` in the product-actions menu.
 * That is a member of a colour-emoji set (🛍️ 📖 ▦ ↗) returned as a **string** for a menu label, so
 * swapping one member for a stroked component would leave that set half-converted and mismatched.
 */
export function PencilIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/**
 * Table layout — a framed grid of rows. Used on the layout-toggle button to mean "switch **to** the
 * table view" (shown while the record view is active), pairing with {@link RecordViewIcon}: the toggle
 * always shows the layout you'll move to, matching the button's old text.
 */
export function TableViewIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="3" y1="14.5" x2="21" y2="14.5" />
    </svg>
  );
}

/**
 * Record layout — a single tall card with stacked field lines (one record, fields as rows). Used on
 * the layout-toggle to mean "switch **to** the record view"; the card metaphor keeps it distinct from
 * both {@link TableViewIcon}'s rows and {@link ColumnsSettingsIcon}'s columns.
 */
export function RecordViewIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <rect x="6.5" y="3.5" width="11" height="17" rx="1.5" />
      <line x1="9.5" y1="7.5" x2="14.5" y2="7.5" />
      <line x1="9.5" y1="11" x2="14.5" y2="11" />
      <line x1="9.5" y1="14.5" x2="14.5" y2="14.5" />
    </svg>
  );
}

/**
 * Open-in-workbench — a small grid with an arrow leaving it top-right. The grid echoes the workbench's
 * `▦` mark; the out-arrow marks it as navigation to another surface (not an in-place toggle).
 */
export function WorkbenchLinkIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <rect x="3" y="9" width="12" height="12" rx="1.5" />
      <line x1="9" y1="9" x2="9" y2="21" />
      <line x1="3" y1="15" x2="15" y2="15" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <polyline points="15.5 3 21 3 21 8.5" />
    </svg>
  );
}

/**
 * Column settings — a columns grid with a small cog, for the "choose columns" button (a *settings*
 * affordance, not just a columns view). Distinct cog corner keeps it apart from {@link RecordViewIcon}.
 */
export function ColumnsSettingsIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      {/* Lucide `columns-3-cog` (a columns frame with a settings cog), flipped vertically
          (matrix 1 0 0 -1 0 24) so the cog — and the open corner it sits in — land at the top-right
          instead of the bottom-right. */}
      <g transform="matrix(1 0 0 -1 0 24)">
        <path d="M10.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.5m-6.7 9.1l1-.4M15 3v7.5m.2 6.4l-.9-.3m2.3 5.1l.3-.9m-.1-5.5l-.4-1m2.7.9l.3-.9m.2 7.4l-.4-1m1.5-3.9l1-.4m0 3l-.9-.3M9 3v18" />
        <circle cx="18" cy="18" r="3" />
      </g>
    </svg>
  );
}

/** Printer — send the on-screen document to paper (or the browser's "save as PDF"). */
export function PrinterIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

/**
 * Download — an arrow dropping into a tray. Marks every action that puts a *file* in the operator's
 * hands, whatever the format, so one mark covers the whole family.
 */
export function DownloadIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Copy — two offset sheets, for "duplicate this into a new one". */
export function CopyIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Tag with an eyelet — a document being *given its reference*. Used for assigning the purchase-order
 * number: a label attached to a thing, which is exactly what minting a document number is.
 */
export function TagIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

/**
 * Outbound envelope — *recording* that a document went out, not transmitting it. An envelope with a
 * rising arrow reads as "it has gone"; a paper plane would over-promise the sending, which InvFlux
 * does not do at this tier.
 */
export function SentIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M21 11.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" />
      <polyline points="3 7 12 13 21 7" />
      <line x1="18" y1="21" x2="18" y2="14" />
      <polyline points="15 17 18 14 21 17" />
    </svg>
  );
}

/** Delivery truck — goods on their way to us. */
export function TruckIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M3 16V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10" />
      <path d="M14 9h3.6a1 1 0 0 1 .8.4l2.4 3.2a1 1 0 0 1 .2.6V16" />
      <circle cx="7.5" cy="17.5" r="2" />
      <circle cx="17.5" cy="17.5" r="2" />
      <line x1="9.5" y1="17.5" x2="15.5" y2="17.5" />
    </svg>
  );
}

/** Carton — a delivery being opened and counted in. */
export function PackageIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </svg>
  );
}

/** Plain cross — dismissal and cancellation. Replaces the `✕` glyph so it strokes like its neighbours. */
export function CloseIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * Hourglass — something is waiting on a person, not on the system.
 *
 * Distinct from {@link Spinner}, and the distinction is the point: a spinner says the software is
 * working and will finish on its own, whereas this says nothing will change until someone acts. The
 * two must never stand in for each other, or an operator waits for a machine that is waiting for
 * them.
 *
 * Drawn rather than borrowed from the `⏳` character for the reason this whole module exists: that
 * codepoint is emoji-presentation by default, so it renders full-colour and ignores the
 * `currentColor` of the affordance holding it — inside a tinted pill it stays its own colour while
 * everything around it takes the tone.
 */
export function HourglassIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <line x1="6" y1="2" x2="18" y2="2" />
      <line x1="6" y1="22" x2="18" y2="22" />
      <path d="M6 2v4.5L12 12l6-5.5V2" />
      <path d="M6 22v-4.5L12 12l6 5.5V22" />
    </svg>
  );
}

/**
 * Information — an explanation is available for the thing beside it.
 *
 * Drawn rather than borrowed from `ⓘ`, and this one is the clearest case in the module. A glyph is
 * *type*: the ring and the letter are one filled shape whose counter — the space inside the circle —
 * is a hole showing whatever is behind it. On a tinted page that hole fills with the page, so the
 * mark reads as an outline stamped on the ground rather than a badge sitting on it. The usual patch
 * is a background on the element holding it, which paints a **rectangle** behind a **circle** and
 * looks exactly like what it is.
 *
 * A stroked circle has no counter to fill, inherits {@link IconProps} `currentColor` like every
 * neighbour, and can be given a fill of its own if a surface ever needs one — none of which the
 * codepoint can do.
 */
export function InfoIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      {/* Centred in the box like every other icon here. It is deliberately NOT nudged upward to
          suit one caller: an icon that carries a caller's optical correction inside its artwork
          looks wrong in every other caller, and silently, since nothing at the call site explains
          it. {@see Hint} owns its own seating. */}
      <circle cx="12" cy="12" r="9" />
      {/* Stem then dot, both stroked: `stroke-linecap: round` renders the zero-length dot as a
          circle, so the `i` keeps the same weight and terminals as the ring around it. */}
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/** Archive box — the terminal put-it-away action (a lidded crate, distinct from {@link PackageIcon}). */
export function ArchiveIcon(props: IconProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <svg {...strokeProps()} {...rest} class={local.class ?? 'h-4 w-4'}>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
