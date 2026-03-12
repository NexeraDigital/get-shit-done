# Phase 4: Dashboard and Event Stream Integration - Research

**Researched:** 2026-03-12
**Domain:** SSE event consolidation, dashboard parallel status display, question routing
**Confidence:** HIGH

## Summary

Phase 4 extends the existing dashboard and event system to support parallel execution visibility. The codebase is well-structured with clear extension points: EventTailer needs multi-file scanning, PhaseState needs parallel status fields, and question routing needs phase tagging. All changes are additive -- no existing behavior needs to be broken.

The most complex piece is the consolidated EventTailer, which must scan a directory for `events-phase-*.ndjson` files and merge them into a single event stream. The existing EventTailer is a clean single-file tailer with ring buffer and dedup. The multi-file extension follows the same pattern but manages multiple file handles and cross-file sequence ordering.

The dashboard side is simpler: PhaseCard already renders all phases with step dots, the Zustand store already tracks phases array, and the SSE hook already handles phase-status-changed events. The primary work is adding per-phase badges for questions and a completion summary table.

**Primary recommendation:** Extend EventTailer to ConsolidatedEventTailer with directory scanning, extend PhaseState with workerStatus/workerId fields, and add phase tagging to question events. All patterns already exist in the codebase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Event Stream Consolidation (EVNT-03):**
- Directory polling: EventTailer scans the log/ directory for `events-phase-*.ndjson` files on each tick. Auto-discovers new workers as they start without orchestrator coordination.
- Read-only fan-in: EventTailer reads all per-worker files and fans them into a single SSE stream. Worker files remain untouched -- no write contention.
- Unified tailer: One EventTailer handles both sequential and parallel mode. In sequential mode it finds one file, in parallel mode it finds N files. Same code path.

**Per-Phase Status Display (DASH-01):**
- Extend existing phases: Add parallel-specific fields to existing PhaseState (e.g., workerStatus: running/queued/done/failed, workerId, workerPid). GET /api/phases returns the same array with richer data.
- Show all phases: Queued phases visible (grayed out with dependency info), running (active), done (checkmark), failed (error). Full picture at a glance.
- SSE push for status updates: Emit phase-status-changed SSE events with updated phase data. Dashboard reacts instantly. Consistent with existing SSE pattern.
- Instant updates: Status changes render immediately. No animations or transitions.
- Summary table on completion: When build completes, show a summary table matching the CLI summary from Phase 3 -- phase name, status, duration, merge result.

**Question Routing (DASH-02, DASH-03):**
- Single list with phase tags: All questions in one list, each tagged with source phase (e.g., "Phase 2: Parallel Engine"). Compact, familiar layout.
- Fully independent answering: Each question is self-contained. Answering one phase's question doesn't block or affect another phase's question. No modal lock.
- Shared answer directory: All answer files go to `.planning/autopilot/answers/{questionId}.json` as today. Orchestrator routes to correct worker using the phase tag in the question.
- Per-phase question badges: Each phase card shows a badge with pending question count. User sees at a glance which phases need attention.

### Claude's Discretion
- Event ordering strategy in the consolidated SSE stream (timestamp-sorted vs arrival order)
- Failed phase display details (badge + expandable vs inline)
- Per-phase progress bar visual style (4-step indicators for discuss/plan/execute/verify)
- computeProgress() adaptation for parallel phases

### Deferred Ideas (OUT OF SCOPE)
- DASH-04: Live dependency graph visualization with color-coded nodes -- v2 requirement
- DASH-05: Execution time estimation from ActivityStore historical data -- v2 requirement
- Per-phase log filtering in dashboard (show only events from one phase) -- potential v2 enhancement
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EVNT-03 | Event streams from all workers are consolidated for dashboard consumption | ConsolidatedEventTailer pattern: directory scanning, multi-file handle management, cross-file event merging |
| DASH-01 | Dashboard shows per-phase status (running/queued/done/failed) for all parallel phases | Extended PhaseState type, PhaseCard parallel rendering, phase-status-changed SSE event, completion summary table |
| DASH-02 | Questions from each phase are routed to the correct phase context | QuestionEvent already has `phase` field; FileQuestionProvider already reads it from state; WorkerPool forwards question events with phaseNumber |
| DASH-03 | User can answer questions for specific phases without affecting others | Answer files are already per-questionId in shared directory; each question resolves independently via QuestionHandler deferred promises |
</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | ^4.0.0 | Test framework | Already used project-wide |
| Express | existing | HTTP server + API routes | Already powers dashboard server |
| Zustand | 5.x | Dashboard state management | Already used in dashboard store |
| React | existing | Dashboard UI | Already used |
| react-router | existing | Dashboard routing | Already used |
| write-file-atomic | existing | Atomic file writes | Already used for IPC |

