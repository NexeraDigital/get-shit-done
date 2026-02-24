---
phase: 09-fix-recent-activity-persistence
plan: 01
subsystem: activity-persistence
tags: [persistence, rest-api, atomic-writes, dashboard-backend]
dependency_graph:
  requires: [state-management, server-infrastructure]
  provides: [activity-storage, activity-rest-endpoint]
  affects: [dashboard-activity-feed]
tech_stack:
  added: [write-file-atomic]
  patterns: [atomic-file-writes, non-critical-error-handling, dependency-injection]
key_files:
  created:
    - autopilot/src/activity/types.ts
    - autopilot/src/activity/index.ts
  modified:
    - autopilot/src/server/routes/api.ts
decisions:
  - "ActivityEntry uses export type (consistent with verbatimModuleSyntax decision 01-01)"
  - "ActivityStore follows StateStore pattern with atomic writes and non-critical error handling"
  - "Persist errors logged but don't throw (activity persistence is non-critical per research recommendation)"
  - "ActivityProvider interface uses optional injection to avoid breaking existing callers"
  - "Activities stored newest-first (unshift) for efficient recent retrieval"
metrics:
  duration: 2min
  completed: 2026-02-24
---

# Phase 09 Plan 01: Create ActivityStore Persistence and REST Endpoint Summary

**One-liner:** ActivityStore class with atomic JSON persistence to .planning/autopilot-activity.json and GET /api/activities REST endpoint for dashboard consumption.

## What Was Built

Created the server-side foundation for activity feed persistence:

1. **ActivityEntry Type** (`autopilot/src/activity/types.ts`):
   - Defines all 9 activity types: phase-started, phase-completed, phase-failed, step-started, step-completed, question-pending, question-answered, error, build-complete
   - Includes message, ISO 8601 timestamp, and optional metadata (phase, step, questionId)
   - Uses `export type` consistent with verbatimModuleSyntax decision

2. **ActivityStore Class** (`autopilot/src/activity/index.ts`):
   - Follows StateStore pattern for consistency with existing codebase
   - `restore()`: Reads from `.planning/autopilot-activity.json`, gracefully handles ENOENT and parse errors
   - `addActivity()`: Prepends new entries (newest-first) and persists atomically
   - `getRecent(limit)`: Returns first N entries for SSE initial burst
   - `getAll()`: Returns full array for REST endpoint
   - `persist()`: Uses write-file-atomic for crash-safe writes
   - Non-critical error handling: persist failures logged but don't throw
   - **Bonus:** `truncateText()` utility for word-boundary truncation at 60 chars

3. **REST Endpoint** (`autopilot/src/server/routes/api.ts`):
   - `ActivityProvider` interface with `getAll()` method for dependency injection
   - Added as optional field to `ApiRouteDeps` (no breaking changes to existing callers)
   - `GET /api/activities` returns `{ activities: ActivityEntry[] }`
   - Gracefully returns empty array when activityProvider not injected

## Key Implementation Details

**Atomic Persistence:**
- Uses `write-file-atomic` (already a project dependency) for crash-safe writes
- Same pattern as StateStore for consistency

**Error Handling:**
- `restore()`: ENOENT → empty array (file doesn't exist yet)
- `restore()`: Parse error → logs warning, starts with empty array
- `addActivity()`: Persist failure → logs error but doesn't throw
- Philosophy: Activity persistence is non-critical; failures shouldn't crash the autopilot

**Dependency Injection:**
- ActivityProvider interface allows flexible wiring
- Optional in ApiRouteDeps so existing tests/code don't break
- Dashboard can consume via REST, autopilot can inject ActivityStore instance

## Files Created/Modified

**Created:**
- `autopilot/src/activity/types.ts` (21 lines) - ActivityEntry type definition
- `autopilot/src/activity/index.ts` (104 lines) - ActivityStore class and truncateText utility

**Modified:**
- `autopilot/src/server/routes/api.ts` (+17 lines) - Added ActivityProvider interface and GET /api/activities endpoint

## Verification Results

All verification checks passed:
- ✓ TypeScript compilation successful (`npx tsc --noEmit`)
- ✓ All 9 activity types present in ActivityEntry
- ✓ ActivityStore and truncateText exported from activity/index.ts
- ✓ GET /api/activities route and ActivityProvider interface added
- ✓ Uses write-file-atomic for persistence
- ✓ addActivity wraps persist in try-catch (non-critical error handling)

## Deviations from Plan

None - plan executed exactly as written.

## Success Criteria Met

- ✓ ActivityStore class persists to .planning/autopilot-activity.json with atomic writes
- ✓ REST endpoint serves all activities for dashboard consumption
- ✓ No new dependencies needed (write-file-atomic already in project)
- ✓ Type compiles cleanly with strict TypeScript

## Next Steps

This plan establishes the persistence layer. Next plans will:
1. Wire ActivityStore into the autopilot lifecycle (instantiate, restore, inject into ResponseServer)
2. Update dashboard to fetch from REST endpoint instead of generating client-side activities
3. Add SSE event emission for real-time activity updates

## Self-Check: PASSED

**Files Created:**
- ✓ FOUND: autopilot/src/activity/types.ts
- ✓ FOUND: autopilot/src/activity/index.ts

**Files Modified:**
- ✓ FOUND: autopilot/src/server/routes/api.ts (modified)

**Commits:**
- ✓ FOUND: 8746326 (Task 1 - ActivityStore and ActivityEntry type)
- ✓ FOUND: 0205cae (Task 2 - Activities REST endpoint)
