# Phase 3: Failure Handling and Git Conflict Resolution - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The parallel engine handles errors gracefully -- failed phases do not corrupt the project, merge conflicts are resolved and documented, and the user retains full control over recovery. This phase extends the existing ShutdownManager, WorkerPool, and mergeWorktree() from Phase 2 with robust failure handling, conflict resolution, and reporting. Dashboard integration is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Failure Modes
- **Fail-fast (default):** When a phase fails, abort all other workers immediately via `WorkerPool.abortAll()`. No waiting for current steps to finish.
- **`--continue` mode:** Independent phases keep running after a failure. Dependent phases are automatically skipped with a clear message (not queued).
- **`--continue` is CLI-only** -- not persisted to config.json. Consistent with `--parallel` pattern from Phase 2.
- **Summary table at run end:** All phases listed with status (passed/failed/skipped/running). Failed phases show error reason. Similar to test runner output.

### Graceful Shutdown
- **Worktree cleanup on shutdown:** Successfully completed worktrees are cleaned up. Failed or in-progress worktrees are preserved for debugging (FAIL-04).
- **Child process termination:** SIGTERM first, wait a short timeout (e.g., 5s), then SIGKILL any survivors. Gives Claude Code processes a chance to clean up.
- **Double Ctrl+C = force exit:** First SIGINT starts graceful shutdown. Second SIGINT within a few seconds forces immediate `process.exit(1)` with no cleanup.
- **Exit code:** Non-zero (1) when shutdown was triggered by failure or signal. CI-friendly.

### Merge Conflict Resolution
- **Auto-resolution strategy:** Claude's discretion on what conflicts can be auto-resolved vs flagged for manual intervention (based on what git merge supports natively).
- **Resolution report:** Structured markdown file per phase at `.planning/phases/XX-name/merge-report.md` containing: conflicting files, resolution strategy used, and outcome.
- **Merge failure in --continue mode:** Failed-merge phase is marked failed. Other completed phases still attempt their merges (serialized). One bad merge doesn't block unrelated phase merges.

### Resolution Context Chaining
- **In-memory accumulator:** Orchestrator maintains a list of resolution reports during the run. Prior reports passed as context when attempting new merges. Also written to disk.
- **Cross-run continuity:** On `--resume`, load existing `merge-report.md` files from disk and seed the in-memory accumulator.
- **Context content:** Files that conflicted + strategy used (e.g., "took phase 3 changes for src/worker/"). Enough to pattern-match without being overwhelming.
- **Summary visibility:** Summary table includes a "Merge" column showing clean/resolved/conflict for each phase.

### Claude's Discretion
- Auto-resolution strategy (which conflict types to attempt vs flag)
- Resolution report internal structure and markdown format
- SIGTERM timeout duration before SIGKILL
- Double Ctrl+C detection window
- How skipped-dependent phases are represented in DependencyScheduler

</decisions>

<specifics>
## Specific Ideas

- Summary table should feel like test runner output (vitest/jest) -- scannable at a glance with clear pass/fail/skip indicators
- The existing `requestShutdown()` in the orchestrator and `abortAll()` in WorkerPool are the integration points -- this phase wires them together properly
- ShutdownManager's LIFO handler pattern is the right place to register worktree cleanup handlers per worker

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ShutdownManager` (`orchestrator/shutdown.ts`): SIGINT/SIGTERM handler with LIFO cleanup -- extend with double-SIGINT and force kill
- `WorkerPool` (`worker/index.ts`): `abortAll()` method exists, `dispatch()` tracks handles with worktree paths
- `mergeWorktree()` (`worker/git-worktree.ts`): Returns false on conflict -- extend with resolution logic
- `serializedMerge()` (`worker/index.ts`): Promise-chain merge serialization -- context chaining hooks in here
- `DependencyScheduler` (`scheduler/index.ts`): `getReady()`, `markComplete()` -- needs `markFailed()` and `markSkipped()` for dependent handling

### Established Patterns
- Promise-chain serialization for concurrent operations (StateWriteQueue, merge chain)
- File-based IPC with NDJSON events and atomic writes
- `execFile` (not `exec`) for Windows path safety
- CLI-only flags not persisted to config (--parallel pattern)

### Integration Points
- `orchestrator/index.ts` lines 420-428: Current fail-fast path -- extend with --continue logic
- `orchestrator/index.ts` line 454: `requestShutdown()` -- wire to `WorkerPool.abortAll()` and worktree cleanup
- `worker/types.ts`: `WorkerResult` -- extend with merge report data
- `ShutdownManager.install()`: Needs double-SIGINT detection added

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 03-failure-handling-and-git-conflict-resolution*
*Context gathered: 2026-03-12*
