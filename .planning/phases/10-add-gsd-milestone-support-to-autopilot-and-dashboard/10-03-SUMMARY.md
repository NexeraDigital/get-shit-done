---
phase: 10-add-gsd-milestone-support-to-autopilot-and-dashboard
plan: 03
subsystem: dashboard
tags: [dashboard, milestone, ui, sse, zustand]
dependency_graph:
  requires: [milestone-types, milestone-api]
  provides: [milestone-dashboard-ui]
  affects: [phase-card, dashboard-state]
tech_stack:
  added: []
  patterns: [milestone-aware-ui, sse-milestone-polling, conditional-header-rendering]
key_files:
  created: []
  modified:
    - autopilot/dashboard/src/types/index.ts
    - autopilot/dashboard/src/api/client.ts
    - autopilot/dashboard/src/store/index.ts
    - autopilot/dashboard/src/hooks/useSSE.ts
    - autopilot/dashboard/src/components/PhaseCard.tsx
decisions:
  - Dashboard types duplicated from server (consistent with existing pattern)
  - setMilestones action takes current and shipped separately (matches API shape)
  - fetchMilestones wrapped in .catch() to handle missing endpoint gracefully
  - Milestone identity shown in PhaseCard header only (per user decision)
  - Both phase-level and milestone-level progress shown (per user decision)
metrics:
  duration: 3min
  completed: 2026-02-24
---

# Phase 10 Plan 03: Dashboard milestone integration Summary

**One-liner:** Dashboard milestone awareness with mirrored types, API client, Zustand store integration, SSE polling, and PhaseCard header showing "v1.0 MVP — Phases" format with milestone progress indicator.

## What Was Built

Integrated milestone support into the dashboard, creating the data flow from server API through store to UI components. The most visible change is the PhaseCard header, which transforms from "Phases" to "v1.0 MVP — Phases" when a milestone is active, with a subtitle showing milestone-scoped progress.

### Dashboard Types (`autopilot/dashboard/src/types/index.ts`)

Added three milestone types at the end of the file (after ActivityItem):

- **MilestoneStatus**: `'active' | 'shipped'` literal union
- **MilestoneInfo**: Full milestone metadata (version, name, status, shippedDate, phase/plan counts, phasesCompleted, accomplishments)
- **MilestoneResponse**: API response shape with `current: MilestoneInfo | null` and `shipped: MilestoneInfo[]`

These types are intentionally duplicated from `autopilot/src/milestone/types.ts` because the dashboard is a separate Vite project and must NOT import from the server codebase (consistent with existing pattern for all dashboard types).

### API Client (`autopilot/dashboard/src/api/client.ts`)

Added `fetchMilestones()` function:

```typescript
export async function fetchMilestones(): Promise<MilestoneResponse> {
  const res = await fetch('/api/milestones');
  if (!res.ok) {
    throw new Error(`fetchMilestones failed: ${String(res.status)}`);
  }
  return res.json() as Promise<MilestoneResponse>;
}
```

Placed after `fetchActivities()` and before push notification endpoints (follows existing API client organization).

### Zustand Store (`autopilot/dashboard/src/store/index.ts`)

Added milestone state slice:

**State fields:**
- `currentMilestone: MilestoneInfo | null` - Active milestone (null if none)
- `milestones: MilestoneInfo[]` - All milestones (current + shipped)

**Action:**
- `setMilestones: (current, shipped) => set({ currentMilestone: current, milestones: shipped })`

The action takes `current` and `shipped` as separate parameters (matching the API response shape) rather than a combined array. This avoids the need for a `.find(m => m.status === 'active')` lookup in the store — the server already determines which milestone is active.

### SSE Hook (`autopilot/dashboard/src/hooks/useSSE.ts`)

Integrated milestone fetching in three places:

1. **Rehydration** (on connect/reconnect): Added `fetchMilestones()` to the Promise.all alongside status, phases, questions, activities
2. **Polling timer** (every 3s): Added milestone fetching to catch state changes
3. **build-complete event**: Added milestone refetch (build complete may follow a milestone ship)

All calls wrapped in `.catch(() => ({ current: null, shipped: [] }))` to ensure a missing `/api/milestones` endpoint (older server) doesn't break rehydration or polling.

### PhaseCard Component (`autopilot/dashboard/src/components/PhaseCard.tsx`)

Updated header section to be milestone-aware:

**When `currentMilestone` exists (active milestone):**
- Header: `{currentMilestone.version} {currentMilestone.name} — Phases`
- Subtitle: `Milestone {phasesCompleted} of {phaseCount} phases complete`
- Right-side count: `{completedCount}/{totalCount} complete` (existing phase-level progress)

**When `currentMilestone` is null (no active milestone):**
- Header: `Phases` (existing behavior)
- No subtitle
- Right-side count: `{completedCount}/{totalCount} complete`

This follows the user decision: "Replace the 'Phases' section header with 'v1.0 MVP — Phases' format when a milestone is active" and "When no milestone exists, fall back to just 'Phases' (current behavior)".

The design shows **both** phase-level progress (right side) and milestone-level progress (subtitle) per user decision: "Show both phase count AND milestone progress indicator."

## Deviations from Plan

None - plan executed exactly as written.

## Technical Decisions

### Type Duplication Strategy

**Decision:** Duplicate MilestoneInfo, MilestoneStatus, and MilestoneResponse types in dashboard/src/types/index.ts instead of importing from server.

**Rationale:** The dashboard is a separate Vite project with its own build. All existing dashboard types (PhaseState, QuestionEvent, ActivityItem) are already duplicated from server types. This maintains the architectural boundary and avoids build complexity.

