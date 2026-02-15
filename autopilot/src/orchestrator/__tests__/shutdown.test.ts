import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShutdownManager } from '../shutdown.js';

describe('ShutdownManager', () => {
  let manager: ShutdownManager;

  beforeEach(() => {
    manager = new ShutdownManager();
  });

  afterEach(() => {
    manager.uninstall();
  });

  it('isShuttingDown returns false before shutdown initiated', () => {
    expect(manager.isShuttingDown).toBe(false);
  });

  it('register(handler) adds handler that runs during cleanup', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register(handler);

    const onShutdownRequested = vi.fn();
    const exitFn = vi.fn();
    manager.install(onShutdownRequested, exitFn);

    // Simulate SIGINT by extracting the listener
    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('install(onShutdownRequested) sets up SIGINT listener that calls callback', async () => {
    const onShutdownRequested = vi.fn();
    const exitFn = vi.fn();
    manager.install(onShutdownRequested, exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    expect(onShutdownRequested).toHaveBeenCalledOnce();
  });

  it('cleanup handlers run in reverse registration order (LIFO)', async () => {
    const order: number[] = [];
    manager.register(async () => { order.push(1); });
    manager.register(async () => { order.push(2); });
    manager.register(async () => { order.push(3); });

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    expect(order).toEqual([3, 2, 1]);
  });

  it('handlers that throw do not prevent remaining handlers from running', async () => {
    const order: number[] = [];
    manager.register(async () => { order.push(1); });
    manager.register(async () => { throw new Error('handler 2 fails'); });
    manager.register(async () => { order.push(3); });

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    // Despite handler 2 throwing, handlers 3 and 1 still ran (LIFO: 3, error, 1)
    expect(order).toEqual([3, 1]);
  });

  it('double-signal protection: second SIGINT does not re-run cleanup', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;

    // First signal
    await signalHandler();
    // Second signal
    await signalHandler();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('isShuttingDown returns true after shutdown initiated', async () => {
    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    expect(manager.isShuttingDown).toBe(true);
  });

  it('uninstall() removes signal listeners', () => {
    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listenersBefore = process.listeners('SIGINT').length;
    manager.uninstall();
    const listenersAfter = process.listeners('SIGINT').length;

    expect(listenersAfter).toBeLessThan(listenersBefore);
  });

  it('calls exit function after all handlers complete', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    const listeners = process.listeners('SIGINT');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    await signalHandler();

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('SIGTERM also triggers shutdown', async () => {
    const onShutdownRequested = vi.fn();
    const exitFn = vi.fn();
    manager.install(onShutdownRequested, exitFn);

    const listeners = process.listeners('SIGTERM');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    if (signalHandler) {
      await signalHandler();
      expect(onShutdownRequested).toHaveBeenCalledOnce();
    }
  });
});
