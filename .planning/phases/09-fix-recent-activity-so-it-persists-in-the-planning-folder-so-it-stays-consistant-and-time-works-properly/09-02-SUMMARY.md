---
phase: 09-fix-recent-activity-persistence
plan: 02
subsystem: activity-wiring
tags: [event-handling, server-timestamps, activity-creation, dependency-injection]
dependency_graph:
  requires: [activity-persistence, orchestrator, cli, server-infrastructure]
  provides: [server-side-activity-creation, activity-event-handlers]
  affects: [dashboard-activity-feed, orchestrator-lifecycle, question-handling]
tech_stack:
  added: []
  patterns: [event-driven-architecture, optional-dependencies, server-timestamps]
key_files:
  created: []
  modified:
    - autopilot/src/orchestrator/index.ts
    - autopilot/src/cli/index.ts
    - autopilot/src/server/index.ts
    - autopilot/src/server/standalone.ts
decisions:
  - "ActivityStore injected as optional dependency to Orchestrator (no breaking changes)"
  - "Phase activities use em-dash separator format: 'Phase N: Name — action'"
  - "Question-pending activities display truncated question text (not raw UUIDs)"
  - "Question-answered activities marked without exposing answer text (per locked decision)"
  - "Error messages truncated to 100 chars for readability in activity feed"
  - "All activities use server timestamps (new Date().toISOString()) not client timestamps"
  - "Activity creation at event source (server-side) not client-side"
metrics:
  duration: 3min
  completed: 2026-02-24
---

# Phase 09 Plan 02: Wire ActivityStore into Orchestrator and CLI Summary

**One-liner:** Server-side activity creation wired into orchestrator lifecycle events (phase/step/build), question handlers, and error handlers with proper content formatting and server timestamps.

## What Was Built

Moved activity creation from client-side (useSSE.ts with client timestamps and raw UUIDs) to server-side (orchestrator and CLI event handlers with server timestamps and human-readable content):

### Task 1: Orchestrator Activity Wiring

**Orchestrator Changes** (`autopilot/src/orchestrator/index.ts`):
1. Added `ActivityStore` as optional dependency in `OrchestratorOptions` interface
2. Added private field `activityStore?: ActivityStore` to Orchestrator class
3. **Phase lifecycle activities:**
   - `phase:started` → `"Phase N: Name — started"` (em-dash separator per locked decision)
   - `phase:completed` → `"Phase N: Name — completed"`
4. **Step lifecycle activities:**
   - `step:started` → `"Phase N: step started"`
   - `step:completed` → `"Phase N: step completed"`
5. **Build completion activity:**
   - `build:complete` → `"Build complete — all phases finished"`

All 5 activity creation points use:
- Server timestamps: `new Date().toISOString()`
- Conditional creation: `if (this.activityStore)`
- Metadata: phase number, step name

### Task 2: CLI and Server Activity Wiring

**CLI Changes** (`autopilot/src/cli/index.ts`):
1. Imported `ActivityStore` and `truncateText` utility
2. Created and restored ActivityStore after StateStore setup
3. Passed `activityStore` to Orchestrator constructor
4. **Question event handlers:**
   - `question:pending` → `"Question: {truncated text}"` (not raw UUID)
   - `question:answered` → `"Question answered"` (no answer text per locked decision)
5. **Error event handler:**
   - `error:escalation` → truncated error message (100 chars)
6. Passed `activityStore` as `activityProvider` to embedded ResponseServer

**Server Changes** (`autopilot/src/server/index.ts`):
1. Added `activityProvider` to `ResponseServerOptions` interface
2. Added `activityProvider` to `ResponseServerOptionsLegacy` interface
3. Extracted `activityProvider` from both new and legacy option paths
4. Passed `activityProvider` to `createApiRoutes`

**Standalone Server Changes** (`autopilot/src/server/standalone.ts`):
1. Imported `ActivityStore`
2. Created and restored ActivityStore after IPC components
3. Passed `activityStore` as `activityProvider` to ResponseServer

## Key Implementation Details

