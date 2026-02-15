---
phase: 02-claude-integration
plan: 03
subsystem: claude
tags: [promise, deferred, event-emitter, question-interception, ask-user-question, tdd]

# Dependency graph
requires:
  - phase: 02-01
    provides: "QuestionEvent and QuestionItem types, Promise.withResolvers polyfill"
provides:
  - "QuestionHandler class with handleQuestion, submitAnswer, getPending, getPendingById, rejectAll"
  - "AskUserQuestionInput and PermissionResultAllow interfaces (local SDK-shape definitions)"
affects: [02-04-claude-service, api-endpoints, orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns: ["deferred Promise via Promise.withResolvers for async blocking", "EventEmitter for lifecycle events"]

key-files:
  created:
    - autopilot/src/claude/question-handler.ts
    - autopilot/src/claude/__tests__/question-handler.test.ts
  modified: []

key-decisions:
  - "Locally-defined SDK interfaces (AskUserQuestionInput, PermissionResultAllow) to keep tests SDK-free"
  - "HandleQuestionOptions as separate parameter for phase/step metadata rather than embedding in input"
  - "Conditional spread for optional phase/step fields to keep QuestionEvent clean"

patterns-established:
  - "Deferred Promise pattern: Promise.withResolvers creates promise/resolve/reject triple, stored in Map keyed by ID"
  - "EventEmitter lifecycle: emit on state change (pending/answered), consumer-agnostic notification"

# Metrics
duration: 2min
completed: 2026-02-15
---

# Phase 2 Plan 3: Question Handler Summary

**QuestionHandler with deferred Promise pattern for AskUserQuestion interception, blocking SDK execution until human answers arrive via submitAnswer**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-15T04:47:54Z
- **Completed:** 2026-02-15T04:49:48Z
- **Tasks:** 2 (TDD RED + GREEN; no refactor needed)
- **Files modified:** 2

## Accomplishments
- QuestionHandler class extends EventEmitter with full deferred-promise lifecycle
- handleQuestion blocks SDK execution via Promise.withResolvers until submitAnswer resolves
- 17 tests covering all behaviors: creation, resolution, rejection, events, concurrent questions
- TypeScript strict mode clean (noUncheckedIndexedAccess, verbatimModuleSyntax)

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing tests** - `5bb2a4c` (test)
2. **TDD GREEN: Implementation** - `7045e38` (feat)

_No refactor commit needed - implementation was clean on first pass._

## Files Created/Modified
- `autopilot/src/claude/question-handler.ts` - QuestionHandler class with handleQuestion, submitAnswer, getPending, getPendingById, rejectAll
- `autopilot/src/claude/__tests__/question-handler.test.ts` - 17 tests covering deferred promise lifecycle, events, concurrent questions, rejectAll

## Decisions Made
- Locally-defined AskUserQuestionInput and PermissionResultAllow interfaces rather than importing from SDK -- keeps tests SDK-free and avoids coupling to SDK type changes
- HandleQuestionOptions as a separate second parameter to handleQuestion rather than embedding phase/step in the input object -- cleaner separation of SDK input from GSD metadata
- Conditional spread (`...(options?.phase !== undefined && { phase: options.phase })`) for optional QuestionEvent fields -- avoids undefined properties in the event object

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict mode array access in tests**
- **Found during:** TDD GREEN (typecheck validation)
- **Issue:** `listener.mock.calls[0][0]` flagged by noUncheckedIndexedAccess as possibly undefined
- **Fix:** Added non-null assertion `[0]!` and type cast `as QuestionEvent` on mock call access
- **Files modified:** autopilot/src/claude/__tests__/question-handler.test.ts
- **Verification:** `tsc --noEmit` passes clean
- **Committed in:** 7045e38 (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor TypeScript strictness fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- QuestionHandler ready for integration into ClaudeService (02-04)
- canUseTool callback will delegate AskUserQuestion calls to handler.handleQuestion()
- submitAnswer exposed for web API endpoints to resolve questions
- rejectAll available for cleanup on command abort/timeout

## Self-Check: PASSED

- All 2 created files exist on disk
- All 2 task commits exist in git history (5bb2a4c, 7045e38)
- All 3 key_links verified (polyfills import, QuestionEvent import, extends EventEmitter)
- 17/17 tests passing, typecheck clean

---
*Phase: 02-claude-integration*
*Completed: 2026-02-15*
