# Phase 2: Parallel Execution Engine - Research

**Researched:** 2026-03-12
**Domain:** Parallel process orchestration, git worktree isolation, Node.js child process management
**Confidence:** HIGH

## Summary

Phase 2 transforms the existing sequential orchestrator loop into a scheduler-driven unified loop that supports both sequential (concurrency 1) and parallel (concurrency N) execution. The key building blocks from Phase 1 are already in place: `DependencyScheduler` for DAG-based phase ordering, `StateWriteQueue` for serialized state mutations, `EventWriter` with per-worker file support, and `ClaudeService` for spawning Claude Code sessions.

The primary technical challenges are: (1) creating a WorkerPool that manages multiple ClaudeService instances with worktree-isolated working directories, (2) refactoring the Orchestrator's phase loop from a for-of sequential loop into a scheduler-driven dispatch loop, and (3) implementing a robust git worktree lifecycle (create branch, add worktree, merge back, cleanup). All git worktree operations use shell-out via `execFile` -- there is no npm library needed.

**Primary recommendation:** Build a WorkerPool class that owns ClaudeService instances and worktree lifecycle. The unified orchestrator loop calls `scheduler.getReady()`, dispatches to the WorkerPool up to concurrency limit, and reacts to completion callbacks to dispatch newly eligible phases.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Worker Pool Design:**
- One worker per phase: spawn a new ClaudeService for each ready phase, up to the concurrency limit. Worker dies when phase completes.
- Immediate dispatch: as soon as a worker finishes and `scheduler.markComplete()` returns newly eligible phases, dispatch the next one immediately (no batch waiting).
- Worker metadata (worker ID, worktree path, PID, phase number) tracked in-memory only. If autopilot crashes, resume logic re-detects state from disk (worktrees, phase completion markers).
- Questions from parallel phases go to a shared phase-tagged queue. Dashboard shows phase context. One answer file, orchestrator routes answers to the correct worker.

**CLI Flag Semantics:**
- `--parallel` with no arguments runs all phases from the roadmap, using the DependencyScheduler to determine concurrency.
- `--phases 2-5 --parallel` combines: runs phases 2-5 in parallel respecting dependencies. `--phases` alone stays sequential. `--parallel` alone runs all.
- Default concurrency cap: `--concurrency 3`. Each ClaudeService uses ~200-500MB.
- `--parallel` is CLI-only (not persisted to config.json). User explicitly opts in each run.
- `--resume` without `--parallel` resumes remaining phases sequentially, even if the previous run was parallel. User must add `--parallel` to resume in parallel mode.

**Sequential Compatibility:**
- Unified orchestrator loop: one code path uses the DependencyScheduler always. Sequential mode = concurrency 1. Parallel mode = concurrency N. Same loop, different limit.
- No worktrees in sequential mode. Sequential runs phases directly in the main repo, exactly as today. Worktrees are a parallel-only concept.
- The scheduler is used even for sequential `--phases` range cases. Consistent code path, respects dependency ordering.

**Git Worktree Lifecycle:**
- Worktrees created adjacent to repo at `../{repo}-worktrees/phase-{N}/`. Avoids nested .git issues and keeps repo clean.
- Branch naming: `gsd/phase-{N}` (e.g., `gsd/phase-2`). Branched from current HEAD.
- Merge back immediately on phase completion. Keeps main up-to-date, surfaces conflicts early.
- If merge fails (conflict): mark the phase as failed, preserve the worktree for manual resolution, log the conflict. Phase 3 will add auto-resolution.
- Worktree and branch cleaned up after successful merge (GIT-06).

### Claude's Discretion

