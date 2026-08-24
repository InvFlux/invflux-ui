import { describe, expect, it } from 'vitest';
import { cascadeAllocate } from './onHandCascade';

describe('cascadeAllocate (client mirror of PHP OnHandCascade)', () => {
  it('zero delta moves nothing', () => {
    expect(cascadeAllocate(0, 5, 2, 3, 0)).toEqual({ atp: 0, res: 0, ctd: 0 });
  });

  it('negative drains atp → res → ctd (worked example: 3/2/5 lose 8)', () => {
    expect(cascadeAllocate(-8, 3, 2, 5, 0)).toEqual({ atp: -3, res: -2, ctd: -3 });
  });

  it('small loss comes entirely from atp', () => {
    expect(cascadeAllocate(-2, 5, 2, 3, 0)).toEqual({ atp: -2, res: 0, ctd: 0 });
  });

  it('loss exactly draining atp spills nothing into res', () => {
    expect(cascadeAllocate(-5, 5, 2, 3, 0)).toEqual({ atp: -5, res: 0, ctd: 0 });
  });

  it("loss clamps at the on-hand total (can't drain past what's there)", () => {
    // fs0 res0 sd2 total2, lose 8 → only 2 removable, all from ctd
    expect(cascadeAllocate(-8, 0, 0, 2, 1)).toEqual({ atp: 0, res: 0, ctd: -2 });
  });

  it('positive with no deficit lands entirely on atp', () => {
    expect(cascadeAllocate(6, 5, 2, 3, 0)).toEqual({ atp: 6, res: 0, ctd: 0 });
  });

  it('positive heals the ctd deficit first, then overflows to atp (restore example)', () => {
    // after loss: fs0 res0 sd2, ctd deficit 1; restore +8 → ctd +1, atp +7, res untouched
    expect(cascadeAllocate(8, 0, 0, 2, 1)).toEqual({ atp: 7, res: 0, ctd: 1 });
  });

  it('positive smaller than the deficit goes entirely to ctd', () => {
    expect(cascadeAllocate(2, 0, 0, 2, 5)).toEqual({ atp: 0, res: 0, ctd: 2 });
  });
});
