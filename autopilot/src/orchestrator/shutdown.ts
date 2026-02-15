// ShutdownManager - Graceful Ctrl+C handling with LIFO cleanup handlers
// Traps SIGINT/SIGTERM, invokes stop callback, runs cleanup in reverse order

export class ShutdownManager {
  private handlers: Array<() => Promise<void>> = [];
  private _shuttingDown = false;
  private signalHandler: (() => Promise<void>) | null = null;

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
   */
  install(
    onShutdownRequested: () => void,
    exitFn: (code: number) => void = (code) => process.exit(code),
  ): void {
    this.signalHandler = async () => {
      if (this._shuttingDown) return; // Double-shutdown guard
      this._shuttingDown = true;

      // Signal orchestrator to stop after current step
      onShutdownRequested();

      // Run handlers in reverse registration order (LIFO) with best-effort cleanup
      for (const handler of [...this.handlers].reverse()) {
        try {
          await handler();
        } catch {
          // Best-effort: catch errors to ensure remaining handlers run
        }
      }

      exitFn(0);
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