- WorkerPool module location and internal class design
- Git worktree creation/cleanup implementation details
- How the unified orchestrator loop coordinates with the worker pool
- Event consolidation strategy for dashboard consumption
- Heartbeat handling for multiple workers (per-worker or consolidated)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-01 | User can enable parallel mode with `--parallel` flag (backward compatible, sequential remains default) | CLI flag addition to commander, unified loop with concurrency parameter |
| SCHED-03 | User can manually specify which phases run in parallel (e.g., `--parallel 2,3,5`) | Changed to `--phases 2-5 --parallel` combination per CONTEXT decisions |
| SCHED-04 | User can limit max concurrent workers with `--concurrency N` flag (default ~3) | CLI flag + config merge pattern already established |
| EXEC-01 | Multiple ClaudeService instances run simultaneously, one per parallel phase | WorkerPool creates independent ClaudeService per worker with isolated cwd |
| EXEC-02 | Each parallel phase runs the full lifecycle (discuss/plan/execute/verify) independently | Each worker runs the existing `runPhase()` logic with worktree cwd |
| GIT-01 | Each parallel phase executes in its own git worktree | `git worktree add -b gsd/phase-N ../repo-worktrees/phase-N/` |
| GIT-02 | On phase completion, worktree changes are merged back to the central branch | `git merge gsd/phase-N` in main repo after phase completes |
| GIT-06 | Worktree is cleaned up (removed) after successful merge | `git worktree remove` + `git branch -d gsd/phase-N` |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `child_process.execFile` | built-in | Git worktree commands | Already used in Orchestrator for git operations. No npm library for worktrees. |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 | ClaudeService instances | Already the core SDK dependency. One instance per worker. |
| `commander` | ^14.0.3 | CLI flag parsing | Already used. Add `--parallel`, `--concurrency` options. |
| `zod` | ^4.0.0 | Config schema validation | Already used. Extend AutopilotConfigSchema. |
| `write-file-atomic` | ^7.0.0 | Crash-safe state writes | Already used by StateStore. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | ^10.3.0 | Structured logging | Already used. Per-worker log context. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw execFile for git | `simple-git` npm | Adds dependency for 5 commands. Not worth it -- execFile is already the pattern. |
| In-memory worker tracking | Persistent worker state file | CONTEXT says in-memory only. Crash recovery uses disk artifacts. |

**Installation:**
No new dependencies needed. All required libraries are already installed.

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
├── worker/                    # NEW: Worker pool and git worktree management
│   ├── index.ts               # WorkerPool class
│   ├── git-worktree.ts        # Git worktree create/merge/cleanup functions
│   ├── types.ts               # WorkerState, WorkerResult interfaces
│   └── __tests__/
│       ├── worker-pool.test.ts
│       └── git-worktree.test.ts
├── orchestrator/
│   └── index.ts               # MODIFIED: Unified scheduler-driven loop
├── cli/
│   └── index.ts               # MODIFIED: --parallel, --concurrency flags
├── types/
│   └── config.ts              # MODIFIED: parallel, concurrency fields
├── scheduler/                 # EXISTING (Phase 1): DependencyScheduler
├── state/                     # EXISTING (Phase 1): StateStore, StateWriteQueue
└── ipc/                       # EXISTING (Phase 1): EventWriter with worker support
```

### Pattern 1: Unified Scheduler-Driven Loop
**What:** Replace the sequential `for (const phase of phases)` loop with a scheduler-driven dispatch loop. The loop calls `scheduler.getReady()`, dispatches phases to workers up to concurrency limit, and awaits completion signals. When a worker completes, `scheduler.markComplete()` returns newly eligible phases which are immediately dispatched.
**When to use:** Always -- both sequential and parallel modes use this loop. Sequential = concurrency 1 (no worktree). Parallel = concurrency N (with worktrees).
**Example:**
```typescript
// Unified orchestrator loop (pseudocode)
async runSchedulerLoop(phases: SchedulerPhase[], concurrency: number, parallel: boolean): Promise<void> {
  const scheduler = new DependencyScheduler(phases);
  const workerPool = new WorkerPool({ concurrency, parallel, projectDir: this.projectDir });

  while (!scheduler.isComplete()) {
    const ready = scheduler.getReady();
    for (const phase of ready) {
      if (workerPool.activeCount >= concurrency) break;
      scheduler.markInProgress(phase.number);
      workerPool.dispatch(phase, async (result) => {
        if (result.success) {
          const newlyReady = scheduler.markComplete(phase.number);
          // Dispatch newly ready phases immediately
        } else {
          // Mark failed, preserve worktree
        }
      });
    }
    // Wait for at least one worker to finish before checking again
    await workerPool.waitForAny();
  }
}
```

### Pattern 2: WorkerPool with ClaudeService Lifecycle
**What:** WorkerPool creates a fresh ClaudeService instance for each phase. In parallel mode, it creates a git worktree before spawning the ClaudeService with the worktree path as `cwd`. On completion, it merges back and cleans up.
**When to use:** All parallel execution.
**Example:**
```typescript
interface WorkerHandle {
  phaseNumber: number;
  workerId: string;
  worktreePath: string | null; // null for sequential
  claudeService: ClaudeService;
  promise: Promise<WorkerResult>;
}

