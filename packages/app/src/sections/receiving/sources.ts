import { slotRegistry, type SlotContribution } from '@invflux/ui';

/**
 * Where the goods being received came from — the seam a reception starts at.
 *
 * A **registry** rather than a fixed list, because the sources are not one vocabulary: a purchase
 * order and a worksheet ship with the base install, an advance shipping notice arrives with an
 * add-on, and a merchant who builds in-house uses none of them. Each contribution's job is to
 * produce the `source_ref_type_id` + `source_id` pair a receiving session already persists, and to
 * seed the lines to be counted — which is why the registry maps one-to-one onto the stored shape
 * rather than sitting beside it.
 *
 * Contributions are keyed into the shared slot registry, so an add-on registers through exactly the
 * seam the base uses (`window.invflux.app.registerSlot(RECEIVING_SOURCE_SLOT, …)`).
 */
export const RECEIVING_SOURCE_SLOT = 'receiving.source';

export interface ReceivingSourceProps {
  /** Everything after `/receiving/new/<id>` — a source that picks a document routes within itself. */
  rest: string;
}

export interface ReceivingSource extends SlotContribution<ReceivingSourceProps> {
  /**
   * One line telling this source apart from its neighbours, in the operator's terms — "a delivery
   * against an order you raised" reads differently from "goods nobody ordered".
   *
   * A getter, like `label`, so the `__()` resolves at render time under the active locale.
   */
  description?: () => string;
}

/** The sources available to this install, in declared order, gated by their own predicates. */
export function receivingSources(): ReceivingSource[] {
  return slotRegistry
    .get<ReceivingSourceProps>(RECEIVING_SOURCE_SLOT)
    .filter((source) => source.enabled?.() ?? true) as ReceivingSource[];
}

/** One source by id, or undefined when the id names nothing this install has (a stale link). */
export function receivingSource(id: string): ReceivingSource | undefined {
  return receivingSources().find((source) => source.id === id);
}
