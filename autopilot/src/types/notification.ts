// Notification type definitions - stub interfaces for later phases

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationType = 'question' | 'progress' | 'error' | 'complete';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  respondUrl?: string;
  options?: string[];
  phase?: number;
  step?: string;
  createdAt: string;
}

export interface NotificationAdapter {
  name: string;
  send(notification: Notification): Promise<void>;
}