class WorkerPool {
  private active: Map<number, WorkerHandle> = new Map();

  async dispatch(phase: SchedulerPhase, phaseState: PhaseState): Promise<void> {
    const workerId = `worker-${phase.number}`;
    let worktreePath: string | null = null;

    if (this.parallel) {
      worktreePath = await createWorktree(this.projectDir, phase.number);
    }

    const cwd = worktreePath ?? this.projectDir;
    const claude = new ClaudeService({ defaultCwd: cwd, autoAnswer: false });
    // Wire events, run phase lifecycle, handle completion
  }
}
```

### Pattern 3: Git Worktree Lifecycle Functions
**What:** Pure functions for git worktree operations using `execFile`. Each function wraps a single git command with proper error handling.
**When to use:** Parallel mode only.
**Example:**
```typescript
import { execFile } from 'node:child_process';
import { basename, resolve, join } from 'node:path';

// Create worktree with new branch from current HEAD
async function createWorktree(projectDir: string, phaseNumber: number): Promise<string> {
  const repoName = basename(resolve(projectDir));
  const worktreePath = resolve(projectDir, '..', `${repoName}-worktrees`, `phase-${phaseNumber}`);
  const branchName = `gsd/phase-${phaseNumber}`;

  await execGit(projectDir, ['worktree', 'add', '-b', branchName, worktreePath]);
  return worktreePath;
}

// Merge worktree branch back to current branch
async function mergeWorktree(projectDir: string, phaseNumber: number): Promise<boolean> {
  const branchName = `gsd/phase-${phaseNumber}`;
  try {
    await execGit(projectDir, ['merge', branchName, '--no-edit']);
    return true;
  } catch {
    return false; // Conflict -- Phase 3 handles auto-resolution
  }
}

// Clean up worktree and branch
async function cleanupWorktree(projectDir: string, phaseNumber: number): Promise<void> {
  const repoName = basename(resolve(projectDir));
  const worktreePath = resolve(projectDir, '..', `${repoName}-worktrees`, `phase-${phaseNumber}`);
  await execGit(projectDir, ['worktree', 'remove', worktreePath, '--force']);
  await execGit(projectDir, ['branch', '-d', `gsd/phase-${phaseNumber}`]);
}

// Helper: promisified execFile for git commands
function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}
```

### Pattern 4: Question Routing for Parallel Workers
**What:** Questions from multiple ClaudeService instances share the same answer mechanism. Each question is tagged with phase number. The orchestrator routes answers to the correct worker's ClaudeService via `submitAnswer()`.
**When to use:** Parallel mode when multiple workers may have pending questions.
**Example:**
```typescript
// In WorkerPool: wire each ClaudeService's question events
claude.on('question:pending', (event: QuestionEvent) => {
  // Event already has phase metadata from ClaudeService options
  // Forward to orchestrator's shared question handling
  this.emit('question:pending', { ...event, phase: phaseNumber });
});

