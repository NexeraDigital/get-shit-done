import type { ClaudeService } from '../claude/index.js';
import type { MergeReport } from './merge-resolver.js';

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
  mergeReport?: MergeReport; // detailed conflict resolution report
}

export interface WorkerPoolOptions {
  concurrency: number;
  parallel: boolean;
  projectDir: string;
}
