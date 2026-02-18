/**
 * SystemAdapter: Sends OS-native toast notifications via node-notifier.
 *
 * Per research Pitfall 2: node-notifier is CJS-only and requires createRequire
 * workaround in this ESM project.
 *
 * Note: node-notifier is an optional dependency (added in Plan 03).
 * If require('node-notifier') fails (not installed), init() throws and
 * NotificationManager gracefully removes this adapter (per Plan 01 init failure handling).
 */

import { createRequire } from 'node:module';
import type { Notification, NotificationAdapter } from '../types.js';

const require = createRequire(import.meta.url);

interface NodeNotifier {
  notify(opts: Record<string, unknown>, cb?: (err: unknown) => void): void;
}

export class SystemAdapter implements NotificationAdapter {
  readonly name = 'system';

  private notifier: NodeNotifier | null = null;

  /** Load node-notifier via createRequire for ESM+CJS compatibility. */
  async init(): Promise<void> {
    // Dynamic require -- throws if node-notifier not installed
    const nn = require('node-notifier') as NodeNotifier;
    this.notifier = nn;
  }

  /** Send OS-native toast notification. */
  async send(notification: Notification): Promise<void> {
    if (!this.notifier) {
      throw new Error('SystemAdapter not initialized -- call init() first');
    }

    const notifier = this.notifier;
    return new Promise<void>((resolve, reject) => {
      notifier.notify(
        {
          title: notification.title,
          message: notification.body,
          sound: notification.type === 'question',
          wait: false,
        },
        (err: unknown) => {
          if (err) reject(err as Error);
          else resolve();
        },
      );
    });
  }

  /** Release the notifier reference. */
  async close(): Promise<void> {
    this.notifier = null;
  }
}
