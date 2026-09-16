import { Match, Switch, type JSX } from 'solid-js';
import { __ } from '@invflux/i18n';
import { IconButton } from './IconButton';
import { currentThemeMode, cycleThemeMode, nextThemeMode, type ThemeMode } from './theme';

/**
 * One button that cycles appearance: follow-the-system → light → dark → follow-the-system.
 *
 * **A cycle, not a light/dark toggle.** A toggle can express two of the three states, so whoever
 * turns dark on can never go back to following their OS without hunting for a reset somewhere else.
 * Making `auto` a stop on the cycle puts it at most two clicks from anywhere, and the tooltip names
 * both where you are and where the next click goes — which is the part a cycling control usually
 * gets wrong.
 *
 * **The glyph shows where the next click GOES, not where you are.** It is a button, so it is
 * labelled with its effect the way "Save" is — a sun means *switch to light*, not *you are in
 * light*. The three glyphs still stand for the three preferences and never for the resolved
 * appearance: `auto` keeps its own half-filled disc, so "follow my OS" is never drawn as a sun that
 * `light` also uses. The tooltip names both ends — where you are and where you are going — which is
 * the part a cycling control usually leaves out, and the part that makes one glyph unambiguous.
 *
 * The glyph is chosen by {@link nextThemeMode}, the same function the click calls, so the picture
 * and the action cannot drift apart.
 */
export function ThemeSwitcher(props: { size?: 'sm' | 'md' }): JSX.Element {
  // Current mode + where the next click goes, as one sentence each: assembling this from fragments
  // would hand translators two half-phrases with no way to agree gender or order.
  const label = (): string => {
    const mode: ThemeMode = currentThemeMode();
    if ('light' === mode) return __('Appearance: light. Switch to dark.');
    if ('dark' === mode) return __('Appearance: dark. Switch to following your system.');

    return __('Appearance: following your system. Switch to light.');
  };

  return (
    <IconButton
      size={props.size ?? 'sm'}
      label={label()}
      onClick={() => cycleThemeMode()}
      aria-live="polite"
    >
      <Switch>
        <Match when={'light' === nextThemeMode()}>
          {/* Sun */}
          <svg
            viewBox="0 0 16 16"
            class="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          >
            <circle cx="8" cy="8" r="3.1" />
            <path
              stroke-linecap="round"
              d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3M12.9 12.9l-1.3-1.3M4.4 4.4L3.1 3.1"
            />
          </svg>
        </Match>
        <Match when={'dark' === nextThemeMode()}>
          {/* Crescent */}
          <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true" fill="currentColor">
            <path d="M13.4 10.2A5.9 5.9 0 0 1 5.8 2.6a6 6 0 1 0 7.6 7.6Z" />
          </svg>
        </Match>
        <Match when={'auto' === nextThemeMode()}>
          {/* Half-filled disc — auto's own glyph, deliberately neither sun nor moon. */}
          <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
            <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" />
            <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" />
          </svg>
        </Match>
      </Switch>
    </IconButton>
  );
}
