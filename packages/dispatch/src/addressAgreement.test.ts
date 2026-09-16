import { describe, expect, it } from 'vitest';
import { ADDRESS_FIELDS, hasAddress, sameAddress } from './addressAgreement';
import type { OrderAddress } from './types';

const ADDRESS: OrderAddress = {
  firstName: 'Alice',
  lastName: 'Roux',
  company: null,
  line1: '12 rue du Marché',
  line2: null,
  city: 'Genève',
  state: 'GE',
  postcode: '1204',
  country: 'CH',
};

describe('hasAddress', () => {
  it('reads a struct of nulls as no address', () => {
    // What the detail read returns for a virtual order: the columns were selected, so the object
    // exists; nothing was captured, so there is nothing to show.
    const blank = Object.fromEntries(
      ADDRESS_FIELDS.map((f) => [f, null]),
    ) as unknown as OrderAddress;
    expect(hasAddress(blank)).toBe(false);
  });

  it('reads one stated field as an address', () => {
    expect(hasAddress({ ...ADDRESS, line1: null, city: 'Genève' })).toBe(true);
  });

  it('treats whitespace as blank', () => {
    const spaces = Object.fromEntries(
      ADDRESS_FIELDS.map((f) => [f, '   ']),
    ) as unknown as OrderAddress;
    expect(hasAddress(spaces)).toBe(false);
  });
});

describe('sameAddress', () => {
  it('agrees on two identical addresses', () => {
    expect(sameAddress(ADDRESS, { ...ADDRESS })).toBe(true);
  });

  it('does not agree when one line differs', () => {
    // The case that prompted the affordance: everything matches except a line the shipping address
    // carries and the billing one does not.
    expect(sameAddress({ ...ADDRESS, line2: 'Étage 2' }, ADDRESS)).toBe(false);
  });

  it('reads null and empty string as the same absence', () => {
    // A checkout that stored "" for a line the customer left empty states the same address as one
    // that stored nothing, and an operator comparing them by eye would say so.
    expect(sameAddress({ ...ADDRESS, line2: null }, { ...ADDRESS, line2: '' })).toBe(true);
  });

  it('does not agree that two empty addresses are the same address', () => {
    // Otherwise a virtual order — which captures neither — would be offered a mirrored correction
    // across two blocks that state nothing.
    const blank = Object.fromEntries(
      ADDRESS_FIELDS.map((f) => [f, null]),
    ) as unknown as OrderAddress;
    expect(sameAddress(blank, { ...blank })).toBe(false);
  });

  it('compares every field it renders', () => {
    // Each field on its own must be able to break the agreement. A field silently dropped from the
    // comparison would make the card claim two addresses match while printing one of them wrong,
    // and would offer a mirror the server then declines.
    for (const field of ADDRESS_FIELDS) {
      expect(sameAddress(ADDRESS, { ...ADDRESS, [field]: 'something else' })).toBe(false);
    }
  });

  it('ignores the contact block, which the wire does not carry on an address', () => {
    // The parties differ by construction — a billing party states the order's email and a shipping
    // one states none — which is exactly why this compares postal fields rather than identity.
    expect(Object.keys(ADDRESS)).not.toContain('contactEmail');
    expect(ADDRESS_FIELDS).not.toContain('contactEmail');
  });
});