// In orchestrator: route answer to correct worker
answerPoller.onAnswer = (questionId, answers) => {
  for (const [, handle] of workerPool.active) {
    if (handle.claudeService.submitAnswer(questionId, answers)) break;
  }
};
```

### Anti-Patterns to Avoid
- **Shared ClaudeService across workers:** ClaudeService explicitly throws if a command is already running (`this.running` check). Each worker MUST have its own instance.
- **Running `npm install` in worktrees:** The GSD autopilot runs Claude Code processes that operate on planning files (`.planning/`). No build step needed in worktrees.
- **Worktrees in sequential mode:** The CONTEXT explicitly states no worktrees for sequential. Sequential runs directly in the main repo.
- **Persisting parallel/concurrency to config.json:** These are CLI-only flags per CONTEXT decision. Do not add to `.gsd-autopilot.json` schema.
- **Merging from worktree directory:** Always merge from the main repo's working directory, not from within the worktree. Run `git merge gsd/phase-N` from `projectDir`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DAG scheduling | Custom topological sort | `DependencyScheduler` (Phase 1) | Already built and tested with cycle detection |
| Concurrent state writes | Manual file locking | `StateWriteQueue` (Phase 1) | Promise-chain serialization handles concurrent mutations |
| Per-worker event files | Custom file routing | `EventWriter` with `phaseNumber` option (Phase 1) | Already supports per-worker event files |
| Atomic file writes | Manual rename-on-close | `write-file-atomic` | Handles platform-specific edge cases (Windows EPERM) |
| CLI flag parsing | Custom argv parsing | `commander` | Already the project's CLI framework |
| Process abort/timeout | Custom signal handling | `AbortController` in ClaudeService | Already implemented with timeout support |

**Key insight:** Phase 1 built all the infrastructure primitives. Phase 2 is an integration phase that composes existing pieces into the parallel execution flow. The only genuinely new code is the WorkerPool, git worktree functions, and the unified loop refactor.

## Common Pitfalls

### Pitfall 1: Git Worktree Branch Already Exists
**What goes wrong:** If a previous parallel run crashed, branches like `gsd/phase-2` may still exist, causing `git worktree add -b` to fail.
**Why it happens:** Crash recovery doesn't clean up branches. `--resume` starts a new run.
**How to avoid:** Before creating a worktree, check if the branch exists. If it does, delete both the stale worktree (if any) and branch before creating fresh ones.
**Warning signs:** `fatal: A branch named 'gsd/phase-2' already exists` error from git.

### Pitfall 2: Merge Race Condition Between Concurrent Phases
**What goes wrong:** Two phases complete simultaneously and both try to merge to main. Git merge is not atomic across processes.
**Why it happens:** Concurrent `git merge` operations on the same branch.
**How to avoid:** Serialize merge operations through a mutex or queue. Use the `StateWriteQueue` pattern -- enqueue merge operations so only one runs at a time.
**Warning signs:** "fatal: You have not concluded your merge" or index.lock errors.

### Pitfall 3: Worktree Path Contains Spaces or Special Characters
**What goes wrong:** `execFile` with worktree paths fails on Windows paths with spaces.
**Why it happens:** Path construction doesn't account for project directories with spaces.
**How to avoid:** Always pass paths as separate arguments to `execFile` (not as part of a shell string). `execFile` handles quoting automatically, unlike `exec`.
**Warning signs:** "fatal: invalid path" errors on Windows.

### Pitfall 4: Event/State Writes From Worktree Workers
**What goes wrong:** Workers in worktrees write events and state to `.planning/autopilot/` inside the worktree, not the main repo.
**Why it happens:** EventWriter and StateStore use relative paths from `projectDir`. If `projectDir` is the worktree path, files go to the wrong place.
**How to avoid:** Always use the MAIN repo's `projectDir` for IPC paths (events, heartbeat, state). Only the ClaudeService `cwd` should use the worktree path. The orchestrator-level IPC components must reference the original project directory.
**Warning signs:** Dashboard stops seeing events when parallel workers start.

### Pitfall 5: Shutdown Cleanup With Active Worktrees
**What goes wrong:** SIGINT kills the process but leaves orphaned worktrees and branches.
**Why it happens:** ShutdownManager doesn't know about worktrees.
**How to avoid:** Register worktree cleanup in ShutdownManager. On graceful shutdown, abort all active ClaudeService instances, then clean up worktrees. Note: failed/interrupted phase worktrees should be PRESERVED per Phase 3's FAIL-04 requirement.
**Warning signs:** `git worktree list` shows stale worktrees after crash.

### Pitfall 6: Orchestrator State Mutation From Multiple Workers
**What goes wrong:** Multiple workers call `persistPhaseUpdate()` concurrently, causing state corruption.
**Why it happens:** Each worker's completion triggers a state update. Without serialization, writes interleave.
**How to avoid:** Route ALL state mutations through the orchestrator's StateWriteQueue (or a dedicated queue). Workers emit completion events; the orchestrator handles state updates in a single serialized path.
**Warning signs:** `state.json` has stale phase data or missing completion markers.

## Code Examples

### Adding CLI Flags (commander)
```typescript
// In cli/index.ts, add to program options (around line 69-79)
.option('--parallel', 'Run phases in parallel using git worktrees')
.option('--concurrency <n>', 'Max concurrent workers (default: 3)', '3')
```

### Extending AutopilotConfig Schema
```typescript
// In types/config.ts -- add runtime-only fields (NOT persisted)
// These are passed through cliFlags, not the config file schema.
// The CLI action handler reads them from commander options directly.
```

### Building SchedulerPhase Array From Roadmap
```typescript
// In orchestrator: convert RoadmapPhase[] to SchedulerPhase[]
import { parseDependsOn } from '../scheduler/parse-depends-on.js';

