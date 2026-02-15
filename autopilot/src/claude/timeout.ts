// Timeout wrapper for Claude Agent SDK command execution.
// Creates an AbortController that aborts after the configured duration.
// Call cleanup() in a finally block to prevent dangling timers.

export interface TimeoutHandle {
  controller: AbortController;
  cleanup: () => void;
}

/**
 * Creates an AbortController that automatically aborts after timeoutMs.
 * Call cleanup() in a finally block to prevent dangling timers.
 *
 * The timer is unref'd so it does not keep the Node.js process alive
 * (prevents vitest hangs and allows clean process exit).
 */
export function createTimeout(timeoutMs: number): TimeoutHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Prevent timer from keeping Node.js process alive
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref();
  }
  const cleanup = () => clearTimeout(timer);
  return { controller, cleanup };
}
