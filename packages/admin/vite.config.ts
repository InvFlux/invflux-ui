/**
 * Vitest config only — this package produces no bundle.
 *
 * Its surface is hosted by the unified app (`@invflux/app`), which imports these sections from
 * source; this package has no standalone mount point (`src/main.tsx`) or `build`/`dev` script of
 * its own. What is load-bearing here is what the factory hands
 * **vitest**, which reads this file: `vite-plugin-solid` (JSX in tests) and the Tailwind plugin.
 * The `surface`/`globalName` below feed the bundle half of the factory and are inert — kept so
 * the config stays a one-liner if this package ever needs its own build again.
 */
import { createInvFluxViteConfig } from '@invflux/build';

export default createInvFluxViteConfig({
  surface: 'admin',
  globalName: 'InvFluxAdmin',
});
