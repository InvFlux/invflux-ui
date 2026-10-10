import { describe, expect, it } from 'vitest';
import {
  FILTER_CONTROL_MULTISELECT,
  filterControlRegistry,
  resolveFilterSelection,
} from './filters';

// The built-in controls (filters-builtins.tsx) wrap the DOM Combobox, so they can't load in the
// node env; their registration is covered by the chip-bar E2E. Here we exercise the registry
// mechanism (a stub control) — that filter types resolve, with the same parent-chain fallback as
// the datatype registry.
describe('filter-control registry', () => {
  it("registers, resolves, and falls back along the type's parent chain", () => {
    const stub = () => null;
    filterControlRegistry.register(FILTER_CONTROL_MULTISELECT, 'test.ms', stub, { default: true });

    expect(filterControlRegistry.resolve(FILTER_CONTROL_MULTISELECT)).toBe(stub);
    expect(filterControlRegistry.resolve('multiselect:tag')).toBe(stub); // variant → parent
    expect(filterControlRegistry.resolve('does-not-exist')).toBeNull();
  });
});

// The default-vs-deliberate transitions live here rather than in the control so they can be
// exercised without a DOM — the controls wrap a Kobalte combobox and can't load in the node env.
describe('resolveFilterSelection', () => {
  describe('at default, the first click replaces', () => {
    it('drops the defaulted values when an unmarked option is ticked', () => {
      // Clicking `Closed` on a default-`Active` filter means "show me closed orders",
      // not "also show me closed orders".
      expect(resolveFilterSelection(['Active'], ['Active', 'Closed'], true)).toEqual({
        kind: 'select',
        value: ['Closed'],
      });
    });

    it('promotes a dotted option to deliberate instead of toggling it off', () => {
      // The click reaches us as a removal; "yes, I mean this one" is the only sensible reading.
      expect(resolveFilterSelection(['Active'], [], true)).toEqual({
        kind: 'select',
        value: ['Active'],
      });
    });

    it('narrows an all-marked default to the single option clicked', () => {
      // The `emptyMeansAll` shape: without replace-on-first-click, one click would appear to do
      // nothing but clear seven marks.
      expect(
        resolveFilterSelection(
          ['simple', 'variable', 'variation', 'kit'],
          ['simple', 'variable', 'kit'],
          true,
        ),
      ).toEqual({ kind: 'select', value: ['variation'] });
    });

    it('takes a multi-value change at face value — it is not a click', () => {
      expect(resolveFilterSelection(['Active'], ['Closed', 'Held'], true)).toEqual({
        kind: 'select',
        value: ['Closed', 'Held'],
      });
    });
  });

  // Ctrl/Cmd+click, or the keep-the-defaults switch on a touch screen: the operator is saying "keep
  // what is marked", so the click is an ordinary toggle on the defaults instead of a replace.
  describe('at default, additive keeps the marked defaults', () => {
    it('ticks an unmarked option on top of the defaults', () => {
      // "The defaults plus this one" — unreachable in one gesture under replace alone.
      expect(
        resolveFilterSelection(
          ['name', 'email', 'order'],
          ['name', 'email', 'order', 'sku'],
          true,
          true,
        ),
      ).toEqual({ kind: 'select', value: ['name', 'email', 'order', 'sku'] });
    });

    it('unticks a dotted option from the defaults instead of promoting it', () => {
      // "The defaults except that one" — the other half, and the reverse of a plain click's reading.
      expect(
        resolveFilterSelection(['name', 'email', 'order'], ['name', 'order'], true, true),
      ).toEqual({ kind: 'select', value: ['name', 'order'] });
    });

    it('still reverts rather than matching nothing when the last default is unticked', () => {
      // A lone default, clicked additively, empties the set — which §2.2 already turns back into
      // "default", so the dot stays and nothing visibly happened. Consistent, not a special case.
      expect(resolveFilterSelection(['Active'], [], true, true)).toEqual({ kind: 'revert' });
    });

    it('defaults to replacing when additive is not given', () => {
      // The pre-existing three-argument call must mean exactly what it always did.
      expect(resolveFilterSelection(['Active'], ['Active', 'Closed'], true)).toEqual({
        kind: 'select',
        value: ['Closed'],
      });
    });
  });

  describe('additive does nothing once deliberate', () => {
    it('adds and removes exactly as a deliberate selection already does', () => {
      expect(resolveFilterSelection(['Closed'], ['Closed', 'Held'], false, true)).toEqual({
        kind: 'select',
        value: ['Closed', 'Held'],
      });
      expect(resolveFilterSelection(['Closed'], [], false, true)).toEqual({ kind: 'revert' });
    });
  });

  describe('once deliberate', () => {
    it('reverts to default when the last option is unchecked, never "match nothing"', () => {
      expect(resolveFilterSelection(['Closed'], [], false)).toEqual({ kind: 'revert' });
    });

    it('adds and removes normally while a selection remains', () => {
      expect(resolveFilterSelection(['Closed'], ['Closed', 'Held'], false)).toEqual({
        kind: 'select',
        value: ['Closed', 'Held'],
      });
      expect(resolveFilterSelection(['Closed', 'Held'], ['Held'], false)).toEqual({
        kind: 'select',
        value: ['Held'],
      });
    });
  });
});
