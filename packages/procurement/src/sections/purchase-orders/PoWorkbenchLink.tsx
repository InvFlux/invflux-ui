import { __ } from '@invflux/i18n';
import { buttonClass, useHostNav, WorkbenchLinkIcon } from '@invflux/ui';
import { type JSX, Show } from 'solid-js';

/**
 * Open every product on this purchase order in the workbench at once, addressed by subject id — the
 * same hand-off, glyph and wording as a customer order's (Dispatch), so one affordance looks like one
 * affordance wherever it appears. Embedded it navigates in-app; standalone the workbench is another
 * admin page, hence a new tab.
 */
export function PoWorkbenchLink(props: { subjectIds: number[]; class?: string }): JSX.Element {
  const hostNav = useHostNav();
  const ids = (): number[] => [...new Set(props.subjectIds)];

  return (
    <Show when={ids().length > 0}>
      <a
        class={buttonClass('secondary', 'md', `h-8 shrink-0 px-2! ${props.class ?? ''}`)}
        href={hostNav.routeHref('/workbench', `subject_ids=${ids().join('-')}&bring_children=1`)}
        target={hostNav.opensNewTab ? '_blank' : undefined}
        rel={hostNav.opensNewTab ? 'noopener' : undefined}
        title={__("Open this order's products in the workbench")}
        aria-label={__("Open this order's products in the workbench")}
        data-testid="po-open-in-workbench"
      >
        <WorkbenchLinkIcon class="h-5 w-5" />
      </a>
    </Show>
  );
}
