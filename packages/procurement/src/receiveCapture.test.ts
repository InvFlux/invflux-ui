import { describe, expect, it } from 'vitest';
import { activeReceiveCapture, isRefusal, registerReceiveCaptureHandler } from './receiveCapture';

describe('receive capture registry', () => {
  it('is off until a handler is registered, and skips a disabled one', () => {
    expect(activeReceiveCapture()).toBeUndefined();

    let on = false;
    registerReceiveCaptureHandler({
      name: 'test.capture',
      enabled: () => on,
      capture: async () => ({ codes: [] }),
    });
    expect(activeReceiveCapture()).toBeUndefined();

    on = true;
    expect(activeReceiveCapture()?.name).toBe('test.capture');
  });

  it('replaces a handler registered under the same name', () => {
    registerReceiveCaptureHandler({ name: 'Test.Capture', capture: async () => ({ codes: ['x'] }) });
    expect(activeReceiveCapture()?.name).toBe('Test.Capture');
  });

  it('tells a refusal from an answer', () => {
    expect(isRefusal({ refused: 'no' })).toBe(true);
    expect(isRefusal({ codes: [] })).toBe(false);
  });
});
