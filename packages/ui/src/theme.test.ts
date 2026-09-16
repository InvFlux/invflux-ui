import { describe, expect, it } from 'vitest';
import { THEME_MODES, nextThemeMode, type ThemeMode } from './theme';

/**
 * The switcher draws the mode it is about to select, so the glyph and the click are the same fact.
 * `nextThemeMode` is that fact, and this is what keeps it single: the button calls it to pick a
 * picture, `cycleThemeMode` calls it to pick a destination, and neither owns a second copy of the
 * order. A control that promises one thing and does another is the failure this rules out.
 */
describe('nextThemeMode', () => {
  it('advances one step along the declared order', () => {
    expect(nextThemeMode('auto')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('auto');
  });

  it('returns to where it started after one full lap, from any starting point', () => {
    // A cycle, not a toggle: `auto` has to be reachable again or choosing dark once would strand
    // the user off their OS setting for good.
    for (const start of THEME_MODES) {
      let mode: ThemeMode = start;
      for (let i = 0; i < THEME_MODES.length; i++) mode = nextThemeMode(mode);
      expect(mode).toBe(start);
    }
  });

  it('visits every mode exactly once per lap, so none is unreachable', () => {
    // Guards the ordering array itself: a duplicated or dropped entry would still cycle, and would
    // still pass the two assertions above for some starting points.
    const seen: ThemeMode[] = [];
    let mode: ThemeMode = 'auto';
    for (let i = 0; i < THEME_MODES.length; i++) {
      mode = nextThemeMode(mode);
      seen.push(mode);
    }
    expect([...seen].sort()).toEqual([...THEME_MODES].sort());
  });
});
