import { describe, expect, it } from 'vitest';
import { mergeOrderedToggles } from './orderedTogglesControl';
import { summarizeSettingValue } from './registry';

/**
 * The control lays a stored list over the options the way the server does (`QueueRank::merge()`),
 * so the screen shows the order that is in effect. The cases mirror the server's `QueueRankTest`.
 */
const builtIn = [
  { value: 'readiness', label: 'Ready to pack first' },
  { value: 'shippable', label: 'Orders that can ship first' },
  { value: 'edt', label: 'Earliest ship date first' },
];
const shape = (rows: ReturnType<typeof mergeOrderedToggles>): Array<[string, boolean]> =>
  rows.map((row) => [row.value, row.enabled]);

describe('mergeOrderedToggles', () => {
  it('shows the built-in order, all on, when nothing is stored', () => {
    const expected = [
      ['readiness', true],
      ['shippable', true],
      ['edt', true],
    ];
    expect(shape(mergeOrderedToggles(builtIn, null))).toEqual(expected);
    expect(shape(mergeOrderedToggles(builtIn, []))).toEqual(expected);
  });

  it('shows the stored order and switches, keeping a switched-off rule in its place', () => {
    const stored = [
      { name: 'edt', enabled: true },
      { name: 'readiness', enabled: false },
      { name: 'shippable', enabled: true },
    ];
    expect(shape(mergeOrderedToggles(builtIn, stored))).toEqual([
      ['edt', true],
      ['readiness', false],
      ['shippable', true],
    ]);
  });

  it('skips a name no longer offered, and a name listed twice', () => {
    const stored = [
      { name: 'tag_priority', enabled: true },
      { name: 'EDT', enabled: true },
      { name: 'edt', enabled: false },
      { name: 'readiness', enabled: true },
      { name: 'shippable', enabled: true },
      'not an entry',
    ];
    expect(shape(mergeOrderedToggles(builtIn, stored))).toEqual([
      ['edt', true],
      ['readiness', true],
      ['shippable', true],
    ]);
  });

  it('lays an option the list does not name after the last row that precedes it by default', () => {
    const withAddOns = [
      { value: 'tag_priority', label: 'Urgent first' },
      { value: 'readiness', label: 'Ready' },
      { value: 'margin', label: 'Margin' },
      { value: 'shippable', label: 'Can ship' },
      { value: 'edt', label: 'Due' },
      { value: 'weight', label: 'Weight' },
    ];
    const stored = [
      { name: 'edt', enabled: true },
      { name: 'readiness', enabled: true },
      { name: 'shippable', enabled: true },
    ];
    expect(mergeOrderedToggles(withAddOns, stored).map((row) => row.value)).toEqual([
      'tag_priority',
      'edt',
      'readiness',
      'margin',
      'shippable',
      'weight',
    ]);
  });
});

describe('the review summary', () => {
  const definition = { dataType: 'ordered-toggles', config: { options: builtIn } };

  it('spells out the built-in order when nothing is stored', () => {
    expect(summarizeSettingValue(definition, [])).toBe(
      'Built-in order: 1. Ready to pack first, 2. Orders that can ship first, 3. Earliest ship date first',
    );
  });

  it('numbers the rules that rank and names the ones switched off', () => {
    const stored = [
      { name: 'edt', enabled: true },
      { name: 'readiness', enabled: true },
      { name: 'shippable', enabled: false },
    ];
    expect(summarizeSettingValue(definition, stored)).toBe(
      '1. Earliest ship date first, 2. Ready to pack first · off: Orders that can ship first',
    );
  });
});
