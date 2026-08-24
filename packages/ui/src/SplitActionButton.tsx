import { createMemo, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu';
import { buttonClass } from './primitives';
import {
  entityActionRegistry,
  type EntityActionContext,
  type EntityActionRegistry,
  type ResolvedAction,
  type ResolvedActions,
} from './entity-actions';

export interface SplitActionButtonProps<Ctx extends EntityActionContext> {
  /** Registry scope key, e.g. `po.detail`. */
  scope: string;
  /** The live context; resolution re-runs when it changes. */
  ctx: Ctx;
  /** Registry to resolve against (defaults to the shared {@link entityActionRegistry}; inject in tests). */
  registry?: EntityActionRegistry;
  /** Aria-label for the overflow trigger. */
  overflowLabel?: string;
  /** Portal target for the overflow menu (forwarded to DropdownMenu). */
  mount?: HTMLElement;
}

// Each half names its own radius, and `buttonClass` then withholds the default `rounded` rather
// than emitting both — stacking two radius utilities on one element is decided by stylesheet
// order, not by the class attribute, which is how this button once rendered square.
const primaryHalf = (radius: string): string =>
  buttonClass('primary', 'md', `${radius} inline-flex items-center gap-1.5`);

/** Map a resolved action to a menu item (disabledReason ⇒ disabled + tooltip). */
const toItem = (a: ResolvedAction, separatorBefore = false): DropdownMenuItem => ({
  id: a.id,
  label: a.label,
  icon: a.icon,
  disabled: a.disabledReason !== undefined,
  // Why-you-can't beats what-it-does, so the disabled reason wins the one tooltip slot.
  tooltip: a.disabledReason ?? a.hint,
  separatorBefore,
  run: a.run,
});

/**
 * Split button for a scope's registered {@link EntityAction}s: the resolved
 * contextual **primary** as a filled button, with a caret opening the overflow (secondary, then a
 * divided destructive group). Collapses to a plain "Actions ▾" menu when no action claims the headline.
 * Availability/labels/icons/ordering all come from the resolver — the shell never branches on tier.
 */
export function SplitActionButton<Ctx extends EntityActionContext>(
  props: SplitActionButtonProps<Ctx>,
): JSX.Element {
  const resolved = createMemo<ResolvedActions>(() =>
    (props.registry ?? entityActionRegistry).resolve(props.scope, props.ctx),
  );

  const overflowItems = (): DropdownMenuItem[] => {
    const { secondary, destructive } = resolved();
    return [...secondary.map((a) => toItem(a)), ...destructive.map((a, i) => toItem(a, 0 === i))];
  };

  const hasOverflow = (): boolean => overflowItems().length > 0;
  const primary = (): ResolvedAction | null => resolved().primary;

  return (
    <Show when={primary() || hasOverflow()}>
      <div class="inline-flex items-stretch">
        <Show when={primary()}>
          {(p) => (
            <button
              type="button"
              class={primaryHalf(hasOverflow() ? 'rounded-l' : 'rounded')}
              disabled={p().disabledReason !== undefined}
              title={p().disabledReason ?? p().hint}
              onClick={() => p().run()}
            >
              <Show when={p().icon}>
                {(Icon) => <Dynamic component={Icon()} class="h-4 w-4" />}
              </Show>
              <span>{p().label}</span>
            </button>
          )}
        </Show>
        <Show when={hasOverflow()}>
          <DropdownMenu
            items={overflowItems()}
            ariaLabel={props.overflowLabel ?? 'More actions'}
            mount={props.mount}
            trigger={<span aria-hidden="true">▾</span>}
            triggerClass={
              primary()
                ? buttonClass('primary', 'md', 'rounded-r border-l border-primary-hover px-2')
                : buttonClass('secondary', 'md', 'rounded inline-flex items-center gap-1')
            }
          />
        </Show>
      </div>
    </Show>
  );
}
