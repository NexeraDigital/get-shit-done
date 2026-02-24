// Orchestrator - Core autopilot engine that sequences GSD commands through
// the full phase lifecycle: init > discuss > plan > execute > verify per phase.
// Extends EventEmitter for progress tracking. Uses dependency injection for testability.

import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutopilotConfig } from '../types/index.js';
import type { AutopilotState, CommitInfo, PhaseState, PhaseStep } from '../types/state.js';
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
  inserted: boolean;
  dependsOn: string | null;
}

/**
 * Parses ROADMAP.md content and extracts phase entries.
 *
 * Pure function -- no I/O. Exported for testability.
 *
 * Merges checklist-based phases with heading-based phases:
 * - Checklist phases provide completion status (authoritative)
 * - Heading phases provide metadata: inserted flag, dependsOn
 * - Phases appearing in both sources are merged
 * - Heading-only phases default to completed: false
 *
 * @param content - Raw ROADMAP.md content string
 * @returns Array of parsed phase entries sorted numerically
 */
export function extractPhasesFromContent(content: string): RoadmapPhase[] {
  const phases: RoadmapPhase[] = [];

  // Step 1: Parse checklist entries
  const phasePattern = /^- \[([ x])\] \*\*Phase (\d+(?:\.\d+)?): (.+?)\*\*/gm;
  let match;
  while ((match = phasePattern.exec(content)) !== null) {
    phases.push({
      number: parseFloat(match[2]!),
      name: match[3]!,
      completed: match[1] === 'x',
      inserted: false,
      dependsOn: null,
    });
  }

  // Step 2: Parse heading entries UNCONDITIONALLY and merge metadata
  const headingPattern = /^#{1,3} Phase (\d+(?:\.\d+)?): (.+?)(\s+\(INSERTED\))?$/gm;
  while ((match = headingPattern.exec(content)) !== null) {
    const phaseNumber = parseFloat(match[1]!);
    const phaseName = match[2]!.trim();
    const hasInsertedMarker = !!match[3];

    // Check if phase already exists from checklist
    const existingPhase = phases.find(p => p.number === phaseNumber);

    if (existingPhase) {
      // Merge metadata into existing checklist phase
      existingPhase.inserted = hasInsertedMarker;
      existingPhase.dependsOn = extractDependsOn(content, phaseNumber);
    } else {
      // New heading-only phase
      phases.push({
        number: phaseNumber,
        name: phaseName,
        completed: false,
        inserted: hasInsertedMarker,
        dependsOn: extractDependsOn(content, phaseNumber),
      });
    }
  }

  // Step 3: Sort phases numerically
  phases.sort((a, b) => a.number - b.number);

  return phases;
}

/**
 * Extracts the "Depends on:" value from a phase's heading block.
 *
 * @param content - Full ROADMAP.md content
 * @param phaseNumber - Phase number to extract dependency for
 * @returns Depends on value or null if not found
 */
