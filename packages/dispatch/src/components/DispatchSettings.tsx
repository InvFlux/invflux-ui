import { __, _x, formatNumber } from '@invflux/i18n';
import { Button, SettingsSection } from '@invflux/ui';
import { For } from 'solid-js';

/**
 * Page-size choices for the queue. Deliberately the same ladder as the Workbench's
 * `LOAD_SIZE_OPTIONS`, so the two list surfaces offer one vocabulary rather than two.
 */
export const LOAD_SIZE_OPTIONS = [50, 100, 200, 500, 1000, 2000];
export const DEFAULT_PER_PAGE = 50;

/** Read `per_page` off the URL, falling back to the default for anything not on the ladder. */
export function parsePerPage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PER_PAGE;
  return LOAD_SIZE_OPTIONS.includes(n) ? n : DEFAULT_PER_PAGE;
}

const fmt = (n: number): string => formatNumber(n);

/**
 * The Dispatch surface's settings, as foldable sections.
 *
 * Mounted by the app shell's contextual gear (`surfaceSettingsRegistry`) inside the unified app, and
 * by the queue's own modal when the SPA runs standalone — one markup, so the two hosts cannot drift
 * apart. Page size applies instantly (it is a URL preference, not a save flow), and "Manage tags…"
 * hands off to the tag manager, closing whichever container it was mounted in first.
 */
export function DispatchSettingsPanel(props: {
  perPage: number;
  onPerPage: (n: number) => void;
  onManageTags: () => void;
}) {
  return (
    <>
      <SettingsSection
        title={_x('Display', 'settings section heading: how things are shown (noun)')}
      >
        <label class="flex items-center justify-between gap-4">
          <span class="text-sm text-text">{__('Page size')}</span>
          <select
            class="h-9 min-w-40 rounded border border-border bg-surface px-2 text-sm shadow-sm"
            value={String(props.perPage)}
            onChange={(e) => props.onPerPage(Number(e.currentTarget.value))}
          >
            <For each={LOAD_SIZE_OPTIONS}>
              {(size) => <option value={String(size)}>{fmt(size)}</option>}
            </For>
          </select>
        </label>
      </SettingsSection>

      <SettingsSection title={__('Tags')}>
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-text">{__('Order tags')}</span>
          <Button variant="secondary" size="sm" onClick={() => props.onManageTags()}>
            {__('Manage tags…')}
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
