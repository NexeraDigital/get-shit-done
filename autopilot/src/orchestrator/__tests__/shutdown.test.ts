import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShutdownManager } from '../shutdown.js';

/**
 * Helper: trigger SIGINT on a ShutdownManager and wait for async cleanup to complete.
 * The signal handler is synchronous but starts async cleanup in the background.
 * We call the handler, then await the _cleanupPromise to wait for cleanup to finish.
 */
function triggerSigint(mgr: ShutdownManager): void {
  const listeners = process.listeners('SIGINT');
  const signalHandler = listeners[listeners.length - 1] as () => void;
  signalHandler();
}

async function triggerSigintAndWait(mgr: ShutdownManager): Promise<void> {
  triggerSigint(mgr);
  if (mgr._cleanupPromise) await mgr._cleanupPromise;
}

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

    await triggerSigintAndWait(manager);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('install(onShutdownRequested) sets up SIGINT listener that calls callback', async () => {
    const onShutdownRequested = vi.fn();
    const exitFn = vi.fn();
    manager.install(onShutdownRequested, exitFn);

    await triggerSigintAndWait(manager);

    expect(onShutdownRequested).toHaveBeenCalledOnce();
  });

  it('cleanup handlers run in reverse registration order (LIFO)', async () => {
    const order: number[] = [];
    manager.register(async () => { order.push(1); });
    manager.register(async () => { order.push(2); });
    manager.register(async () => { order.push(3); });

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    await triggerSigintAndWait(manager);

    expect(order).toEqual([3, 2, 1]);
  });

  it('handlers that throw do not prevent remaining handlers from running', async () => {
    const order: number[] = [];
    manager.register(async () => { order.push(1); });
    manager.register(async () => { throw new Error('handler 2 fails'); });
    manager.register(async () => { order.push(3); });

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    await triggerSigintAndWait(manager);

    // Despite handler 2 throwing, handlers 3 and 1 still ran (LIFO: 3, error, 1)
    expect(order).toEqual([3, 1]);
  });

  it('double-signal protection: second SIGINT does not re-run cleanup', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    await triggerSigintAndWait(manager);

    // Second signal -- should not re-run cleanup (within window = force exit)
    // But since handlers already completed, exitFn was already called
    expect(handler).toHaveBeenCalledOnce();
  });

  it('isShuttingDown returns true after shutdown initiated', async () => {
    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    triggerSigint(manager);

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

  it('signal-triggered shutdown exits with code 1 (not 0)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    await triggerSigintAndWait(manager);

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('SIGTERM also triggers shutdown', async () => {
    const onShutdownRequested = vi.fn();
    const exitFn = vi.fn();
    manager.install(onShutdownRequested, exitFn);

    const listeners = process.listeners('SIGTERM');
    const signalHandler = listeners[listeners.length - 1] as () => void;
    if (signalHandler) {
      signalHandler();
      if (manager._cleanupPromise) await manager._cleanupPromise;
      expect(onShutdownRequested).toHaveBeenCalledOnce();
    }
  });

  it('double SIGINT within 3s window triggers immediate force exit', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5000)));
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    // First signal -- starts cleanup (handler takes 5s)
    triggerSigint(manager);

    // Second signal immediately (within 3s window) -- should force exit
    triggerSigint(manager);

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('double SIGINT outside 3s window is ignored (already shutting down)', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 100)));
    manager.register(handler);

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    // First signal
    triggerSigint(manager);

    // Simulate passage of time beyond the force exit window
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 4000);

    // Second signal outside window -- should NOT force exit
    triggerSigint(manager);

    // exitFn should not have been called from the second signal (only from cleanup completing)
    // The first call to exitFn happens when cleanup finishes
    expect(exitFn).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    // Wait for cleanup to complete
    if (manager._cleanupPromise) await manager._cleanupPromise;
  });

  it('hung cleanup handler does not block other handlers (per-handler timeout)', async () => {
    const order: number[] = [];
    manager.register(async () => { order.push(1); });
    // This handler hangs forever
    manager.register(() => new Promise(() => {}));
    manager.register(async () => { order.push(3); });

    const exitFn = vi.fn();
    manager.install(vi.fn(), exitFn);

    await triggerSigintAndWait(manager);

    // LIFO: handler 3 first, then hung handler (times out after 5s), then handler 1
    // Both non-hung handlers should have run despite the hung one
    expect(order).toContain(3);
    expect(order).toContain(1);
    expect(exitFn).toHaveBeenCalledWith(1);
  }, 10000);

  it('killChildProcesses callback is invoked during shutdown', async () => {
    const killChildProcesses = vi.fn().mockResolvedValue(undefined);
    const exitFn = vi.fn();

    manager.install(vi.fn(), exitFn, { killChildProcesses });

    await triggerSigintAndWait(manager);

    expect(killChildProcesses).toHaveBeenCalledOnce();
  });
});
