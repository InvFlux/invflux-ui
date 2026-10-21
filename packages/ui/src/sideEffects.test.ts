import { describe, expect, it } from 'vitest';

/**
 * Every module that registers something at load time is listed in `package.json`'s `sideEffects`.
 *
 * `sideEffects` is an allowlist, so a production build drops any module that is only ever imported
 * for its effect (`import './settings/orderedTogglesControl'`) and is not on it — the control, view
 * or filter it registers is then simply missing, and the setting falls back to a raw editor. The dev
 * server does not tree-shake, so nothing shows until the release bundle. This reads the source
 * instead: a line that *starts* with a registry's `register(` call, or a top-level `registerX(`
 * call, is a load-time registration.
 *
 * The sources come through Vite's `import.meta.glob` as raw text rather than `node:fs`: this package
 * ships to a browser and carries no Node types.
 */
const TOP_LEVEL_REGISTRATION = /^(\w+[Rr]egistry\.register\(|register[A-Z]\w*\()/m;

/** Every source module under `src/`, keyed `./relative/path.tsx` from this directory. */
const sources = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const packageJson = Object.values(
  import.meta.glob<string>('../package.json', { query: '?raw', import: 'default', eager: true }),
)[0];

describe('package.json sideEffects', () => {
  it('lists every module that registers something when it loads', () => {
    const listed = new Set((JSON.parse(packageJson ?? '{}') as { sideEffects?: string[] }).sideEffects ?? []);
    const registering = Object.entries(sources)
      .filter(([, text]) => TOP_LEVEL_REGISTRATION.test(text))
      .map(([path]) => `./src/${path.slice(2)}`);

    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(registering.length).toBeGreaterThan(0);
    expect(registering.filter((path) => !listed.has(path))).toEqual([]);
  });
});
