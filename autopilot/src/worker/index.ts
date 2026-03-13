// WorkerPool - manages ClaudeService instances for parallel phase execution.
// In parallel mode, each worker runs in its own git worktree.
// In sequential mode, workers run directly in the project directory.
// Merge operations are serialized via a promise chain to prevent git index.lock conflicts.

import { EventEmitter } from 'node:events';
import { ClaudeService } from '../claude/index.js';
import {
  ensureCleanWorktree,
  createWorktree,
  mergeWorktree,
  cleanupWorktree,
} from './git-worktree.js';
import { resolveConflicts, writeMergeReport, type MergeReport } from './merge-resolver.js';
import type { WorkerHandle, WorkerResult, WorkerPoolOptions } from './types.js';
import type { SchedulerPhase } from '../scheduler/index.js';

/**
 * The function signature for running a phase.
 * The orchestrator provides its runPhase logic through this callback,
 * decoupling WorkerPool from PhaseState internals.
 */
export type RunPhaseFn = (cwd: string, claudeService: ClaudeService) => Promise<void>;

/**
 * WorkerPool manages concurrent ClaudeService instances with optional
 * git worktree isolation for parallel phase execution.
 *
 * Events:
 * - 'worker:message' -> { phaseNumber, ...originalEvent } (forwarded from each worker's ClaudeService)
 */
export class WorkerPool extends EventEmitter {
  private readonly options: WorkerPoolOptions;
  private readonly active = new Map<number, WorkerHandle>();
  private mergeChain: Promise<void> = Promise.resolve();
  private mergeReports: MergeReport[] = [];
  private aborted = false;

  constructor(options: WorkerPoolOptions) {
    super();
    this.options = options;
  }

  /**
   * Number of currently active (running) workers.
   */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Seed the merge report accumulator with prior reports (for --resume support).
   */
  addPriorReports(reports: MergeReport[]): void {
    this.mergeReports.push(...reports);
  }

  /**
   * Get accumulated merge reports (for orchestrator summary).
   */
  getMergeReports(): MergeReport[] {
    return [...this.mergeReports];
  }

  /**
   * Dispatch a phase for execution.
   *
   * In parallel mode: creates a worktree, spawns a ClaudeService pointing at it,
   * runs the phase, then serializes merge + cleanup.
   *
   * In sequential mode: runs the phase directly in the project directory.
   */
  dispatch(phase: SchedulerPhase, runPhaseFn: RunPhaseFn): void {
    const claudeService = new ClaudeService({
      defaultCwd: this.options.projectDir,
    });

    // Forward ClaudeService events with phase metadata
    const forwardEvent = (eventName: string) => {
      claudeService.on(eventName, (event: Record<string, unknown>) => {
        this.emit(`worker:${eventName}`, { ...event, phaseNumber: phase.number });
      });
    };
    forwardEvent('message');
    forwardEvent('question:pending');
    forwardEvent('question:answered');

    const promise = this.executeWorker(phase, claudeService, runPhaseFn);

    const handle: WorkerHandle = {
      phaseNumber: phase.number,
      workerId: `worker-${phase.number}`,
      worktreePath: null, // Set during execution for parallel mode
      claudeService,
      promise,
    };

    this.active.set(phase.number, handle);
  }

  /**
   * Returns a promise that resolves when any active worker completes.
   * Removes the completed worker from the active Map.
   */
  async waitForAny(): Promise<WorkerResult> {
    if (this.active.size === 0) {
      throw new Error('No active workers to wait for');
    }

    // Race all active worker promises
    const entries = [...this.active.entries()];
    const result = await Promise.race(
      entries.map(([_num, handle]) => handle.promise),
    );

    // Remove completed worker
    this.active.delete(result.phaseNumber);
    return result;
  }

  /**
   * Returns all currently active worker handles.
   * Used by the orchestrator to route answer submissions to the correct worker ClaudeService.
   */
  getActiveHandles(): WorkerHandle[] {
    return [...this.active.values()];
  }

  /**
   * Abort all active workers by calling abortCurrent() on their ClaudeService instances.
   * Sets the aborted flag to prevent merge operations after abort.
   */
  abortAll(): void {
    this.aborted = true;
    for (const handle of this.active.values()) {
      handle.claudeService.abortCurrent();
    }
  }

  /**
   * Internal: execute a single worker with worktree lifecycle in parallel mode.
   */
  private async executeWorker(
    phase: SchedulerPhase,
    claudeService: ClaudeService,
    runPhaseFn: RunPhaseFn,
  ): Promise<WorkerResult> {
    const { parallel, projectDir } = this.options;

    try {
      let cwd: string;

      if (parallel) {
        // Parallel mode: create worktree
        await ensureCleanWorktree(projectDir, phase.number);
        cwd = await createWorktree(projectDir, phase.number);

        // Update the handle's worktree path
        const handle = this.active.get(phase.number);
        if (handle) handle.worktreePath = cwd;
      } else {
        // Sequential mode: run directly in project directory
        cwd = projectDir;
      }

      // Execute the phase
      await runPhaseFn(cwd, claudeService);

      // Post-execution: merge and cleanup (parallel only)
      if (parallel) {
        // Check abort flag before merge to avoid merging after abortAll() (RESEARCH pitfall 5)
        if (this.aborted) {
          return {
            phaseNumber: phase.number,
            success: false,
            error: 'Aborted before merge',
          };
        }

        const mergeResult = await this.serializedMerge(projectDir, phase.number);

        if (mergeResult) {
          // Clean merge -- cleanup worktree
          try {
            await cleanupWorktree(projectDir, phase.number);
          } catch {
            // Non-fatal: worktree will be cleaned up on next run by ensureCleanWorktree()
          }

          return {
            phaseNumber: phase.number,
            success: true,
            mergeSuccess: true,
          };
        }

        // Merge failed -- attempt conflict resolution
        const report = await resolveConflicts(projectDir, phase.number, this.mergeReports);
        const phaseDir = `${projectDir}/.planning/phases`; // writeMergeReport creates subdirs as needed
        await writeMergeReport(phaseDir, report);
        this.mergeReports.push(report);

        if (report.success) {
          // Resolution succeeded -- cleanup worktree
          try {
            await cleanupWorktree(projectDir, phase.number);
          } catch {
            // Non-fatal: worktree will be cleaned up on next run by ensureCleanWorktree()
          }
          return {
            phaseNumber: phase.number,
            success: true,
            mergeSuccess: true,
            mergeReport: report,
          };
        }

        // Resolution failed -- preserve worktree for debugging (FAIL-04)
        return {
          phaseNumber: phase.number,
          success: false,
          error: `Merge conflict resolution failed for phase ${phase.number}`,
          mergeSuccess: false,
          mergeReport: report,
        };
      }

      return {
        phaseNumber: phase.number,
        success: true,
      };
    } catch (err) {
      // Phase failed -- worktree is preserved (never cleaned up) for debugging (FAIL-04)
      const error = err instanceof Error ? err.message : String(err);
      return {
        phaseNumber: phase.number,
        success: false,
        error,
      };
    }
  }

  /**
   * Serialize merge operations via a promise chain to prevent
   * concurrent git index.lock conflicts (per RESEARCH pitfall 2).
   */
  private serializedMerge(projectDir: string, phaseNumber: number): Promise<boolean> {
    const mergePromise = this.mergeChain.then(async () => {
      return mergeWorktree(projectDir, phaseNumber);
    });

    // Update the chain -- always resolves (catch prevents chain breakage)
    this.mergeChain = mergePromise.then(
      () => {},
      () => {},
    );

    return mergePromise;
  }
}