**Server-Side Creation:**
- Activities created at event source (orchestrator emits, CLI handlers respond)
- No client-side timestamp generation (fixes timestamp drift issue)
- Server timestamps guaranteed monotonic and consistent

**Content Formatting:**
- Phase activities: `"Phase 9: Fix Recent Activity — started"` (em-dash separator)
- Step activities: `"Phase 9: execute completed"` (blue-category step names)
- Question activities: `"Question: Should we use TypeScript..."` (truncated at 60 chars)
- Answered questions: `"Question answered"` (no answer text exposed)
- Errors: Truncated to 100 chars for readability

**Dependency Injection:**
- ActivityStore optional in OrchestratorOptions (no breaking changes)
- ActivityProvider optional in ResponseServerOptions (gradual rollout)
- Both embedded and standalone server paths support activities

**Verification:**
- TypeScript compilation passes with no errors
- 5 `activityStore.addActivity` calls in Orchestrator (phase-started, phase-completed, step-started, step-completed, build-complete)
- 3 `activityStore.addActivity` calls in CLI (question-pending, question-answered, error)
- 2 uses of `truncateText()` in CLI (question text, error messages)
- All activities use `new Date().toISOString()` for timestamps (9 instances)
- Phase activities use em-dash separator `—` (2 instances)

## Files Created/Modified

**Modified:**
- `autopilot/src/orchestrator/index.ts` (+53 lines) - Added ActivityStore dependency, 5 activity creation points
- `autopilot/src/cli/index.ts` (+51 lines) - ActivityStore creation, 3 event handlers, server wiring
- `autopilot/src/server/index.ts` (+12 lines) - ActivityProvider interfaces, constructor param extraction
- `autopilot/src/server/standalone.ts` (+7 lines) - ActivityStore creation and injection

## Deviations from Plan

None - plan executed exactly as written.

## Success Criteria Met

- ✓ Activity creation happens server-side at event source with server timestamps
- ✓ Question activities display truncated question text, not raw UUIDs
- ✓ Phase activities use "Phase N: Name — action" format per locked decision
- ✓ Answered question activities marked without exposing answer text
- ✓ Both embedded and standalone server paths serve activities via REST
- ✓ Orchestrator has 5 addActivity calls (lifecycle events)
- ✓ CLI has 3 addActivity calls (questions, errors)
- ✓ All activities persisted to `.planning/autopilot-activity.json`

## Integration Points

**Orchestrator → ActivityStore:**
- Phase/step lifecycle events create activities in real-time
- Activities persist atomically via write-file-atomic

**CLI → ActivityStore:**
- Question pending/answered events create activities
- Error escalation events create activities
- ActivityStore passed to both Orchestrator and ResponseServer

**ResponseServer → ActivityStore:**
- ActivityProvider interface allows flexible injection
- GET /api/activities endpoint serves persisted activities
- Works in both embedded (CLI) and standalone (dashboard) modes

## Next Steps

This plan completes server-side activity creation. Phase 09 Plan 03 will:
1. Update dashboard to fetch activities from REST endpoint (not client-side generation)
2. Add SSE event emission for real-time activity updates
3. Remove client-side activity creation logic from useSSE.ts

## Self-Check: PASSED

**Files Modified:**
- ✓ FOUND: autopilot/src/orchestrator/index.ts (modified)
- ✓ FOUND: autopilot/src/cli/index.ts (modified)
- ✓ FOUND: autopilot/src/server/index.ts (modified)
- ✓ FOUND: autopilot/src/server/standalone.ts (modified)

**Commits:**
- ✓ FOUND: 2054d20 (Task 1 - Orchestrator activity wiring)
- ✓ FOUND: 57f6961 (Task 2 - CLI and server activity wiring)

**Verification Checks:**
- ✓ TypeScript compilation passes (npx tsc --noEmit)
- ✓ 5 activityStore.addActivity calls in Orchestrator
- ✓ 3 activityStore.addActivity calls in CLI
- ✓ Question-pending uses truncateText() on question text
- ✓ Question-answered does NOT include answer text
- ✓ Phase activities use em-dash (—) separator
- ✓ All activities use server timestamps (9 instances)
