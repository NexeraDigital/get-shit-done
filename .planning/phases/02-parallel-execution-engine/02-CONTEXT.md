# Phase 2: Parallel Execution Engine - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable parallel phase execution via `--parallel` flag. Multiple ClaudeService instances run independent phases concurrently in git-worktree-isolated workers, with the full discuss/plan/execute/verify lifecycle per phase. Sequential mode remains the default and behaves identically to current behavior. Failure handling and auto-resolution of merge conflicts are Phase 3 concerns.

</domain>

<decisions>
## Implementation Decisions

### Worker Pool Design
- One worker per phase: spawn a new ClaudeService for each ready phase, up to the concurrency limit. Worker dies when phase completes.
- Immediate dispatch: as soon as a worker finishes and `scheduler.markComplete()` returns newly eligible phases, dispatch the next one immediately (no batch waiting).
- Worker metadata (worker ID, worktree path, PID, phase number) tracked in-memory only. If autopilot crashes, resume logic re-detects state from disk (worktrees, phase completion markers).
- Questions from parallel phases go to a shared phase-tagged queue. Dashboard shows phase context. One answer file, orchestrator routes answers to the correct worker.

### CLI Flag Semantics
- `--parallel` with no arguments runs all phases from the roadmap, using the DependencyScheduler to determine concurrency.
- `--phases 2-5 --parallel` combines: runs phases 2-5 in parallel respecting dependencies. `--phases` alone stays sequential. `--parallel` alone runs all.
- Default concurrency cap: `--concurrency 3`. Each ClaudeService uses ~200-500MB.
- `--parallel` is CLI-only (not persisted to config.json). User explicitly opts in each run.
- `--resume` without `--parallel` resumes remaining phases sequentially, even if the previous run was parallel. User must add `--parallel` to resume in parallel mode.

### Sequential Compatibility
- Unified orchestrator loop: one code path uses the DependencyScheduler always. Sequential mode = concurrency 1. Parallel mode = concurrency N. Same loop, different limit.
- No worktrees in sequential mode. Sequential runs phases directly in the main repo, exactly as today. Worktrees are a parallel-only concept.
- The scheduler is used even for sequential `--phases` range cases. Consistent code path, respects dependency ordering.

### Git Worktree Lifecycle
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

</decisions>

<specifics>
## Specific Ideas

- The existing `extractPhasesFromContent()` already returns `dependsOn` as parsed data — the unified loop should consume DependencyScheduler directly, not re-parse
- Phase 1's `StateWriteQueue` (promise-chain serialization) handles concurrent state mutations — workers report completion to the orchestrator which uses this queue
- Per-worker event files (`events-phase-{N}.ndjson`) from Phase 1 infrastructure are ready to use

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DependencyScheduler` (`scheduler/index.ts`): `getReady()`, `markInProgress()`, `markComplete()`, `isComplete()` — fully tested
- `parseDependsOn()` (`scheduler/parse-depends-on.ts`): Converts ROADMAP.md strings to phase number arrays
- `StateWriteQueue` (`state/index.ts`): Promise-chain serialization for concurrent mutations
- `EventWriter` (`ipc/event-writer.ts`): Already supports `phaseNumber`, `workerId`, `stepName` metadata and per-worker event files
- `ClaudeService` (`claude/index.ts`): Spawns Claude Code processes with `runGsdCommand()`
- `extractPhasesFromContent()` (`orchestrator/index.ts`): Parses ROADMAP.md phases with `dependsOn`

### Established Patterns
- File-based IPC: NDJSON events, JSON questions/heartbeat, atomic writes via `write-file-atomic`
- Zod schema validation on all state persistence/restore
- Single-writer state mutations via StateWriteQueue
- CLI flags → config merge (CLI > env > file) via `loadConfig()`

### Integration Points
- `orchestrator/index.ts` line 375: Sequential phase loop — becomes scheduler-driven unified loop
- `cli/index.ts` line 180: ClaudeService creation — becomes WorkerPool creation in parallel mode
- `cli/index.ts` lines 65-80: CLI flag definitions — add `--parallel`, `--concurrency`
- `types/config.ts`: AutopilotConfig schema — add `parallel` and `concurrency` fields
- `state/index.ts`: StateStore — orchestrator uses it to track phase completion across workers

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-parallel-execution-engine*
*Context gathered: 2026-03-12*
