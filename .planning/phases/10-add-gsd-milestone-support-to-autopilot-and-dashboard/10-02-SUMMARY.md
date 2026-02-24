---
phase: 10-add-gsd-milestone-support-to-autopilot-and-dashboard
plan: 02
subsystem: api-server
tags: [rest-api, provider-pattern, dependency-injection]
dependency_graph:
  requires: [milestone-types, milestone-parser]
  provides: [milestone-api-endpoint]
  affects: [dashboard-integration]
tech_stack:
  added: []
  patterns: [provider-injection, optional-dependency]
key_files:
  created: []
  modified:
    - autopilot/src/server/routes/api.ts
    - autopilot/src/server/index.ts
    - autopilot/src/server/standalone.ts
decisions:
  - MilestoneProvider follows established provider injection pattern (StateProvider, ActivityProvider)
  - No provider returns graceful empty response { current: null, shipped: [] }
  - Parser re-reads files on each request (acceptable for infrequent milestone updates)
metrics:
  duration: 2min
  completed: 2026-02-24
---

# Phase 10 Plan 02: REST API endpoint for milestone data Summary

**One-liner:** Added /api/milestones REST endpoint with MilestoneProvider interface following established provider injection pattern, wired into ResponseServer and standalone mode with graceful degradation when no provider configured.

## What Was Built

Extended the Express server REST API with milestone support, following the same provider injection pattern established for StateProvider, QuestionProvider, ActivityProvider, and LivenessProvider. The implementation cleanly integrates the milestone parser from Plan 01 into the HTTP layer.

### MilestoneProvider Interface (api.ts)

Added new provider interface alongside existing providers:

```typescript
/** Provides milestone lifecycle data parsed from planning files */
export interface MilestoneProvider {
  getMilestones(): MilestoneResponse;
}
```

Updated `ApiRouteDeps` interface to accept optional milestone provider:

```typescript
export interface ApiRouteDeps {
  stateProvider: StateProvider;
  questionProvider: QuestionProvider;
  livenessProvider?: LivenessProvider;
  activityProvider?: ActivityProvider;
  milestoneProvider?: MilestoneProvider;  // NEW
}
```

### /api/milestones Route

Added GET endpoint in `createApiRoutes()` positioned after activities endpoint:

```typescript
router.get('/milestones', (_req: Request, res: Response) => {
  if (!milestoneProvider) {
    res.json({ current: null, shipped: [] });
    return;
  }
  const milestones = milestoneProvider.getMilestones();
  res.json(milestones);
});
```

**Graceful degradation:** Returns empty response shape when no provider configured (fresh projects, legacy mode). No HTTP errors.

**Response format:** Direct JSON serialization of `MilestoneResponse` - no envelope wrapping. Response IS the milestone data with `current` and `shipped` fields.

### ResponseServer Wiring (index.ts)

Extended `ResponseServerOptions` interface with optional milestone provider:

```typescript
export interface ResponseServerOptions {
  // ... existing fields ...
  milestoneProvider?: MilestoneProvider;
}
```

Updated constructor to:
1. Declare `milestoneProvider` variable alongside other providers
2. Extract from opts in non-legacy branch: `milestoneProvider = opts.milestoneProvider`
3. Pass to API routes: `createApiRoutes({ ..., milestoneProvider })`

**Legacy mode:** `milestoneProvider` remains undefined in legacy branch - graceful degradation applies.

### Standalone Server Implementation (standalone.ts)

Created inline milestone provider implementation using the parser:

```typescript
const milestoneProvider = {
  getMilestones() {
    return parseMilestoneData(planningDir);
  },
};
```

Passed to ResponseServer constructor alongside other providers:

```typescript
const server = new ResponseServer({
  // ... existing providers ...
  milestoneProvider,
});
```

**File reads on each request:** The provider calls `parseMilestoneData()` on every GET request. For milestone data (changes only when `/gsd:complete-milestone` or `/gsd:new-milestone` runs), this is acceptable - avoids stale data and simplifies implementation. Small markdown files parse quickly.

## Deviations from Plan

None - plan executed exactly as written.

## Technical Decisions

### Provider Injection Pattern Consistency

**Decision:** MilestoneProvider follows the exact same pattern as ActivityProvider and LivenessProvider (optional dependency, destructured in createApiRoutes, graceful degradation).

**Rationale:** Code consistency reduces cognitive load. Future maintainers see familiar pattern. All providers have identical wiring flow.

**Implementation:** Optional in `ApiRouteDeps`, null check in route handler, undefined in legacy mode.

### No Response Envelope

**Decision:** `/api/milestones` returns `MilestoneResponse` directly, not wrapped in `{ milestones: ... }`.

**Rationale:** The response IS milestone data. Top-level object already has `current` and `shipped` fields - adding an envelope creates unnecessary nesting. Matches Plan 01 type design.

**Consistency check:** `/api/activities` returns `{ activities: [...] }` envelope, but that's for a flat array. Milestone data is already structured.

### Parser Called on Each Request

**Decision:** Milestone provider implementation calls `parseMilestoneData(planningDir)` synchronously on every request.

**Rationale:**
1. Milestone data changes infrequently (only when slash commands run)
2. Markdown files are small (KB range)
3. Regex parsing is fast (milliseconds)
4. No stale data issues (always reads latest from disk)
5. Simplifies implementation (no caching, no invalidation)

**Alternative considered:** Cache with filesystem watcher. Rejected as premature optimization for data that changes rarely.

## Verification

TypeScript compiles without errors:
```
cd autopilot && npx tsc --noEmit
(no output = success)
```

MilestoneProvider interface exported:
```typescript
export interface MilestoneProvider // ✓ Found in api.ts
```

/api/milestones route exists:
```typescript
router.get('/milestones', ...) // ✓ Found in api.ts
```

ResponseServer accepts milestoneProvider:
```typescript
milestoneProvider?: MilestoneProvider // ✓ Found in ResponseServerOptions
```

Standalone server creates and injects provider:
```typescript
import { parseMilestoneData } from '../milestone/parser.js'; // ✓ Found
const milestoneProvider = { getMilestones() { ... } }; // ✓ Found
```

## Self-Check: PASSED

**Modified files:**
- ✓ autopilot/src/server/routes/api.ts (exists, MilestoneProvider + route added)
- ✓ autopilot/src/server/index.ts (exists, milestoneProvider wired)
- ✓ autopilot/src/server/standalone.ts (exists, parser imported and used)

**Commits:**
- ✓ f1a4593: feat(10-02): add MilestoneProvider interface and /api/milestones route
- ✓ fa62306: feat(10-02): wire milestone provider into ResponseServer and standalone

All files modified as expected, all commits present, TypeScript compiles cleanly.

## Next Steps

Plan 03 will:
- Create React types for milestone data (mirror server types)
- Add `/api/milestones` client fetch function
- Integrate milestone data into Zustand store
- Add SSE listener for milestone updates (if milestone change events exist)
