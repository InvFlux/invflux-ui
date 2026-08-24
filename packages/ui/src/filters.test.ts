import { describe, expect, it } from 'vitest';
import { FILTER_CONTROL_MULTISELECT, filterControlRegistry } from './filters';

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
