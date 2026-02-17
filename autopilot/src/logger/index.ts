import { EventEmitter } from 'node:events';
import pino from 'pino';
import type { Logger } from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RingBuffer } from './ring-buffer.js';
import type { LogEntry, LogLevel } from '../types/index.js';

const DEFAULT_RING_BUFFER_SIZE = 1000;

/**
 * Subset of the SonicBoom interface used by the logger.
 * Avoids importing sonic-boom directly while maintaining type safety.
 */
interface SonicBoomDest {
  flushSync(): void;
  once(event: string, listener: () => void): void;
  removeAllListeners(event: string): void;
  destroyed?: boolean;
}

/** Wait for a pino destination to become ready, then flushSync. */
function waitForReadyAndFlush(dest: SonicBoomDest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (dest.destroyed) {
      resolve();
      return;
    }
    // SonicBoom fires 'ready' when the file descriptor is open.
    // Set up a listener in case it's not ready yet.
    dest.once('ready', () => {
      try {
        dest.flushSync();
        resolve();
      } catch (err) {
        reject(err as Error);
      }
    });
    // If already ready (fd is open), flushSync will succeed immediately.
    try {
      dest.flushSync();
      // Success -- already ready. Remove the pending listener.
      dest.removeAllListeners('ready');
      resolve();
    } catch {
      // Not ready yet -- the 'ready' listener above will handle it.
    }
  });
}

/**
 * Structured logger with pino for JSON file output and an in-memory
 * ring buffer for future SSE streaming to the dashboard.
 *
 * - Writes structured JSON to per-phase-step log files
 * - Maintains an in-memory ring buffer of recent LogEntry objects
 * - Ring buffer is populated synchronously in log(), not in pino's stream pipeline
 * - Creates the log directory automatically if it does not exist
 */
export class AutopilotLogger extends EventEmitter {
  private readonly logger: Logger;
  private readonly destination: SonicBoomDest;
  private readonly ringBuffer: RingBuffer<LogEntry>;
  private readonly logDir: string;

  constructor(logDir: string, ringBufferSize = DEFAULT_RING_BUFFER_SIZE) {
    super();
    this.logDir = logDir;
    this.ringBuffer = new RingBuffer<LogEntry>(ringBufferSize);

    // Ensure log directory exists (pitfall #4: pino.destination does not create dirs)
    mkdirSync(logDir, { recursive: true });

    // Create destination with async I/O for performance
    const dest = pino.destination({
      dest: join(logDir, 'autopilot.log'),
      sync: false,
    });
    this.destination = dest as unknown as SonicBoomDest;

    // Default logger writes to a general log file
    this.logger = pino(
      {
        level: 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      dest,
    );
  }

  /**
   * Create a pino logger that writes to a phase-step specific log file.
   * Per user decision: one log file per phase-step (e.g., phase-1-plan.log).
   */
  createPhaseLogger(phase: number, step: string): Logger {
    const dest = pino.destination({
      dest: join(this.logDir, `phase-${phase}-${step}.log`),
      sync: false,
    });
    return pino(
      {
        level: 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      dest,
    );
  }

  /**
   * Log a message at the given level.
   *
   * - Creates a LogEntry and pushes it to the ring buffer (synchronous)
   * - Forwards to pino logger at the appropriate level
   */
  log(
    level: LogLevel,
    component: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      phase: meta?.['phase'] as number | undefined,
      step: meta?.['step'] as string | undefined,
      meta,
    };

    // Push to ring buffer synchronously (per research: keep separate from pino pipeline)
    this.ringBuffer.push(entry);

    // Emit entry event for real-time SSE delivery
    this.emit('entry', entry);

    // Forward to pino at the appropriate level
    this.logger[level]({ component, ...meta }, message);
  }

  /** Return all recent log entries from the ring buffer (oldest first). */
  getRecentEntries(): LogEntry[] {
    return this.ringBuffer.toArray();
  }

  /** Return the ring buffer instance (for SSE consumers in Phase 5). */
  getRingBuffer(): RingBuffer<LogEntry> {
    return this.ringBuffer;
  }

  /** Flush pino's async SonicBoom destination (for graceful shutdown). */
  async flush(): Promise<void> {
    await waitForReadyAndFlush(this.destination);
  }
}
