// ShutdownManager - stub for TDD RED phase
// Graceful Ctrl+C handling with LIFO cleanup handlers

export class ShutdownManager {
  get isShuttingDown(): boolean {
    throw new Error('Not implemented');
  }

  register(_handler: () => Promise<void>): void {
    throw new Error('Not implemented');
  }

  install(_onShutdownRequested: () => void, _exitFn?: (code: number) => void): void {
    throw new Error('Not implemented');
  }

  uninstall(): void {
    throw new Error('Not implemented');
  }
}
