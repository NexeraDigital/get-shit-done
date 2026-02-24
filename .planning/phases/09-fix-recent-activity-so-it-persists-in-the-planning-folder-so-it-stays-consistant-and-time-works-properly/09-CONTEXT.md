# Phase 9: Fix Recent Activity Persistence - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the dashboard's Recent Activity feed so activities persist to disk in the .planning folder (surviving restarts), display human-readable content instead of raw UUIDs, and show accurate server-sourced timestamps with proper relative time formatting. This is a fix/improvement to existing dashboard functionality, not new feature work.

</domain>

<decisions>
## Implementation Decisions

### Activity content & display
- Question-pending activities show truncated question text, not raw UUIDs (e.g. "Question: Which authentication method shou...")
- Truncation length and approach: Claude's discretion
- Phase-change activities use phase name + action format (e.g. "Phase 3: Core Orchestrator — started", "Phase 5: React Dashboard — completed")
- Answered questions show in feed marked as answered (e.g. checkmark indicator) but do NOT display the answer text

### Persistence & retention
- Activities stored in a single JSON file: `.planning/autopilot-activity.json`
- Keep everything — no pruning, full build history retained
- File is cumulative across all autopilot runs for the project (not reset on fresh start, resume continues existing)
- Dashboard shows last 20 entries with a "Load more" button for older entries

### Time display behavior
- All activity timestamps are server-side (created when the event actually happens, persisted in JSON)
- Relative time for events < 24h old ("just now", "5 minutes ago", "2 hours ago")
- Switch to absolute date for events >= 24h old ("Feb 24, 2:30 PM")
- Timestamps update live in the browser every 30 seconds
- No tooltip on hover — just the relative/absolute time displayed

### Activity types & severity
- Events that generate activities: phase started/completed/failed, questions pending/answered, errors, build complete, AND step-level changes (research started, planning started, etc.)
- Visual distinction via colored dots: orange for questions, green for success, red for errors, blue for progress
- Error activities get extra visual weight: bold text + red background tint so they stand out
- No filtering UI needed — feed shows all types

### Claude's Discretion
- Exact truncation length for question text in activity entries
- JSON file structure and schema for activity storage
- How to wire persistence into existing SSE event flow
- Activity deduplication strategy (if needed)

</decisions>

<specifics>
## Specific Ideas

- Current activity feed shows raw UUIDs like "2f199945-0dcf-4..." which is useless — must show actual question text
- Time display is inconsistent (same item shows "17s ago" then "just now" on reload) — server timestamps fix this
- The colored dot pattern already exists in current dashboard — extend it consistently

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-fix-recent-activity-so-it-persists-in-the-planning-folder-so-it-stays-consistant-and-time-works-properly*
*Context gathered: 2026-02-24*
