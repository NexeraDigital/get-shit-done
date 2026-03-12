---
phase: 02-parallel-execution-engine
verified: 2026-03-12T07:25:00Z
status: passed
score: 5/5 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/5
  gaps_closed:
    - "Running autopilot with --parallel launches multiple ClaudeService instances that execute independent phases concurrently"
    - "Each parallel phase executes in its own git worktree and the worktree is cleaned up after successful merge back to the central branch"
    - "Each parallel phase runs the full lifecycle (discuss, plan, execute, verify) independently without interfering with other active phases"
  gaps_remaining: []
  regressions: []
---

# Phase 2: Parallel Execution Engine Verification Report

**Phase Goal:** Users can run `--parallel` and have multiple phases execute concurrently via git-worktree-isolated workers, with the full discuss/plan/execute/verify lifecycle per phase
**Verified:** 2026-03-12T07:25:00Z
**Status:** passed
**Re-verification:** Yes -- after gap closure (Plan 02-04)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running autopilot with --parallel launches multiple ClaudeService instances that execute independent phases concurrently | VERIFIED | WorkerPool creates per-worker ClaudeService (worker/index.ts:57). Dispatch callback on orchestrator/index.ts:409 passes `cwd` and `claudeService` to `this.runPhase(phaseState, claudeService, cwd)`. No underscore-prefixed unused params. 4 dedicated parallel wiring tests in unified-loop.test.ts. |
| 2 | Running autopilot without --parallel behaves identically to the existing sequential mode (backward compatible) | VERIFIED | Unified loop with concurrency=1, no worktrees. WorkerPool provides projectDir as cwd in sequential mode. 886 tests pass including all pre-existing orchestrator tests. |
| 3 | Each parallel phase executes in its own git worktree and the worktree is cleaned up after successful merge back | VERIFIED | WorkerPool creates worktrees (git-worktree.ts), dispatch callback passes `cwd` to `runPhase` (line 410), `runPhase` threads cwd to `runStep`, `getGitHead`, and all lifecycle methods. mergeWorktree/cleanupWorktree tested (12 tests in git-worktree.test.ts). |
| 4 | User can specify --concurrency N to limit workers and --phases with --parallel to select specific phases | VERIFIED | CLI parses --concurrency with default 3, --parallel as boolean (cli/index.ts:73-74). Wired to orchestrator.run() on line 759. WorkerPool respects concurrency limit. 7 CLI flag tests pass. |
| 5 | Each parallel phase runs the full lifecycle (discuss, plan, execute, verify) independently | VERIFIED | `runPhase` accepts optional `overrideClaudeService` and `overrideCwd` (line 595-598), resolves with `??` fallback (lines 601-602), and passes `cs`/`cwd` to all 4 lifecycle methods: `runDiscuss` (line 630), `runPlan` (line 635), `runExecute` (line 640), `runVerifyWithGapLoop` (line 645). Each lifecycle method accepts optional `claudeService`/`cwd` params. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `autopilot/src/worker/types.ts` | WorkerHandle, WorkerResult, WorkerPoolOptions interfaces | VERIFIED | 22 lines, all interfaces exported |
| `autopilot/src/worker/git-worktree.ts` | Git worktree lifecycle functions | VERIFIED | 99 lines, exports createWorktree, mergeWorktree, cleanupWorktree, ensureCleanWorktree, execGit |
| `autopilot/src/worker/__tests__/git-worktree.test.ts` | Tests for git worktree operations | VERIFIED | 223 lines, 12 tests |
| `autopilot/src/worker/index.ts` | WorkerPool class | VERIFIED | 188 lines, exports WorkerPool with dispatch/waitForAny/abortAll/serializedMerge |
| `autopilot/src/worker/__tests__/worker-pool.test.ts` | WorkerPool unit tests | VERIFIED | 277 lines, 13 tests |
| `autopilot/src/orchestrator/index.ts` | Unified scheduler-driven loop with parallel wiring | VERIFIED | DependencyScheduler import/usage, unified loop at lines 399-433, dispatch callback properly threads cwd and claudeService |
| `autopilot/src/orchestrator/__tests__/unified-loop.test.ts` | Unified loop + parallel wiring tests | VERIFIED | 426 lines, includes 4 parallel wiring tests added in 02-04 |
| `autopilot/src/cli/index.ts` | CLI with --parallel, --concurrency flags | VERIFIED | Flags on lines 73-74, wired to orchestrator.run() |
| `autopilot/src/cli/__tests__/parallel-flags.test.ts` | CLI flag tests | VERIFIED | 62 lines, 7 tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| worker/index.ts | worker/git-worktree.ts | import git-worktree functions | WIRED | Imports ensureCleanWorktree, createWorktree, mergeWorktree, cleanupWorktree |
| worker/index.ts | claude/index.ts | new ClaudeService per worker | WIRED | Line 57: `new ClaudeService({ defaultCwd })` |
| orchestrator/index.ts | scheduler/index.ts | DependencyScheduler drives loop | WIRED | Import + getReady/markInProgress/markComplete/isComplete |
| orchestrator/index.ts | worker/index.ts | WorkerPool dispatches phases | WIRED | Import, construction, dispatch callback passes cwd + claudeService to runPhase |
| orchestrator dispatch callback | runPhase | cwd + claudeService params | WIRED | Line 409-411: `async (cwd, claudeService) => { await this.runPhase(phaseState, claudeService, cwd); }` |
| runPhase | lifecycle methods | cs + cwd threading | WIRED | Lines 630-645: all 4 lifecycle methods receive `cs` and `cwd` |
| cli/index.ts | orchestrator/index.ts | parallel/concurrency passed to run() | WIRED | Lines 759-762 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCHED-01 | 02-02, 02-03 | User can enable parallel mode with --parallel flag | SATISFIED | --parallel flag parsed in CLI, passed to orchestrator, WorkerPool uses it |
| SCHED-03 | 02-02, 02-03 | User can manually specify which phases run in parallel | SATISFIED | --phases range combined with --parallel selects phases for parallel execution |
| SCHED-04 | 02-02, 02-03 | User can limit max concurrent workers with --concurrency N | SATISFIED | --concurrency parsed with default 3, passed to WorkerPool |
| EXEC-01 | 02-03, 02-04 | Multiple ClaudeService instances run simultaneously | SATISFIED | WorkerPool creates per-worker ClaudeService, dispatch callback threads it to runPhase, runPhase uses it for all lifecycle methods |
| EXEC-02 | 02-03, 02-04 | Each parallel phase runs full lifecycle independently | SATISFIED | Each lifecycle method receives worker-specific claudeService and cwd via optional override pattern |
| GIT-01 | 02-01, 02-04 | Each parallel phase executes in its own git worktree | SATISFIED | Worktrees created by WorkerPool, cwd threaded to runPhase and all downstream methods |
| GIT-02 | 02-01 | On completion, worktree changes merged back to central branch | SATISFIED | mergeWorktree correctly merges gsd/phase-N branch, tested with conflict handling |
| GIT-06 | 02-01 | Worktree cleaned up after successful merge | SATISFIED | cleanupWorktree removes worktree and branch, tested |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| .planning/REQUIREMENTS.md | 13, 19, 31, 57, 102 | Git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) | Warning | Pre-existing issue, not caused by Phase 2. File has 5 unresolved conflict blocks. Does not affect runtime. |

