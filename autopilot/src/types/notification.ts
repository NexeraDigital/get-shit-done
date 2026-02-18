// Notification type definitions with full lifecycle adapter contract

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationType = 'question' | 'progress' | 'error' | 'complete';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  respondUrl?: string;       // Dashboard URL for question responses
  options?: string[];         // Question option labels
  phase?: number;
  step?: string;
  createdAt: string;
  // Stop notification extras
  summary?: string;           // e.g. "3 of 7 phases completed in 45 min"
  nextSteps?: string;         // e.g. "Run --resume to continue" or "Check verification gaps"
  errorMessage?: string;      // Error details if type is 'error'
}

export interface NotificationAdapter {
  readonly name: string;
  init(): Promise<void>;
  send(notification: Notification): Promise<void>;
  close(): Promise<void>;
}
