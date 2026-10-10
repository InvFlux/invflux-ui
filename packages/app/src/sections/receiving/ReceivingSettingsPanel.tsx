import { __, _x } from '@invflux/i18n';
import { SettingsSection, Switch } from '@invflux/ui';
import type { JSX } from 'solid-js';
import { fullPrecision, setFullPrecision } from './costText';

/**
 * Receiving's own panel in the app shell's contextual gear. Display only: it changes how this reader
 * sees the figures and nothing else, so it takes effect as it is flipped.
 */
export function ReceivingSettingsPanel(): JSX.Element {
  return (
    <SettingsSection title={_x('Display', 'settings section heading: how things are shown (noun)')}>
      <div class="flex items-start justify-between gap-4 py-1.5">
        <div class="min-w-0">
          <p class="text-sm text-text">{__('Show calculated costs in full')}</p>
          <p class="mt-0.5 text-xs text-text-muted">
            {__(
              'Average costs, values and converted costs are rounded to the currency’s decimals. Turn this on to see them as stored, to four decimal places. Prices as stated always show in full.',
            )}
          </p>
        </div>
        <div class="shrink-0 pt-0.5">
          <Switch
            checked={fullPrecision()}
            ariaLabel={__('Show calculated costs in full')}
            onChange={(checked) => setFullPrecision(checked)}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
