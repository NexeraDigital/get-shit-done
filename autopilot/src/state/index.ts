// StateStore - persistent state management with atomic writes
// Uses write-file-atomic for crash-safe persistence (FNDN-02)
// Uses path.join for all path construction (FNDN-03)

import writeFileAtomic from 'write-file-atomic';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AutopilotState } from '../types/index.js';

// Zod schema matching the AutopilotState interface for restore validation
const ErrorRecordSchema = z.object({
  timestamp: z.string(),
  phase: z.number(),
  step: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
  message: z.string(),
  truncatedOutput: z.string().optional(),
});

const QuestionItemStateSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
  multiSelect: z.boolean(),
});

const PendingQuestionSchema = z.object({
  id: z.string(),
  phase: z.number(),
  step: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
  questions: z.array(z.string()),
  createdAt: z.string(),
  answeredAt: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  questionItems: z.array(QuestionItemStateSchema).optional(),
});

const PhaseStateSchema = z.object({
  number: z.number(),
  name: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
  steps: z.object({
    discuss: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
    plan: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
    execute: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
    verify: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
  }),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  commits: z.array(
    z.union([
      z.object({ hash: z.string(), message: z.string() }),
      // Backwards compat: migrate bare string hashes from older state files
      z.string().transform((hash) => ({ hash, message: '' })),
    ]),
  ),
  gapIterations: z.number(),
  inserted: z.boolean().optional(),
  dependsOn: z.string().nullable().optional(),
});

const AutopilotStateSchema = z.object({
  status: z.enum(['idle', 'running', 'waiting_for_human', 'error', 'complete']),
  currentPhase: z.number(),
  currentStep: z.enum(['idle', 'discuss', 'plan', 'execute', 'verify', 'done']),
  phases: z.array(PhaseStateSchema),
  pendingQuestions: z.array(PendingQuestionSchema),
  errorHistory: z.array(ErrorRecordSchema),
  startedAt: z.string(),
  lastUpdatedAt: z.string(),
  tunnelUrl: z.string().optional(),
  tunnelError: z.string().optional(),
  remoteSessionUrl: z.string().optional(),
}).passthrough();

/**
 * StateWriteQueue serializes async state mutations through a promise chain.
 * Prevents interleaved reads/writes when multiple async paths modify state concurrently.
 * Each enqueued operation waits for the previous one to complete before executing.
 * Failed operations are isolated -- subsequent operations still execute.
 */
export class StateWriteQueue {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Enqueues an async operation to run after all previously enqueued operations complete.
   * Returns a promise that resolves/rejects with the operation's result.
   * If the operation throws, subsequent enqueued operations still execute (fault isolation).
   */
  enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.chain = this.chain.then(
        () => fn().then(resolve, reject),
        () => fn().then(resolve, reject),
      );
    });
  }
}

export class StateStore {
  private state: AutopilotState;
  private readonly _filePath: string;
  private writeQueue = new StateWriteQueue();

  private constructor(state: AutopilotState, filePath: string) {
    this.state = state;
    this._filePath = filePath;
  }

  /** The file path where state is persisted */
  get filePath(): string {
    return this._filePath;
  }

  /** Returns a readonly snapshot of the current state */
  getState(): Readonly<AutopilotState> {
    // Return a shallow copy so mutations to the returned object
    // do not affect internal state
    return { ...this.state };
  }

  /**
   * Atomically read-modify-write state through the serialized write queue.
   * Prevents lost updates when multiple parallel workers modify state concurrently.
   */
  async update(fn: (state: AutopilotState) => Partial<AutopilotState>): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      const patch = fn(this.state);
      await this.setState(patch);
    });
  }

  /** Merges a partial patch into state, updates lastUpdatedAt, and persists to disk */
  async setState(patch: Partial<AutopilotState>): Promise<void> {
    this.state = {
      ...this.state,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  /** Writes state to disk atomically using write-file-atomic (retries on Windows EPERM) */
  private async persist(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2) + '\n';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await writeFileAtomic(this._filePath, data);
        return;
      } catch (err: unknown) {
        const isRetryable = err instanceof Error &&
          ('code' in err && (err as NodeJS.ErrnoException).code === 'EPERM');
        if (!isRetryable || attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }

  /**
   * Restores a StateStore from a file on disk.
   * Validates the file content against the Zod schema.
   * Throws descriptive errors for missing files, invalid JSON, and schema violations.
   */
  static async restore(filePath: string): Promise<StateStore> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`State file not found or unreadable: ${filePath} -- ${message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`State file contains invalid JSON: ${filePath}`);
    }

    try {
      const state = AutopilotStateSchema.parse(parsed);
      return new StateStore(state, filePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`State file has invalid schema: ${filePath} -- ${message}`);
    }
  }

  /**
   * Creates a fresh StateStore with default state values.
   * The state file path is constructed using path.join (FNDN-03).
   */
  static createFresh(projectDir: string): StateStore {
    const filePath = join(projectDir, '.planning', 'autopilot', 'state.json');
    const now = new Date().toISOString();
    const state: AutopilotState = {
      status: 'idle',
      currentPhase: 0,
      currentStep: 'idle',
      phases: [],
      pendingQuestions: [],
      errorHistory: [],
      startedAt: now,
      lastUpdatedAt: now,
    };
    return new StateStore(state, filePath);
  }
}
