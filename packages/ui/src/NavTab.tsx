import { A } from '@solidjs/router';
import { splitProps, type JSX } from 'solid-js';
import { cx, navTabClasses, type NavTabVariant } from './primitives';

export interface NavTabProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Default `surface` — the shell's own row. Pass `section` for a surface's inner row. */
  variant?: NavTabVariant;
  /**
   * The tab's surface holds unsaved work. Tints it amber — and **takes the active fill away**,
   * because both are backgrounds and only one of them can render.
   *
   * Deciding that here is the point. Emitting `bg-primary/10` and `bg-yellow-100` together and
   * letting a winner emerge is not an override: Tailwind resolves conflicting utilities by
   * stylesheet order, never by the order they appear on the element, so which one shows would be a
   * property of the generated sheet rather than of this code. (The same trap as the split action
   * button's radius — see `primitives.ts`.) Unsaved work is the more urgent signal and takes it;
   * the tab still reads as active from its border, colour and casing.
   */
  dirty?: boolean;
  /** Exact-match the route rather than prefix-match it (solid-router's `end`). */
  end?: boolean;
}

/**
 * One tab in a navigation row — a router `<A>` wearing the house tab look.
 *
 * It owns the *look* and the active-vs-dirty precedence, and nothing else. The rows themselves are
 * far too different to share a component — the shell's has two groups, drag-reorder with insertion
 * markers, close buttons and resume-hrefs, while a surface's is a flat list — so they stay where
 * they are and agree only on this.
 *
 * Everything else is forwarded, so a call site still attaches drag handlers, extra `classList`
 * entries and ARIA exactly as if it were writing the `<A>` itself.
 */
export function NavTab(props: NavTabProps): JSX.Element {
  const [local, rest] = splitProps(props, ['variant', 'dirty', 'class', 'classList', 'children']);
  const classes = (): ReturnType<typeof navTabClasses> =>
    navTabClasses(local.variant ?? 'surface', true === local.dirty);

  return (
    <A
      {...rest}
      class={cx(classes().class, local.class)}
      inactiveClass={classes().inactiveClass}
      activeClass={classes().activeClass}
      // `A` merges a caller's classList into its own, so the dirty tint composes with whatever the
      // call site adds (drag opacity today, whatever a future row needs).
      classList={{ ...(local.classList ?? {}), 'bg-yellow-100': true === local.dirty }}
    >
      {local.children}
    </A>
  );
}
