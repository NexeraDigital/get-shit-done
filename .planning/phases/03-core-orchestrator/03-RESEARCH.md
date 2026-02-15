# Phase 3: Core Orchestrator - Research

**Researched:** 2026-02-15
**Domain:** CLI entry point, async state machine orchestration, graceful shutdown, discuss-phase handler, gap detection loop, YOLO mode config
**Confidence:** HIGH

## Summary

Phase 3 builds the orchestrator -- the heart of gsd-autopilot. It ties together the ClaudeService facade (Phase 2), the StateStore (Phase 1), the AutopilotLogger (Phase 1), and the config loader (Phase 1) into an autonomous workflow engine that sequences GSD slash commands through the full lifecycle: init project, then for each phase: discuss (optional), plan, execute, verify, with gap detection loops and retry logic.

The orchestrator is a custom async state machine built on Node.js EventEmitter. The prior architecture research (`.planning/research/ARCHITECTURE.md`) explicitly evaluated XState v5 and rejected it for this use case -- the autopilot flow is linear and predictable, with no parallel states or hierarchical nesting. A simple `for` loop over phases with `async/await` step functions is more transparent and testable than a formal state machine library.

The phase also introduces the CLI entry point (Commander.js v14 for argument parsing), the discuss-phase handler (using ClaudeService to analyze gray areas and generate CONTEXT.md), graceful shutdown handling (Ctrl+C persists state for resume), and the YOLO-mode config writer (generates `.planning/config.json` with all GSD gates disabled for autonomous execution).

**Primary recommendation:** Build the orchestrator as a single `Orchestrator` class extending EventEmitter. Use Commander.js v14 for CLI parsing with `parseAsync()`. Implement graceful shutdown via `process.on('SIGINT')` with a shutdown manager that cascades cleanup. The discuss-phase handler should use ClaudeService to run a lightweight analysis prompt, extract gray areas, then either batch questions to the human (via QuestionHandler) or auto-generate "Claude's Discretion" CONTEXT.md when `--skip-discuss` is set. The gap detection loop should be a bounded `while` loop (max 3 iterations) within `runPhase()`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | ^14.0.3 | CLI argument parsing, help generation, option validation | 113K+ dependents; v14 requires Node >=20 (matches project target); ESM support via exports map; built-in TypeScript types; `parseAsync()` for async action handlers |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 | Execute GSD commands via `query()` | Already installed (Phase 2); orchestrator calls ClaudeService which wraps this |
| `write-file-atomic` | ^7.0.0 | Atomic state persistence | Already installed (Phase 1); used by StateStore |
| `pino` | ^10.3.0 | Structured logging | Already installed (Phase 1); used by AutopilotLogger |
| `zod` | ^4.0.0 | Config and state validation | Already installed (Phase 1) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs/promises` | built-in | Read/write CONTEXT.md, config.json, ROADMAP.md | Every orchestrator run |
| `node:path` | built-in | Cross-platform path construction | All file operations |
| `node:events` | built-in | EventEmitter base for Orchestrator | Orchestrator class |
| `node:process` | built-in | Signal handling (SIGINT, SIGTERM) | Graceful shutdown |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Commander.js | `yargs` | Yargs is more powerful for multi-command hierarchies but heavier. Autopilot has one command with flags -- Commander is cleaner for this. |
| Commander.js | `citty` / `cleye` | Newer TypeScript-first alternatives but much smaller ecosystems. Commander's maturity and documentation outweigh the TypeScript DX advantage for this project. |
| Custom async loop | XState v5 | XState adds 16.7 kB + learning curve. The flow is linear (init > discuss > plan > execute > verify > next). XState's value is in complex branching/parallel states we don't have. Architecture research explicitly rejected XState. |
| Custom async loop | `fiume` (zero-dep FSM) | Lighter than XState but still adds abstraction for a fundamentally sequential flow. `for` loop + `switch` + EventEmitter is more transparent for contributors. |

**Installation:**
```bash
npm install commander
```

**Note:** All other dependencies are already installed from Phase 1 and Phase 2.

## Architecture Patterns

### Recommended Project Structure
```
src/
  cli/
    index.ts             # Commander setup, parseAsync(), bootstrap
  orchestrator/
    index.ts             # Orchestrator class (EventEmitter, main loop)
    discuss-handler.ts   # Discuss-phase: gray area analysis, CONTEXT.md generation
    gap-detector.ts      # Verify > find gaps > plan gaps > execute gaps
    yolo-config.ts       # Write .planning/config.json for autonomous GSD execution
    shutdown.ts          # Graceful shutdown manager (SIGINT/SIGTERM)
    __tests__/
      orchestrator.test.ts
      discuss-handler.test.ts
      gap-detector.test.ts
      yolo-config.test.ts
      shutdown.test.ts
