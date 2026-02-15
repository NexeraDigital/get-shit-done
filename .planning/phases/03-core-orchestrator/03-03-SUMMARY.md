---
phase: 03-core-orchestrator
plan: 03
subsystem: orchestrator
tags: [orchestrator, event-emitter, phase-lifecycle, retry, gap-detection, shutdown, resume, state-persistence]

# Dependency graph
requires:
  - phase: 01-foundation-and-types
    provides: StateStore, AutopilotLogger, AutopilotConfig, PhaseState, AutopilotState types
  - phase: 02-claude-integration
    provides: ClaudeService with runGsdCommand(), abortCurrent(), CommandResult type
  - phase: 03-core-orchestrator plan 01
    provides: ShutdownManager, writeYoloConfig
  - phase: 03-core-orchestrator plan 02
    provides: writeSkipDiscussContext, checkForGaps, parsePhaseRange
provides:
  - Orchestrator class extending EventEmitter with DI-based constructor
  - run() method sequencing phases through discuss > plan > execute > verify
  - Resume support skipping completed phases and individual completed steps
  - Retry-once-then-escalate pattern for failed ClaudeService calls
  - Gap detection loop bounded to 3 iterations after verify
  - Graceful shutdown with state persistence before stopping
  - extractPhasesFromContent pure function for ROADMAP.md parsing
affects: [03-core-orchestrator plan 04 (CLI entry point), 04-response-server, 05-dashboard, 06-notification-system]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency injection via options object for all Orchestrator dependencies"
    - "EventEmitter events for progress tracking (phase:started, phase:completed, step:started, step:completed)"
    - "State persistence before every awaited ClaudeService call (Pitfall 1 prevention)"
    - "Per-step resume checking instead of phase-level status (Pitfall 2 prevention)"
    - "ShutdownError class for distinguishing shutdown aborts from real errors"

key-files:
  created:
    - autopilot/src/orchestrator/index.ts
    - autopilot/src/orchestrator/__tests__/orchestrator.test.ts
  modified:
    - autopilot/src/index.ts

key-decisions:
  - "extractPhasesFromContent as pure function accepting content string (not file path) for testability"
  - "ShutdownError custom error class to distinguish shutdown aborts from real errors in executeWithRetry"
  - "Phase 3 escalation defaults to abort (throw) since web UI for retry/skip/abort is Phase 4"
  - "Gap detection resets verify step to idle after each iteration to allow re-verify"
  - "persistPhaseUpdate maps over state.phases to find and update the matching phase by number"

patterns-established:
  - "DI options object pattern: OrchestratorOptions bundles all injected dependencies"
  - "Custom error classes for control flow: ShutdownError distinguishes abort-type from failure-type"
  - "Module-level mocking with vi.mock for imported utility functions in integration tests"
  - "Call order tracking pattern: recording setState/runGsdCommand calls to verify persistence ordering"

# Metrics
duration: 4min
completed: 2026-02-15
---

# Phase 3 Plan 3: Core Orchestrator Summary

**Orchestrator class with phase lifecycle loop (discuss > plan > execute > verify), retry-once-then-escalate, bounded gap detection, resume support, and graceful shutdown with 17 unit tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-15T17:27:21Z
- **Completed:** 2026-02-15T17:31:01Z
- **Tasks:** 2
- **Files created/modified:** 3

## Accomplishments
- Orchestrator class integrates StateStore, ClaudeService, AutopilotLogger, and utility modules into a single autonomous workflow engine
- Full phase lifecycle sequencing with resume support that checks individual step states (not just phase status)
- State persisted before every ClaudeService call, preventing stale state on crash (Pitfall 1)
- 17 unit tests with fully mocked dependencies covering all behavioral requirements
- All 334 tests passing across 26 test files with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Orchestrator class with phase lifecycle loop** - `5bdfd7d` (feat)
2. **Task 2: Create Orchestrator unit tests with mocked dependencies** - `5b7041d` (test)

## Files Created/Modified
- `autopilot/src/orchestrator/index.ts` - Orchestrator class: EventEmitter extension, run() with phase loop, runPhase/runStep/runDiscuss/runPlan/runExecute, executeWithRetry, runVerifyWithGapLoop, requestShutdown, extractPhasesFromContent
- `autopilot/src/orchestrator/__tests__/orchestrator.test.ts` - 17 tests: step sequencing, resume, state persistence ordering, retry/escalate, retry-success, skip-discuss, skip-verify, gap detection, gap cap, shutdown, events, YOLO config, phase range, shutdown-abort, extractPhasesFromContent
- `autopilot/src/index.ts` - Added re-exports for Orchestrator, ShutdownManager, writeYoloConfig, discuss-handler functions, gap-detector functions

## Decisions Made
- **Pure extractPhasesFromContent:** Made the ROADMAP.md parser a pure function accepting a content string (not file path) so it can be tested without filesystem mocks. The I/O wrapper extractPhases reads the file and delegates to it.
- **ShutdownError custom class:** Created a dedicated error type to distinguish shutdown-initiated aborts from real command failures in executeWithRetry, preventing unnecessary retry/escalation when shutdown is requested.
- **Abort as default escalation:** Since Phase 3 has no web UI for interactive retry/skip/abort decisions, escalation emits the event and throws an error. Phase 4 will add the response mechanism.
- **Gap loop verify reset:** After each gap iteration, the verify step is reset to 'idle' so the next loop iteration can run it through the full runStep lifecycle again (with state persistence and events).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Orchestrator ready for CLI entry point integration (Plan 04) via `new Orchestrator({ stateStore, claudeService, logger, config, projectDir })`
- All orchestrator utilities (ShutdownManager, writeYoloConfig, discuss-handler, gap-detector) are wired in and tested
- EventEmitter events ready for Phase 4 (Response Server) and Phase 5 (Dashboard) to listen to
- The abort-as-default escalation behavior is explicitly designed to be replaced by web UI interaction in Phase 4

## Self-Check: PASSED

- All 3 files verified present on disk
- All 2 commit hashes verified in git log (5bdfd7d, 5b7041d)
- 17/17 orchestrator tests passing
- 334/334 total tests passing
- TypeScript typecheck and build clean