No TODO, FIXME, PLACEHOLDER, or unused-parameter anti-patterns found in Phase 2 artifacts.

### Human Verification Required

### 1. Parallel Mode End-to-End

**Test:** Run `gsd-autopilot --parallel --concurrency 2 --phases 1-2` on a project with two independent phases
**Expected:** Two separate git worktrees created, two ClaudeService instances running in those worktrees, each completing discuss/plan/execute/verify independently, worktrees merged back and cleaned up
**Why human:** Requires a real project with multiple phases and actual ClaudeService execution to confirm the full pipeline works end-to-end

### 2. Sequential Mode Regression

**Test:** Run `gsd-autopilot` without --parallel on an existing project
**Expected:** Behavior identical to pre-Phase-2 sequential execution
**Why human:** Unit tests verify the code path but end-to-end behavior with real ClaudeService requires manual testing

### Gaps Summary

All three gaps from the previous verification have been closed by Plan 02-04:

1. **Dispatch callback now passes worker-specific cwd and claudeService** -- Line 409-411 no longer uses underscore-prefixed unused params. Both are passed to `this.runPhase()`.

2. **runPhase and all downstream methods accept and use overrides** -- 8 methods updated with optional `claudeService`/`cwd` parameters using the `??` fallback pattern. The chain is: `dispatch -> runPhase -> runStep/runDiscuss/runPlan/runExecute/runVerifyWithGapLoop -> getGitHead/executeWithRetry`.

3. **886 tests pass** including 4 new parallel wiring tests that specifically assert the worker-provided ClaudeService receives `runGsdCommand` calls (not the shared instance).

No regressions detected. All previously-passing artifacts remain verified.

---

_Verified: 2026-03-12T07:25:00Z_
_Verifier: Claude (gsd-verifier)_
