import { describe, expect, it } from 'vitest';
import {
  defaultReasonFor,
  deriveType,
  outOfStockCap,
  partiesFor,
  reasonApplies,
  reasonsFor,
  shelvedQty,
  stockFatesFor,
  stockFor,
  stockReadout,
} from './correctionChoice';
import type { CorrectionReason, CorrectionType } from './types';

const type = (
  code: CorrectionType['code'],
  preDispatch: boolean,
  restock: boolean,
): CorrectionType => ({
  code,
  name: code,
  preDispatch,
  restock,
  refund: true,
});

/** The set an install without after-shipment corrections offers. */
const ESSENTIALS: CorrectionType[] = [
  type('cancel_customer', true, true),
  type('cancel_merchant', true, true),
  type('writeoff_defective', true, false),
  type('writeoff_missing', true, false),
];

const reason = (
  code: string,
  cause: CorrectionReason['cause'],
  timing: CorrectionReason['timing'],
  writeOff = false,
): CorrectionReason => ({ code, name: code, cause, timing, writeOff });

const REASONS: CorrectionReason[] = [
  reason('change_mind', 'customer', 'any'),
  reason('wrong_size', 'customer', 'post'),
  reason('defective', 'merchant', 'any', true),
  reason('short_pick', 'merchant', 'pre', true),
  reason('out_of_stock', 'merchant', 'pre'),
  reason('pricing_error', 'merchant', 'pre'),
  reason('wrong_item', 'merchant', 'post'),
  reason('lost', 'logistics', 'post'),
];

const byCode = (code: string): CorrectionReason => REASONS.find((r) => r.code === code)!;

const SHORT = { deficit: true, writeOffAllowed: { defective: true, short_pick: true } };
const IN_STOCK = { deficit: false, writeOffAllowed: { defective: false, short_pick: false } };
const EMPTY_SHELF = { deficit: false, writeOffAllowed: { defective: true, short_pick: true } };
/** Nothing for sale, but other orders' units should still be on the shelf. */
const SHELF_FOR_OTHERS = {
  deficit: false,
  writeOffAllowed: { defective: true, short_pick: false },
};

describe('deriveType', () => {
  const pre = { timing: 'pre' as const };

  it('puts a customer cancellation back on the shelf', () => {
    expect(
      deriveType(ESSENTIALS, {
        ...pre,
        party: 'customer',
        stock: 'shelf',
        reasonCode: 'change_mind',
      })?.code,
    ).toBe('cancel_customer');
  });

  it('keeps a merchant cancellation apart from a customer one', () => {
    expect(
      deriveType(ESSENTIALS, {
        ...pre,
        party: 'merchant',
        stock: 'shelf',
        reasonCode: 'pricing_error',
      })?.code,
    ).toBe('cancel_merchant');
  });

  it('writes off defective goods as defective, and goods missing at pick as missing', () => {
    expect(
      deriveType(ESSENTIALS, {
        ...pre,
        party: 'merchant',
        stock: 'writeOff',
        reasonCode: 'defective',
      })?.code,
    ).toBe('writeoff_defective');
    expect(
      deriveType(ESSENTIALS, {
        ...pre,
        party: 'merchant',
        stock: 'writeOff',
        reasonCode: 'short_pick',
      })?.code,
    ).toBe('writeoff_missing');
  });

  it('cancels, never writes off, a line that is out of stock', () => {
    const stock = stockFor(REASONS, 'out_of_stock', 'merchant');
    expect(stock).toBe('shelf');
    expect(
      deriveType(ESSENTIALS, { ...pre, party: 'merchant', stock, reasonCode: 'out_of_stock' })
        ?.code,
    ).toBe('cancel_merchant');
  });

  it('never writes goods off on the customer’s account', () => {
    expect(
      deriveType(ESSENTIALS, {
        ...pre,
        party: 'customer',
        stock: 'writeOff',
        reasonCode: 'change_mind',
      }),
    ).toBeNull();
  });

  it('finds no after-shipment type where the server offers none', () => {
    expect(
      deriveType(ESSENTIALS, {
        timing: 'post',
        party: 'customer',
        stock: 'shelf',
        reasonCode: 'wrong_size',
      }),
    ).toBeNull();
  });

  it('after shipment, takes the creatable type that moves the stock the way asked', () => {
    // An install that offers returns sends more codes than the Essentials union names.
    const post = (code: string, restock: boolean): CorrectionType =>
      type(code as CorrectionType['code'], false, restock);
    const withReturns = [
      ...ESSENTIALS,
      post('cancel_reversal', false),
      post('return_resaleable', true),
    ];
    expect(
      deriveType(withReturns, {
        timing: 'post',
        party: 'customer',
        stock: 'shelf',
        reasonCode: 'wrong_size',
      })?.code,
    ).toBe('return_resaleable');
  });
});

