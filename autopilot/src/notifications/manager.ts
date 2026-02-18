/**
 * NotificationManager: Dispatches notifications to all registered adapters
 * via Promise.allSettled for parallel delivery. Console adapter is always
 * included as the fallback zero-dependency channel.
 *
 * Supports question reminders: re-notifies after configurable timeout if the
 * question is still unanswered. Uses timer.unref() to prevent blocking Node exit.
 */

import { randomUUID } from 'node:crypto';
import type { Notification, NotificationAdapter } from './types.js';
import type { NotificationManagerOptions } from './types.js';

export class NotificationManager {
  private readonly adapters: NotificationAdapter[] = [];
  private readonly reminders = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reminderMs: number;

  constructor(options?: Pick<NotificationManagerOptions, 'questionReminderMs'>) {
    this.reminderMs = options?.questionReminderMs ?? 300_000;
  }

  /**
   * Add an adapter to the manager. Call before init().
   * Console adapter should be added first so it acts as the guaranteed fallback.
   */
  addAdapter(adapter: NotificationAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Initialize all adapters. Adapters that fail to init are removed from the list
   * (do NOT crash startup -- Pitfall 5).
   */
  async init(): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.init()),
    );

    // Remove adapters that failed to initialize (iterate in reverse to avoid index shift)
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i]!.status === 'rejected') {
        const adapter = this.adapters[i]!;
        console.warn(
          `[NotificationManager] Adapter "${adapter.name}" failed to init, removing:`,
          (results[i] as PromiseRejectedResult).reason,
        );
        this.adapters.splice(i, 1);
      }
    }
  }

  /**
   * Dispatch a notification to all registered adapters via Promise.allSettled.
   * If ALL adapters fail, logs an error but does not throw.
   */
  async notify(notification: Notification): Promise<void> {
    if (this.adapters.length === 0) {
      console.error('[NotificationManager] No adapters registered, notification dropped:', notification.id);
      return;
    }

    const results = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.send(notification)),
    );

    const allFailed = results.every((r) => r.status === 'rejected');
    if (allFailed) {
      console.error(
        '[NotificationManager] All adapters failed to send notification:',
        notification.id,
        results.map((r) => (r as PromiseRejectedResult).reason),
      );
    }
  }

  /**
   * Start a reminder timer for a pending question. Fires after reminderMs
   * if not cancelled. Uses timer.unref() to prevent blocking Node exit.
   */
  startReminder(questionId: string, notification: Notification): void {
    // Cancel any existing reminder for this question
    this.cancelReminder(questionId);

    const timer = setTimeout(() => {
      this.reminders.delete(questionId);
      void this.notify(notification);
    }, this.reminderMs);

    // Prevent the timer from blocking Node.js process exit (Pitfall 4)
    timer.unref();

    this.reminders.set(questionId, timer);
  }

  /**
   * Cancel the reminder for a specific question (wire to 'question:answered' event).
   */
  cancelReminder(questionId: string): void {
    const timer = this.reminders.get(questionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.reminders.delete(questionId);
    }
  }

  /**
   * Close the manager: cancel all reminders and close all adapters.
   */
  async close(): Promise<void> {
    // Cancel all pending reminders
    for (const [questionId] of this.reminders) {
      this.cancelReminder(questionId);
    }

    await Promise.allSettled(this.adapters.map((adapter) => adapter.close()));
  }

  /**
   * Create a notification with a generated ID and current timestamp.
   * Convenience helper for callers that don't pre-build the object.
   */
  static createNotification(
    partial: Omit<Notification, 'id' | 'createdAt'>,
  ): Notification {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...partial,
    };
  }
}
