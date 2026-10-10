import { __ } from '@invflux/i18n';
import { Button, SettingsSection } from '@invflux/ui';

/**
 * The Dispatch surface's settings, as foldable sections.
 *
 * Mounted by the app shell's contextual gear (`surfaceSettingsRegistry`) inside the unified app, and
 * by the queue's own modal when the SPA runs standalone — one markup, so the two hosts cannot drift
 * apart. "Manage tags…" hands off to the tag manager, closing whichever container it was mounted
 * in first.
 */
export function DispatchSettingsPanel(props: { onManageTags: () => void }) {
  return (
    <>
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
