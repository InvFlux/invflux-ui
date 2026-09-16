import { describe, expect, it, vi } from 'vitest';
import type { FilterDescriptor } from '../filters';
import {
  createSavedFilter,
  deleteSavedFilter,
  describeSavedQuery,
  fetchSavedFilters,
  queryContains,
  queryMatches,
  resolveSavedQuery,
  updateSavedFilter,
  type SavedFilter,
} from './savedFilters';
import type { InvFluxApi } from './client';

/** A descriptor carrying only what the resolver reads. */
function filter(
  id: string,
  isDefault: boolean,
  params?: Record<string, string | string[]>,
): FilterDescriptor {
  return {
    id,
    label: id,
    type: 'multiselect',
    active: true,
    summary: '',
    value: () => [],
    options: () => [],
    onChange: () => {},
    clear: () => {},
    isDefault: () => isDefault,
    ...(params === undefined ? {} : { params: () => params }),
  };
}

describe('resolveSavedQuery', () => {
  /**
   * The rule the whole mechanism turns on, and §0's bug stated as a test: the live URL says only
   * `pending_manual_refund=1`, and what gets stored must also carry the workflow states that were
   * merely defaulted — or the saved filter re-aims the day that default moves.
   */
  it('writes out a filter sitting at its default, which the URL omits', () => {
    const resolved = resolveSavedQuery({ pending_manual_refund: '1' }, [
      filter('workflow', true, { workflow_state: 'Active,Closed' }),
    ]);

    expect(resolved).toEqual({
      pending_manual_refund: '1',
      workflow_state: 'Active,Closed',
    });
  });

  it('leaves a deliberate filter to the URL it already wrote', () => {
    // Re-deriving it here would let a difference between two encoders change what was saved.
    const params = vi.fn(() => ({ workflow_state: 'Active' }));
    const deliberate: FilterDescriptor = { ...filter('workflow', false), params };

    const resolved = resolveSavedQuery({ workflow_state: 'Closed' }, [deliberate]);

    expect(resolved).toEqual({ workflow_state: 'Closed' });
    expect(params).not.toHaveBeenCalled();
  });

  it('never lets a default overwrite what the URL already carries', () => {
    // A filter reporting "default" while the URL carries its parameter is describing something
    // already explicit; the URL is the state actually in effect.
    const resolved = resolveSavedQuery({ workflow_state: 'Closed' }, [
      filter('workflow', true, { workflow_state: 'Active' }),
    ]);

    expect(resolved).toEqual({ workflow_state: 'Closed' });
  });

  it('carries list-shaped parameters through unchanged', () => {
    const resolved = resolveSavedQuery({}, [
      filter('kind', true, { 'subject_kind[]': ['simple', 'variation'] }),
    ]);

    expect(resolved).toEqual({ 'subject_kind[]': ['simple', 'variation'] });
  });

  it('ignores a defaulted filter that declares no parameters', () => {
    // Correct for a filter with no default to make explicit — it adds nothing the URL lacks.
    expect(resolveSavedQuery({ a: '1' }, [filter('x', true)])).toEqual({ a: '1' });
  });

  it('merges several defaulted filters', () => {
    const resolved = resolveSavedQuery({ search: 'acme' }, [
      filter('workflow', true, { workflow_state: 'Active' }),
      filter('kind', true, { 'subject_kind[]': ['simple'] }),
      filter('status', false, { status: 'Staged' }),
    ]);

    expect(resolved).toEqual({
      search: 'acme',
      workflow_state: 'Active',
      'subject_kind[]': ['simple'],
    });
  });

  it('does not mutate the caller’s current query', () => {
    const current = { a: '1' };
    resolveSavedQuery(current, [filter('workflow', true, { workflow_state: 'Active' })]);

    expect(current).toEqual({ a: '1' });
  });
});

