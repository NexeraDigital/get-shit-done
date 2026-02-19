// IPC barrel export

export {
  IPC_PATHS,
  HEARTBEAT_STALE_MS,
  HEARTBEAT_INTERVAL_MS,
  ANSWER_POLL_INTERVAL_MS,
} from './types.js';

export type {
  IPCEvent,
  IPCAnswer,
  IPCHeartbeat,
} from './types.js';

// Autopilot-side components
export { EventWriter } from './event-writer.js';
export { HeartbeatWriter } from './heartbeat-writer.js';
export { AnswerPoller } from './answer-poller.js';

// Dashboard-side components
export { FileStateReader } from './file-state-reader.js';
export { EventTailer } from './event-tailer.js';
export { AnswerWriter } from './answer-writer.js';
export { FileQuestionProvider } from './file-question-provider.js';
