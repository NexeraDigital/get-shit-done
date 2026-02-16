// Orchestrator - Core autopilot engine that sequences GSD commands through
// the full phase lifecycle: init > discuss > plan > execute > verify per phase.
// Extends EventEmitter for progress tracking. Uses dependency injection for testability.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutopilotConfig } from '../types/index.js';
import type { AutopilotState, PhaseState, PhaseStep } from '../types/state.js';
import type { CommandResult } from '../claude/types.js';
import type { StateStore } from '../state/index.js';
import type { ClaudeService } from '../claude/index.js';
import type { AutopilotLogger } from '../logger/index.js';
import { writeYoloConfig } from './yolo-config.js';
import { writeSkipDiscussContext } from './discuss-handler.js';
import { checkForGaps } from './gap-detector.js';

export interface OrchestratorOptions {
  stateStore: StateStore;
  claudeService: ClaudeService;
  logger: AutopilotLogger;
  config: AutopilotConfig;
  projectDir: string;
}

interface RoadmapPhase {
  number: number;
  name: string;
  completed: boolean;
}

/**
 * Parses ROADMAP.md content and extracts phase entries.
 *
 * Pure function -- no I/O. Exported for testability.
 *
 * @param content - Raw ROADMAP.md content string
 * @returns Array of parsed phase entries
 */
export function extractPhasesFromContent(content: string): RoadmapPhase[] {
  const phases: RoadmapPhase[] = [];
  const phasePattern = /^- \[([ x])\] \*\*Phase (\d+): (.+?)\*\*/gm;
  let match;

  while ((match = phasePattern.exec(content)) !== null) {
    phases.push({
      number: parseInt(match[2]!, 10),
      name: match[3]!,
      completed: match[1] === 'x',
    });
  }

  return phases;
}

/**
 * Reads ROADMAP.md from disk and extracts phase entries.
 *
 * @param projectDir - Root project directory (contains .planning/)
 * @returns Array of parsed phase entries
 */
async function extractPhases(projectDir: string): Promise<RoadmapPhase[]> {
  const roadmapPath = join(projectDir, '.planning', 'ROADMAP.md');
  const content = await readFile(roadmapPath, 'utf-8');
  return extractPhasesFromContent(content);
}

/**
 * Converts a RoadmapPhase into a PhaseState with default step values.
 */
function toPhaseState(rp: RoadmapPhase): PhaseState {
  return {
    number: rp.number,
    name: rp.name,
    status: rp.completed ? 'completed' : 'pending',
    steps: {
      discuss: rp.completed ? 'done' : 'idle',
      plan: rp.completed ? 'done' : 'idle',
      execute: rp.completed ? 'done' : 'idle',
      verify: rp.completed ? 'done' : 'idle',
    },
    commits: [],
    gapIterations: 0,
  };
}

/**
 * Custom error thrown when a shutdown is requested during command execution.
 * Used to distinguish shutdown aborts from real errors in executeWithRetry.
 */
class ShutdownError extends Error {
  constructor() {
    super('Shutdown requested');
    this.name = 'ShutdownError';
  }
}

/**
 * The Orchestrator sequences GSD slash commands through the full lifecycle:
 * init project, then for each phase: discuss > plan > execute > verify.
 *
 * Features:
 * - Resume support: skips completed phases and steps
 * - Retry-once-then-escalate for failed commands
 * - Gap detection loop (bounded to 3 iterations) after verify
 * - Skip-discuss writes CONTEXT.md directly
 * - Skip-verify omits verification entirely
 * - Graceful shutdown with state persistence
 *
 * Events:
 * - 'phase:started' -> { phase: number, name: string }
 * - 'phase:completed' -> { phase: number, name: string }
 * - 'step:started' -> { phase: number, step: string }
 * - 'step:completed' -> { phase: number, step: string }
 * - 'build:complete' -> void
 * - 'error:escalation' -> { phase: number, step: string, error: string, options: string[] }
 * - 'gap:escalated' -> { phase: number, iterations: number }
 */
export class Orchestrator extends EventEmitter {
  private readonly stateStore: StateStore;
  private readonly claudeService: ClaudeService;
  private readonly logger: AutopilotLogger;
  private readonly config: AutopilotConfig;
  private readonly projectDir: string;
  private shutdownRequested = false;

