import type { ClaudeService } from '../claude/index.js';

export interface WorkerHandle {
  phaseNumber: number;
  workerId: string;
  worktreePath: string | null; // null for sequential mode
  claudeService: ClaudeService;
  promise: Promise<WorkerResult>;
}

export interface WorkerResult {
  phaseNumber: number;
  success: boolean;
  error?: string;
  mergeSuccess?: boolean; // true if worktree merged cleanly
}

export interface WorkerPoolOptions {
  concurrency: number;
  parallel: boolean;
  projectDir: string;
}
