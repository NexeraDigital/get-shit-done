import { describe, it, expect } from 'vitest';
import { createTimeout } from '../timeout.js';

describe('createTimeout', () => {
  it('returns an AbortController and cleanup function', () => {
    const handle = createTimeout(1000);
    expect(handle.controller).toBeInstanceOf(AbortController);
    expect(typeof handle.cleanup).toBe('function');
    handle.cleanup();
  });

  it('controller is not aborted initially', () => {
    const handle = createTimeout(1000);
    expect(handle.controller.signal.aborted).toBe(false);
    handle.cleanup();
  });

  it('controller aborts after timeout', async () => {
    const handle = createTimeout(50);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(handle.controller.signal.aborted).toBe(true);
    handle.cleanup();
  });

  it('cleanup prevents abort', async () => {
    const handle = createTimeout(50);
    handle.cleanup();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(handle.controller.signal.aborted).toBe(false);
  });

  it('abort fires abort event on signal', async () => {
    const handle = createTimeout(50);
    let abortFired = false;
    handle.controller.signal.addEventListener('abort', () => {
      abortFired = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(abortFired).toBe(true);
    handle.cleanup();
  });
});
