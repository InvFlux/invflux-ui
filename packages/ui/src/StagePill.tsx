import type { Component } from 'solid-js';
import { Pill } from './Pill';
import { STAGE_COLOR, STATUS_FALLBACK_COLOR } from './statusPalette';
import type { StageCode } from './types';

const LABEL: Record<StageCode, string> = {
  '': 'Pending',
  M: 'In box',
  W: 'Put aside',
  E: 'Error',
};

/**
 * The dispatch stage badge. Colour comes from the shared status palette rather than a local class
 * map, so it agrees with the order-status pill it sits beside and inherits one answer for contrast
 * and, later, dark mode.
 */
export const StagePill: Component<{ stage: StageCode }> = (props) => (
  <Pill colorId={STAGE_COLOR[props.stage] ?? STATUS_FALLBACK_COLOR} size="sm" class="font-medium">
    {LABEL[props.stage]}
  </Pill>
);