```

### Pattern 1: Orchestrator as Async Loop with EventEmitter
**What:** The Orchestrator class extends EventEmitter and runs the phase lifecycle as a simple `for` loop with `async/await`. State transitions emit events for logging, notification, and dashboard updates.
**When to use:** Always -- this is the core pattern for the entire phase.
**Why:** The autopilot flow is fundamentally linear. Each phase runs discuss > plan > execute > verify sequentially. Using `for await` with `async` step functions is more readable, testable, and debuggable than a formal state machine library. The architecture research confirmed this approach.

```typescript
// Derived from .planning/research/ARCHITECTURE.md Orchestrator pattern
import { EventEmitter } from 'node:events';

class Orchestrator extends EventEmitter {
  private stateStore: StateStore;
  private claudeService: ClaudeService;
  private logger: AutopilotLogger;
  private config: AutopilotConfig;
  private shutdownRequested = false;

  async run(): Promise<void> {
    const state = this.stateStore.getState();

    // Initialize project if not already done
    if (state.currentPhase === 0) {
      await this.initProject();
    }

    // Phase loop with resume support
    for (const phase of state.phases) {
      if (phase.status === 'completed' || phase.status === 'skipped') continue;
      if (this.shutdownRequested) break;

      await this.runPhase(phase);
    }

    if (!this.shutdownRequested) {
      await this.completeMilestone();
    }
  }

  private async runPhase(phase: PhaseState): Promise<void> {
    await this.updateState({ currentPhase: phase.number, status: 'running' });
    this.emit('phase:started', { phase: phase.number, name: phase.name });

    // Step sequence with resume support
    if (phase.steps.discuss !== 'done') {
      await this.runStep(phase, 'discuss', () => this.runDiscuss(phase));
    }
    if (phase.steps.plan !== 'done') {
      await this.runStep(phase, 'plan', () => this.runPlan(phase));
    }
    if (phase.steps.execute !== 'done') {
      await this.runStep(phase, 'execute', () => this.runExecute(phase));
    }
    if (phase.steps.verify !== 'done' && !this.config.skipVerify) {
      await this.runStep(phase, 'verify', () => this.runVerify(phase));
    }

    await this.markPhaseComplete(phase);
    this.emit('phase:completed', { phase: phase.number, name: phase.name });
  }
}
```

### Pattern 2: Retry-Then-Escalate for Claude Commands
**What:** Every ClaudeService call is wrapped in a retry function that attempts once, and on second failure escalates to the human with retry/skip/abort options.
**When to use:** Every `runGsdCommand()` call from the orchestrator.
**Why:** LLM calls are inherently non-deterministic. A single retry often resolves transient issues (API rate limits, network blips, model confusion). Escalation prevents infinite retry loops while keeping the human in control.

```typescript
// ORCH-03, ORCH-04: Retry once, then escalate
async function executeWithRetry(
  claudeService: ClaudeService,
  prompt: string,
  options: RunCommandOptions,
  onEscalate: (error: string) => Promise<'retry' | 'skip' | 'abort'>,
): Promise<CommandResult> {
  // First attempt
  let result = await claudeService.runGsdCommand(prompt, options);
  if (result.success) return result;

  // Retry once (ORCH-03)
  result = await claudeService.runGsdCommand(prompt, options);
  if (result.success) return result;

  // Escalate to human (ORCH-04)
  const decision = await onEscalate(result.error ?? 'Unknown error');

  if (decision === 'retry') {
    return claudeService.runGsdCommand(prompt, options);
  }
  if (decision === 'skip') {
    return { success: false, error: 'Skipped by user', sessionId: '', durationMs: 0, costUsd: 0, numTurns: 0 };
  }
  // abort
  throw new Error('Aborted by user');
}
```

### Pattern 3: Graceful Shutdown Manager
**What:** A centralized shutdown manager that registers cleanup handlers, traps SIGINT/SIGTERM, and cascades cleanup in reverse startup order. Uses a boolean flag to prevent the orchestrator from starting new phases.
**When to use:** Application startup (CLI entry point).
**Why:** Ctrl+C must persist state for resume (CLI-14). Without centralized shutdown management, each component independently handles signals, leading to race conditions and incomplete cleanup.

```typescript
// CLI-14: Graceful shutdown with state persistence
class ShutdownManager {
  private handlers: Array<() => Promise<void>> = [];
  private shuttingDown = false;

