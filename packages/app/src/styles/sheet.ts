import styles from './app.css?inline';

/**
 * The app's stylesheet, owned as its own module so it can be **its own HMR boundary**.
 *
 * Why this exists rather than importing the CSS straight into `main.tsx`: a `?inline` import has no
 * accept handler of its own, so a stylesheet edit propagates to whoever imported it. Imported by the
 * entry — which deliberately does not self-accept, see the note at the end of main.tsx's mount() —
 * that means Vite falls back to a full page reload for every CSS change. Owning the boundary here
 * stops the update at the stylesheet and swaps the CSS in place instead.
 *
 * The trick is that the live `CSSStyleSheet` object must survive the module's own re-execution:
 * `adoptedStyleSheets` holds a *reference*, so a fresh sheet would leave every mounted shadow root
 * pointing at the old one. `import.meta.hot.data` carries it across, and `replaceSync` updates the
 * sheet the document is already using.
 *
 * None of the HMR machinery survives a build — `import.meta.hot` is statically undefined there, so
 * this is a plain "make a sheet, hand it out" module in production.
 */

/** The single adopted stylesheet, preserved across hot updates of this module. */
const sheet: CSSStyleSheet = import.meta.hot?.data.sheet ?? new CSSStyleSheet();

if (import.meta.hot) {
  import.meta.hot.data.sheet = sheet;
}

sheet.replaceSync(styles);

/** The stylesheet to adopt into a shadow root. Always the same object, so hot swaps reach it. */
export function appStyleSheet(): CSSStyleSheet {
  return sheet;
}