  constructor(options: OrchestratorOptions) {
    super();
    this.stateStore = options.stateStore;
    this.claudeService = options.claudeService;
    this.logger = options.logger;
    this.config = options.config;
    this.projectDir = options.projectDir;
  }

  /**
   * Main entry point. Sequences through all phases calling
   * discuss > plan > execute > verify for each.
   *
   * @param prdPath - Path to the PRD document (used for init)
   * @param phaseRange - Optional filter to run only specific phases
   */
  async run(
    prdPath: string,
    phaseRange?: { start: number; end: number },
  ): Promise<void> {
    this.logger.log('info', 'orchestrator', 'Starting autopilot run', { prdPath });

    // ORCH-08: Write YOLO config for autonomous execution
    await writeYoloConfig(this.projectDir, this.config);

    const state = this.stateStore.getState();

    // Initialize project if fresh (currentPhase === 0)
    if (state.currentPhase === 0) {
      await this.initProject(prdPath);
    }

    // Re-read state after potential init
    const currentState = this.stateStore.getState();

    // Phase loop
    for (const phase of currentState.phases) {
      // Skip completed or skipped phases
      if (phase.status === 'completed' || phase.status === 'skipped') continue;

      // Skip if outside phase range
      if (phaseRange) {
        if (phase.number < phaseRange.start || phase.number > phaseRange.end) continue;
      }

      // Check shutdown before starting new phase
      if (this.shutdownRequested) break;

      await this.runPhase(phase);
    }

    // ORCH-10: If all phases complete without shutdown
    if (!this.shutdownRequested) {
      this.emit('build:complete');
      this.logger.log('info', 'orchestrator', 'Build complete');
      await this.stateStore.setState({ status: 'complete' });
    }
  }

  /**
   * Signals the orchestrator to stop after the current step.
   * Aborts any in-progress ClaudeService command.
   */
  requestShutdown(): void {
    this.shutdownRequested = true;
    this.claudeService.abortCurrent();
  }

  // ---------------------------------------------------------------------------
  // Private: Project initialization
  // ---------------------------------------------------------------------------

  private async initProject(prdPath: string): Promise<void> {
    this.logger.log('info', 'orchestrator', 'Initializing project', { prdPath });

    // Ensure the project directory is a git repo (Claude Code requires it)
    await this.ensureGitRepo();

    // Run init command (longer timeout: new-project spawns researchers + synthesizer + roadmapper)
    const initResult = await this.executeWithRetry(
      `/gsd:new-project --auto ${prdPath}`,
      { phase: 0, step: 'init', timeoutMs: 1_200_000 },
    );

    this.logger.log('info', 'orchestrator', 'Init command result', {
      success: initResult.success,
      durationMs: initResult.durationMs,
      costUsd: initResult.costUsd,
      numTurns: initResult.numTurns,
      error: initResult.error,
    });

    // Read ROADMAP.md to extract populated phases
    let roadmapPhases: RoadmapPhase[];
    try {
      roadmapPhases = await extractPhases(this.projectDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        throw new Error(
          `Init command completed but ROADMAP.md was not created at ${join(this.projectDir, '.planning', 'ROADMAP.md')}. ` +
          'Verify the Claude Agent SDK is configured (ANTHROPIC_API_KEY set) and GSD is installed.',
        );
      }
      throw err;
    }
    const phases: PhaseState[] = roadmapPhases.map(toPhaseState);

    // Persist initial state with phases
    const firstPhaseNumber = phases.length > 0 ? phases[0]!.number : 1;
    await this.stateStore.setState({
      phases,
      status: 'running',
      currentPhase: firstPhaseNumber,
    });
  }

