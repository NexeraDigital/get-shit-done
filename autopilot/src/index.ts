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
