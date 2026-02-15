---
phase: 02-claude-integration
plan: 04
subsystem: claude
tags: [claude-agent-sdk, facade, event-emitter, abort-controller, vitest-mocking]

# Dependency graph
requires:
  - phase: 02-01
    provides: "CommandResult types, createTimeout utility, polyfills"
  - phase: 02-02
    provides: "parseResult function for SDK result messages"
  - phase: 02-03
    provides: "QuestionHandler for AskUserQuestion interception"
provides:
  - "ClaudeService facade class with runGsdCommand() single-method API"
  - "canUseTool callback routing AskUserQuestion to QuestionHandler"
  - "Package entry point exports for ClaudeService and QuestionHandler"
affects: [orchestrator, api-endpoints, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Facade pattern wrapping SDK async generator behind single Promise-based method", "vi.mock for SDK module isolation in tests"]

key-files:
  created:
    - autopilot/src/claude/index.ts
    - autopilot/src/claude/__tests__/claude-service.test.ts
  modified:
    - autopilot/src/index.ts

key-decisions:
  - "Cast SDK input through unknown for AskUserQuestionInput (TypeScript strict mode requires double-cast for Record<string,unknown> to specific interface)"
  - "Mock SDK query() with async generators and Query interface stubs for isolated unit tests"
  - "AbortError name-check for timeout detection (SDK throws AbortError on controller.abort())"

patterns-established:
  - "ClaudeService as sole public API for Claude interaction -- orchestrator never imports SDK directly"
  - "vi.mock with async generator factories for testing async-generator-based APIs"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 2 Plan 4: ClaudeService Facade Summary

**ClaudeService facade wiring timeout, question handler, and result parser behind runGsdCommand() with 10 mocked-SDK unit tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T04:53:13Z
- **Completed:** 2026-02-15T04:56:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ClaudeService extends EventEmitter, encapsulates all SDK interaction behind runGsdCommand()
- canUseTool callback routes AskUserQuestion to QuestionHandler and allows all other tools
- Concurrent execution guard prevents overlapping commands
- Abort support with pending question rejection
- 10 unit tests covering all ClaudeService behaviors with fully mocked SDK
- ClaudeService and QuestionHandler exported from @gsd/autopilot package entry point

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ClaudeService facade class** - `c8cf422` (feat)
2. **Task 2: Create ClaudeService unit tests with mocked SDK** - `d9f7c73` (test)

## Files Created/Modified
- `autopilot/src/claude/index.ts` - ClaudeService class with runGsdCommand, submitAnswer, abortCurrent, getPendingQuestions, isRunning
- `autopilot/src/claude/__tests__/claude-service.test.ts` - 10 tests with mocked SDK query function and async generator factories
- `autopilot/src/index.ts` - Added ClaudeService and QuestionHandler re-exports

## Decisions Made
- Used `input as unknown as AskUserQuestionInput` double-cast in canUseTool callback because TypeScript strict mode rejects direct cast from `Record<string, unknown>` to the specific interface shape
- Mocked SDK query() to return async generators with Query interface stubs (interrupt, close, etc.) for type compatibility without spawning real processes
- Used AbortError name-check (`err.name === 'AbortError'`) for timeout detection, matching the SDK's actual abort behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict mode cast in canUseTool**
- **Found during:** Task 1 (typecheck)
- **Issue:** `input as AskUserQuestionInput` rejected by TypeScript strict mode because `Record<string, unknown>` doesn't sufficiently overlap with `AskUserQuestionInput`
- **Fix:** Changed to `input as unknown as AskUserQuestionInput` (double-cast through unknown)
- **Files modified:** autopilot/src/claude/index.ts
- **Verification:** `tsc --noEmit` passes clean
- **Committed in:** c8cf422

**2. [Rule 1 - Bug] Fixed concurrent execution test timeout**
- **Found during:** Task 2 (test run)
- **Issue:** Mock async generator didn't respect abort signal, causing test to hang for 5 seconds and timeout
- **Fix:** Changed mock to listen for abort signal on the AbortController and throw AbortError when aborted
- **Files modified:** autopilot/src/claude/__tests__/claude-service.test.ts
- **Verification:** All 10 tests pass within 200ms
- **Committed in:** d9f7c73

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Minor strict-mode and test-infrastructure fixes. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Claude integration modules complete (types, timeout, result-parser, question-handler, ClaudeService)
- Phase 2 complete -- all 4 plans executed
- 202 total tests passing across full suite
- Ready for Phase 3 (orchestrator or API layer)

## Self-Check: PASSED

- All 3 key files exist on disk (2 created, 1 modified)
- Both task commits verified in git history (c8cf422, d9f7c73)
- All 5 key_links verified (SDK import, QuestionHandler, parseResult, createTimeout, package re-export)
- Both files exceed min_lines (index.ts: 192, test: 483, both > 80)
- 10/10 ClaudeService tests passing
- 202/202 full suite tests passing
- TypeScript compiles with no errors

---
*Phase: 02-claude-integration*
*Completed: 2026-02-15*
