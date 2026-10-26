import { ApiError } from '@invflux/ui/api';
import { describe, expect, it } from 'vitest';
import { statusMeaningRefusal } from './api';

describe('statusMeaningRefusal — the apply route’s reason, read at the boundary', () => {
  it('reads the sentence the route refuses with', () => {
    const err = new ApiError(403, { error: 'You do not have permission.' });

    expect(statusMeaningRefusal(err)).toBe('You do not have permission.');
  });

  it('is null for a server failure, whose body is not a reason for the merchant', () => {
    expect(statusMeaningRefusal(new ApiError(500, { error: 'Boom' }))).toBeNull();
  });

  it('is null when nothing was answered at all', () => {
    expect(statusMeaningRefusal(new ApiError(0, undefined))).toBeNull();
    expect(statusMeaningRefusal(new Error('offline'))).toBeNull();
  });

  it('is null for a refusal without a sentence', () => {
    expect(statusMeaningRefusal(new ApiError(422, { error: '' }))).toBeNull();
    expect(statusMeaningRefusal(new ApiError(422, { code: 'rest_forbidden' }))).toBeNull();
  });
});
