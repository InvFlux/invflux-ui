import { __ } from '@invflux/i18n';
import { useLocation } from '@solidjs/router';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { NewReception } from './NewReception';
import { ReceivingHome } from './ReceivingHome';
import { registerReceivingSources } from './registerSources';
import { receivingSource } from './sources';

// The base install's own sources, registered at chunk load through the seam an add-on uses.
registerReceivingSources();

/**
 * Receiving — where goods arriving at the door are recorded.
 *
 * A **top-level surface**, not a Procurement tab, and the split is a real one rather than tidiness:
 * receiving is a stock movement gated on the inventory capability, while Procurement is gated on
 * managing purchase orders. A floor worker who receives deliveries all day may hold the first and
 * not the second, and a merchant who builds in-house rather than buying may hide Procurement
 * altogether and still need this every day.
 *
 * Routing is by path segment rather than nested `<Route>` config, the same way the Procurement
 * sections do it: the shell mounts a surface as one component under `/<id>/*` and the surface
 * decides what to show.
 *
 *   `/receiving`             the landing lists — what is being counted, what has been received
 *   `/receiving/new`         the source chooser
 *   `/receiving/new/<id>`    that source's own flow, and anything below it
 */
export default function ReceivingSection(): JSX.Element {
  const location = useLocation();
  const segments = (): string[] => location.pathname.split('/').filter(Boolean);
  const view = (): string => segments()[1] ?? '';
  const sourceId = (): string => segments()[2] ?? '';
  // Everything below the source id belongs to the source: picking a document, counting it.
  const rest = (): string => segments().slice(3).join('/');

  return (
    <Switch fallback={<ReceivingHome />}>
      <Match when={'new' === view() && '' === sourceId()}>
        <NewReception />
      </Match>
      <Match when={'new' === view() && '' !== sourceId()}>
        {/* The surface owns its own page padding: a top-level surface is handed the bare pane. No
            back-link here — each screen's heading is a {@link ReceivingCrumbs} trail whose first
            step leads here, so the way out is the title rather than a line above it. */}
        <div class="p-4">
          <Show
            when={receivingSource(sourceId())}
            fallback={
              // A link to a source this install does not have — an add-on deactivated since the
              // link was shared, or a typed URL. Said plainly rather than rendered as an empty page.
              <p class="text-sm text-text-muted">
                {__('That way of receiving stock is not available on this site.')}
              </p>
            }
          >
            {/* A getter, not a value: Solid components run once, so a plain object would freeze
                `rest` at whatever it was on the first render and the source could never route
                within itself — picking a document would leave the picker on screen. */}
            {(source) =>
              source().component({
                get rest() {
                  return rest();
                },
              })
            }
          </Show>
        </div>
      </Match>
    </Switch>
  );
}