### Supporting (No New Dependencies)
This phase requires ZERO new dependencies. All work extends existing modules.

## Architecture Patterns

### Recommended Changes Structure
```
autopilot/src/
  ipc/
    event-tailer.ts            # Extend: add multi-file scanning (ConsolidatedEventTailer)
    event-tailer.test.ts       # Extend: add multi-file tests
    types.ts                   # No change needed (workerEvents path already exists)
  types/
    state.ts                   # Extend: add workerStatus, workerId to PhaseState
  server/
    routes/
      api.ts                   # Extend: computeProgress() for parallel, add parallel status to /phases
      sse.ts                   # Extend: handle phase-status-changed event type
    standalone.ts              # Wire ConsolidatedEventTailer instead of EventTailer
autopilot/dashboard/src/
  types/index.ts               # Mirror new PhaseState fields
  components/
    PhaseCard.tsx              # Extend: parallel status indicators, question badges
    QuestionBadge.tsx          # Extend: per-phase question grouping
    SummaryTable.tsx           # NEW: completion summary table component
  pages/
    QuestionResponse.tsx       # Extend: show phase tag on question
    Overview.tsx               # Extend: show summary table on build-complete
  store/index.ts               # Extend: add parallel-specific actions
  hooks/useSSE.ts              # Extend: handle phase-status-changed event
```

### Pattern 1: ConsolidatedEventTailer (Multi-File Directory Scanning)
**What:** Extends EventTailer to scan `log/` directory for `events-phase-*.ndjson` files on each tick, managing one file handle per discovered file.
**When to use:** In standalone dashboard mode when running parallel phases.

```typescript
// Key design: Map<filePath, { handle, offset, buffer, lastSeq }>
// On each tick:
// 1. readdir(logDir) filtered to events-phase-*.ndjson
// 2. Open new files, track in Map
// 3. Read new bytes from each file (same as current single-file tail)
// 4. Parse lines, emit events with phaseNumber from file name
// 5. Ring buffer stores merged events

class ConsolidatedEventTailer extends EventEmitter {
  private readonly logDir: string;
  private readonly files = new Map<string, FileTailState>();
  // Ring buffer, timer, etc. same as EventTailer
}
```

**Recommendation for Claude's discretion (event ordering):** Use arrival order (process files in alphabetical order on each tick). Timestamp-sorting adds complexity and latency for negligible benefit since events are displayed in a stream, not a sorted table. Events already have timestamps for the UI to display if needed.

### Pattern 2: PhaseState Extension for Parallel Status
**What:** Add optional parallel-specific fields to PhaseState without breaking sequential mode.
**When to use:** Always -- fields are optional and only populated in parallel mode.

```typescript
// In autopilot/src/types/state.ts
export interface PhaseState {
  // ... existing fields ...
  workerStatus?: 'running' | 'queued' | 'done' | 'failed';
  workerId?: string;
  workerPid?: number;
  duration?: number;        // ms, populated on completion
  mergeStatus?: 'clean' | 'resolved' | 'conflict';
  error?: string;           // populated on failure
}
```

### Pattern 3: Phase-Tagged Question Display
**What:** Questions already have `phase` field. Display it prominently and count per-phase pending questions.
**When to use:** When rendering question list and phase cards.

```typescript
// QuestionEvent already has: phase?: number
// Group questions by phase for badge counts:
const questionsByPhase = new Map<number, QuestionEvent[]>();
for (const q of questions) {
  const phase = q.phase ?? 0;
  const list = questionsByPhase.get(phase) ?? [];
  list.push(q);
  questionsByPhase.set(phase, list);
}
```

### Pattern 4: SSE phase-status-changed Event
**What:** New SSE event type emitted when parallel phase status changes. Dashboard handles it like existing phase-started/phase-completed.
**When to use:** When WorkerPool reports phase state transitions.

```typescript
// Server-side: emit on state change
broadcast('phase-status-changed', {
  phaseNumber: N,
  status: 'running' | 'queued' | 'done' | 'failed',
  workerId: 'worker-N',
});

// Dashboard useSSE.ts: handle new event
es.addEventListener('phase-status-changed', () => {
  void Promise.all([fetchPhases(), fetchActivities()]).then(([p, a]) => {
    const st = useDashboardStore.getState();
    st.setPhases(p.phases);
    st.setActivities(a.activities);
  });
});
```

