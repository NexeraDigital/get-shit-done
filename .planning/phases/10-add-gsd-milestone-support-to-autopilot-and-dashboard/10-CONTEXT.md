# Phase 10: Add GSD Milestone support to autopilot and dashboard - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the autopilot server and dashboard aware of GSD's milestone lifecycle. Surface the current active milestone identity, display milestone-scoped progress, handle milestone state transitions (shipped, no-active), and provide a victory screen when a milestone completes. Only the current/active milestone is shown — no historical browsing.

</domain>

<decisions>
## Implementation Decisions

### Dashboard display
- Replace the "Phases" section header with "v1.0 MVP — Phases" format when a milestone is active
- When no milestone exists, fall back to just "Phases" (current behavior)
- Show both phase count AND milestone progress indicator (e.g. "Milestone 1 of 3 — 0/1 phases complete")
- Milestone identity is scoped to the Phases card — not in the header bar or project description card

### Data sourcing
- Read from three sources: PROJECT.md (current milestone identity), MILESTONES.md (history/stats), ROADMAP.md (milestone groupings in progress table)
- New dedicated `/api/milestones` endpoint — not bolted onto /api/status
- Return basics + stats per milestone: version, name, status (active/shipped), shipped date, phase count, plan count, key accomplishments

### Milestone lifecycle
- Full lifecycle support: display, detect completion, and surface actions
- When a milestone is shipped (via /gsd:complete-milestone), the Overview page transforms into a victory/celebration screen showing milestone stats, accomplishments, and "Start next milestone" prompt
- When all phases are 100% but milestone hasn't been formally shipped: just show 100% progress bar, no special prompt
- When no active milestone exists (between milestones or fresh project): show a "No active milestone" card/message suggesting to run /gsd:new-milestone

### Multi-milestone view
- Dashboard shows only the current/active milestone — no history browsing
- Victory screen shows only the just-shipped milestone's stats — no reference to past milestones
- Past milestones remain in .planning/milestones/ files and MILESTONES.md but are not surfaced in the dashboard UI

### Claude's Discretion
- Victory screen visual design and animation
- Exact milestone progress indicator format and placement
- How to parse milestone data from the various .planning/ markdown files (regex, section parsing, etc.)
- API response shape for /api/milestones

</decisions>

<specifics>
## Specific Ideas

- The Phases section header format: "v1.0 MVP — Phases" with em-dash separator
- Victory screen replaces the normal Overview page entirely when milestone is shipped
- "No active milestone" empty state should suggest the /gsd:new-milestone command

</specifics>

<deferred>
## Deferred Ideas

- Historical milestone browsing/switcher on the dashboard — keep it current-only for now
- Dashboard-triggered milestone completion (button to run /gsd:complete-milestone from the UI) — complex, defer to future phase

</deferred>

---

*Phase: 10-add-gsd-milestone-support-to-autopilot-and-dashboard*
*Context gathered: 2026-02-24*
