import { __, sprintf } from '@invflux/i18n';

/**
 * The first free name for a copy of `original`: "Copy of X", then "Copy (2) of X", "Copy (3) of X"…
 *
 * `taken` must hold every set's name, archived ones included — an archived set keeps its name — and
 * the comparison ignores case, as the server's does.
 */
export function freeCopyName(original: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLocaleLowerCase()));
  for (let attempt = 1; ; attempt += 1) {
    const candidate =
      1 === attempt
        ? /* translators: %s: the name of the terms being copied */
          sprintf(__('Copy of %s'), original)
        : /* translators: 1: which copy this is, counting from 2; 2: the name of the terms being copied */
          sprintf(__('Copy (%1$d) of %2$s'), attempt, original);
    if (!used.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
}
