import { createSignal, type Accessor } from 'solid-js';

/**
 * Light / dark / auto, stamped as `data-theme` on every root the SPA styles.
 *
 * **Two roots, not one.** The SPA renders in a shadow root, and Kobalte's Select and Combobox and
 * every `mount`-ed Modal portal into a *second* one. Stamp only the first and those overlays keep
 * the other theme — so a root registers itself here and the stamp follows it. Both are matched by
 * `:host` in `styles/theme.css`, since both adopt that sheet.
 *
 * **`auto` is a stored value, not the absence of one.** It means "follow the OS", which the
 * stylesheet resolves via `prefers-color-scheme`; the alternative — treating "no preference" as auto
 * — makes "back to auto" impossible to express once someone has chosen, which is the state a theme
 * switcher most needs to offer.
 *
 * Persisted per browser rather than per account, deliberately: `auto` follows *this device's* OS, so
 * the preference is device-scoped by nature. That also matches every other display preference here
 * (grid density, text size, workspace layout), none of which round-trips to the server.
 */
export type ThemeMode = 'auto' | 'light' | 'dark';

/** Cycle order for the switcher. `auto` leads because it is the default and the one to return to. */
export const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark'];

const STORAGE_KEY = 'invflux:theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return 'auto' === value || 'light' === value || 'dark' === value;
}

/** The stored preference, or `auto`. Storage can throw outright (private mode), never just return null. */
function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return isThemeMode(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

const [themeMode, setModeSignal] = createSignal<ThemeMode>(readStoredMode());

/** The active preference. `auto` here means "follow the OS", not "resolved to light". */
export const currentThemeMode: Accessor<ThemeMode> = themeMode;

/**
 * Roots to stamp. Held weakly-ish by a Set the caller adds to at mount; the SPA outlives every
 * root it registers, so there is nothing to unregister in practice.
 */
const roots = new Set<HTMLElement>();

/** Register a root (shadow host or portal root) and stamp it immediately. */
export function registerThemeRoot(root: HTMLElement | null | undefined): void {
  if (!root) return;
  roots.add(root);
  root.setAttribute('data-theme', themeMode());
}

/** Set the preference, stamp every root, and persist it. */
export function setThemeMode(mode: ThemeMode): void {
  setModeSignal(mode);
  for (const root of roots) root.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / quota — the choice still applies for this page's lifetime */
  }
}

/**
 * The mode one click away — where {@link cycleThemeMode} would go from here.
 *
 * Exported because the switcher draws the mode it is *about to* select, so the glyph order and the
 * cycle order are the same fact. Deriving them separately is how a control ends up promising one
 * thing and doing another.
 */
export function nextThemeMode(mode: ThemeMode = themeMode()): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]!;
}

/**
 * Advance to the next mode and return it.
 *
 * A cycle rather than a light/dark toggle, because a toggle strands whoever wants to go back to
 * following their OS: it is reachable from every position in at most two clicks, instead of being a
 * reset hidden somewhere else.
 */
export function cycleThemeMode(): ThemeMode {
  const next = nextThemeMode();
  setThemeMode(next);

  return next;
}
