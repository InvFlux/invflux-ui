import { useLocation } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import { SupplierDetail } from './SupplierDetail';
import { SuppliersList } from './SuppliersList';

/**
 * Suppliers section router. The section mounts at `/suppliers/*` (App.tsx); we dispatch on the
 * path segments rather than nested `<Route>` config (the registry hands the shell a flat
 * component). `/suppliers` → list; `/suppliers/:id[/:tab]` → detail. `useLocation` is reactive,
 * so navigating between list and detail re-renders here.
 */
export function SuppliersSection(): JSX.Element {
  const location = useLocation();
  const supplierId = (): string | null => location.pathname.split('/').filter(Boolean)[1] ?? null;

  return (
    <Show when={supplierId()} fallback={<SuppliersList />}>
      {(id) => <SupplierDetail id={id()} />}
    </Show>
  );
}
