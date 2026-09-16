import { describe, expect, it } from 'vitest';

// The route's own source, as text. Imported through Vite's `?raw` rather than read with `node:fs`
// because these packages compile against `vite/client` alone, with no Node types.
import source from './OrderList.tsx?raw';

/**
 * No filter parameter may be read-only.
 *
 * The queue treats a fixed list of URL parameters as filter state: they are what a saved view
 * captures, what applying one erases, and what a pinned view toggles. Every one of them therefore
 * has to be settable from the filter bar itself — a parameter the queue reads but no control writes
 * is a constraint the operator can be *shown* and can never *state*.
 *
 * This is not hypothetical. `pending_manual_refund` reached the URL only through a bespoke toolbar
 * button; retiring that button in favour of a shipped saved view left the parameter readable and
 * unwritable, and because a seeded view's deletion is permanent, deleting it would have destroyed
 * the only way to ask about unsettled refunds.
 *
 * The assertion reads the route's source because the descriptors are built inside the component,
 * where a unit test cannot reach them without rendering the whole queue. What it checks is coarse —
 * that a writer exists at all, not that it is wired correctly — which is the shape of the defect it
 * exists to catch, and what the browser pass covers afterwards.
 */
describe('dispatch filter parameters', () => {
  /** The `FILTER_PARAM_KEYS` list as the route declares it. */
  const declaredKeys = (): string[] => {
    const block = /const FILTER_PARAM_KEYS = \[([^\]]*)\] as const;/.exec(source);
    expect(block, 'FILTER_PARAM_KEYS is no longer declared as a literal list').not.toBeNull();

    return [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  /**
   * Parameters written by a control, i.e. named in an object literal handed to `setSearchParams`.
   *
   * Deliberately blind to `setSearchParams(patch)`: applying or toggling a saved view writes a
   * computed patch over *every* key, so counting it would make each key look settable and pass this
   * test on exactly the surface it is meant to fail on.
   */
  const writtenKeys = (): Set<string> => {
    const keys = new Set<string>();
    for (const call of source.matchAll(/setSearchParams\(\{([^}]*)\}/g)) {
      for (const key of call[1].matchAll(/([a-z_]+)\s*:/g)) keys.add(key[1]);
    }

    return keys;
  };

  it('declares at least the filters the queue is known to carry', () => {
    // A guard on the parser, not on the design: a silently-empty match would make the real
    // assertion below pass by vacuum.
    expect(declaredKeys()).toContain('workflow_state');
    expect(declaredKeys().length).toBeGreaterThan(5);
    expect(writtenKeys().size).toBeGreaterThan(5);
  });

  it('gives every filter parameter a control that writes it', () => {
    const written = writtenKeys();
    const readOnly = declaredKeys().filter((key) => !written.has(key));

    expect(
      readOnly,
      'these parameters are read from the URL but no filter control sets them, so an operator ' +
        'cannot state the constraint by hand',
    ).toEqual([]);
  });
});
