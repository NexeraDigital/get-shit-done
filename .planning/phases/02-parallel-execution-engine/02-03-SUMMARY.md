---
phase: 02-parallel-execution-engine
plan: 03
subsystem: orchestrator
tags: [worker-pool, dependency-scheduler, parallel-execution, worktree, concurrency]

# Dependency graph
requires:
  - phase: 01-scheduler-and-isolation-model
    provides: DependencyScheduler, StateWriteQueue, EventWriter infrastructure
  - phase: 02-parallel-execution-engine
    plan: 01
    provides: WorkerHandle/WorkerResult/WorkerPoolOptions types, git-worktree lifecycle functions
  - phase: 02-parallel-execution-engine
    plan: 02
    provides: --parallel and --concurrency CLI flags parsed and ready
provides:
  - WorkerPool class managing ClaudeService instances with worktree lifecycle
  - Unified scheduler-driven orchestrator loop (replaces sequential for-of)
  - CLI wiring: --parallel/--concurrency passed to Orchestrator.run()
affects: [03-failure-handling, 04-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [unified-loop-one-codepath, promise-chain-merge-serialization, dispatch-callback-pattern]

key-files:
  created:
    - autopilot/src/worker/index.ts
    - autopilot/src/worker/__tests__/worker-pool.test.ts
    - autopilot/src/orchestrator/__tests__/unified-loop.test.ts
  modified:
    - autopilot/src/orchestrator/index.ts
    - autopilot/src/orchestrator/__tests__/orchestrator.test.ts
    - autopilot/src/cli/index.ts

key-decisions:
  - "WorkerPool uses dispatch callback pattern: runPhaseFn(cwd, claudeService) decouples from PhaseState internals"
  - "Merge serialization via promise-chain (same pattern as StateWriteQueue) prevents git index.lock conflicts"
  - "Phase failures in unified loop trigger requestShutdown() instead of throwing -- graceful fail-fast"
  - "Orchestrator test updated: retry-escalate no longer throws, returns via shutdown path"

patterns-established:
  - "Unified loop: one code path for both sequential and parallel, differentiated only by concurrency and worktree usage"
  - "Dispatch callback: WorkerPool.dispatch(phase, async (cwd, cs) => {...}) pattern for phase execution"
  - "Event forwarding: worker:message events re-emitted with phaseNumber metadata for multi-worker tracking"

requirements-completed: [EXEC-01, EXEC-02, SCHED-01, SCHED-03, SCHED-04]

# Metrics
duration: 15min
completed: 2026-03-12
---

# Phase 02 Plan 03: WorkerPool and Unified Orchestrator Loop Summary

**WorkerPool class with worktree lifecycle management and unified DependencyScheduler-driven orchestrator loop replacing sequential for-of loop, enabling both sequential (concurrency=1) and parallel (concurrency=N) execution modes**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-12T06:34:13Z
- **Completed:** 2026-03-12T06:49:39Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 3

## Accomplishments
- WorkerPool class: creates/manages ClaudeService instances with worktree isolation, serialized merges, event forwarding
- Unified orchestrator loop: DependencyScheduler drives phase dispatch for both sequential and parallel modes
- CLI wiring: --parallel and --concurrency flags now passed through to Orchestrator.run()
- Full backward compatibility: 882 tests pass (18 new tests added), tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): WorkerPool failing tests** - `25e76bc` (test)
2. **Task 1 (GREEN): WorkerPool implementation** - `0b6af09` (feat)
3. **Task 2: Unified loop + CLI wiring** - `81b5f6b` (feat)

_Task 1 used TDD with separate RED and GREEN commits._

## Files Created/Modified
- `autopilot/src/worker/index.ts` - WorkerPool class with dispatch, waitForAny, abortAll, serialized merge
- `autopilot/src/worker/__tests__/worker-pool.test.ts` - 13 tests: dispatch, activeCount, waitForAny, merge serialization, abortAll, events
- `autopilot/src/orchestrator/index.ts` - Replaced for-of loop with DependencyScheduler+WorkerPool unified loop
- `autopilot/src/orchestrator/__tests__/unified-loop.test.ts` - 5 tests: options, dependency order, skip completed, concurrency, build complete
- `autopilot/src/orchestrator/__tests__/orchestrator.test.ts` - Updated retry-escalate test for new shutdown behavior
- `autopilot/src/cli/index.ts` - Wired parallel/concurrency options to orchestrator.run()

## Decisions Made
- WorkerPool uses a dispatch callback pattern `(cwd, claudeService) => Promise<void>` so it doesn't need to know about PhaseState internals
- Merge serialization uses promise-chain pattern (same as StateWriteQueue from Phase 1) instead of mutex library
- Phase failures now trigger graceful shutdown via requestShutdown() rather than throwing errors through the call stack
- Could not mock WorkerPool/DependencyScheduler in unified-loop tests due to circular module resolution causing OOM -- used integration-style tests with real modules instead

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing orchestrator test for new error behavior**
- **Found during:** Task 2 (Unified loop implementation)
- **Issue:** Existing `retries once on failure, then escalates` test expected `run()` to reject with thrown error, but unified loop catches errors via WorkerPool and calls requestShutdown() instead
- **Fix:** Updated test to expect `run()` to resolve (not reject) while still verifying escalation events and error state recording
- **Files modified:** autopilot/src/orchestrator/__tests__/orchestrator.test.ts
- **Committed in:** `81b5f6b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary behavioral update for existing test to match new unified loop semantics. No scope creep.

## Issues Encountered
- Mocking WorkerPool/DependencyScheduler modules in vitest caused OOM (circular module resolution with Claude SDK). Solved by using integration-style tests with real module imports and mocking only I/O dependencies (fs, ClaudeService).
- vi.mock factory hoisting requires vi.hoisted() for variables used in mock factories -- standard vitest pattern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Parallel execution engine complete: WorkerPool + unified loop + CLI flags all wired
- Phase 3 (Failure Handling) can build on this: --continue mode, merge conflict resolution, worktree recovery
- No blockers

## Self-Check: PASSED

All files verified present. All commits verified in history.

---
*Phase: 02-parallel-execution-engine*
*Completed: 2026-03-12*
