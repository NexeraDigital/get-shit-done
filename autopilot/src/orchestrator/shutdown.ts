// ShutdownManager - Graceful Ctrl+C handling with LIFO cleanup handlers
// Traps SIGINT/SIGTERM, invokes stop callback, runs cleanup in reverse order
// Supports double-SIGINT force exit and per-handler timeouts

export const FORCE_EXIT_WINDOW_MS = 3000;
const HANDLER_TIMEOUT_MS = 5000;

export interface ShutdownInstallOptions {
  killChildProcesses?: () => Promise<void>;
}

export class ShutdownManager {
  private handlers: Array<() => Promise<void>> = [];
  private _shuttingDown = false;
  private firstSignalTime: number | null = null;
  private signalHandler: (() => void) | null = null;
  /** Exposed for testing: resolves when async cleanup completes. */
  _cleanupPromise: Promise<void> | null = null;

  /**
   * Whether shutdown has been initiated.
   */
  get isShuttingDown(): boolean {
    return this._shuttingDown;
  }

  /**
   * Register a cleanup handler. Handlers run in LIFO order during shutdown.
   */
  register(handler: () => Promise<void>): void {
    this.handlers.push(handler);
  }

  /**
   * Install signal handlers for SIGINT and SIGTERM.
   * @param onShutdownRequested - Called immediately when signal received (signals orchestrator to stop)
   * @param exitFn - Exit function (default: process.exit). Injectable for testing.
   * @param options - Optional: killChildProcesses callback for process tree termination
   */
  install(
    onShutdownRequested: () => void,
    exitFn: (code: number) => void = (code) => process.exit(code),
    options?: ShutdownInstallOptions,
  ): void {
    this.signalHandler = () => {
      if (this._shuttingDown) {
        // Double-signal handling
        if (this.firstSignalTime !== null && Date.now() - this.firstSignalTime < FORCE_EXIT_WINDOW_MS) {
          // Within force exit window -- immediate exit with no cleanup
          exitFn(1);
        }
        // Outside window -- ignore (already shutting down, handlers still running)
        return;
      }

      this._shuttingDown = true;
      this.firstSignalTime = Date.now();

      // Signal orchestrator to stop after current step
      onShutdownRequested();

      // Run async cleanup in the background (signal handler is sync)
      this._cleanupPromise = (async () => {
        // Kill child processes first if callback provided
        if (options?.killChildProcesses) {
          try {
            await options.killChildProcesses();
          } catch {
            // Best-effort
          }
        }

        // Run handlers in reverse registration order (LIFO) with per-handler timeout
        for (const handler of [...this.handlers].reverse()) {
          try {
            await Promise.race([
              handler(),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT_MS),
              ),
            ]);
          } catch {
            // Best-effort: catch errors/timeouts to ensure remaining handlers run
          }
        }

        exitFn(1);
      })();
    };

    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
  }

  /**
   * Remove signal listeners. Call this for test cleanup.
   */
  uninstall(): void {
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      this.signalHandler = null;
    }
  }
}
