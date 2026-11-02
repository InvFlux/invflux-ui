import { describe, expect, it } from 'vitest';
import { productHeading } from './productHeading';

describe('roadmap product headings', () => {
  it('makes a top-level product an h2', () => {
    expect(productHeading({ sku: 'pro' }, 0)).toBe('h2');
  });

  it('makes a product inside a product an h3', () => {
    expect(productHeading({ sku: 'bridge-scanner-ops' }, 1)).toBe('h3');
  });

  it('stops at h4, however deep products nest', () => {
    expect(productHeading({ sku: 'addon-a' }, 2)).toBe('h4');
    expect(productHeading({ sku: 'addon-b' }, 5)).toBe('h4');
  });

  it('leaves a feature as a plain row, even at the top level', () => {
    expect(productHeading({ sku: null }, 0)).toBeNull();
    expect(productHeading({ sku: null }, 1)).toBeNull();
  });
});