### Pattern 5: Completion Summary Table
**What:** On build-complete, display a summary table matching the CLI `renderSummary()` format from `orchestrator/summary.ts`.
**When to use:** In the Overview page when status === 'complete' and parallel mode was active.

```typescript
// The data comes from PhaseState[] already in the store
// PhaseResult shape matches what we add to PhaseState:
//   { phaseNumber, name, success: status === 'completed', skipped: status === 'skipped',
//     mergeStatus, error }
```

### Anti-Patterns to Avoid
- **Separate SSE connections per phase:** One SSE stream handles everything. Multiple connections waste resources and complicate reconnection.
- **Centralized event file for parallel mode:** Workers write to per-worker files (already decided). Never fan-in at the write side -- only at the read side.
- **Polling for parallel status:** Use SSE push for status changes. The 3s polling backup is already in useSSE.ts but should not be the primary mechanism.
- **Breaking sequential mode:** All new fields are optional. Sequential mode must work exactly as before.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event deduplication | Custom dedup logic | Existing seq-based dedup in EventTailer | Each file has its own sequence; track per-file lastSeq |
| Atomic file writes | Manual write+rename | write-file-atomic (already used) | Handles edge cases on Windows |
| State synchronization | Custom lock/semaphore | Existing StateWriteQueue promise-chain pattern | Already proven in Phase 1 |
| SSE protocol | Custom wire format | Express SSE pattern already in sse.ts | Handles headers, reconnection, cleanup |

## Common Pitfalls

### Pitfall 1: Cross-File Sequence Number Confusion
**What goes wrong:** EventTailer's current dedup uses a single `lastSeq` counter. Each per-worker file has independent sequence numbers starting from 1. Using global lastSeq would skip events.
**Why it happens:** Copy-paste from single-file tailer without adjusting dedup strategy.
**How to avoid:** Track `lastSeq` per file in the Map. Each file's events are deduped independently.
**Warning signs:** Events from later-starting workers never appear.

### Pitfall 2: File Handle Leak on Worker Completion
**What goes wrong:** Worker files stop growing when the phase completes, but file handles are never closed.
**Why it happens:** No cleanup trigger when a file goes dormant.
**How to avoid:** Close file handles after N ticks with no new data AND the phase is marked done. Or simply keep them open (cheap) and close all on stop().
**Warning signs:** Open file handle count grows unbounded over many parallel runs.

### Pitfall 3: Race Between State Update and SSE Event
**What goes wrong:** Dashboard receives phase-status-changed SSE event but REST /api/phases still returns stale state because state.json hasn't been written yet.
**Why it happens:** SSE event emitted before atomic write to state.json completes.
**How to avoid:** The existing pattern in useSSE.ts handles this correctly -- it fetches from REST on each SSE event, and the 3s polling interval catches any misses. No special handling needed.
**Warning signs:** Phase card shows stale status momentarily after SSE event.

### Pitfall 4: Dashboard Type Drift
**What goes wrong:** Server PhaseState gets new fields but dashboard mirror types don't get updated.
**Why it happens:** Types are intentionally duplicated between server and dashboard (separate build targets).
**How to avoid:** Update both `autopilot/src/types/state.ts` AND `autopilot/dashboard/src/types/index.ts` in the same task.
**Warning signs:** TypeScript compiles but new fields are `undefined` in the dashboard.

### Pitfall 5: Question Debounce in Parallel Mode
**What goes wrong:** Multiple phases emit questions simultaneously, and the 500ms debounce in sse.ts collapses them into a single "N questions waiting" notification instead of separate per-phase notifications.
**Why it happens:** The existing debounce groups ALL questions regardless of source phase.
**How to avoid:** This is acceptable behavior per the locked decision (single list with phase tags). The debounce correctly counts total pending questions. No change needed to the debounce logic.
**Warning signs:** None -- this is working as designed.

### Pitfall 6: ConsolidatedEventTailer in Sequential Mode
**What goes wrong:** In sequential mode, the main event file is `events.ndjson` (not `events-phase-*.ndjson`). ConsolidatedEventTailer only scans for per-phase files and misses the main file.
**Why it happens:** The "unified tailer" decision means one code path for both modes.
**How to avoid:** ConsolidatedEventTailer should scan for BOTH `events.ndjson` and `events-phase-*.ndjson`. In sequential mode it finds just the main file. In parallel mode it finds per-worker files. The main file may also exist if the orchestrator wrote init events before dispatching workers.
**Warning signs:** No events appear in the dashboard in sequential mode after switching to ConsolidatedEventTailer.

