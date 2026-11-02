import { describe, expect, it } from 'vitest';
import { withoutRoutineRefundSchedules } from './routineRefundSchedules';

const scheduled = (id: string, mode: string) => ({ id, type: 'refund.scheduled', payload: { mode } });
const closing = (type: string, scheduleId: string) => ({
  id: `${type}-${scheduleId}`,
  type,
  payload: { scheduled_event_id: scheduleId },
});
const ids = (events: Array<{ id: string }>) => events.map((e) => e.id);

describe('withoutRoutineRefundSchedules', () => {
  it.each(['auto', 'manual_confirmed'])('leaves out a %s schedule confirmed with no failure', (mode) => {
    const events = [scheduled('s', mode), closing('correction.refund_confirmed', 's')];
    expect(ids(withoutRoutineRefundSchedules(events))).toEqual(['correction.refund_confirmed-s']);
  });

  it('keeps a manual schedule, which waited for an operator, once settled', () => {
    const events = [scheduled('s', 'manual'), closing('correction.refund_confirmed', 's')];
    expect(ids(withoutRoutineRefundSchedules(events))).toContain('s');
  });

  it('keeps a schedule not yet confirmed', () => {
    expect(ids(withoutRoutineRefundSchedules([scheduled('s', 'auto')]))).toEqual(['s']);
  });

  it('keeps a schedule with a failed attempt, even once confirmed', () => {
    const events = [
      scheduled('s', 'auto'),
      closing('refund.failed', 's'),
      closing('correction.refund_confirmed', 's'),
    ];
    expect(ids(withoutRoutineRefundSchedules(events))).toContain('s');
  });

  it('keeps a canceled schedule', () => {
    const events = [scheduled('s', 'auto'), closing('refund.canceled', 's')];
    expect(ids(withoutRoutineRefundSchedules(events))).toContain('s');
  });

  it('judges each schedule by its own confirmation', () => {
    const events = [scheduled('a', 'auto'), scheduled('b', 'auto'), closing('correction.refund_confirmed', 'a')];
    expect(ids(withoutRoutineRefundSchedules(events))).toEqual(['b', 'correction.refund_confirmed-a']);
  });

  it('leaves other events alone', () => {
    const events = [{ id: 'x', type: 'order.created' }];
    expect(withoutRoutineRefundSchedules(events)).toEqual(events);
  });
});
