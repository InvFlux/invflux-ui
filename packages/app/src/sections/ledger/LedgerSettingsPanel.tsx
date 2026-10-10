import { _x } from '@invflux/i18n';
import { SettingsSection, Switch } from '@invflux/ui';
import { For, type JSX } from 'solid-js';
import { displayOptions, type LedgerDisplay } from './ledgerDisplay';

/**
 * The stock ledger's own panel in the app shell's contextual gear.
 *
 * Every option here changes how this reader sees the page and nothing else — no request is made, no
 * other reader is affected — so each takes effect as it is flipped, with nothing to save and nothing
 * to undo. That is why they are switches with hints rather than a form: the page behind the popover
 * answers immediately, which is a better explanation than any wording in the hint.
 */
export function LedgerSettingsPanel(props: {
  display: () => LedgerDisplay;
  onChange: (patch: Partial<LedgerDisplay>) => void;
}): JSX.Element {
  return (
    <SettingsSection title={_x('Display', 'settings section heading: how things are shown (noun)')}>
      <For each={displayOptions()}>
        {(option) => (
          <div class="flex items-start justify-between gap-4 py-1.5">
            <div class="min-w-0">
              <p class="text-sm text-text">{option.label}</p>
              <p class="mt-0.5 text-xs text-text-muted">{option.hint}</p>
            </div>
            <div class="shrink-0 pt-0.5">
              <Switch
                checked={props.display()[option.key]}
                ariaLabel={option.label}
                onChange={(checked) => props.onChange({ [option.key]: checked })}
              />
            </div>
          </div>
        )}
      </For>
    </SettingsSection>
  );
}