  register(handler: () => Promise<void>): void {
    this.handlers.push(handler);
  }

  install(onShutdownRequested: () => void): void {
    const handler = async () => {
      if (this.shuttingDown) return; // Prevent double-shutdown
      this.shuttingDown = true;
      onShutdownRequested(); // Signal orchestrator to stop after current step

      // Run handlers in reverse registration order (LIFO)
      for (const h of [...this.handlers].reverse()) {
        try {
          await h();
        } catch {
          // Best-effort cleanup
        }
      }
      process.exit(0);
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }
}
```

**Windows consideration:** SIGTERM is not a real signal on Windows. However, `process.on('SIGINT')` works for Ctrl+C on Windows. `process.on('SIGTERM')` is a no-op on Windows but harmless to register. Node.js emits 'SIGINT' when Ctrl+C is pressed on Windows regardless.

### Pattern 4: Gap Detection Loop (ORCH-05)
**What:** After verify completes, check for gaps. If gaps are found, re-plan and re-execute the gaps, then re-verify. Bounded to 3 iterations maximum.
**When to use:** After every verification step.
**Why:** GSD's verify > find gaps > plan gaps > execute gaps cycle is a key differentiator. The bounded loop prevents infinite re-execution while giving the system a chance to self-heal.

```typescript
// ORCH-05: Gap detection with max 3 iterations
async function runVerifyWithGapLoop(
  phase: PhaseState,
  claudeService: ClaudeService,
  maxIterations: number = 3,
): Promise<'passed' | 'escalated'> {
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const verifyResult = await claudeService.runGsdCommand(
      `/gsd:verify-work ${phase.number}`,
      { phase: phase.number, step: 'verify' },
    );

    if (verifyResult.success) {
      // Check VERIFICATION.md or result text for gap indicators
      const hasGaps = await checkForGaps(phase.number);
      if (!hasGaps) return 'passed';

      // Re-plan gaps
      await claudeService.runGsdCommand(
        `/gsd:plan-phase ${phase.number} --gaps`,
        { phase: phase.number, step: 'plan' },
      );

      // Re-execute gaps only
      await claudeService.runGsdCommand(
        `/gsd:execute-phase ${phase.number} --gaps-only`,
        { phase: phase.number, step: 'execute' },
      );

      // Update iteration count in state
      phase.gapIterations = iteration + 1;
    }
  }

  return 'escalated'; // Max iterations reached
}
```

### Pattern 5: YOLO Mode Config Writer (ORCH-08)
**What:** Before running any GSD commands, write `.planning/config.json` with YOLO mode enabled and all interactive gates disabled. This ensures GSD commands run fully autonomously without prompting.
**When to use:** Once during initialization, before the first GSD command.
**Why:** GSD has interactive checkpoints and confirmation gates designed for human-driven workflows. The autopilot must bypass these since it runs autonomously. The config.json file controls GSD's behavior.

```typescript
// ORCH-08: Write YOLO config for autonomous GSD execution
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function writeYoloConfig(projectDir: string, config: AutopilotConfig): Promise<void> {
  const yoloConfig = {
    mode: 'yolo',
    depth: config.depth,
    parallelization: true,
    commit_docs: true,
    model_profile: config.model === 'quality' ? 'quality' : config.model === 'budget' ? 'budget' : 'balanced',
    workflow: {
      research: true,
      plan_check: true,
      verifier: !config.skipVerify,
    },
  };

  await writeFile(
    join(projectDir, '.planning', 'config.json'),
    JSON.stringify(yoloConfig, null, 2) + '\n',
  );
}
```

### Pattern 6: CLI Entry Point with Commander.js (CLI-01)
**What:** Use Commander.js v14 for parsing CLI arguments. The CLI bootstraps all components, wires them together, then starts the orchestrator. Uses `parseAsync()` for async action handlers.
**When to use:** The `src/cli/index.ts` entry point.
**Why:** Commander.js is the standard Node.js CLI framework. v14 supports ESM, requires Node >=20 (matches project target), includes TypeScript types, and provides automatic help generation.

```typescript
// CLI-01, CLI-07, CLI-08, CLI-09, CLI-10, CLI-14
import { Command } from 'commander';

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous GSD workflow orchestrator')
  .version('0.1.0')
  .requiredOption('--prd <path>', 'Path to PRD/idea document')
  .option('--resume', 'Resume from last checkpoint')
  .option('--skip-discuss', 'Skip discuss-phase, let Claude decide everything')
  .option('--skip-verify', 'Skip verification step')
  .option('--phases <range>', 'Run specific phases (e.g., 1-3)')
  .option('--notify <channel>', 'Notification channel', 'console')
  .option('--webhook-url <url>', 'Webhook URL for Teams/Slack')
  .option('--port <number>', 'Dashboard port', '3847')
  .option('--depth <level>', 'Planning depth', 'standard')
  .option('--model <profile>', 'Model profile', 'balanced')
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Suppress non-error output')
  .action(async (options) => {
    // Bootstrap: load config, create components, wire together, run
  });

