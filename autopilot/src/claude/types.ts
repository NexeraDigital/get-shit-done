// Claude integration types derived from the Agent SDK's
// AskUserQuestionInput and SDKResultMessage types.
// All exports use `export type` for verbatimModuleSyntax compatibility.

export type CommandResult = {
  success: boolean;
  result?: string;
  error?: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  numTurns: number;
};

export type RunCommandOptions = {
  timeoutMs?: number;    // Default: 600_000 (10 minutes)
  cwd?: string;          // Working directory for the command
  phase?: number;        // Current phase number (for logging)
  step?: string;         // Current step name (for logging)
};

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
