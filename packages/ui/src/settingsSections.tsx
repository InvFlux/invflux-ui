import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  untrack,
  useContext,
} from 'solid-js';
import { arrangeColumns, moveInOrder } from './grid/columnModel';
import { isStringArray, isVisibility } from './grid/gridStorage';

/** Which side of its target a dragged section would land on. */
export type DropEdge = 'before' | 'after';

/**
 * What the gear's {@link SettingsSection}s share while one surface's panels are open: which sections
 * are folded, in what order they sit, and the state of a drag that is rearranging them.
 */
export interface SettingsSectionsHost {
  /** The stored fold state for a section, `undefined` while the reader has never toggled it. */
  openState: (id: string) => boolean | undefined;
  setOpen: (id: string, open: boolean) => void;
  /** Announce a mounted section. The returned function withdraws it. Announcement order is the default order. */
  register: (id: string) => () => void;
  /** The section's place among those mounted, 0 first. */
  rank: (id: string) => number;
  /** More than one section is mounted, so there is something to reorder. */
  reorderable: () => boolean;
  /** True while a drag is under way: every section shows folded, without the stored state changing. */
  folding: () => boolean;
  startDrag: (id: string) => void;
  dragOver: (id: string) => void;
  drop: (id: string) => void;
  endDrag: () => void;
  isDragging: (id: string) => boolean;
  /** Where the dragged section would land relative to `id`, when `id` is the live drop target. */
  dropEdge: (id: string) => DropEdge | null;
}

const SettingsSectionsContext = createContext<SettingsSectionsHost>();

/** The host of the sections being rendered, or `undefined` outside a gear (a standalone settings modal). */
export function useSettingsSections(): SettingsSectionsHost | undefined {
  return useContext(SettingsSectionsContext);
}

/** A signal that keeps its value in `localStorage`; storage that is unreadable or unwritable leaves it in memory. */
function storedSignal<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [() => T, (next: T) => void] {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (null !== raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) initial = parsed;
    }
  } catch {
    /* unreadable or malformed — the fallback is already correct */
  }
  const [get, set] = createSignal<T>(initial);
  createEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(get()));
    } catch {
      /* quota or private mode — the arrangement lasts for the session */
    }
  });

  return [get, (next) => set(() => next)];
}

/**
 * Remembers how one surface's gear sections are arranged: which are folded and in what order.
 *
 * The gear does not own its sections — each panel a surface registers renders its own — so this
 * only supplies the arrangement through context, and a section that finds no provider (the same
 * panel inside a standalone modal) keeps its plain local fold. Both pieces are stored per surface
 * and per browser, like the tables' column choices.
 *
 * **A stored order is merged with the sections present, never filtered by them.** A section that is
 * absent for a while (an add-on switched off) keeps its saved place, and one the reader has never
 * seen lands after the arranged ones.
 *
 * **A drag folds every section, and none of that is stored.** Dragging a tall open section past
 * others is awkward, so the sections show folded for the length of the drag and take their own
 * state back on drop. The fold is deferred one tick because a browser cancels a drag whose source
 * is rearranged inside the `dragstart` event.
 */
export function SettingsSectionsProvider(props: {
  surfaceId: string;
  children: JSX.Element;
}): JSX.Element {
  // The arrangement belongs to the surface the provider was made for; the gear remounts it per surface.
  const prefix = `invflux:gear:${untrack(() => props.surfaceId)}`;
  const [fold, setFold] = storedSignal<Record<string, boolean>>(`${prefix}:fold`, {}, isVisibility);
  const [stored, setStored] = storedSignal<string[]>(`${prefix}:order`, [], isStringArray);
  const [registered, setRegistered] = createSignal<string[]>([]);
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [target, setTarget] = createSignal<string | null>(null);
  const [folding, setFolding] = createSignal(false);
  let foldTimer: ReturnType<typeof setTimeout> | undefined;

  const arranged = createMemo(() =>
    arrangeColumns(
      registered().map((id) => ({ id })),
      stored(),
    ).map((entry) => entry.id),
  );

  const endDrag = (): void => {
    clearTimeout(foldTimer);
    setDragging(null);
    setTarget(null);
    setFolding(false);
  };

  const host: SettingsSectionsHost = {
    openState: (id) => fold()[id],
    setOpen: (id, open) => setFold({ ...fold(), [id]: open }),
    register: (id) => {
      setRegistered((ids) => [...ids, id]);

      return () => {
        // One entry: a second section with the same id keeps its own.
        setRegistered((ids) => {
          const at = ids.indexOf(id);

          return at < 0 ? ids : [...ids.slice(0, at), ...ids.slice(at + 1)];
        });
      };
    },
    rank: (id) => arranged().indexOf(id),
    reorderable: () => arranged().length > 1,
    folding,
    startDrag: (id) => {
      setDragging(id);
      foldTimer = setTimeout(() => setFolding(true), 0);
    },
    dragOver: (id) => setTarget(id),
    drop: (id) => {
      const source = dragging();
      if (null !== source && source !== id) {
        setStored(moveInOrder(stored(), registered(), source, id));
      }
      endDrag();
    },
    endDrag,
    isDragging: (id) => dragging() === id,
    dropEdge: (id) => {
      const source = dragging();
      if (null === source || source === id || target() !== id) return null;

      return arranged().indexOf(source) < arranged().indexOf(id) ? 'after' : 'before';
    },
  };
  onCleanup(() => clearTimeout(foldTimer));

  return (
    <SettingsSectionsContext.Provider value={host}>
      {props.children}
    </SettingsSectionsContext.Provider>
  );
}
