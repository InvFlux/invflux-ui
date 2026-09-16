/**
 * Headings, lists and paragraphs of rendered terms, sized for a page of form controls — shared by every
 * place terms are previewed and by the formatting help, so the help shows what a preview will.
 */
export const TERMS_TYPOGRAPHY =
  '[&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-primary [&_a]:underline';

/**
 * Rendered terms in their box: the typography on a bordered surface. Capped at the same share of the
 * window as the text box, and scrolling past it, so a long text never pushes the buttons under it out
 * of view.
 */
export const RENDERED = `max-h-[45vh] overflow-y-auto rounded border border-slate-200 bg-surface p-4 text-sm ${TERMS_TYPOGRAPHY}`;
