// Internal types for the notifications module.
// Re-exports shared types and defines manager-specific types.

export type {
  Notification,
  NotificationAdapter,
  NotificationType,
  NotificationSeverity,
} from '../types/notification.js';

export interface NotificationManagerOptions {
  port: number;                    // For building dashboard URLs
  questionReminderMs?: number;     // Default: 300_000 (5 min)
  stopSpinner?: () => void;        // Callback to stop ora spinner before console writes
}
