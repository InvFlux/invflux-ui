import { describe, expect, it } from 'vitest';
import { splitGloss } from './gloss';

describe('splitGloss', () => {
  it('splits a product heading into its name and the bracketed translation', () => {
    expect(splitGloss({ sku: 'bridge-cost-layers', title: 'Cost Layers (Couches de coût)' })).toEqual({
      name: 'Cost Layers',
      gloss: 'Couches de coût',
    });
  });

  it('leaves a product heading without a translation whole', () => {
    expect(splitGloss({ sku: 'bridge-cost-layers', title: 'Cost Layers' })).toEqual({
      name: 'Cost Layers',
      gloss: null,
    });
  });

  it('never splits a node that is not a product', () => {
    expect(splitGloss({ sku: null, title: 'Value stock first in, first out (FIFO)' })).toEqual({
      name: 'Value stock first in, first out (FIFO)',
      gloss: null,
    });
  });
});
