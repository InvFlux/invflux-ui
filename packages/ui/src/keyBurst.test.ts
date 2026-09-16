import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPendingShortcut, noteKeystroke, runWhenTypingStops } from './keyBurst';

/**
 * The guard that lets a floor surface keep bare-letter shortcuts while a barcode scanner is typing
 * into the page.
 *
 * A scanner is a keyboard with no manners: it emits its payload wherever focus happens to be, so a
 * barcode containing `u` would otherwise navigate the operator away mid-scan.
 */
describe('runWhenTypingStops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelPendingShortcut();
    vi.useRealTimers();
  });

  // The browser reports keystrokes through a capture listener this module installs on `document`;
  // in a node test the same signal is delivered by hand, which is why it is exported.
  const press = (): void => {
    noteKeystroke();
  };

  it('runs a lone keypress, a moment later', () => {
    const action = vi.fn();
    runWhenTypingStops(action);

    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(action).toHaveBeenCalledTimes(1);
  });

  /**
   * The case this exists for. `u` arriving as a character of a barcode is followed by the rest of
   * the barcode within milliseconds, and that is what cancels it.
   */
  it('never runs when the next character of a scan follows', () => {
    const action = vi.fn();
    runWhenTypingStops(action);

    vi.advanceTimersByTime(8); // scanner inter-character gap
    press();
    vi.advanceTimersByTime(500);

    expect(action).not.toHaveBeenCalled();
  });

  it('survives a whole barcode without firing once', () => {
    const action = vi.fn();
    for (const ch of '5u901234u55') {
      if (ch === 'u') runWhenTypingStops(action);
      vi.advanceTimersByTime(9);
      press();
    }
    vi.advanceTimersByTime(500);

    expect(action).not.toHaveBeenCalled();
  });

  /** Two letters in quick succession is typing, not two shortcuts. */
  it('keeps only the last of two shortcuts inside the window', () => {
    const first = vi.fn();
    const second = vi.fn();

    runWhenTypingStops(first);
    vi.advanceTimersByTime(10);
    runWhenTypingStops(second);
    vi.advanceTimersByTime(50);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs again for a second, separate press', () => {
    const action = vi.fn();

    runWhenTypingStops(action);
    vi.advanceTimersByTime(50);
    runWhenTypingStops(action);
    vi.advanceTimersByTime(50);

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('can be cancelled outright, for a surface unmounting under a pending shortcut', () => {
    const action = vi.fn();

    runWhenTypingStops(action);
    cancelPendingShortcut();
    vi.advanceTimersByTime(500);

    expect(action).not.toHaveBeenCalled();
  });
});
