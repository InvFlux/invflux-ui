import { For, Show, createMemo, type JSX } from 'solid-js';
import { __, _x } from '@invflux/i18n';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Select } from '../Select';
import { SegmentedControl } from '../SegmentedControl';
import { CloseIcon } from '../icons';
import { createDragReorder } from '../dragReorder';
import {
  addSortLevel,
  moveSortLevel,
  removeSortLevel,
  replaceSortColumn,
  setSortDirection,
  type SortLevels,
} from './sortLevels';

/** A column the rows can be sorted by, as the editor offers it. */
export interface SortableColumn {
  id: string;
  label: string;
  /** The direction a new level on this column starts in (a stock or value column: largest first). */
  firstDesc: boolean;
}

/**
 * The sort as an editable list of levels — the column manager's Sort tab. Each level names a column
 * and a direction; the first decides, each later one breaks the ties left by those before it. Levels
 * are reordered by dragging, and a column sorts at most once, so each level's menu offers only the
 * columns no other level uses.
 */
export function SortLevelsEditor(props: {
  levels: () => SortLevels;
  onChange: (next: SortLevels) => void;
  columns: SortableColumn[];
}): JSX.Element {
  const byId = createMemo(() => new Map(props.columns.map((column) => [column.id, column])));
  const labelOf = (id: string): string => byId().get(id)?.label ?? id;
  const unused = (): SortableColumn[] =>
    props.columns.filter((column) => !props.levels().some((level) => level.id === column.id));
  const reorder = createDragReorder((fromId, toId) =>
    props.onChange(moveSortLevel(props.levels(), fromId, toId)),
  );

  function addLevel(): void {
    const next = unused()[0];
    if (next) props.onChange(addSortLevel(props.levels(), next.id, next.firstDesc));
  }

  return (
    <div>
      <ul class="space-y-1">
        <For each={props.levels()}>
          {(level, index) => (
            <>
              <Show when={reorder.isDropTarget(level.id)}>
                <li class="h-0.5 rounded bg-primary" aria-hidden="true" />
              </Show>
              <li
                data-testid={`sort-level-row-${level.id}`}
                class="flex cursor-move items-center gap-2 rounded border border-border px-2 py-1 text-sm hover:bg-gray-100"
                classList={{ 'opacity-50': reorder.isDragging(level.id) }}
                {...reorder.itemProps(level.id)}
              >
                <span class="select-none text-text-muted" aria-hidden="true">
                  ⋮⋮
                </span>
                <span class="w-16 shrink-0 text-text-muted">
                  {index() === 0
                    ? _x('Sort by', 'sort levels: label of the first level')
                    : _x('Then by', 'sort levels: label of each later level')}
                </span>
                <Select
                  class="min-w-0 flex-1"
                  aria-label={_x('Column', 'sort levels: the column a level sorts by')}
                  value={level.id}
                  onChange={(e) =>
                    props.onChange(
                      replaceSortColumn(props.levels(), level.id, e.currentTarget.value),
                    )
                  }
                >
                  <option value={level.id}>{labelOf(level.id)}</option>
                  <For each={unused()}>
                    {(column) => <option value={column.id}>{column.label}</option>}
                  </For>
                </Select>
                <SegmentedControl
                  size="sm"
                  ariaLabel={_x('Direction', 'sort levels: ascending or descending')}
                  options={[
                    // Short labels: the picker is narrow, and the column menu beside them needs the
                    // room. The full word is the tooltip.
                    {
                      value: 'asc',
                      label: _x('Asc', 'sort direction, short for ascending'),
                      title: _x('Ascending', 'sort direction'),
                    },
                    {
                      value: 'desc',
                      label: _x('Desc', 'sort direction, short for descending'),
                      title: _x('Descending', 'sort direction'),
                    },
                  ]}
                  value={level.desc ? 'desc' : 'asc'}
                  onChange={(dir) =>
                    props.onChange(setSortDirection(props.levels(), level.id, dir === 'desc'))
                  }
                />
                <IconButton
                  label={__('Remove this sort level')}
                  size="sm"
                  onClick={() => props.onChange(removeSortLevel(props.levels(), level.id))}
                >
                  <CloseIcon class="h-4 w-4" />
                </IconButton>
              </li>
            </>
          )}
        </For>
      </ul>
      <div class="mt-2">
        <Button
          variant="secondary"
          size="sm"
          // Disabled only when there is nothing to add: every sortable column already has a level.
          disabled={unused().length === 0}
          onClick={addLevel}
          data-testid="sort-level-add"
        >
          {__('Add a sort level')}
        </Button>
      </div>
    </div>
  );
}
