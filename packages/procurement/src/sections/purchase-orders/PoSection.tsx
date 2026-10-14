import { useLocation, useNavigate } from '@solidjs/router';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { NewPoModal } from './NewPoModal';
import { PoDetail } from './PoDetail';
import { PoList } from './PoList';

/**
 * Purchase-orders section router. Mounts at `/purchase-orders/*` (App.tsx) and dispatches on the
 * path: the list (fallback), the list with the new-order dialog over it (`/new`), and the detail
 * (`/:id`). `/new` stays a route so a link or a bookmark to it still opens the dialog.
 */
export function PoSection(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const rest = (): string => location.pathname.split('/').filter(Boolean)[1] ?? '';

  return (
    <Switch fallback={<PoList />}>
      <Match when={'new' === rest()}>
        <PoList />
        <Show when={'new' === rest()}>
          <NewPoModal onClose={() => navigate(`/purchase-orders${location.search}`)} />
        </Show>
      </Match>
      <Match when={'' !== rest()}>
        <PoDetail id={rest()} />
      </Match>
    </Switch>
  );
}
