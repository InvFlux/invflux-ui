import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { __, sprintf } from '@invflux/i18n';
import { Pill } from './Pill';
import { EyeIcon } from './icons';
import type { OrderViewer } from './types';

/** "Someone else is on this order right now" — driven by the dispatch presence heartbeat. */
export const ViewerBadge: Component<{ viewers: OrderViewer[] }> = (props) => {
  const names = (): string => props.viewers.map((v) => v.userName).join(', ');
  return (
    <Show when={props.viewers.length > 0}>
      <Pill tone="info" size="sm" title={sprintf(__('Viewed by: %s'), names())}>
        <EyeIcon class="h-3.5 w-3.5" />
        {names()}
      </Pill>
    </Show>
  );
};