function extractDependsOn(content: string, phaseNumber: number): string | null {
  // Build regex pattern that matches both "3.1" and "03.1" formats
  const parts = String(phaseNumber).split('.');
  let numberPattern: string;
  if (parts.length === 1) {
    // Integer phase: match with or without leading zero
    numberPattern = `0?${parts[0]}`;
  } else {
    // Decimal phase: match "3.1" or "03.1"
    numberPattern = `0?${parts[0]}\\.${parts[1]}`;
  }

  // Find the phase heading line and extract the block content line-by-line
  const lines = content.split('\n');
  const headingPattern = new RegExp(`^#{1,3} Phase ${numberPattern}:`);

  let inTargetPhase = false;
  const blockLines: string[] = [];

  for (const line of lines) {
    if (headingPattern.test(line)) {
      inTargetPhase = true;
      continue; // Skip the heading line itself
    }

    if (inTargetPhase) {
      // Stop at the next phase heading
      if (/^#{1,3} Phase/.test(line)) {
        break;
      }
      blockLines.push(line);
    }
  }

  if (blockLines.length === 0) return null;

  const blockContent = blockLines.join('\n');

  // Look for "**Depends on:** value" line
  const dependsOnPattern = /^\*\*Depends on:\*\*\s*(.+?)$/m;
  const dependsMatch = dependsOnPattern.exec(blockContent);
  return dependsMatch ? dependsMatch[1]!.trim() : null;
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
    inserted: rp.inserted,
    dependsOn: rp.dependsOn,
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
   * @param phaseRange - Optional array of phase numbers to run
   */
  async run(
    prdPath: string,
    phaseRange?: number[],
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

      // Skip if not in phase range
      if (phaseRange && !phaseRange.includes(phase.number)) continue;

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

    // Check if a previous run left a usable ROADMAP.md — reuse it instead of re-running init
    try {
      const existingPhases = await extractPhases(this.projectDir);
      if (existingPhases.length > 0) {
        this.logger.log('info', 'orchestrator', 'Reusing existing ROADMAP.md', {
          phases: existingPhases.length,
        });
        const phases: PhaseState[] = existingPhases.map(toPhaseState);
        const firstPhaseNumber = phases[0]!.number;
        await this.stateStore.setState({
          phases,
          status: 'running',
          currentPhase: firstPhaseNumber,
        });
        return;
      }
    } catch {
      // ROADMAP.md missing or unparseable — proceed with fresh init
    }

    // No usable ROADMAP.md -- a PRD is required to initialize from scratch
    if (!prdPath) {
      throw new Error(
        'No PRD provided and no existing ROADMAP.md found in .planning/. ' +
        'Provide --prd <path> to initialize, or ensure .planning/ROADMAP.md exists.',
      );
    }

    // Remove stale PROJECT.md/config.json so /gsd:new-project doesn't refuse
    const projectMdPath = join(this.projectDir, '.planning', 'PROJECT.md');
    const configJsonPath = join(this.projectDir, '.planning', 'config.json');
    for (const staleFile of [projectMdPath, configJsonPath]) {
      try {
        await unlink(staleFile);
        this.logger.log('info', 'orchestrator', `Removed stale ${staleFile}`);
      } catch {
        // File doesn't exist — fine
      }
    }

    // Run init command (high maxTurns: new-project spawns researchers + synthesizer + roadmapper)
    const initResult = await this.executeWithRetry(
      `/gsd:new-project --auto ${prdPath}`,
      { phase: 0, step: 'init', maxTurns: 200 },
    );

    this.logger.log('info', 'orchestrator', 'Init command result', {
      success: initResult.success,
      durationMs: initResult.durationMs,
      costUsd: initResult.costUsd,
      numTurns: initResult.numTurns,
      error: initResult.error,
      resultPreview: initResult.result?.slice(0, 500),
    });

    // Read ROADMAP.md to extract populated phases -- poll with retry since
    // background Task subagents may still be finishing when the SDK session ends.
    const roadmapPath = join(this.projectDir, '.planning', 'ROADMAP.md');
    let roadmapPhases: RoadmapPhase[];
    const POLL_INTERVAL_MS = 5_000;
    const MAX_POLL_MS = 120_000;
    const pollStart = Date.now();

    while (true) {
      try {
        roadmapPhases = await extractPhases(this.projectDir);
        break; // Success -- exit polling loop
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('ENOENT')) throw err; // Non-ENOENT errors bubble immediately

        const elapsed = Date.now() - pollStart;
        if (elapsed >= MAX_POLL_MS) {
          throw new Error(
            `Init command completed (${initResult.numTurns} turns, ${initResult.durationMs}ms) but ROADMAP.md was not created at ${roadmapPath} after polling for ${MAX_POLL_MS / 1000}s. ` +
            `Result preview: ${initResult.result?.slice(0, 500) ?? '(none)'}. ` +
            'Verify the Claude Agent SDK is configured (ANTHROPIC_API_KEY set) and GSD is installed.',
          );
        }

        this.logger.log('warn', 'orchestrator', 'ROADMAP.md not found yet, polling...', {
          elapsedMs: elapsed,
          maxPollMs: MAX_POLL_MS,
        });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
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

    // Update state to mark phase as current and in-progress
    phase.status = 'in_progress';
    if (!phase.startedAt) {
      phase.startedAt = new Date().toISOString();
    }
    await this.stateStore.setState({
      currentPhase: phase.number,
      status: 'running',
    });
    await this.persistPhaseUpdate(phase);

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
  // Private: Git commit tracking
  // ---------------------------------------------------------------------------

  private async getGitHead(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('git', ['rev-parse', 'HEAD'], { cwd: this.projectDir }, (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout.trim());
      });
    });
  }

  private async getNewCommits(sinceRef: string | null): Promise<CommitInfo[]> {
    const SEP = '<<GSD_SEP>>';
    const format = `%H${SEP}%s`;
    const parseOutput = (stdout: string): CommitInfo[] =>
      stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [hash = '', message = ''] = line.split(SEP);
        return { hash, message };
      });

    if (!sinceRef) {
      // No prior HEAD — repo was empty before; grab all commits
      return new Promise((resolve) => {
        execFile('git', ['log', `--format=${format}`], { cwd: this.projectDir }, (err, stdout) => {
          if (err || !stdout.trim()) resolve([]);
          else resolve(parseOutput(stdout));
        });
      });
    }
    return new Promise((resolve) => {
      execFile(
        'git', ['log', `--format=${format}`, `${sinceRef}..HEAD`],
        { cwd: this.projectDir },
        (err, stdout) => {
          if (err || !stdout.trim()) resolve([]);
          else resolve(parseOutput(stdout));
        },
      );
    });
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

    // Capture git HEAD before step runs
    const headBefore = await this.getGitHead();

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

    // Collect any new commits made during this step
    const newCommits = await this.getNewCommits(headBefore);
    if (newCommits.length > 0) {
      const existing = new Set(phase.commits.map((c) => c.hash));
      for (const commit of newCommits) {
        if (!existing.has(commit.hash)) {
          phase.commits.push(commit);
        }
      }
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
      { phase: phase.number, step: 'plan', maxTurns: 200 },
    );
  }

  private async runExecute(phase: PhaseState): Promise<void> {
    await this.executeWithRetry(
      `/gsd:execute-phase ${phase.number}`,
      { phase: phase.number, step: 'execute', maxTurns: 200 },
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
    meta: { phase: number; step: string; timeoutMs?: number; maxTurns?: number },
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
        maxTurns: meta.maxTurns,
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
        maxTurns: meta.maxTurns,
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
