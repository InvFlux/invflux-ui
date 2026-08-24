import { createSignal } from 'solid-js';
import { welcomePage } from './welcomeCatalog';

/**
 * Which plugins' **welcome screens are still outstanding** — seeded from the boot context before
 * mount (like {@link ./capabilities.ts} and {@link ./surfaces.ts}), then owned by the app.
 *
 * A list of slugs rather than a boolean because each family plugin has a first run of its own: an
 * add-on activated months after the base still has its own screen to offer, and settling one says
 * nothing about the others.
 *
 * Unlike capabilities and surface modes, this one is *reactive*: a welcome screen settles (adopted,
 * declined, nothing to do) without a page load, and the shell must stop diverting landing visits to
 * it the moment it does. A plain value read from the static context would keep re-routing until the
 * next reload, which reads as "the wizard won't let me leave".
 *
 * The server flags remain the authority — this signal only mirrors them for the page's lifetime.
 */
const [pendingWelcomes, setPendingWelcomes] = createSignal<readonly string[]>([]);

export { pendingWelcomes };

/** Seed from the boot context, before mount. */
export function setOnboarding(onboarding: { pending?: readonly string[] } | undefined): void {
  setPendingWelcomes(onboarding?.pending ?? []);
}

/**
 * The welcome screen a landing visit should be diverted to, if any: the first outstanding one that is
 * actually **installed here**.
 *
 * The two halves can disagree — the server knows an add-on armed its flag, but the screen itself
 * lives in that add-on's own bundle, which a deactivation removes without clearing anything. Skipping
 * a slug with no registered page keeps that case a no-op rather than a redirect into a blank route.
 */
export const nextWelcome = (): string | undefined =>
  pendingWelcomes().find((slug) => undefined !== welcomePage(slug));

/** This plugin's welcome is settled — completed, declined, or it had nothing to offer. */
export function markWelcomeSettled(slug: string): void {
  setPendingWelcomes((prev) => prev.filter((s) => s !== slug));
}
