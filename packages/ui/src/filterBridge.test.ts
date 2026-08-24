import { describe, expect, it, vi } from 'vitest';
import {
  deleteFilterModifierParams,
  deleteUnreservedFilterParams,
  gridFiltersToDescriptors,
  readFilterModifiersFromParams,
  readUnreservedFilterValuesFromParams,
  writeFilterModifiersToParams,
  writeFilterValuesToParams,
  type GridFilterMeta,
} from './filterBridge';

const supplierWithModes: GridFilterMeta = {
  id: 'supplier',
  label: 'Supplier',
  type: 'multiselect',
  optionsSource: 'server',
  options: [
    { value: '7', label: 'ACME' },
    { value: '12', label: 'Globex' },
  ],
  priority: 70,
  modes: [
    { value: 'any', label: 'Any' },
    { value: 'all', label: 'All' },
    { value: 'none', label: 'None' },
  ],
  defaultMode: 'any',
};

const supplier: GridFilterMeta = {
  id: 'supplier',
  label: 'Supplier',
  type: 'multiselect',
  optionsSource: 'server',
  options: [
    { value: '7', label: 'ACME' },
    { value: '12', label: 'Globex' },
  ],
  priority: 70,
};

describe('gridFiltersToDescriptors', () => {
  it('maps metadata to descriptors ordered by priority then id', () => {
    const metas: GridFilterMeta[] = [
      { ...supplier, id: 'b', priority: 50 },
      { ...supplier, id: 'a', priority: 50 },
      { ...supplier, id: 'c', priority: 10 },
    ];
    const ids = gridFiltersToDescriptors(metas, () => ({}), () => {}).map((d) => d.id);
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('reflects selection as active + summary and exposes live value/options', () => {
    const values = { supplier: ['7'] };
    const [d] = gridFiltersToDescriptors([supplier], () => values, () => {});
    expect(d.active).toBe(true);
    expect(d.summary).toBe('ACME');
    expect(d.value()).toEqual(['7']);
    expect(d.options()).toEqual(supplier.options);
  });

  it('is inactive with an empty summary when nothing is selected', () => {
    const [d] = gridFiltersToDescriptors([supplier], () => ({}), () => {});
    expect(d.active).toBe(false);
    expect(d.summary).toBe('');
    expect(d.value()).toEqual([]);
  });

  it('routes onChange and clear through the setter', () => {
    const setValue = vi.fn();
    const [d] = gridFiltersToDescriptors([supplier], () => ({}), setValue);
    d.onChange(['7', '12']);
    d.clear();
    expect(setValue).toHaveBeenNthCalledWith(1, 'supplier', ['7', '12']);
    expect(setValue).toHaveBeenNthCalledWith(2, 'supplier', []);
  });

  it('summarises 3+ selections as first +N and honours an override', () => {
    const many = { supplier: ['7', '12', '99'] };
    const [d] = gridFiltersToDescriptors([supplier], () => many, () => {});
    expect(d.summary).toBe('ACME +2');

    const [custom] = gridFiltersToDescriptors([supplier], () => many, () => {}, {
      summarize: (vals) => `${vals.length} picked`,
    });
    expect(custom.summary).toBe('3 picked');
  });

  it('prefers an optionsFor override over the metadata options', () => {
    const override = [{ value: '1', label: 'Live' }];
    const [d] = gridFiltersToDescriptors([supplier], () => ({}), () => {}, {
      optionsFor: () => override,
    });
    expect(d.options()).toEqual(override);
  });
});

describe('gridFiltersToDescriptors — modes', () => {
  it('renders no mode toggle and no prefix at the default mode', () => {
    const [d] = gridFiltersToDescriptors([supplierWithModes], () => ({ supplier: ['7'] }), () => {}, {
      modifiers: () => ({}),
      extraFor: () => 'TOGGLE',
    });
    expect(d.summary).toBe('ACME'); // default mode → unprefixed
    expect(d.extra?.()).toBe('TOGGLE'); // toggle still offered (modes present)
  });

  it('prefixes the summary with the active non-default mode label', () => {
    const [none] = gridFiltersToDescriptors(
      [supplierWithModes],
      () => ({ supplier: ['7'] }),
      () => {},
      { modifiers: () => ({ supplier: { mode: 'none' } }) },
    );
    expect(none.summary).toBe('None: ACME');

    const [all] = gridFiltersToDescriptors(
      [supplierWithModes],
      () => ({ supplier: ['7', '12'] }),
      () => {},
      { modifiers: () => ({ supplier: { mode: 'all' } }) },
    );
    expect(all.summary).toBe('All: ACME, Globex');
  });

  it('exposes the current mode and routes setMode through setModifier', () => {
    const setModifier = vi.fn();
    let captured: { mode: () => string; setMode: (v: string) => void } | undefined;
    gridFiltersToDescriptors([supplierWithModes], () => ({}), () => {}, {
      modifiers: () => ({ supplier: { mode: 'all' } }),
      setModifier,
      extraFor: (args) => {
        captured = args;
        return 'x';
      },
    }).forEach((d) => d.extra?.());

    expect(captured?.mode()).toBe('all');
    captured?.setMode('none');
    expect(setModifier).toHaveBeenCalledWith('supplier', 'mode', 'none');
  });

  it('omits the toggle when the filter declares no modes', () => {
    const plain: GridFilterMeta = { ...supplierWithModes, modes: undefined };
    const [d] = gridFiltersToDescriptors([plain], () => ({}), () => {}, { extraFor: () => 'x' });
    expect(d.extra).toBeUndefined();
  });
});

describe('URL param helpers', () => {
  it('reads unreserved {id}[] params and skips reserved ones', () => {
    const params = new URLSearchParams(
      'supplier[]=7&supplier[]=12&stock_status[]=instock&tax_filters[brand][]=x',
    );
    const values = readUnreservedFilterValuesFromParams(params, ['stock_status', 'stock_concern']);
    expect(values).toEqual({ supplier: ['7', '12'] });
  });

  it('reads the indexed {id}[n] form WordPress reserialises array args to', () => {
    // WP rewrites ?supplier[]=3&supplier[]=1 → ?supplier[0]=3&supplier[1]=1 on admin page loads.
    const params = new URLSearchParams('supplier[0]=3&supplier[1]=1&stock_status[0]=instock');
    const values = readUnreservedFilterValuesFromParams(params, ['stock_status']);
    expect(values).toEqual({ supplier: ['3', '1'] });
  });

  it('deletes the indexed {id}[n] form too', () => {
    const params = new URLSearchParams('supplier[0]=3&supplier[1]=1&search=x');
    deleteUnreservedFilterParams(params, []);
    expect(params.has('supplier[0]')).toBe(false);
    expect(params.has('supplier[1]')).toBe(false);
    expect(params.get('search')).toBe('x');
  });

  it('round-trips a value map through write then read', () => {
    const params = new URLSearchParams();
    writeFilterValuesToParams(params, { supplier: ['7', '12'], vendor: ['3'] });
    expect(params.getAll('supplier[]')).toEqual(['7', '12']);
    expect(readUnreservedFilterValuesFromParams(params, [])).toEqual({
      supplier: ['7', '12'],
      vendor: ['3'],
    });
  });

  it('deletes unreserved {id}[] params while keeping reserved and bracketed ones', () => {
    const params = new URLSearchParams(
      'supplier[]=7&stock_status[]=instock&tax_filters[brand][]=x&search=foo',
    );
    deleteUnreservedFilterParams(params, ['stock_status', 'stock_concern']);
    expect(params.getAll('supplier[]')).toEqual([]);
    expect(params.getAll('stock_status[]')).toEqual(['instock']);
    expect(params.get('tax_filters[brand][]')).toBe('x');
    expect(params.get('search')).toBe('foo');
  });

  it('writes a numeric_ids filter as a single dash-joined param', () => {
    const params = new URLSearchParams();
    const post_ids: GridFilterMeta = {
      id: 'post_ids',
      label: 'Product IDs',
      type: 'numeric_ids',
      optionsSource: 'none',
      options: [],
      priority: 29,
    };
    writeFilterValuesToParams(params, { post_ids: ['1036', '1037', '1038'] }, [post_ids]);
    expect(params.get('post_ids')).toBe('1036-1037-1038');
    expect(params.has('post_ids[]')).toBe(false);
  });

  it('reads a numeric_ids filter from its dash-joined param', () => {
    const params = new URLSearchParams('post_ids=1036-1037-1038&search=foo');
    const post_ids: GridFilterMeta = {
      id: 'post_ids',
      label: 'Product IDs',
      type: 'numeric_ids',
      optionsSource: 'none',
      options: [],
      priority: 29,
    };
    expect(readUnreservedFilterValuesFromParams(params, [], [post_ids])).toEqual({
      post_ids: ['1036', '1037', '1038'],
    });
  });

  it('drops non-digit segments + duplicates when reading dash-joined numeric_ids', () => {
    const params = new URLSearchParams('post_ids=1036-abc-1037-1036-');
    const post_ids: GridFilterMeta = {
      id: 'post_ids',
      label: 'Product IDs',
      type: 'numeric_ids',
      optionsSource: 'none',
      options: [],
      priority: 29,
    };
    expect(readUnreservedFilterValuesFromParams(params, [], [post_ids])).toEqual({
      post_ids: ['1036', '1037'],
    });
  });

  it('falls back to array encoding for numeric_ids when no metas are provided', () => {
    // First-load (pre-server-metadata) case: the early read can't dispatch on type, so a
    // dash-joined param is missed and would need the post-meta re-read to pick up.
    const params = new URLSearchParams('post_ids=1036-1037');
    expect(readUnreservedFilterValuesFromParams(params, [])).toEqual({});
  });

  it('deletes a dash-joined numeric_ids param when metas declare its type', () => {
    const params = new URLSearchParams('post_ids=1036-1037&supplier[]=7&search=foo');
    const post_ids: GridFilterMeta = {
      id: 'post_ids',
      label: 'Product IDs',
      type: 'numeric_ids',
      optionsSource: 'none',
      options: [],
      priority: 29,
    };
    deleteUnreservedFilterParams(params, [], [post_ids]);
    expect(params.has('post_ids')).toBe(false);
    expect(params.getAll('supplier[]')).toEqual([]); // array shape also swept
    expect(params.get('search')).toBe('foo');
  });

  it('does not mix array + bespoke shapes for the same filter id', () => {
    // If both shapes are present (shouldn't happen in practice), the bespoke read wins and the
    // array form is ignored — keeps the filter's value uniquely sourced.
    const params = new URLSearchParams('post_ids=1036-1037&post_ids[]=9999');
    const post_ids: GridFilterMeta = {
      id: 'post_ids',
      label: 'Product IDs',
      type: 'numeric_ids',
      optionsSource: 'none',
      options: [],
      priority: 29,
    };
    expect(readUnreservedFilterValuesFromParams(params, [], [post_ids])).toEqual({
      post_ids: ['1036', '1037'],
    });
  });

  it('reads, writes, and deletes the fmod[id][key] modifier bag', () => {
    const read = readFilterModifiersFromParams(
      new URLSearchParams('fmod[supplier][mode]=all&supplier[]=7&search=x'),
    );
    expect(read).toEqual({ supplier: { mode: 'all' } });

    const params = new URLSearchParams('search=x');
    writeFilterModifiersToParams(params, { supplier: { mode: 'none' }, vendor: { mode: '' } });
    expect(params.get('fmod[supplier][mode]')).toBe('none');
    expect(params.has('fmod[vendor][mode]')).toBe(false); // empty skipped

    deleteFilterModifierParams(params);
    expect(params.has('fmod[supplier][mode]')).toBe(false);
    expect(params.get('search')).toBe('x');
  });
});

const stockLevel: GridFilterMeta = {
  id: 'stock_level',
  label: 'Stock level',
  type: 'range',
  optionsSource: 'none',
  options: [],
  priority: 35,
  scopes: [
    { value: 'atp', label: 'Available' },
    { value: 'res', label: 'Reserved' },
    { value: 'ctd', label: 'Committed' },
  ],
  defaultScopes: ['atp'],
};

describe('gridFiltersToDescriptors — scopes', () => {
  const values = () => ({ stock_level: ['1', '10'] });

  it('offers the picker and falls back to the declared default scopes', () => {
    const captured: string[][] = [];
    const [d] = gridFiltersToDescriptors([stockLevel], values, () => {}, {
      modifiers: () => ({}),
      summarize: (v) => `${v[0]} – ${v[1]}`,
      extraFor: ({ scopes }) => {
        captured.push(scopes());
        return 'PICKER';
      },
    });

    expect(d.extra?.()).toBe('PICKER');
    expect(captured[0]).toEqual(['atp']);
  });

  it('names the measured slots in the chip summary, since a band alone says nothing', () => {
    const [d] = gridFiltersToDescriptors([stockLevel], values, () => {}, {
      modifiers: () => ({ stock_level: { scopes: 'atp,ctd' } }),
      summarize: (v) => `${v[0]} – ${v[1]}`,
    });

    expect(d.summary).toBe('Available + Committed: 1 – 10');
  });

  it('writes the selection comma-joined into the scalar modifier bag', () => {
    const written: Array<[string, string, string]> = [];
    gridFiltersToDescriptors([stockLevel], values, () => {}, {
      modifiers: () => ({}),
      setModifier: (id, key, value) => written.push([id, key, value]),
      extraFor: ({ setScopes }) => {
        setScopes(['atp', 'ctd']);
        return '';
      },
    })[0].extra?.();

    expect(written).toEqual([['stock_level', 'scopes', 'atp,ctd']]);
  });

  it('restores the default rather than persisting an empty selection', () => {
    const written: Array<[string, string, string]> = [];
    gridFiltersToDescriptors([stockLevel], values, () => {}, {
      modifiers: () => ({ stock_level: { scopes: 'ctd' } }),
      setModifier: (id, key, value) => written.push([id, key, value]),
      // The server reads "no scopes" as "measure everything", so an empty selection would widen
      // the filter instead of narrowing it.
      extraFor: ({ setScopes }) => {
        setScopes([]);
        return '';
      },
    })[0].extra?.();

    expect(written).toEqual([['stock_level', 'scopes', 'atp']]);
  });

  it('leaves a filter without scopes untouched', () => {
    const [d] = gridFiltersToDescriptors([supplier], () => ({ supplier: ['7'] }), () => {}, {
      modifiers: () => ({}),
    });

    expect(d.summary).toBe('ACME');
    expect(d.extra).toBeUndefined();
  });
});
