import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { followUrlSearch } from './followUrlSearch';

/** Effects are deferred to the end of the update cycle, so each step has to settle. */
const settle = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()));

/**
 * The two-way mirror between the search box and the URL, and the direction that nearly ate it.
 *
 * This is tested headlessly rather than through a rendered page because the bug was never about
 * rendering: it was an effect depending on the signal it writes. Reading the local term tracked made
 * every keystroke re-run the sync, reapply a URL that had not caught up, and wipe the box mid-word —
 * so "Dispatch" typed into the field produced an empty box and `?q=h`.
 */
describe('followUrlSearch', () => {
  it('leaves a person typing alone while the URL lags behind', async () => {
    await createRoot(async (dispose) => {
      // The URL starts empty and stays empty: its write is debounced, so during typing it is always
      // behind. That lag is the condition the bug needed, and it is a real one.
      const [url] = createSignal<string | undefined>('');
      const [term, setTerm] = createSignal('');
      followUrlSearch(url, term, setTerm);
      await settle();

      for (const typed of ['D', 'Di', 'Dis', 'Disp', 'Dispa', 'Dispat', 'Dispatc', 'Dispatch']) {
        setTerm(typed);
        await settle();
        expect(term()).toBe(typed);
      }

      dispose();
    });
  });

  it('applies the URL when the URL is what changed', async () => {
    await createRoot(async (dispose) => {
      const [url, setUrl] = createSignal<string | undefined>('');
      const [term, setTerm] = createSignal('');
      followUrlSearch(url, term, setTerm);
      await settle();

      // A link arriving filtered, or the back button: the box must follow.
      setUrl('dispatch');
      await settle();
      expect(term()).toBe('dispatch');

      // And an empty URL is a value, not an absence — it means the term was cleared.
      setUrl('');
      await settle();
      expect(term()).toBe('');

      dispose();
    });
  });

  it('is a no-op when the mirror finally catches up', async () => {
    await createRoot(async (dispose) => {
      const [url, setUrl] = createSignal<string | undefined>('');
      const [term, setTerm] = createSignal('');
      let writes = 0;
      followUrlSearch(url, term, (t) => {
        ++writes;
        setTerm(t);
      });
      await settle();

      setTerm('dispatch'); // typed
      await settle();
      setUrl('dispatch'); // the debounced mirror lands
      await settle();

      expect(term()).toBe('dispatch');
      // The echo of our own write must not be reapplied — harmless here, but it is the same
      // feedback that becomes a loop once anything downstream reacts to the term.
      expect(writes).toBe(0);

      dispose();
    });
  });

  it('leaves the box alone when there is no URL to mirror', async () => {
    await createRoot(async (dispose) => {
      // The standalone admin page: no router, so the host passes nothing and the box just works.
      const [url] = createSignal<string | undefined>(undefined);
      const [term, setTerm] = createSignal('already typed');
      followUrlSearch(url, term, setTerm);
      await settle();

      expect(term()).toBe('already typed');

      dispose();
    });
  });
});