describe('what each answer leaves open', () => {
  it('offers the carrier only once the parcel has left', () => {
    expect(partiesFor('pre')).toEqual(['customer', 'merchant']);
    expect(partiesFor('post')).toEqual(['customer', 'merchant', 'logistics']);
  });

  it('offers a write-off only on the merchant’s side', () => {
    expect(stockFatesFor('customer')).toEqual(['shelf']);
    expect(stockFatesFor('merchant')).toEqual(['shelf', 'writeOff']);
  });

  it('narrows reasons to the party and the side of shipment', () => {
    expect(reasonsFor(REASONS, 'pre', 'customer').map((r) => r.code)).toEqual(['change_mind']);
    expect(reasonsFor(REASONS, 'post', 'customer').map((r) => r.code)).toEqual([
      'change_mind',
      'wrong_size',
    ]);
    expect(reasonsFor(REASONS, 'pre', 'merchant').map((r) => r.code)).toEqual([
      'defective',
      'short_pick',
      'out_of_stock',
      'pricing_error',
    ]);
  });
});

describe('which reasons apply to the line, before shipment', () => {
  it('offers "out of stock" only while the product is short', () => {
    expect(reasonApplies(byCode('out_of_stock'), 'pre', SHORT)).toBe(true);
    expect(reasonApplies(byCode('out_of_stock'), 'pre', EMPTY_SHELF)).toBe(false);
  });

  it('offers a write-off only while nothing is left for sale to replace the units', () => {
    expect(reasonApplies(byCode('defective'), 'pre', EMPTY_SHELF)).toBe(true);
    expect(reasonApplies(byCode('short_pick'), 'pre', IN_STOCK)).toBe(false);
    expect(reasonApplies(byCode('pricing_error'), 'pre', IN_STOCK)).toBe(true);
  });

  it('judges each write-off reason on its own rule', () => {
    expect(reasonApplies(byCode('defective'), 'pre', SHELF_FOR_OTHERS)).toBe(true);
    expect(reasonApplies(byCode('short_pick'), 'pre', SHELF_FOR_OTHERS)).toBe(false);
  });

  it('leaves a write-off to the server when the line does not say', () => {
    expect(reasonApplies(byCode('defective'), 'pre', { deficit: false })).toBe(true);
  });

  it('applies neither rule after shipment', () => {
    expect(reasonApplies(byCode('defective'), 'post', IN_STOCK)).toBe(true);
  });
});

describe('defaults', () => {
  it('pre-selects a change of mind for the customer, and out of stock for a short line', () => {
    expect(defaultReasonFor(REASONS, 'pre', 'customer', EMPTY_SHELF)).toBe('change_mind');
    expect(defaultReasonFor(REASONS, 'pre', 'merchant', SHORT)).toBe('out_of_stock');
  });

  it('leaves a merchant reason to the operator when nothing points at one', () => {
    expect(defaultReasonFor(REASONS, 'pre', 'merchant', EMPTY_SHELF)).toBe('');
  });

  it('writes off what the reason says is broken or missing, and shelves the rest', () => {
    expect(stockFor(REASONS, 'short_pick', 'merchant')).toBe('writeOff');
    expect(stockFor(REASONS, 'pricing_error', 'merchant')).toBe('shelf');
    expect(stockFor(REASONS, 'defective', 'customer')).toBe('shelf');
  });
});

