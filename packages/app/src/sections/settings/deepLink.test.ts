import { describe, expect, it } from 'vitest';
import { mirroredSearchParam, settingsDeepLink } from './deepLink';

/**
 * The URL → Settings contract.
 *
 * The assertion that earns its place is the locale one: `section` must stay a key. If it ever
 * became a search term, every notice link would be minted in whatever language the admin happened
 * to be in and would match nothing anywhere else — a bug that would never show up on an English
 * install, which is to say never in testing.
 */
describe('settings deep link', () => {
  it('reads a search term verbatim', () => {
    expect(settingsDeepLink({ q: 'stock' }).search).toBe('stock');
    // Including a term that looks like a key, which is not this function's business to judge.
    expect(settingsDeepLink({ q: '__plugin_meta__' }).search).toBe('__plugin_meta__');
  });

  it('treats a missing term as an empty box, not as "leave it alone"', () => {
    // The URL is the source of truth both ways, so arriving without `q` means the filter is clear.
    // Were this undefined, a stale term would survive in a surface that stays mounted.
    expect(settingsDeepLink({}).search).toBe('');
    expect(settingsDeepLink({ q: '' }).search).toBe('');
  });

  it('passes a section key through untranslated', () => {
    expect(settingsDeepLink({ section: '__plugin_meta__' }).revealSection).toBe('__plugin_meta__');
  });

  it('ignores a section that names nothing', () => {
    // An empty value would otherwise start a reveal that can never match, clearing the merchant's
    // filters on the way.
    expect(settingsDeepLink({ section: '' }).revealSection).toBeUndefined();
    expect(settingsDeepLink({}).revealSection).toBeUndefined();
  });

  it('carries the decisions filter, and only on an exact 1', () => {
    expect(settingsDeepLink({ decisions: '1' }).decisions).toBe(true);
    expect(settingsDeepLink({ decisions: 'true' }).decisions).toBe(false);
    expect(settingsDeepLink({}).decisions).toBe(false);
  });

  it('takes the last value of a repeated parameter', () => {
    // Malformed rather than meaningful — but a link that half-works should work, not silently not.
    expect(settingsDeepLink({ q: ['first', 'last'] }).search).toBe('last');
    expect(settingsDeepLink({ section: ['a', '__plugin_meta__'] }).revealSection).toBe(
      '__plugin_meta__',
    );
    expect(settingsDeepLink({ q: [] }).search).toBe('');
  });

  it('combines a term and a section without one defeating the other', () => {
    // A notice link carries only `section`; a person's link carries only `q`. Both together is
    // legitimate and neither is dropped.
    const link = settingsDeepLink({ q: 'plugin', section: '__plugin_meta__' });
    expect(link.search).toBe('plugin');
    expect(link.revealSection).toBe('__plugin_meta__');
  });

  it('drops the parameter rather than mirroring an empty one', () => {
    expect(mirroredSearchParam('')).toBeUndefined();
    expect(mirroredSearchParam('stock')).toBe('stock');
  });
});
