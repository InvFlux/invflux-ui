/**
 * Register a stylesheet's `@property` rules on the **document**, because a shadow root cannot.
 *
 * **Custom-property registration is document-scoped.** An `@property` rule inside a sheet that is
 * only ever adopted by a shadow root does not register at all: the rule parses, `cssRules` reports
 * it, and `getComputedStyle(el).getPropertyValue('--tw-border-style')` still answers `""`. Nothing
 * warns. So this cannot be left to the sheet that declares them.
 *
 * **What breaks without it is not obvious from the symptom.** Tailwind v4 compiles `border` to
 * `border-style: var(--tw-border-style); border-width: 1px`, with the style supplied by a registered
 * property whose `initial-value` is `solid`. Unregistered, that `var()` is *guaranteed-invalid*, so
 * `border-style` falls back to `none` — and a `none` style makes the **used** border width `0`
 * whatever the specified width says. The result is that `border` silently paints nothing, while the
 * class is present, the rule is in the sheet, and the computed width reads `0px` as if someone had
 * asked for that. Forty-nine `--tw-*` properties ride on the same mechanism (transforms, shadows,
 * gradients, ring), so the failure is broad and looks like several unrelated bugs.
 *
 * Extracted from the live sheet rather than hand-listed: the set is whatever Tailwind emitted for
 * the classes actually used, so a hand-maintained copy would drift the first time someone adds a
 * `rotate-` or `shadow-` utility.
 *
 * Nothing here paints. An `@property` rule gives a custom property a syntax and an initial value; it
 * matches no element and sets no declaration on one, so registering document-wide leaks no styling
 * into the host page — which is what makes this safe to do from a page that otherwise keeps all of
 * its CSS inside its own shadow roots.
 */
let adopted: CSSStyleSheet | undefined;

export function registerCssPropertyRules(source: CSSStyleSheet): void {
  // Older engines, and any environment without the Properties and Values API: nothing to hoist, and
  // the utilities that depend on it degrade the same way they would have anyway.
  if (typeof CSSPropertyRule === 'undefined') return;

  const rules: string[] = [];
  for (const rule of source.cssRules) {
    if (rule instanceof CSSPropertyRule) rules.push(rule.cssText);
  }
  if (rules.length === 0) return;

  const css = rules.join('\n');
  // One sheet, replaced in place rather than appended to. A hot stylesheet update re-runs this, and
  // pushing a second sheet each time would grow `document.adoptedStyleSheets` without bound — with
  // every copy registering the same names, so the leak would be invisible until it was large.
  if (adopted !== undefined) {
    adopted.replaceSync(css);

    return;
  }

  adopted = new CSSStyleSheet();
  adopted.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];
}