describe('queryContains — is this view in effect', () => {
  const view = { pending_manual_refund: '1', workflow_state: 'Active,Closed' };

  it('holds when every parameter the view declares is present with the same value', () => {
    expect(queryContains(view, view)).toBe(true);
  });

  it('still holds when the reader has narrowed further', () => {
    // A pinned view is a toggle for its OWN constraints. Typing a customer name does not stop the
    // operator looking at unsettled refunds, and blinking the toggle off there reads as a release.
    expect(queryContains({ ...view, search: 'weber' }, view)).toBe(true);
  });

  it('fails when a declared parameter is missing', () => {
    expect(queryContains({ pending_manual_refund: '1' }, view)).toBe(false);
  });

  it('fails when the key is present but the value differs', () => {
    // The presence of `workflow_state` says nothing: a queue cut to `Closed` is not showing the
    // `Active,Closed` span the view asks for, and claiming otherwise is the §0 defect again.
    expect(queryContains({ ...view, workflow_state: 'Closed' }, view)).toBe(false);
  });

  it('is satisfied by anything for a view that declares nothing', () => {
    expect(queryContains({ search: 'x' }, {})).toBe(true);
  });

  it('keeps the scalar-versus-list distinction', () => {
    expect(queryContains({ id: '7' }, { id: ['7'] })).toBe(false);
  });
});

