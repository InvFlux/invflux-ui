import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_LEVEL_REGISTRATION = /^(\w+[Rr]egistry\.register\(|register[A-Z]\w*\()/m;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);

    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('package.json sideEffects', () => {
  it('lists every module that registers something when it loads', () => {
    const listed = new Set(
      (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { sideEffects: string[] })
        .sideEffects,
    );
    const registering = sources(join(root, 'src'))
      .filter((path) => TOP_LEVEL_REGISTRATION.test(readFileSync(path, 'utf8')))
      .map((path) => `./${relative(root, path)}`);

    expect(registering.length).toBeGreaterThan(0);
    expect(registering.filter((path) => !listed.has(path))).toEqual([]);
  });
});
