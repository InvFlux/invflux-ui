import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toasts, leavingIds, TOAST_EXIT_MS } from './toast';

afterEach(() => {
  toast.clear();
  vi.useRealTimers();
});

describe('toast store', () => {
  it('show appends a toast and returns its id', () => {
    const id = toast.success('Saved');
    const list = toasts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, message: 'Saved', variant: 'success' });
  });

  it('convenience methods set the variant', () => {
    toast.info('i');
    toast.warning('w');
    toast.error('e');
    expect(toasts().map((t) => t.variant)).toEqual(['info', 'warning', 'error']);
  });

  it('dismiss marks leaving, then hard-removes after the exit window; others stay', () => {
    vi.useFakeTimers();
    const a = toast('a');
    const b = toast('b');
    toast.dismiss(a);
    // Lingers (leaving) so the region can fade it out…
    expect(leavingIds().has(a)).toBe(true);
    expect(toasts().map((t) => t.id)).toEqual([a, b]);
    // …then it's gone after the exit window; b is untouched.
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(toasts().map((t) => t.id)).toEqual([b]);
  });

  it('dismiss is idempotent while leaving', () => {
    vi.useFakeTimers();
    const a = toast('a');
    toast.dismiss(a);
    toast.dismiss(a); // no-op (already leaving)
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(toasts()).toHaveLength(0);
  });

  it('auto-dismisses after the duration, then the exit window', () => {
    vi.useFakeTimers();
    const id = toast('bye', { duration: 1000 });
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1000); // duration elapsed → marked leaving
    expect(leavingIds().has(id)).toBe(true);
    vi.advanceTimersByTime(TOAST_EXIT_MS); // fade-out window → removed
    expect(toasts()).toHaveLength(0);
  });

  it('carries an optional action', () => {
    const onClick = vi.fn();
    toast('conflict', { action: { label: 'Reject', onClick } });
    expect(toasts()[0]?.action?.label).toBe('Reject');
  });

  it('duration 0 is sticky (no auto-dismiss)', () => {
    vi.useFakeTimers();
    toast('stay', { duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toasts()).toHaveLength(1);
  });

  it('clear empties everything', () => {
    toast('a');
    toast('b');
    toast.clear();
    expect(toasts()).toHaveLength(0);
  });
});
