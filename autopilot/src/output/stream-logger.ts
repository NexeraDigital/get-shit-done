/**
 * Raw SDK message logger that writes JSON lines to sdk-output.log.
 *
 * Always captures everything regardless of verbosity level.
 * Skips individual text_delta messages to prevent log bloat (Pitfall 3).
 * Uses pino with SonicBoom async destination for non-blocking writes.
 */

import pino from 'pino';
import type { Logger } from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Subset of SonicBoom used for flush. Avoids direct sonic-boom import.
 */
interface SonicBoomDest {
  flushSync(): void;
  once(event: string, listener: () => void): void;
  removeAllListeners(event: string): void;
  destroyed?: boolean;
}

export class StreamLogger {
  private readonly logger: Logger;
  private readonly destination: SonicBoomDest;

  constructor(logDir: string) {
    // Ensure log directory exists
    mkdirSync(logDir, { recursive: true });

    const dest = pino.destination({
      dest: join(logDir, 'sdk-output.log'),
      sync: false,
    });
    this.destination = dest as unknown as SonicBoomDest;

    this.logger = pino(
      {
        level: 'trace',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      dest,
    );
  }

  /**
   * Write an SDK message to the log file as JSON.
   *
   * Skips individual text_delta messages to prevent log bloat.
   * The complete assistant message (type 'assistant') will be logged
   * with all content, so no data is lost.
   */
  write(message: unknown): void {
    if (this.isTextDelta(message)) {
      return;
    }
    this.logger.info({ sdkMessage: message }, 'sdk-message');
  }

  /**
   * Flush the async SonicBoom destination.
   * Uses the ready-then-flushSync pattern from AutopilotLogger.
   */
  async flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destination.destroyed) {
        resolve();
        return;
      }
      this.destination.once('ready', () => {
        try {
          this.destination.flushSync();
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
      try {
        this.destination.flushSync();
        this.destination.removeAllListeners('ready');
        resolve();
      } catch {
        // Not ready yet -- the 'ready' listener will handle it
      }
    });
  }

  /**
   * Duck-type check for text_delta messages (stream_event with content_block_delta + text_delta).
   * These are skipped to prevent logging every character individually.
   */
  private isTextDelta(message: unknown): boolean {
    const msg = message as {
      type?: string;
      event?: {
        type?: string;
        delta?: { type?: string };
      };
    };
    return (
      msg.type === 'stream_event' &&
      msg.event?.type === 'content_block_delta' &&
      msg.event?.delta?.type === 'text_delta'
    );
  }
}
