# Phase 6: Notification System - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Dispatch notifications through configurable adapter channels when the autopilot needs human attention or stops running. Supports console (default), OS-native toast, Teams/Slack webhooks, and user-provided custom adapters. Notification triggers, adapter lifecycle, and fallback behavior are in scope. The dashboard UI (Phase 5) and orchestrator (Phase 3) already exist — this phase adds the notification dispatch layer.

</domain>

<decisions>
## Implementation Decisions

### Notification triggers & frequency
- Two trigger categories only: **questions pending** and **autopilot stopped** (error, shutdown, or build complete)
- Stop notifications include: status, summary (phases completed, time elapsed, error if applicable), and next steps (e.g., "run --resume" or "check verification gaps")
- No phase milestone notifications (start/complete) — keep it quiet
- Question reminders: re-notify if question is unanswered after a configurable timeout (e.g., 5 min default)
- Frequency control: Claude's Discretion (one-per-event is likely sufficient, batching optional)

### Console output style
- Inline with normal output flow — colored line, not a box/banner
- Question notifications show the full question text and options in the terminal
- Include full clickable URL to the dashboard question page (e.g., `http://localhost:3847/questions/abc123`)
- Terminal bell character (`\a`) for question notifications only — silent for stop/error
- No bell or sound for non-question notifications

### Chat platform messages (Teams/Slack)
- Link only — no inline action buttons. Message contains question text + dashboard link to answer
- Minimal content: phase name, question/status text, dashboard link. No progress bars or option lists
- Same minimal style for both question and stop notifications — consistent across notification types
- Teams and Slack adapters: identical logical behavior, formatted for each platform's native card format (Adaptive Card vs Block Kit)
- Claude's Discretion: platform-specific formatting differences where it makes sense

### Custom adapter contract
- Class-based with lifecycle: `init()`, `send(notification)`, `close()` methods
- Fire and forget: `send()` does not return delivery status. Console fallback triggers on thrown errors
- Claude's Discretion: whether to include helper functions (e.g., `toPlainText()`, `toMarkdown()`) alongside the raw Notification object
- Ship an example adapter file (`example-adapter.js`) that users can copy and modify as a starting point

### Claude's Discretion
- Notification frequency control strategy (batching vs one-per-event)
- Whether to include formatting helper functions for custom adapters
- Platform-specific formatting differences between Teams and Slack adapters
- Exact console color scheme for different notification types
- Reminder timeout default value and configurability

</decisions>

<specifics>
## Specific Ideas

- Console notifications should feel like part of the existing StreamRenderer output flow, not a separate system
- Question notifications in the terminal should print enough that you can see what's being asked without opening the browser
- Stop notifications should be actionable — tell the user exactly what to do next

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-notification-system*
*Context gathered: 2026-02-18*
