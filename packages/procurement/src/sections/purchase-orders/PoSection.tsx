import { useLocation } from '@solidjs/router';
import { type JSX, Match, Switch } from 'solid-js';
import { PoCreate } from './PoCreate';
import { PoDetail } from './PoDetail';
import { PoList } from './PoList';

/**
 * Purchase-orders section router. Mounts at `/purchase-orders/*` (App.tsx) and dispatches on the
 * path: list (fallback), the create form (`/new`), and the detail (`/:id`).
 */
export function PoSection(): JSX.Element {
  const location = useLocation();
  const rest = (): string => location.pathname.split('/').filter(Boolean)[1] ?? '';

  return (
    <Switch fallback={<PoList />}>
      <Match when={'new' === rest()}>
        <PoCreate />
      </Match>
      <Match when={'' !== rest()}>
        <PoDetail id={rest()} />
      </Match>
    </Switch>
  );
}
