// Dashboard types mirroring server types.
// These are duplicated intentionally -- the dashboard is a separate Vite project
// and must NOT import from the server codebase.

// From autopilot/src/types/state.ts

export type AutopilotStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_human'
  | 'error'
  | 'complete';

export type PhaseStep =
  | 'idle'
  | 'discuss'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'done';

export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export type CommitInfo = {
  hash: string;
  message: string;
};

export type PhaseState = {
  number: number;
  name: string;
  status: PhaseStatus;
  steps: {
    discuss: PhaseStep;
    plan: PhaseStep;
    execute: PhaseStep;
    verify: PhaseStep;
  };
  startedAt?: string;
  completedAt?: string;
  commits: CommitInfo[];
  gapIterations: number;
};

// From autopilot/src/types/log.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  phase?: number;
  step?: string;
  meta?: Record<string, unknown>;
};

// From autopilot/src/claude/types.ts

export type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionItem = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
};

export type QuestionEvent = {
  id: string;
  phase?: number;
  step?: string;
  questions: QuestionItem[];
  createdAt: string;
};

// Dashboard-specific types

export type ActivityItem = {
  type:
    | 'phase-started'
    | 'phase-completed'
    | 'question-pending'
    | 'question-answered'
    | 'error'
    | 'build-complete';
  message: string;
  timestamp: string;
};
