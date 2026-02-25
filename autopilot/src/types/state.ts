// State type definitions per CONTEXT.md locked decisions
// State granularity: phase + step (per research recommendation)

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

export interface ErrorRecord {
  timestamp: string;
  phase: number;
  step: PhaseStep;
  message: string;
  truncatedOutput?: string;
}

export interface QuestionItemState {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface PendingQuestion {
  id: string;
  phase: number;
  step: PhaseStep;
  questions: string[];
  createdAt: string;
  answeredAt?: string;
  answers?: Record<string, string>;
  /** Full question data for dashboard rendering (only present in IPC mode) */
  questionItems?: QuestionItemState[];
}

export interface CommitInfo {
  hash: string;
  message: string;
}

export interface PhaseState {
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
  inserted?: boolean;
  dependsOn?: string | null;
}

export interface AutopilotState {
  status: AutopilotStatus;
  currentPhase: number;
  currentStep: PhaseStep;
  phases: PhaseState[];
  pendingQuestions: PendingQuestion[];
  errorHistory: ErrorRecord[];
  startedAt: string;
  lastUpdatedAt: string;
  tunnelUrl?: string; // Public dev-tunnel URL for remote dashboard access
}
