// Package entry point - re-exports public API
export {
  AutopilotConfigSchema,
} from './types/index.js';

export type {
  AutopilotStatus,
  PhaseStep,
  PhaseStatus,
  ErrorRecord,
  PendingQuestion,
  PhaseState,
  AutopilotState,
  AutopilotConfig,
  LogLevel,
  LogEntry,
  NotificationSeverity,
  NotificationType,
  Notification,
  NotificationAdapter,
} from './types/index.js';