## Code Examples

### Existing EventTailer (Single File) -- autopilot/src/ipc/event-tailer.ts
The current EventTailer opens a single file, reads new bytes on each tick, and emits parsed events. Key properties:
- 500ms tick interval
- Ring buffer of 200 events for initial SSE burst
- Sequence-based dedup (`lastSeq`)
- Handles file not existing (retries on each tick)
- Handles file rotation/deletion (reopen on error)

### EventWriter Per-Worker Routing -- autopilot/src/ipc/event-writer.ts
EventWriter already supports per-worker routing via the `phaseNumber` option:
```typescript
// When phaseNumber is set, writes to events-phase-{N}.ndjson
// When phaseNumber is unset, writes to events.ndjson
this.filePath = this.metadata.phaseNumber != null
  ? IPC_PATHS.workerEvents(projectDir, this.metadata.phaseNumber)
  : IPC_PATHS.events(projectDir);
```

### IPC_PATHS.workerEvents -- autopilot/src/ipc/types.ts
```typescript
workerEvents: (projectDir: string, phaseNumber: number) =>
  join(projectDir, '.planning', 'autopilot', 'log', `events-phase-${phaseNumber}.ndjson`),
```

### QuestionEvent Already Has Phase -- autopilot/src/claude/types.ts
```typescript
export type QuestionEvent = {
  id: string;
  phase?: number;    // Already present!
  step?: string;     // Already present!
  questions: QuestionItem[];
  createdAt: string;
};
```

### WorkerPool Already Forwards Question Events -- autopilot/src/worker/index.ts
```typescript
// Line 79-86 in worker/index.ts
const forwardEvent = (eventName: string) => {
  claudeService.on(eventName, (event: Record<string, unknown>) => {
    this.emit(`worker:${eventName}`, { ...event, phaseNumber: phase.number });
  });
};
forwardEvent('question:pending');
forwardEvent('question:answered');
```

### Summary Table Format -- autopilot/src/orchestrator/summary.ts
```typescript
// PhaseResult interface -- model for dashboard completion summary
export interface PhaseResult {
  phaseNumber: number;
  name: string;
  success: boolean;
  skipped: boolean;
  error?: string;
  mergeStatus?: 'clean' | 'resolved' | 'conflict' | undefined;
}
```

### computeProgress() -- autopilot/src/server/routes/api.ts
```typescript
// Current implementation: counts done steps across all phases
// For parallel mode: this already works correctly because phases
// have independent step states. No change needed for basic progress.
// For "queued" phases (not yet started), steps are all 'idle' = 0 progress.
export function computeProgress(state: Readonly<AutopilotState>): number {
  if (state.phases.length === 0) return 0;
  const totalSteps = state.phases.length * 4;
  let completedSteps = 0;
  for (const phase of state.phases) {
    if (phase.steps.discuss === 'done') completedSteps++;
    if (phase.steps.plan === 'done') completedSteps++;
    if (phase.steps.execute === 'done') completedSteps++;
    if (phase.steps.verify === 'done') completedSteps++;
  }
  return Math.round((completedSteps / totalSteps) * 100);
}
```

**Recommendation for Claude's discretion (computeProgress):** The existing implementation already handles parallel phases correctly. Each phase's steps are independent. The total progress bar shows overall completion across all phases. No adaptation needed.

## Discretion Recommendations

### Event Ordering Strategy
**Recommendation: Arrival order (process files alphabetically on each tick)**
- Timestamp sorting adds complexity (need to buffer across files, wait for all files to report before emitting)
- Arrival order is simple and fast -- just process each file's new lines as they appear
- Events already carry timestamps for UI display
- SSE is append-only, so minor ordering differences are invisible in a scrolling log

### Failed Phase Display
**Recommendation: Badge + expandable inline error**
- The PhaseRow component already renders status badges (red for failed)
- Add an expandable section showing the error message below the step dots
- Keep it inline (no modal) to maintain the "full picture at a glance" goal
- Click to expand/collapse error details

### Per-Phase Progress Visual Style
**Recommendation: Keep existing 4-step dots, add running indicator**
- The StepDot component already shows green (done), blue-pulse (active), gray (idle)
- For parallel mode: multiple phases can show blue-pulse simultaneously
- No change needed to the visual style -- it already supports this
- Add a small running/queued/done/failed text badge next to the step dots for parallel awareness

