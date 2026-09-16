import { createEffect, type JSX } from 'solid-js';

/** The elements rendered terms may contain: the structure Markdown produces, and nothing else. */
const ALLOWED = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'UL',
  'OL',
  'LI',
  'STRONG',
  'EM',
  'A',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'BR',
  'HR',
]);

/**
 * Rebuild rendered terms from an allowlist, as DOM nodes rather than as an HTML string.
 *
 * The server already renders the Markdown with raw HTML escaped and unsafe links dropped. This is the
 * second layer, so the page never trusts a string it inserts: an element outside the allowlist is
 * unwrapped to its text, a link keeps its target only when it is http(s) or mailto, and an ordered
 * list keeps only a numeric `start` — the one attribute clause numbering needs.
 */
function safeFragment(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();

  const copy = (from: Node, to: Node): void => {
    for (const child of Array.from(from.childNodes)) {
      if (Node.TEXT_NODE === child.nodeType) {
        to.appendChild(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (Node.ELEMENT_NODE !== child.nodeType) {
        continue;
      }
      const element = child as Element;
      if (!ALLOWED.has(element.tagName)) {
        copy(element, to);
        continue;
      }
      const clean = document.createElement(element.tagName.toLowerCase());
      if ('A' === element.tagName) {
        const href = element.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) {
          clean.setAttribute('href', href);
          clean.setAttribute('target', '_blank');
          clean.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if ('OL' === element.tagName) {
        const start = element.getAttribute('start') ?? '';
        if (/^\d+$/.test(start)) {
          clean.setAttribute('start', start);
        }
      }
      copy(element, clean);
      to.appendChild(clean);
    }
  };
  copy(parsed.body, out);

  return out;
}

/** Rendered terms, inserted through {@link safeFragment} — never as a raw HTML string. */
export function RenderedTerms(props: { html: string; class?: string }): JSX.Element {
  let host: HTMLDivElement | undefined;
  createEffect(() => {
    host?.replaceChildren(safeFragment(props.html));
  });

  return <div ref={host} class={props.class} />;
}
