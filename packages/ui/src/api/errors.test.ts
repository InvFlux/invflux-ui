import { describe, expect, it } from 'vitest';
import { ApiError, failureMessage } from './errors';

/** A failed request's body, as text an operator can read. */
describe('failureMessage', () => {
  // WordPress's answer to a PHP fatal in a REST request, as the Workbench save showed it verbatim.
  const fatal = {
    code: 'internal_server_error',
    message:
      '<p>There has been a critical error on this website.</p><p><a href="https://wordpress.org/documentation/article/faq-troubleshooting/">Learn more about troubleshooting WordPress.</a></p>',
    data: { status: 500 },
  };

  it('reads a fatal as a server error, never as its page', () => {
    const message = failureMessage(500, fatal) ?? '';
    expect(message).toContain('500');
    expect(message).not.toMatch(/<|critical error/);
    expect(new ApiError(500, fatal).message).toBe(message);
  });

  it('shows any other message as text, markup removed', () => {
    expect(failureMessage(400, { code: 'x', message: 'Invalid SKU.' })).toBe('Invalid SKU.');
    expect(failureMessage(403, { code: 'x', message: '<p>Sorry, <b>no</b>.</p>' })).toBe(
      'Sorry, no.',
    );
    expect(failureMessage(400, { message: '<p>Rock &amp; roll&#8217;s</p><p>Two.</p>' })).toBe(
      'Rock & roll’s Two.',
    );
    expect(failureMessage(500, { code: 'other', message: 'Database unavailable.' })).toBe(
      'Database unavailable.',
    );
  });

  it('prefers the message the route’s own contract carries, and says nothing when there is none', () => {
    expect(failureMessage(400, { error: 'Worksheet not found.' }, 'Worksheet not found.')).toBe(
      'Worksheet not found.',
    );
    expect(failureMessage(400, null)).toBeUndefined();
    expect(failureMessage(400, { message: '<p></p>' })).toBeUndefined();
    expect(new ApiError(404, null).message).toBe('Request failed (404)');
  });
});
