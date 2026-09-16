import { __ } from '@invflux/i18n';
import { ProcurementCtx } from '@invflux/procurement/src/context';
import {
  TermsModal,
  type TermsModalTarget,
} from '@invflux/procurement/src/sections/terms/TermsModal';
import { toast } from '@invflux/ui';
import { createQuery } from '@tanstack/solid-query';
import { createEffect, type JSX, Show } from 'solid-js';
import { useApp } from '../../context';
import { procurementBootstrapQuery } from './bootstrap';

/**
 * The purchase-terms dialog opened from outside Procurement — the store settings. The dialog reads
 * what the Procurement surface gives its screens (REST root, nonce, capabilities), so this loads the
 * same bootstrap the surface does, from the same cache, and provides it around the dialog alone.
 *
 * The default export is what the settings control loads lazily: the dialog and its editor stay out
 * of the settings screen's bundle until someone opens them.
 */
export default function TermsDialogHost(props: {
  target: TermsModalTarget;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const bootstrap = createQuery(() => procurementBootstrapQuery(app));
  createEffect(() => {
    if (bootstrap.isError) {
      toast.error(__('Could not load procurement.'));
      props.onClose();
    }
  });

  return (
    <Show when={bootstrap.data}>
      {(data) => (
        <ProcurementCtx.Provider
          value={{
            ...data(),
            apiRoot: app.apiRoot,
            nonce: app.nonce,
            currentUser: app.currentUser,
          }}
        >
          <TermsModal target={props.target} onClose={props.onClose} />
        </ProcurementCtx.Provider>
      )}
    </Show>
  );
}
