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
  QuestionItemState,
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

export { loadConfig } from './config/index.js';

export { StateStore } from './state/index.js';

export { AutopilotLogger } from './logger/index.js';
export { RingBuffer } from './logger/ring-buffer.js';

export { ClaudeService } from './claude/index.js';
export { QuestionHandler } from './claude/question-handler.js';

export type {
  CommandResult,
  RunCommandOptions,
  QuestionEvent,
  QuestionItem,
  QuestionOption,
} from './claude/types.js';

export { Orchestrator } from './orchestrator/index.js';
export type { OrchestratorOptions } from './orchestrator/index.js';
export { ShutdownManager } from './orchestrator/shutdown.js';
export { writeYoloConfig } from './orchestrator/yolo-config.js';
export { generateSkipDiscussContext, writeSkipDiscussContext } from './orchestrator/discuss-handler.js';
export type { PhaseInfo } from './orchestrator/discuss-handler.js';
export { checkForGaps, parsePhaseRange } from './orchestrator/gap-detector.js';

export { StreamRenderer } from './output/index.js';
export { StreamLogger } from './output/index.js';
export type { VerbosityLevel, MessageCategory } from './output/index.js';
export { renderBanner, renderPhaseBanner } from './output/index.js';

export { ResponseServer } from './server/index.js';
export type { ResponseServerOptions } from './server/index.js';

// Server route interfaces
export type { StateProvider, QuestionProvider } from './server/routes/api.js';

// IPC
export {
  IPC_PATHS,
  HEARTBEAT_STALE_MS,
  HEARTBEAT_INTERVAL_MS,
  ANSWER_POLL_INTERVAL_MS,
  EventWriter,
  HeartbeatWriter,
  AnswerPoller,
  FileStateReader,
  EventTailer,
  AnswerWriter,
  FileQuestionProvider,
} from './ipc/index.js';

export type {
  IPCEvent,
  IPCAnswer,
  IPCHeartbeat,
} from './ipc/index.js';

// Notifications
export { NotificationManager } from './notifications/index.js';
export { ConsoleAdapter } from './notifications/index.js';
export { TeamsAdapter } from './notifications/adapters/teams.js';
export { SlackAdapter } from './notifications/adapters/slack.js';
export { CustomWebhookAdapter } from './notifications/adapters/webhook.js';
export { SystemAdapter } from './notifications/adapters/system.js';
export { loadCustomAdapter } from './notifications/loader.js';
export type { NotificationManagerOptions } from './notifications/types.js';
