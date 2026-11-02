interface EventLike {
  id: string;
  type: string;
  payload?: unknown;
}

function payloadOf(event: EventLike): { mode?: unknown; scheduled_event_id?: unknown } {
  return (event.payload ?? {}) as { mode?: unknown; scheduled_event_id?: unknown };
}

/**
 * Leaves out each `refund.scheduled` that went on to be confirmed without a failure, whose row would
 * only repeat the confirmation beside it. The event stays on record: it is what makes issuing a
 * refund safe to retry. A manual schedule stays too, because it waited for an operator, and so does
 * one with a failed attempt, because that part of the story happened.
 */
export function withoutRoutineRefundSchedules<T extends EventLike>(events: T[]): T[] {
  const scheduleIdsOf = (type: string): Set<unknown> =>
    new Set(events.filter((e) => e.type === type).map((e) => payloadOf(e).scheduled_event_id));
  const confirmed = scheduleIdsOf('correction.refund_confirmed');
  const failed = scheduleIdsOf('refund.failed');

  return events.filter(
    (e) =>
      e.type !== 'refund.scheduled' ||
      payloadOf(e).mode === 'manual' ||
      !confirmed.has(e.id) ||
      failed.has(e.id),
  );
}