function toSchedulerPhases(roadmapPhases: RoadmapPhase[]): SchedulerPhase[] {
  return roadmapPhases.map(rp => ({
    number: rp.number,
    name: rp.name,
    dependencies: parseDependsOn(rp.dependsOn),
  }));
}
```

### Git Worktree Stale Cleanup
```typescript
// Before creating a worktree, clean up stale artifacts from previous runs
async function ensureCleanWorktree(projectDir: string, phaseNumber: number): Promise<void> {
  const branchName = `gsd/phase-${phaseNumber}`;
  const repoName = basename(resolve(projectDir));
  const worktreePath = resolve(projectDir, '..', `${repoName}-worktrees`, `phase-${phaseNumber}`);

  // Try removing existing worktree (may not exist -- that's fine)
  try {
    await execGit(projectDir, ['worktree', 'remove', worktreePath, '--force']);
  } catch { /* Not found -- OK */ }

  // Try deleting existing branch
  try {
    await execGit(projectDir, ['branch', '-D', branchName]);
  } catch { /* Not found -- OK */ }

  // Prune stale worktree entries
  await execGit(projectDir, ['worktree', 'prune']);
}
```

### Serialized Merge Queue
```typescript
// Use StateWriteQueue pattern to serialize merge operations
const mergeQueue = new StateWriteQueue();