### computeProgress() Adaptation
**Recommendation: No change needed**
- Current implementation counts completed steps across all phases
- This naturally handles parallel: running phases contribute partial progress, queued phases contribute 0, done phases contribute full
- The overall progress bar shows aggregate completion, which is correct

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single EventTailer for one file | ConsolidatedEventTailer for N files | This phase | Enables parallel event streaming |
| currentPhase as single number | Multiple phases running simultaneously | Phase 2 | Dashboard must show multiple active phases |
| Questions from single phase context | Questions tagged with source phase | This phase | Dashboard must display phase origin |

## Open Questions

1. **Should ConsolidatedEventTailer replace EventTailer or extend it?**
   - What we know: The decision says "unified tailer" -- one class for both modes
   - Recommendation: Replace EventTailer with ConsolidatedEventTailer that handles both single-file and multi-file modes. The single-file case is just the degenerate case of multi-file.

2. **How does the orchestrator emit phase-status-changed events?**
   - What we know: Orchestrator already emits phase:started and phase:completed
   - Recommendation: Add a new event `phase:status-changed` for intermediate status transitions (queued -> running, running -> failed). The EventWriter in the orchestrator writes these to the main event log. The ConsolidatedEventTailer picks them up.

3. **How does the build-complete event carry summary data for the summary table?**
   - What we know: The orchestrator already emits `build:complete`. The `renderSummary()` function in summary.ts produces the CLI output.
   - Recommendation: Include the PhaseResult[] array in the build-complete event data. The dashboard can render it as a table. OR the dashboard derives it from the phases array in the store (which already has status, mergeStatus, etc.). The latter is simpler and avoids data duplication.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | autopilot/vitest.config.ts (or default) |
| Quick run command | `cd autopilot && npx vitest run --reporter=verbose` |
| Full suite command | `cd autopilot && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVNT-03 | ConsolidatedEventTailer scans N files and emits merged events | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts -x` | No -- Wave 0 |
| EVNT-03 | ConsolidatedEventTailer handles sequential mode (single file) | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts -x` | No -- Wave 0 |
| EVNT-03 | ConsolidatedEventTailer auto-discovers new worker files | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts -x` | No -- Wave 0 |
| DASH-01 | PhaseState includes workerStatus/workerId fields | unit | `cd autopilot && npx vitest run src/types/__tests__/state.test.ts -x` | No -- Wave 0 (type test) |
| DASH-01 | phase-status-changed SSE event broadcasts correctly | unit | `cd autopilot && npx vitest run src/server/__tests__/sse.test.ts -x` | Yes (extend) |
| DASH-01 | computeProgress handles parallel phases | unit | `cd autopilot && npx vitest run src/server/__tests__/api-routes.test.ts -x` | Yes (extend) |
| DASH-02 | Questions include phase number in response | unit | `cd autopilot && npx vitest run src/server/__tests__/api-routes.test.ts -x` | Yes (extend) |
| DASH-03 | Answering one question does not affect others | unit | `cd autopilot && npx vitest run src/ipc/__tests__/answer-roundtrip.test.ts -x` | Yes (extend) |

### Sampling Rate
- **Per task commit:** `cd autopilot && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd autopilot && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `autopilot/src/ipc/__tests__/consolidated-event-tailer.test.ts` -- covers EVNT-03 multi-file scanning
- [ ] Extend `autopilot/src/server/__tests__/sse.test.ts` -- covers phase-status-changed event
- [ ] Extend `autopilot/src/server/__tests__/api-routes.test.ts` -- covers parallel phase status in /phases

## Sources

### Primary (HIGH confidence)
- Direct code analysis of all source files listed in CONTEXT.md code_context section
- `autopilot/src/ipc/event-tailer.ts` -- current single-file tailer implementation
- `autopilot/src/ipc/event-writer.ts` -- per-worker file routing already implemented
- `autopilot/src/ipc/types.ts` -- IPC_PATHS.workerEvents already defined
- `autopilot/src/server/routes/sse.ts` -- SSE broadcast infrastructure
- `autopilot/src/server/routes/api.ts` -- API routes and computeProgress
- `autopilot/src/worker/index.ts` -- WorkerPool event forwarding with phaseNumber
- `autopilot/src/claude/question-handler.ts` -- QuestionHandler with phase metadata
- `autopilot/src/types/state.ts` -- PhaseState type definition
- `autopilot/dashboard/src/` -- All dashboard components, store, hooks, types
- `autopilot/src/orchestrator/summary.ts` -- CLI summary table format

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing code analyzed
- Architecture: HIGH - clear extension points identified in existing code, patterns well-established
- Pitfalls: HIGH - derived from direct code analysis of current implementation details

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable internal codebase, no external dependency changes)