describe('shelvedQty', () => {
  it('gives everything back while the product has stock for sale or reserved', () => {
    expect(shelvedQty({ stockAtpQty: 3, stockCtdQty: 5, stockDemandQty: 5 }, 2)).toBe(2);
    expect(
      shelvedQty({ stockAtpQty: 0, stockResQty: 1, stockCtdQty: 5, stockDemandQty: 9 }, 2),
    ).toBe(2);
  });

  it('gives back only what the product’s other orders do not need', () => {
    // 10 wanted, 8 held: cancelling 3 leaves 7 wanted, so 1 goes back.
    expect(shelvedQty({ stockAtpQty: 0, stockCtdQty: 8, stockDemandQty: 10 }, 3)).toBe(1);
    expect(shelvedQty({ stockAtpQty: 0, stockCtdQty: 8, stockDemandQty: 10 }, 2)).toBe(0);
  });

  it('assumes everything goes back when the figures are not known', () => {
    expect(shelvedQty({ stockCtdQty: 0, stockDemandQty: 0 }, 2)).toBe(2);
  });
});

describe('out of stock', () => {
  it('cancels at most what the product is short, so nothing ever goes back on sale', () => {
    expect(outOfStockCap({ stockDeficitQty: 1 }, 3)).toBe(1);
    expect(outOfStockCap({ stockDeficitQty: 5 }, 3)).toBe(3);
    // 10 wanted, 9 held: short by 1. Cancelling that 1 puts nothing back.
    expect(shelvedQty({ stockAtpQty: 0, stockCtdQty: 9, stockDemandQty: 10 }, 1)).toBe(0);
  });

  it('leaves the limit to the server when the shortfall is not known', () => {
    expect(outOfStockCap({}, 3)).toBe(3);
  });

  it('prefers the live shortfall to the cached deficit', () => {
    // Cached deficit 1, but 8 units are for sale: the product is not short.
    expect(outOfStockCap({ shortfallQty: 0, stockDeficitQty: 1 }, 2)).toBe(0);
  });

  it('is not offered on a product that is not short, whatever the cached flag says', () => {
    expect(reasonApplies(byCode('out_of_stock'), 'pre', { deficit: true, shortfall: 0 })).toBe(
      false,
    );
    expect(reasonApplies(byCode('out_of_stock'), 'pre', { deficit: false, shortfall: 1 })).toBe(
      true,
    );
  });
});

describe('stockReadout', () => {
  const short = { stockAtpQty: 0, stockCtdQty: 8, stockDemandQty: 10 };

  it('states a write-off as such', () => {
    expect(stockReadout(short, 'writeOff', 'defective', 2)).toEqual({ kind: 'writtenOff', qty: 2 });
  });

  it('states how much goes back on sale, and when it is only part', () => {
    expect(stockReadout({ stockAtpQty: 3 }, 'shelf', 'pricing_error', 2)).toEqual({
      kind: 'backOnSale',
      shelved: 2,
      qty: 2,
    });
    expect(stockReadout(short, 'shelf', 'pricing_error', 3)).toEqual({
      kind: 'backOnSale',
      shelved: 1,
      qty: 3,
    });
  });

  it('says why nothing goes back', () => {
    expect(stockReadout(short, 'shelf', 'out_of_stock', 2)).toEqual({
      kind: 'nothingBack',
      neverInStock: true,
    });
    expect(stockReadout(short, 'shelf', 'change_mind', 2)).toEqual({
      kind: 'nothingBack',
      neverInStock: false,
    });
  });
});
