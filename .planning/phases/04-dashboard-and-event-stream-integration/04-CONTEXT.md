# Phase 4: Dashboard and Event Stream Integration - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The dashboard shows real-time status for all parallel phases and routes questions to the correct phase worker, giving the user full visibility and interaction during parallel execution. This phase delivers EVNT-03, DASH-01, DASH-02, DASH-03. Dependency graph visualization (DASH-04) and time estimation (DASH-05) are deferred to v2.

</domain>

<decisions>
## Implementation Decisions

### Event Stream Consolidation (EVNT-03)
- Directory polling: EventTailer scans the log/ directory for `events-phase-*.ndjson` files on each tick. Auto-discovers new workers as they start without orchestrator coordination.
- Read-only fan-in: EventTailer reads all per-worker files and fans them into a single SSE stream. Worker files remain untouched -- no write contention.
- Unified tailer: One EventTailer handles both sequential and parallel mode. In sequential mode it finds one file, in parallel mode it finds N files. Same code path.

### Per-Phase Status Display (DASH-01)
- Extend existing phases: Add parallel-specific fields to existing PhaseState (e.g., workerStatus: running/queued/done/failed, workerId, workerPid). GET /api/phases returns the same array with richer data.
- Show all phases: Queued phases visible (grayed out with dependency info), running (active), done (checkmark), failed (error). Full picture at a glance.
- SSE push for status updates: Emit phase-status-changed SSE events with updated phase data. Dashboard reacts instantly. Consistent with existing SSE pattern.
- Instant updates: Status changes render immediately. No animations or transitions.
- Summary table on completion: When build completes, show a summary table matching the CLI summary from Phase 3 -- phase name, status, duration, merge result.

### Question Routing (DASH-02, DASH-03)
- Single list with phase tags: All questions in one list, each tagged with source phase (e.g., "Phase 2: Parallel Engine"). Compact, familiar layout.
- Fully independent answering: Each question is self-contained. Answering one phase's question doesn't block or affect another phase's question. No modal lock.
- Shared answer directory: All answer files go to `.planning/autopilot/answers/{questionId}.json` as today. Orchestrator routes to correct worker using the phase tag in the question.
- Per-phase question badges: Each phase card shows a badge with pending question count. User sees at a glance which phases need attention.

### Claude's Discretion
- Event ordering strategy in the consolidated SSE stream (timestamp-sorted vs arrival order)
- Failed phase display details (badge + expandable vs inline)
- Per-phase progress bar visual style (4-step indicators for discuss/plan/execute/verify)
- computeProgress() adaptation for parallel phases

</decisions>

<specifics>
## Specific Ideas

- The existing `IPC_PATHS.workerEvents()` helper already generates per-worker event file paths (`events-phase-{N}.ndjson`) -- the consolidated EventTailer should use the same naming convention for discovery
- The Phase 3 CLI summary table (pass/fail/skip with merge column) is the model for the dashboard completion view
- Per-phase progress should show the 4-step lifecycle (discuss/plan/execute/verify) since this is already tracked in `PhaseState.steps`
- Push notification debouncing for questions (already implemented in SSE) should account for questions arriving from different phases simultaneously

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EventTailer` (`ipc/event-tailer.ts`): Tails single NDJSON file with ring buffer and dedup. Needs extension to multi-file.
- `IPC_PATHS.workerEvents()` (`ipc/types.ts`): Already generates `events-phase-{N}.ndjson` paths.
- `IPCEvent` (`ipc/types.ts`): Already has `phaseNumber`, `workerId`, `stepName` fields.
- `setupSSE()` (`server/routes/sse.ts`): Two-mode SSE setup (in-process and file-tail). File-tail mode consumes EventTailer events.
- `FileQuestionProvider` (`ipc/file-question-provider.ts`): Reads questions from state, writes answers. Needs phase filtering.
- `AnswerWriter` (`ipc/answer-writer.ts`): Writes answer files to shared directory.
- `computeProgress()` (`server/routes/api.ts`): Calculates single percentage from phase steps.

### Established Patterns
- File-based IPC: NDJSON events, JSON questions/heartbeat, atomic writes via write-file-atomic
- SSE broadcast to connected clients with ring buffer for initial burst
- Push notification debouncing (500ms) for rapid-fire questions
- Provider interfaces (StateProvider, QuestionProvider, LivenessProvider) for dependency injection

### Integration Points
- `EventTailer.tail()`: Extend to scan multiple files instead of single file
- `GET /api/phases`: Response shape needs parallel status fields added to PhaseState
- `setupSSE()` file-tail mode: EventTailer already emits 'event' -- consolidated tailer works transparently
- `FileQuestionProvider.getPendingQuestions()`: Add phase number to returned QuestionEvent
- `computeProgress()`: Adapt to handle parallel phase states (some running, some queued)

</code_context>

<deferred>
## Deferred Ideas

- DASH-04: Live dependency graph visualization with color-coded nodes -- v2 requirement
- DASH-05: Execution time estimation from ActivityStore historical data -- v2 requirement
- Per-phase log filtering in dashboard (show only events from one phase) -- potential v2 enhancement

</deferred>

---

*Phase: 04-dashboard-and-event-stream-integration*
*Context gathered: 2026-03-12*