await program.parseAsync(process.argv);
```

### Pattern 7: Discuss-Phase Handler (DISC-01 through DISC-04)
**What:** When discuss is not skipped, use ClaudeService to analyze the phase description, identify gray areas, batch questions 2-3 at a time, collect responses, and write CONTEXT.md. When skipped, generate a CONTEXT.md marking everything as "Claude's Discretion."
**When to use:** At the start of each phase, before planning.
**Why:** The discuss-phase captures human decisions that guide the entire phase implementation. Batching questions reduces notification spam while preserving the value of human input.

```typescript
// DISC-01 through DISC-04: Discuss-phase handler
async function handleDiscussPhase(
  phase: PhaseState,
  claudeService: ClaudeService,
  config: AutopilotConfig,
  projectDir: string,
): Promise<void> {
  const phaseDir = getPhaseDir(projectDir, phase.number);
  const contextPath = join(phaseDir, `${padPhase(phase.number)}-CONTEXT.md`);

  if (config.skipDiscuss) {
    // DISC-04: Generate "Claude's Discretion" CONTEXT.md
    const content = generateSkipDiscussContext(phase);
    await writeFile(contextPath, content);
    return;
  }

  // DISC-01: Use Claude to analyze gray areas
  const analysisResult = await claudeService.runGsdCommand(
    `/gsd:discuss-phase ${phase.number}`,
    { phase: phase.number, step: 'discuss' },
  );

  // The discuss-phase command itself handles:
  // - DISC-02: Question batching (built into the GSD command)
  // - DISC-03: Response collection and CONTEXT.md writing
  // The orchestrator just needs to wait for it to complete.
}
```

**Key insight about discuss-phase:** The `/gsd:discuss-phase` GSD command already handles gray area identification, question batching, and CONTEXT.md writing internally. The autopilot orchestrator's job for the discuss step is to either (a) run the GSD command and wait for it to complete (including waiting for human responses via the QuestionHandler), or (b) generate a skip-discuss CONTEXT.md directly. The orchestrator does NOT need to re-implement the discuss workflow -- it delegates to the existing GSD command via ClaudeService.

### Pattern 8: Phase Range Parsing (CLI-09)
**What:** Parse `--phases N-M` flag into a start/end range, filtering which phases the orchestrator processes.
**When to use:** CLI argument processing.

```typescript
// CLI-09: Parse phase range
function parsePhaseRange(range: string): { start: number; end: number } {
  const match = range.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid phase range: ${range}. Expected format: N or N-M`);
  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  if (start > end) throw new Error(`Invalid phase range: start (${start}) > end (${end})`);
  return { start, end };
}
```

### Anti-Patterns to Avoid
- **Spawning `claude -p` as child process:** Use ClaudeService (Agent SDK wrapper from Phase 2) exclusively. The pitfalls research documents hanging bugs and fragile output parsing with child process spawning.
- **Using `spawnSync` for anything:** Blocks the event loop, preventing the Express server (Phase 4) from responding. Use `async/await` throughout.
- **Shared mutable state between server and orchestrator:** Use EventEmitter for communication. Route handlers emit events; orchestrator listens and updates its own state.
- **Unbounded gap detection loops:** Always cap at 3 iterations (ORCH-05). Without bounds, a persistent issue causes infinite re-execution and token burn.
- **Parsing stdout strings for status detection:** Use CommandResult.success from the ClaudeService facade. Check filesystem state (does VERIFICATION.md exist? does it contain "passed"?) as a secondary signal.
- **Multiple signal handlers fighting:** Use a single ShutdownManager that coordinates all cleanup. Prevent double-shutdown with a boolean guard.
- **Re-implementing discuss-phase logic:** The `/gsd:discuss-phase` command already handles gray area analysis, question batching, and CONTEXT.md writing. The orchestrator should delegate to it via ClaudeService, not re-implement the workflow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Custom argv parser | Commander.js v14 | Option types, validation, help generation, error messages, parseAsync for async |
| State persistence | Custom JSON write | StateStore (Phase 1) with write-file-atomic | Atomic writes prevent corruption on crash |
| GSD command execution | Child process spawn | ClaudeService.runGsdCommand() (Phase 2) | Structured results, question interception, timeout, abort support |
| Question handling | Custom deferred promise map | QuestionHandler (Phase 2) | Already implements the deferred-promise lifecycle, event emission, and answer format |
| Log file management | Custom file writers | AutopilotLogger.createPhaseLogger() (Phase 1) | Per-phase-step log files, ring buffer for SSE, structured JSON |
| Config loading | Custom file+env parser | loadConfig() (Phase 1) | CLI > env > file > defaults precedence chain with Zod validation |

**Key insight:** Phase 3 is an integration phase. It wires together the components built in Phase 1 (StateStore, AutopilotLogger, loadConfig) and Phase 2 (ClaudeService, QuestionHandler) with new orchestration logic. The amount of genuinely new code is relatively small -- the value is in correct sequencing, state transitions, error handling, and graceful shutdown.

## Common Pitfalls

### Pitfall 1: Forgetting to Persist State Before Every Awaited Operation
**What goes wrong:** The orchestrator updates in-memory state (e.g., sets current step to 'execute') but does not persist to disk before calling `runGsdCommand()`. If the command crashes the process, the state file still says the previous step. On resume, the orchestrator re-executes the already-completed step.
**Why it happens:** Developers optimize by batching state writes, or forget to `await` the persist call before the next operation.
**How to avoid:** Always `await stateStore.setState(patch)` before any `await claudeService.runGsdCommand()` call. The StateStore already handles atomic writes -- the orchestrator just needs to call it consistently.
**Warning signs:** Resume re-executes completed work. State file is behind actual progress.

### Pitfall 2: Not Handling Resume State Correctly
**What goes wrong:** On `--resume`, the orchestrator loads the state file but does not correctly skip already-completed steps within a phase. It re-runs the entire phase because it only checks `phase.status`, not individual `phase.steps.{step}` values.
**Why it happens:** The phase-level status check (`completed`/`in_progress`) is simpler to implement than checking each step individually.
**How to avoid:** Check `phase.steps.discuss`, `phase.steps.plan`, etc. individually. Only run steps whose status is not `'done'`. The PhaseState type already has per-step tracking -- use it.
**Warning signs:** Resume re-runs discuss or plan for a phase where execute already completed.

### Pitfall 3: Error Cascade from Failed Phase Not Halting Downstream Phases
**What goes wrong:** Phase 3 fails, the orchestrator skips it and starts Phase 4. Phase 4 depends on Phase 3's output and also fails. The user gets a cascade of error notifications.
**Why it happens:** The orchestrator treats each phase independently without checking preconditions or understanding dependencies.
**How to avoid:** When a phase fails after retry and the human chooses "skip", the orchestrator should check if downstream phases depend on the skipped phase. If they do, warn the human that downstream phases may also fail. For a V1 implementation, a simple approach: if any phase fails with "abort", stop the entire run.
**Warning signs:** Multiple consecutive phase failures after a skip decision.

### Pitfall 4: YOLO Config Overwriting User's Existing config.json
**What goes wrong:** The user already has a `.planning/config.json` with custom settings (branching strategy, git preferences). The autopilot overwrites it with the YOLO config, losing their settings.
**Why it happens:** The YOLO config writer does a blind overwrite without reading existing settings.
**How to avoid:** Read the existing config.json (if any), merge YOLO-specific settings (mode, gates) while preserving user settings (branching, git), and write back. Alternatively, back up the original and restore on completion.
**Warning signs:** User's branching strategy or other git settings are lost after autopilot run.

### Pitfall 5: Discuss-Phase Blocking Forever When No Web UI Exists (Phase 3)
**What goes wrong:** The discuss-phase generates questions via QuestionHandler, which creates deferred promises. But Phase 4 (Response Server) has not been built yet, so there is no web UI to submit answers. The orchestrator blocks indefinitely.
**Why it happens:** Phase 3 introduces the question flow but the web UI is Phase 4/5.
**How to avoid:** For Phase 3, questions must be answerable through an alternative mechanism. Options: (a) console-based question display with stdin input (simplest for Phase 3), (b) log the question and provide a file-based answer mechanism, (c) use the QuestionHandler events to print questions to console and accept keyboard input. The notification system (Phase 6) is the proper long-term solution, but Phase 3 needs a working fallback.
**Warning signs:** Process hangs at "Waiting for response..." with no way to respond.

### Pitfall 6: Phase Number Mismatch Between State and ROADMAP.md
**What goes wrong:** The orchestrator initializes phases from ROADMAP.md at startup. If ROADMAP.md has been modified (phases added, reordered, or removed) since the state file was created, the phase numbers in the state file do not match. The orchestrator attempts to execute the wrong phase or skips phases entirely.
**Why it happens:** ROADMAP.md is modified by GSD commands during execution, but the state file has a snapshot of the phase list from initialization.
**How to avoid:** Re-read ROADMAP.md at the start of each phase to get the current phase list. Match phases by number, not by array index. If a phase in the state file does not exist in ROADMAP.md, mark it as skipped and log a warning.
**Warning signs:** Orchestrator logs "running phase 4: Foundation" when Phase 4 is actually "Response Server."

### Pitfall 7: Commander.js CJS/ESM Dual Import
**What goes wrong:** Importing `commander` in an ESM project with `import { Command } from 'commander'` works but the default export path may vary. Commander v14 uses a CJS package with an ESM wrapper (`esm.mjs`).
**Why it happens:** Commander.js is a CJS package that provides ESM support via exports map. The `import` specifier resolves to `esm.mjs`, which re-exports the CJS module.
**How to avoid:** Import as `import { Command } from 'commander'` -- the exports map handles resolution correctly. Do NOT import from `'commander/esm.mjs'` directly. Verified: Commander v14 works with `"module": "NodeNext"` in tsconfig.
**Warning signs:** TypeScript compilation errors about module resolution or missing types.

## Code Examples

Verified patterns from official sources and existing codebase:

### Complete CLI Entry Point (CLI-01)
```typescript
// Source: Commander.js v14 API + project patterns
import { Command } from 'commander';
import { loadConfig } from '../config/index.js';
import { StateStore } from '../state/index.js';
import { AutopilotLogger } from '../logger/index.js';
import { ClaudeService } from '../claude/index.js';
import { Orchestrator } from '../orchestrator/index.js';

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous GSD workflow orchestrator')
  .version('0.1.0')
  .requiredOption('--prd <path>', 'Path to PRD/idea document')
  .option('--resume', 'Resume from last checkpoint')
  .option('--skip-discuss', 'Skip discuss-phase')
  .option('--skip-verify', 'Skip verification')
  .option('--phases <range>', 'Run specific phases (e.g., 1-3)')
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Suppress non-error output')
  .action(async (options) => {
    const projectDir = process.cwd();
    const config = await loadConfig(projectDir, {
      skipDiscuss: options.skipDiscuss ?? false,
      skipVerify: options.skipVerify ?? false,
      verbose: options.verbose ?? false,
      quiet: options.quiet ?? false,
    });

    const logger = new AutopilotLogger(join(projectDir, '.planning', 'autopilot-log'));
    const claudeService = new ClaudeService({ defaultCwd: projectDir });
    const stateStore = options.resume
      ? await StateStore.restore(join(projectDir, '.planning', 'autopilot-state.json'))
      : StateStore.createFresh(projectDir);

    const orchestrator = new Orchestrator({ stateStore, claudeService, logger, config, projectDir });

    // Graceful shutdown
    const shutdown = new ShutdownManager();
    shutdown.register(() => logger.flush());
    shutdown.register(() => stateStore.setState({ status: 'idle' }));
    shutdown.install(() => orchestrator.requestShutdown());

    await orchestrator.run(options.prd, options.phases);
  });

await program.parseAsync(process.argv);
```

### ROADMAP.md Phase Extraction
```typescript
// Source: Project codebase patterns (ROADMAP.md structure)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RoadmapPhase {
  number: number;
  name: string;
  completed: boolean;
}

async function extractPhases(projectDir: string): Promise<RoadmapPhase[]> {
  const roadmap = await readFile(join(projectDir, '.planning', 'ROADMAP.md'), 'utf-8');
  const phases: RoadmapPhase[] = [];

  // Match phase lines: "- [x] **Phase N: Name**" or "- [ ] **Phase N: Name**"
  const phasePattern = /^- \[([ x])\] \*\*Phase (\d+): (.+?)\*\*/gm;
  let match;

  while ((match = phasePattern.exec(roadmap)) !== null) {
    phases.push({
      number: parseInt(match[2]!, 10),
      name: match[3]!,
      completed: match[1] === 'x',
    });
  }

  return phases;
}
```

### Skip-Discuss CONTEXT.md Generator (DISC-04)
```typescript
// Source: CONTEXT.md template from GSD (.planning/templates/context.md)
function generateSkipDiscussContext(phase: { number: number; name: string }): string {
  const padded = String(phase.number).padStart(2, '0');
  const now = new Date().toISOString().split('T')[0];

  return `# Phase ${phase.number}: ${phase.name} - Context

**Gathered:** ${now}
**Status:** Ready for planning (auto-generated, --skip-discuss)

<domain>
## Phase Boundary

Phase ${phase.number} as defined in ROADMAP.md. All implementation decisions deferred to Claude's discretion.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All areas deferred to Claude's discretion via --skip-discuss flag. Claude should make reasonable implementation choices based on research findings and standard practices.

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches (auto-generated via --skip-discuss)

</specifics>

<deferred>
## Deferred Ideas

None -- discussion skipped

</deferred>

---

*Phase: ${padded}-${phase.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}*
*Context gathered: ${now} (auto-generated)*
`;
}
```

### Verify Result Parsing -- Checking for Gaps
```typescript
// Source: GSD verify-work command output patterns
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function checkForGaps(projectDir: string, phaseNumber: number): Promise<boolean> {
  // Check for VERIFICATION.md or UAT.md in the phase directory
  const phaseDir = await findPhaseDir(projectDir, phaseNumber);
  const padded = String(phaseNumber).padStart(2, '0');

  try {
    const verificationPath = join(phaseDir, `${padded}-VERIFICATION.md`);
    const content = await readFile(verificationPath, 'utf-8');

    // GSD verify-work writes status indicators
    if (content.includes('gaps_found') || content.includes('GAPS_FOUND')) {
      return true;
    }
    if (content.includes('passed') || content.includes('PASSED')) {
      return false;
    }
  } catch {
    // No verification file yet
  }

  // Also check for UAT.md (GSD verify-work output format)
  try {
    const uatPath = join(phaseDir, `${padded}-UAT.md`);
    const content = await readFile(uatPath, 'utf-8');
    // Look for failed tests or issues found
    if (content.includes('FAIL') || content.includes('Issue Found')) {
      return true;
    }
  } catch {
    // No UAT file
  }

  return false; // Assume passed if no indicators found
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude -p` child process spawning | `ClaudeService.runGsdCommand()` via Agent SDK | Phase 2 (2026-02-15) | Structured results, question interception, no hanging bugs |
| Parsing stdout for status patterns | CommandResult.success + filesystem checks | Phase 2 (2026-02-15) | Reliable success/failure detection |
| Commander.js v12/v13 | Commander.js v14 | 2026-02 | Requires Node >=20 (matches project), improved ESM support |
| XState for state management | Custom async loop + EventEmitter | Architecture decision (2026-02-13) | Simpler for linear workflow, no additional dependency |
| `process.on('exit')` for cleanup | Dedicated ShutdownManager with SIGINT/SIGTERM | Best practice | Proper async cleanup, state persistence before exit |

**Deprecated/outdated:**
- `child_process.spawn('claude', ...)` for GSD commands: Replaced by Agent SDK `query()` in Phase 2.
- XState for this use case: Explicitly evaluated and rejected in architecture research.
- Commander.js v12 and below: v14 aligns with Node >=20 requirement and has better ESM support.

## Open Questions

1. **How does the orchestrator interact with `/gsd:new-project --auto`?**
   - What we know: The PRD shows `claude -p "/gsd:new-project --auto @prd.md"` as the initialization step. The `--auto` flag runs research, requirements, and roadmap generation without interaction. The `@prd.md` is a file reference.
   - What's unclear: Whether the Agent SDK `query()` supports the `@file` reference syntax in prompts. If not, the prompt needs to include the PRD content directly.
   - Recommendation: Test with literal `@prd.md` reference first. If the SDK does not expand file references in prompts, read the PRD file content and include it in the prompt text. The GSD `new-project --auto` command expects an idea document as context.

2. **Question answering mechanism before Phase 4 (Response Server)**
   - What we know: Phase 3 introduces the question flow via ClaudeService's QuestionHandler. Phase 4 builds the web server that accepts answers via HTTP POST. Phase 6 builds the notification system.
   - What's unclear: How users answer questions in Phase 3 when the web UI does not exist yet.
   - Recommendation: For Phase 3 testing and development, implement a minimal console-based question display that prints questions to stdout and accepts answers. This can be a simple EventEmitter listener on `question:pending` that logs the question and provides instructions. In production use, Phase 3 will always run alongside Phase 4+ (the full CLI), so this is primarily a development/testing concern. The orchestrator should emit events that later phases (4, 5, 6) can listen to.

3. **Notification stub for Phase 3**
   - What we know: ORCH-09 requires progress notifications after each phase. ORCH-10 requires completion notification. Phase 6 builds the notification system.
   - What's unclear: Whether Phase 3 should include a basic console notification or defer entirely to Phase 6.
   - Recommendation: Implement a minimal `ConsoleNotifier` class that satisfies the `NotificationAdapter` interface (already defined in types) and simply logs to the console via the AutopilotLogger. This provides visible progress during development without building the full notification system. Phase 6 replaces it with the proper notification manager.

4. **Phase extraction from ROADMAP.md robustness**
   - What we know: ROADMAP.md follows a consistent format with `- [x] **Phase N: Name**` entries.
   - What's unclear: Whether GSD commands modify this format during execution (e.g., inserting decimal phases, changing checkbox state).
   - Recommendation: Parse ROADMAP.md at startup and cache the phase list. Re-read before each phase to detect any changes. Use regex that handles both integer phases (`Phase 3`) and decimal phases (`Phase 2.1`). The `gsd-tools.js roadmap get-phase` command can also be used for individual phase lookups.

5. **How does `--prd` work with `--resume`?**
   - What we know: `--prd` provides the initial PRD document for project initialization. `--resume` picks up from the last checkpoint.
   - What's unclear: Whether `--prd` should be required with `--resume` (the PRD is already consumed during init and the state file exists).
   - Recommendation: Make `--prd` required only when `--resume` is NOT set. When resuming, the orchestrator loads state from the state file and does not need the PRD path. Commander.js does not natively support conditional required options, so validate manually in the action handler.

## Sources

### Primary (HIGH confidence)
- [Commander.js v14 npm](https://www.npmjs.com/package/commander) - v14.0.3, requires Node >=20, ESM via exports map, TypeScript types included
- [Commander.js GitHub](https://github.com/tj/commander.js) - API documentation, parseAsync(), option hooks, examples
- [Project architecture research](C:/GitHub/GetShitDone/get-shit-done/.planning/research/ARCHITECTURE.md) - Orchestrator pattern, EventEmitter decision, XState rejection rationale
- [Phase 2 research](C:/GitHub/GetShitDone/get-shit-done/.planning/phases/02-claude-integration/02-RESEARCH.md) - ClaudeService API, QuestionHandler pattern, Agent SDK usage
- [Project pitfalls research](C:/GitHub/GetShitDone/get-shit-done/.planning/research/PITFALLS.md) - Graceful shutdown, state corruption, error cascade patterns
- [Existing codebase: ClaudeService](C:/GitHub/GetShitDone/get-shit-done/autopilot/src/claude/index.ts) - runGsdCommand() interface, question event forwarding
- [Existing codebase: StateStore](C:/GitHub/GetShitDone/get-shit-done/autopilot/src/state/index.ts) - setState(), restore(), createFresh() API
- [Existing codebase: AutopilotLogger](C:/GitHub/GetShitDone/get-shit-done/autopilot/src/logger/index.ts) - createPhaseLogger(), log(), flush() API
- [Existing codebase: types](C:/GitHub/GetShitDone/get-shit-done/autopilot/src/types/) - AutopilotState, PhaseState, PhaseStep, AutopilotConfig, Notification, NotificationAdapter
- [GSD CONTEXT.md template](C:/GitHub/GetShitDone/get-shit-done/get-shit-done/templates/context.md) - CONTEXT.md format and examples
- [GSD config.json reference](C:/GitHub/GetShitDone/get-shit-done/get-shit-done/references/planning-config.md) - Planning config schema and options

### Secondary (MEDIUM confidence)
- [Express.js graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) - server.close() pattern, cleanup ordering
- [Node.js process signals](https://nodejs.org/api/process.html) - SIGINT/SIGTERM handling, Windows behavior
- [Graceful shutdown guide (OneUptime)](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) - Modern 2026 patterns for Node.js shutdown
- [Saga pattern for async orchestration](https://www.priyankrajai.com/blog/async-job-orchestration-saga-pattern) - Step state machines, dependency resolution, timeout handling

### Tertiary (LOW confidence)
- None. All findings verified through official documentation, existing codebase analysis, or prior project research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Commander.js v14 verified on npm; all other dependencies already installed and working from Phase 1/2
- Architecture: HIGH - Orchestrator pattern derived from project's own architecture research, confirmed by existing codebase patterns
- Pitfalls: HIGH - Identified from project's own pitfalls research, verified against existing code and Node.js docs
- Discuss-phase handler: HIGH - CONTEXT.md template verified from GSD codebase; discuss-phase command well-documented
- Gap detection: MEDIUM - GSD verify-work output format not fully documented; gap detection relies on file content parsing that may vary

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (Commander.js is stable; core Node.js APIs are stable; project-internal patterns are locked)