async function safeMerge(projectDir: string, phaseNumber: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    mergeQueue.enqueue(async () => {
      const success = await mergeWorktree(projectDir, phaseNumber);
      resolve(success);
    }).catch(reject);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential phase loop | Scheduler-driven unified loop | Phase 2 (this work) | Same code path for sequential and parallel |
| Single ClaudeService | WorkerPool with multiple instances | Phase 2 (this work) | Enables concurrent phase execution |
| Direct repo execution | Git worktree isolation | Phase 2 (this work) | Prevents file conflicts between parallel phases |
| Manual phase ordering | DependencyScheduler from ROADMAP.md | Phase 1 (completed) | DAG-based ordering with cycle detection |

**Industry context:** Cursor, Claude Code, and Codex all adopted git worktrees for parallel AI agent workflows in 2025-2026. The pattern is well-established: one worktree per agent, branch per task, merge back on completion.

## Open Questions

1. **Heartbeat handling for multiple workers**
   - What we know: HeartbeatWriter currently writes a single heartbeat file for the orchestrator process.
   - What's unclear: Should each worker have its own heartbeat, or is the orchestrator heartbeat sufficient?
   - Recommendation: Keep a single orchestrator heartbeat. Workers are tracked in-memory by the WorkerPool. If the orchestrator is alive, workers are managed.

2. **Merge ordering when multiple phases complete simultaneously**
   - What we know: Merges must be serialized to avoid git index.lock conflicts.
   - What's unclear: Should merge order follow phase number or completion order?
   - Recommendation: Use completion order (FIFO queue). Earlier completions merge first. This is simpler and avoids starvation.

3. **Worker event wiring complexity**
   - What we know: Each ClaudeService emits messages, questions, and results. In sequential mode, CLI wires these in one place.
   - What's unclear: How much of the CLI's wiring needs to move into WorkerPool vs. stay in CLI.
   - Recommendation: WorkerPool should expose the same events as a single ClaudeService (forwarding from all workers). The CLI wires to WorkerPool exactly as it wires to ClaudeService today.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `autopilot/vitest.config.ts` |
| Quick run command | `cd autopilot && npx vitest run --reporter=verbose` |
| Full suite command | `cd autopilot && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | `--parallel` flag parsed, sequential default | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | No -- Wave 0 |
| SCHED-03 | `--phases + --parallel` combination works | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | No -- Wave 0 |
| SCHED-04 | `--concurrency N` parsed with default 3 | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | No -- Wave 0 |
| EXEC-01 | WorkerPool creates multiple ClaudeService instances | unit | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -x` | No -- Wave 0 |
| EXEC-02 | Each worker runs full lifecycle independently | integration | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -x` | No -- Wave 0 |
| GIT-01 | Worktree created with correct branch and path | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | No -- Wave 0 |
| GIT-02 | Merge back to main on completion | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | No -- Wave 0 |
| GIT-06 | Worktree and branch cleaned up after merge | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd autopilot && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd autopilot && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `autopilot/src/worker/__tests__/git-worktree.test.ts` -- covers GIT-01, GIT-02, GIT-06
- [ ] `autopilot/src/worker/__tests__/worker-pool.test.ts` -- covers EXEC-01, EXEC-02
- [ ] `autopilot/src/orchestrator/__tests__/unified-loop.test.ts` -- covers SCHED-01, scheduler-driven loop
- [ ] No new framework config needed -- vitest already configured

## Sources

### Primary (HIGH confidence)
- [Git official docs: git-worktree](https://git-scm.com/docs/git-worktree) -- command syntax, flags, locking
- Project source code: `autopilot/src/scheduler/index.ts` -- DependencyScheduler API
- Project source code: `autopilot/src/orchestrator/index.ts` -- existing sequential loop (line 375)
- Project source code: `autopilot/src/claude/index.ts` -- ClaudeService API, concurrent execution guard
- Project source code: `autopilot/src/state/index.ts` -- StateWriteQueue, StateStore
- Project source code: `autopilot/src/ipc/event-writer.ts` -- per-worker event file support
- Project source code: `autopilot/src/ipc/types.ts` -- IPC_PATHS.workerEvents
- Project source code: `autopilot/src/cli/index.ts` -- CLI wiring patterns, commander setup

### Secondary (MEDIUM confidence)
- [Nx Blog: Git worktrees for AI agents](https://nx.dev/blog/git-worktrees-ai-agents) -- industry patterns
- [Upsun: Git worktrees for parallel AI coding agents](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/) -- architectural patterns
- [Ken Muse: Using Git Worktrees for Concurrent Development](https://www.kenmuse.com/blog/using-git-worktrees-for-concurrent-development/) -- merge workflow

### Tertiary (LOW confidence)
- None -- all findings verified against official docs or source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all libraries already in use
- Architecture: HIGH -- patterns derived directly from existing codebase structure and CONTEXT decisions
- Pitfalls: HIGH -- derived from source code analysis (ClaudeService concurrent guard, StateStore mutation paths, git worktree command semantics)
- Git worktree operations: HIGH -- verified against official git documentation

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain, no fast-moving dependencies)