**Precedent:** Decision [05-01] from STATE.md: "Dashboard types duplicated from server (no cross-project imports -- separate Vite project)."

### setMilestones Action Signature

**Decision:** `setMilestones(current, shipped)` takes two separate parameters instead of a single array or merged list.

**Rationale:** The API response has the shape `{ current: ..., shipped: [...] }`. The server already determines which milestone is active (cross-referencing PROJECT.md and MILESTONES.md). Passing these separately to the store avoids the need for `.find(m => m.status === 'active')` lookups and makes the current/shipped distinction explicit in the store API.

**Implementation:** Single `set()` call updates both fields atomically.

### Graceful Degradation for Missing Endpoint

**Decision:** Wrap all `fetchMilestones()` calls in `.catch(() => ({ current: null, shipped: [] }))`.

**Rationale:** The `/api/milestones` endpoint was added in Phase 10. If the dashboard connects to an older server version (or if milestone files don't exist yet), the endpoint will fail. By catching and returning empty milestone data, the dashboard degrades gracefully — existing features continue working, milestone UI doesn't appear.

**Scope:** Applied to rehydration, polling, and build-complete event handlers.

### Milestone Identity Placement

**Decision:** Show milestone identity (version + name) in PhaseCard header only, not in header bar or project description card.

**Rationale:** Per user decision during planning: "Milestone identity is scoped to the Phases card only." This keeps the milestone context focused on the phase progress area, avoiding visual clutter in the top navigation.

### Dual Progress Indicators

**Decision:** Show both phase-level count (right side) and milestone-level subtitle (below header).

**Rationale:** Per user decision: "Show both phase count AND milestone progress indicator." Phase count shows immediate work status (3/10 complete). Milestone count shows progress toward the milestone goal (3 of 8 phases complete). These are complementary metrics — phases may exist outside the milestone scope.

**Example:** If milestone covers phases 1-8 but project has 10 total phases, right side shows 3/10, subtitle shows 3 of 8.

## Verification

### TypeScript Compilation

Dashboard compiles without errors:
```
cd autopilot/dashboard && npx tsc --noEmit
(no output = success)
```

Server compiles without errors:
```
cd autopilot && npx tsc --noEmit
(no output = success)
```

### Key Implementation Checks

Verified milestone types exist in dashboard:
```bash
grep "MilestoneInfo" src/types/index.ts
# Found: type definition and usage in MilestoneResponse
```

Verified fetchMilestones in API client:
```bash
grep "fetchMilestones" src/api/client.ts
# Found: function definition with proper error handling
```

Verified store has milestone state:
```bash
grep "currentMilestone" src/store/index.ts
# Found: state field, initial value, and setMilestones action
```

Verified SSE fetches milestones:
```bash
grep "fetchMilestones" src/hooks/useSSE.ts
# Found: import, rehydration call, polling call, build-complete call
```

Verified PhaseCard uses milestone data:
```bash
grep "currentMilestone.version" src/components/PhaseCard.tsx
# Found: milestone-aware header rendering
```

### Must-Have Truths (from plan frontmatter)

- [x] Dashboard has MilestoneInfo and MilestoneResponse types mirrored from server
- [x] fetchMilestones() API client function exists and returns milestone data
- [x] Zustand store has currentMilestone and milestones state with setMilestones action
- [x] PhaseCard header shows 'v1.0 MVP — Phases' format when active milestone exists
- [x] PhaseCard falls back to 'Phases' header when no milestone is active
- [x] Milestone progress indicator shows phase completion count within the milestone
- [x] Milestones are fetched on mount and refreshed via polling

### Key Links (from plan frontmatter)

- [x] store imports MilestoneInfo type from types/index.ts
- [x] useSSE calls fetchMilestones in rehydrate and poll
- [x] PhaseCard uses useDashboardStore selector for currentMilestone

## Self-Check: PASSED

**Modified files:**
- ✓ autopilot/dashboard/src/types/index.ts (milestone types added)
- ✓ autopilot/dashboard/src/api/client.ts (fetchMilestones added)
- ✓ autopilot/dashboard/src/store/index.ts (milestone state slice added)
- ✓ autopilot/dashboard/src/hooks/useSSE.ts (milestone fetching wired)
- ✓ autopilot/dashboard/src/components/PhaseCard.tsx (milestone-aware header)

**Commits:**
- ✓ 3cb5a2a: feat(10-03): add milestone types, API client, and store support
- ✓ 6c74054: feat(10-03): add milestone-aware PhaseCard header and SSE fetching

**File existence:**
```bash
ls -la autopilot/dashboard/src/types/index.ts       # Exists
ls -la autopilot/dashboard/src/api/client.ts        # Exists
ls -la autopilot/dashboard/src/store/index.ts       # Exists
ls -la autopilot/dashboard/src/hooks/useSSE.ts      # Exists
ls -la autopilot/dashboard/src/components/PhaseCard.tsx # Exists
```

**Commit existence:**
```bash
git log --oneline --all | grep "3cb5a2a"  # Found
git log --oneline --all | grep "6c74054"  # Found
```

All files modified, all commits present, all verifications pass.

## Next Steps

Plan 04 will:
- Create user-facing documentation for milestone workflow
- Document MILESTONES.md format and PROJECT.md "Current Milestone" section
- Provide examples of milestone planning and shipping
- Explain milestone vs phase vs plan scoping

This completes the technical implementation of milestone support. The dashboard now displays milestone context, the server provides milestone data, and the parser extracts milestone metadata from planning files. The final plan adds user documentation.