describe('queryMatches', () => {
  it('ignores key order — the same view, written differently', () => {
    expect(queryMatches({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
  });

  it('treats a one-element list and a scalar as different shapes', () => {
    // `?id[]=7` and `?id=7` are not the same request, and a surface reading one cannot read the
    // other — so a saved filter matching on it would report the wrong view as applied.
    expect(queryMatches({ id: ['7'] }, { id: '7' })).toBe(false);
  });

  it('is order-sensitive within a list, and size-sensitive across maps', () => {
    expect(queryMatches({ k: ['a', 'b'] }, { k: ['b', 'a'] })).toBe(false);
    expect(queryMatches({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(queryMatches({ k: ['a', 'b'] }, { k: ['a', 'b'] })).toBe(true);
  });

  it('matches two empty queries', () => {
    expect(queryMatches({}, {})).toBe(true);
  });
});

describe('the saved-filter endpoints', () => {
  function apiSpy(payload: unknown = {}): { api: InvFluxApi; calls: string[][] } {
    const calls: string[][] = [];
    const record =
      (method: string) =>
      async (route: string): Promise<unknown> => {
        calls.push([method, route]);

        return payload;
      };

    return {
      calls,
      api: {
        get: record('GET'),
        post: record('POST'),
        patch: record('PATCH'),
        del: record('DELETE'),
        put: record('PUT'),
      } as unknown as InvFluxApi,
    };
  }

  it('reads a surface’s filters with the caller’s permission to change them', async () => {
    const rows: SavedFilter[] = [
      {
        id: 1,
        name: 'Pending manual refunds',
        query: {},
        pinned: true,
        position: 0,
        colorId: 19,
        seeded: true,
      },
    ];
    const withRows = apiSpy({ savedFilters: rows, canManage: true });

    await expect(fetchSavedFilters(withRows.api, 'dispatch')).resolves.toEqual({
      savedFilters: rows,
      canManage: true,
    });
    expect(withRows.calls[0][1]).toContain('/saved-filters/dispatch');
  });

  it('treats an absent list as empty and an absent permission as no', async () => {
    // Assuming permission would offer a save that ends in a 403 after the operator has already
    // composed what they wanted to keep.
    const { api } = apiSpy({});

    await expect(fetchSavedFilters(api, 'dispatch')).resolves.toEqual({
      savedFilters: [],
      canManage: false,
    });
  });

  it('puts the surface in the path on every verb, and the id on the ones that need it', async () => {
    const { api, calls } = apiSpy();

    await createSavedFilter(api, 'dispatch', { name: 'x', query: {} });
    await updateSavedFilter(api, 'workbench', 12, { pinned: true });
    await deleteSavedFilter(api, 'procurement.po', 3);

    expect(calls[0][0]).toBe('POST');
    expect(calls[0][1]).toContain('/saved-filters/dispatch');
    expect(calls[1][0]).toBe('PATCH');
    expect(calls[1][1]).toContain('/saved-filters/workbench/12');
    expect(calls[2][0]).toBe('DELETE');
    // The dot is a legal surface character and must survive path encoding intact, or the route
    // stops matching and every PO saved filter 404s.
    expect(calls[2][1]).toContain('/saved-filters/procurement.po/3');
  });
});

describe('describeSavedQuery', () => {
  const chip = (over: Partial<FilterDescriptor> & Pick<FilterDescriptor, 'id'>): FilterDescriptor =>
    ({
      label: over.id,
      type: 'multiselect',
      active: true,
      summary: '',
      value: () => [],
      options: () => [],
      onChange: () => {},
      clear: () => {},
      ...over,
    }) as FilterDescriptor;

  const workflow = chip({
    id: 'workflow',
    label: 'Workflow status',
    paramKeys: ['workflow_state'],
    options: () => [
      { value: 'Active', label: 'Active' },
      { value: 'OnHold', label: 'On hold' },
      { value: 'Closed', label: 'Closed' },
    ],
  });
  const tags = chip({
    id: 'tag',
    label: 'Tags',
    paramKeys: ['tag_id'],
    options: () => [
      { value: '1', label: 'Urgent' },
      { value: '2', label: 'Fragile' },
      { value: '3', label: 'Gift' },
      { value: '4', label: 'Bulky' },
      { value: '5', label: 'VIP' },
    ],
  });

  it('renders each filter by its own label and option labels', () => {
    const lines = describeSavedQuery({ workflow_state: 'Active,Closed' }, [workflow]);

    expect(lines).toEqual([{ id: 'workflow', label: 'Workflow status', value: 'Active, Closed' }]);
  });

  it('omits a filter the query does not constrain, so a view lists what it does and no more', () => {
    expect(describeSavedQuery({ tag_id: '1' }, [workflow, tags])).toEqual([
      { id: 'tag', label: 'Tags', value: 'Urgent' },
    ]);
  });

  it('collapses a long selection rather than listing every value', () => {
    const lines = describeSavedQuery({ tag_id: '1,2,3,4' }, [tags]);

    expect(lines[0].value).toBe('4 of 5');
  });

  /**
   * The §1.2 case, and the reason a description exists at all: a clause naming something that is
   * gone still constrains the query, so the view returns rows its name does not promise. Dropping
   * the line would be the silent failure; carrying it is what lets the surface say so.
   */
  it('carries values the install can no longer resolve instead of dropping them', () => {
    const lines = describeSavedQuery({ tag_id: '1,99' }, [tags]);

    expect(lines[0].unresolved).toEqual(['99']);
    expect(lines[0].value).toBe('Urgent, 99');
  });

  it('does not judge a value unresolvable when the filter has no option list to judge it by', () => {
    const sku = chip({ id: 'sku', label: 'SKU', paramKeys: ['sku'] });

    expect(describeSavedQuery({ sku: 'ABC-1' }, [sku])).toEqual([
      { id: 'sku', label: 'SKU', value: 'ABC-1' },
    ]);
  });

  it('lets a filter describe its own encoding', () => {
    const workflowWithSentinel = chip({
      ...workflow,
      describe: () => ({ id: 'workflow', label: 'Workflow status', value: 'All states' }),
    });

    expect(describeSavedQuery({ workflow_state: '_' }, [workflowWithSentinel])).toEqual([
      { id: 'workflow', label: 'Workflow status', value: 'All states' },
    ]);
  });

  /**
   * A parameter nothing on this surface claims is louder than one that resolves badly: the view is
   * doing something the install cannot name. Hiding it would leave a result set nobody can account
   * for — the same failure as a silently dropped clause.
   */
  it('reports a parameter no filter claims, rather than hiding it', () => {
    const lines = describeSavedQuery({ from_an_addon: 'x' }, [workflow]);

    expect(lines).toEqual([
      { id: 'from_an_addon', label: 'from_an_addon', value: 'x', unresolved: ['x'] },
    ]);
  });

  it('lets a surface claim a parameter that is not a chip', () => {
    const lines = describeSavedQuery(
      { search: 'Walker' },
      [workflow],
      [
        {
          keys: ['search'],
          describe: (query) => ({ id: 'search', label: 'Search', value: String(query.search) }),
        },
      ],
    );

    expect(lines).toEqual([{ id: 'search', label: 'Search', value: 'Walker' }]);
  });
});