  /**
   * Ensures the project directory is a git repository.
   * Claude Code requires a git repo to operate. If none exists, runs `git init`.
   */
  private async ensureGitRepo(): Promise<void> {
    const isGitRepo = await new Promise<boolean>((resolve) => {
      execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.projectDir }, (err) => {
        resolve(!err);
      });
    });

    if (!isGitRepo) {
      this.logger.log('info', 'orchestrator', 'No git repo found, running git init', {
        projectDir: this.projectDir,
      });
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['init'], { cwd: this.projectDir }, (err) => {
          if (err) reject(new Error(`git init failed: ${err.message}`));
          else resolve();
        });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Phase execution
  // ---------------------------------------------------------------------------

  private async runPhase(phase: PhaseState): Promise<void> {
    // ORCH-09: Emit phase:started
    this.emit('phase:started', { phase: phase.number, name: phase.name });

    // Update state to mark phase as current
    await this.stateStore.setState({
      currentPhase: phase.number,
      status: 'running',
    });

    // Step sequence with resume support (Pitfall 2: check individual step states)
    if (phase.steps.discuss !== 'done') {
      await this.runStep(phase, 'discuss', () => this.runDiscuss(phase));
      if (this.shutdownRequested) return;
    }

    if (phase.steps.plan !== 'done') {
      await this.runStep(phase, 'plan', () => this.runPlan(phase));
      if (this.shutdownRequested) return;
    }

    if (phase.steps.execute !== 'done') {
      await this.runStep(phase, 'execute', () => this.runExecute(phase));
      if (this.shutdownRequested) return;
    }

    if (phase.steps.verify !== 'done' && !this.config.skipVerify) {
      await this.runVerifyWithGapLoop(phase);
      if (this.shutdownRequested) return;
    }

    // Mark phase complete
    phase.status = 'completed';
    phase.completedAt = new Date().toISOString();
    await this.persistPhaseUpdate(phase);

    // ORCH-09: Emit phase:completed
    this.emit('phase:completed', { phase: phase.number, name: phase.name });
  }

  // ---------------------------------------------------------------------------
  // Private: Step execution wrapper
  // ---------------------------------------------------------------------------

  private async runStep(
    phase: PhaseState,
    stepName: PhaseStep,
    fn: () => Promise<void>,
  ): Promise<void> {
    // Check shutdown before starting step
    if (this.shutdownRequested) {
      await this.stateStore.setState({ status: 'idle' });
      return;
    }

    // Emit step:started
    this.emit('step:started', { phase: phase.number, step: stepName });

    // Update in-progress state
    phase.steps[stepName as keyof typeof phase.steps] = stepName;
    await this.stateStore.setState({ currentStep: stepName });

    // CRITICAL: Persist state BEFORE calling fn (Pitfall 1)
    await this.persistPhaseUpdate(phase);

    try {
      await fn();
    } catch (err) {
      // If shutdown was requested, persist state and return cleanly
      if (this.shutdownRequested) {
        await this.stateStore.setState({ status: 'idle' });
        return;
      }
      throw err;
    }

    // Check shutdown after fn completes
    if (this.shutdownRequested) {
      await this.stateStore.setState({ status: 'idle' });
      return;
    }

    // Mark step done
    phase.steps[stepName as keyof typeof phase.steps] = 'done';
    await this.persistPhaseUpdate(phase);
    await this.stateStore.setState({ currentStep: 'done' });

    // Emit step:completed
    this.emit('step:completed', { phase: phase.number, step: stepName });

    this.logger.log('info', 'orchestrator', `Step ${stepName} completed for phase ${phase.number}`, {
      phase: phase.number,
      step: stepName,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: Step implementations
  // ---------------------------------------------------------------------------

  private async runDiscuss(phase: PhaseState): Promise<void> {
    if (this.config.skipDiscuss) {
      // DISC-04: Write CONTEXT.md directly
      await writeSkipDiscussContext(this.projectDir, {
        number: phase.number,
        name: phase.name,
      });
      return;
    }

    // Delegate to GSD discuss-phase command
    await this.executeWithRetry(
      `/gsd:discuss-phase ${phase.number}`,
      { phase: phase.number, step: 'discuss' },
    );
  }

  private async runPlan(phase: PhaseState): Promise<void> {
    await this.executeWithRetry(
      `/gsd:plan-phase ${phase.number}`,
      { phase: phase.number, step: 'plan' },
    );
  }

  private async runExecute(phase: PhaseState): Promise<void> {
    await this.executeWithRetry(
      `/gsd:execute-phase ${phase.number}`,
      { phase: phase.number, step: 'execute' },
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Verify with gap detection loop (ORCH-05)
  // ---------------------------------------------------------------------------

  private async runVerifyWithGapLoop(phase: PhaseState): Promise<void> {
    const MAX_GAP_ITERATIONS = 3;

    for (let iteration = 0; iteration < MAX_GAP_ITERATIONS; iteration++) {
      // Run verify step
      await this.runStep(phase, 'verify', async () => {
        await this.executeWithRetry(
          `/gsd:verify-work ${phase.number}`,
          { phase: phase.number, step: 'verify' },
        );
      });

      if (this.shutdownRequested) return;

      // Check for gaps
      const hasGaps = await checkForGaps(this.projectDir, phase.number);
      if (!hasGaps) return; // Passed -- done

      // Gaps found: re-plan with --gaps flag, re-execute with --gaps-only
      this.logger.log('warn', 'orchestrator', `Gaps found in phase ${phase.number}, iteration ${iteration + 1}`, {
        phase: phase.number,
        iteration: iteration + 1,
      });

      // Re-plan gaps
      await this.executeWithRetry(
        `/gsd:plan-phase ${phase.number} --gaps`,
        { phase: phase.number, step: 'plan' },
      );

      if (this.shutdownRequested) return;

      // Re-execute gaps only
      await this.executeWithRetry(
        `/gsd:execute-phase ${phase.number} --gaps-only`,
        { phase: phase.number, step: 'execute' },
      );

      if (this.shutdownRequested) return;

      // Update gap iteration count
      phase.gapIterations = iteration + 1;
      await this.persistPhaseUpdate(phase);

      // Reset verify step to allow re-verify
      phase.steps.verify = 'idle';
      await this.persistPhaseUpdate(phase);
    }

    // Max iterations reached -- escalate but don't block
    this.logger.log('warn', 'orchestrator', `Gap detection capped at ${MAX_GAP_ITERATIONS} iterations for phase ${phase.number}`, {
      phase: phase.number,
      iterations: MAX_GAP_ITERATIONS,
    });
    this.emit('gap:escalated', { phase: phase.number, iterations: MAX_GAP_ITERATIONS });
  }

  // ---------------------------------------------------------------------------
  // Private: Retry-once-then-escalate (ORCH-03, ORCH-04)
  // ---------------------------------------------------------------------------

  private async executeWithRetry(
    prompt: string,
    meta: { phase: number; step: string; timeoutMs?: number },
  ): Promise<CommandResult> {
    this.logger.log('info', 'orchestrator', `Running command: ${prompt}`, {
      phase: meta.phase,
      step: meta.step,
    });

    // First attempt
    let result: CommandResult;
    try {
      result = await this.claudeService.runGsdCommand(prompt, {
        cwd: this.projectDir,
        phase: meta.phase,
        step: meta.step,
        timeoutMs: meta.timeoutMs,
      });
    } catch (err) {
      if (this.shutdownRequested) throw new ShutdownError();
      throw err;
    }

    if (result.success) return result;

    // Check shutdown before retry
    if (this.shutdownRequested) throw new ShutdownError();

    // Retry once (ORCH-03)
    this.logger.log('warn', 'orchestrator', 'Command failed, retrying once', {
      phase: meta.phase,
      step: meta.step,
      error: result.error,
    });

    try {
      result = await this.claudeService.runGsdCommand(prompt, {
        cwd: this.projectDir,
        phase: meta.phase,
        step: meta.step,
        timeoutMs: meta.timeoutMs,
      });
    } catch (err) {
      if (this.shutdownRequested) throw new ShutdownError();
      throw err;
    }

    if (result.success) return result;

    // Check shutdown before escalation
    if (this.shutdownRequested) throw new ShutdownError();

    // Escalate (ORCH-04)
    const errorMsg = result.error ?? 'Unknown error';
    this.emit('error:escalation', {
      phase: meta.phase,
      step: meta.step,
      error: errorMsg,
      options: ['retry', 'skip', 'abort'],
    });

    // ORCH-06: Record error in state
    const state = this.stateStore.getState();
    const errorRecord = {
      timestamp: new Date().toISOString(),
      phase: meta.phase,
      step: meta.step as PhaseStep,
      message: errorMsg,
      truncatedOutput: result.result?.slice(0, 500),
    };
    await this.stateStore.setState({
      errorHistory: [...state.errorHistory, errorRecord],
    });

    // Phase 3: No web UI yet -- default to abort behavior
    throw new Error(`Command failed after retry: ${errorMsg}`);
  }

  // ---------------------------------------------------------------------------
  // Private: State persistence helpers
  // ---------------------------------------------------------------------------

  /**
   * Persists the current phases array to state.
   * Finds the phase in state and updates it in place.
   */
  private async persistPhaseUpdate(phase: PhaseState): Promise<void> {
    const state = this.stateStore.getState();
    const updatedPhases = state.phases.map((p) =>
      p.number === phase.number ? { ...phase } : p,
    );
    await this.stateStore.setState({ phases: updatedPhases });
  }
}
