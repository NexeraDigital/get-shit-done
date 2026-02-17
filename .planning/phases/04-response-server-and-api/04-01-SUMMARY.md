---
phase: 04-response-server-and-api
plan: 01
subsystem: api
tags: [express, rest, http-server, dependency-injection, typescript]

# Dependency graph
requires:
  - phase: 01-foundation-and-types
    provides: StateStore, AutopilotState types, AutopilotConfig types
  - phase: 02-claude-integration
    provides: ClaudeService with getPendingQuestions(), submitAnswer()
  - phase: 03-core-orchestrator
    provides: Orchestrator class with EventEmitter events
provides:
  - ResponseServer class with start()/close() lifecycle
  - REST API endpoints (health, status, phases, questions)
  - Error handling middleware
  - computeProgress() helper for status endpoint
affects: [04-02-sse-and-cli-wiring, 05-dashboard]

# Tech tracking
tech-stack:
  added: [express@5.2.1, "@types/express@5.0.6"]
  patterns: [dependency-injection-via-constructor, route-factory-with-injected-deps, createServer-for-error-handling]

key-files:
  created:
    - autopilot/src/server/index.ts
    - autopilot/src/server/routes/api.ts
    - autopilot/src/server/middleware/error.ts
    - autopilot/src/server/__tests__/api-routes.test.ts
    - autopilot/src/server/__tests__/server.test.ts
  modified:
    - autopilot/package.json
    - autopilot/package-lock.json

key-decisions:
  - "Used createServer() instead of app.listen() for reliable EADDRINUSE error handling on Windows"
  - "String() cast on req.params values for Express 5 type safety (params can be string | string[])"
  - "computeProgress() exported from routes/api.ts as pure function for testability"

patterns-established:
  - "Route factory pattern: createApiRoutes(deps) returns Router with injected services"
  - "Server lifecycle: createServer + error listener before listen() for EADDRINUSE"

# Metrics
duration: 4min
completed: 2026-02-17
---

# Phase 4 Plan 1: Response Server and REST API Summary

**Express 5 ResponseServer with DI constructor and 6 REST endpoints (health, status with progress%, phases, questions CRUD) plus error middleware**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-17T18:14:10Z
- **Completed:** 2026-02-17T18:18:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- ResponseServer class with dependency injection, start()/close() lifecycle, EADDRINUSE handling
- 6 REST endpoints: health check, status with computed progress percentage, phases list, questions list, question by ID, submit answer
- Error middleware catches unhandled errors and returns 500 JSON
- 15 tests covering all endpoints and server lifecycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Express 5 and create ResponseServer class with REST routes** - `15d85e1` (feat)
2. **Task 2: Add tests for REST endpoints and ResponseServer lifecycle** - `19b17f7` (test)

## Files Created/Modified
- `autopilot/src/server/index.ts` - ResponseServer class with DI constructor, start(), close(), address getter
- `autopilot/src/server/routes/api.ts` - createApiRoutes() factory with 6 endpoints and computeProgress() helper
- `autopilot/src/server/middleware/error.ts` - Express error-handling middleware (4-param signature)
- `autopilot/src/server/__tests__/api-routes.test.ts` - 11 tests for all REST endpoints with mock deps
- `autopilot/src/server/__tests__/server.test.ts` - 4 tests for server lifecycle (start, close, EADDRINUSE)
- `autopilot/package.json` - Added express and @types/express dependencies
- `autopilot/package-lock.json` - Lock file updated

## Decisions Made
- Used `createServer()` from `node:http` instead of Express `app.listen()` to ensure the error event listener is registered before `listen()` is called, preventing a race condition on Windows where EADDRINUSE could resolve instead of reject
- Applied `String()` cast on `req.params` values because Express 5 types define params as `string | string[]`; the cast ensures type safety with `noUncheckedIndexedAccess`
- Exported `computeProgress()` as a named function from routes/api.ts for direct unit testing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EADDRINUSE test failure due to Express app.listen() race condition**
- **Found during:** Task 2 (server lifecycle tests)
- **Issue:** `app.listen()` on Express 5 could resolve the callback before the error event for EADDRINUSE, causing the test to receive a resolved promise instead of rejection
- **Fix:** Switched from `app.listen(port, callback)` to `createServer(app)` + `server.on('error')` + `server.listen(port, callback)` for deterministic error handling
- **Files modified:** autopilot/src/server/index.ts
- **Verification:** EADDRINUSE test passes reliably
- **Committed in:** 19b17f7 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed TypeScript strict mode errors in test files**
- **Found during:** Task 2 (TypeScript compilation check)
- **Issue:** `res.json()` returns `unknown` in strict mode with `noUncheckedIndexedAccess`; test assertions on body properties failed type checking
- **Fix:** Added `as any` cast on `await res.json()` calls in test files
- **Files modified:** autopilot/src/server/__tests__/api-routes.test.ts, autopilot/src/server/__tests__/server.test.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 19b17f7 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- REST API foundation complete, ready for Plan 02 (SSE streaming and CLI wiring)
- All endpoints tested and type-safe
- ResponseServer accepts Orchestrator and Logger dependencies for SSE event wiring in Plan 02

## Self-Check: PASSED

All 6 created files verified on disk. Both task commits (15d85e1, 19b17f7) verified in git log.

---
*Phase: 04-response-server-and-api*
*Completed: 2026-02-17*
