---
status: testing
phase: 09-fix-recent-activity-persistence
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md
started: 2026-02-24T12:00:00Z
updated: 2026-02-24T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Activity Persistence Across Restart
expected: |
  Activities persist to .planning/autopilot-activity.json. After the autopilot restarts, previously recorded activities are still visible in the dashboard's Recent Activity feed (not lost on restart).
awaiting: user response

## Tests

### 1. Activity Persistence Across Restart
expected: Activities persist to .planning/autopilot-activity.json. After the autopilot restarts, previously recorded activities are still visible in the dashboard's Recent Activity feed (not lost on restart).
result: [pending]

### 2. Activity Feed Shows Human-Readable Content
expected: Activity feed entries show descriptive text like "Phase 9: Fix Recent Activity — started" and "Question: Should we use..." (truncated) instead of raw UUIDs or internal IDs.
result: [pending]

### 3. Timestamps Display Correctly (Relative Time)
expected: Recent activities (< 24 hours old) show relative timestamps like "just now", "5s ago", "30 minutes ago", "2 hours ago" instead of raw ISO dates.
result: [pending]

### 4. Timestamps Display Correctly (Absolute Date)
expected: Activities older than 24 hours show absolute dates like "Feb 24, 2:30 PM" instead of relative time.
result: [pending]

### 5. Live Timestamp Updates
expected: Timestamps update automatically without page refresh. An activity showing "just now" should change to "30s ago" after about 30 seconds, then "1 minute ago" after a minute.
result: [pending]

### 6. Load More Pagination
expected: The activity feed initially shows up to 20 entries. If there are more than 20, a "Load more" button appears at the bottom. Clicking it reveals older entries. The button disappears when all entries are shown.
result: [pending]

### 7. Error Activity Styling
expected: Error activities in the feed are visually prominent with bold text and a red background tint, making them easy to spot among other entries.
result: [pending]

### 8. Answered Question Checkmark
expected: When a question has been answered, its activity entry in the feed shows a checkmark indicator to distinguish it from pending questions.
result: [pending]

### 9. Color-Coded Activity Dots
expected: Activity entries have colored dots: orange for pending questions, green for completions/answered questions, red for errors, blue for progress events (started/step activities).
result: [pending]

### 10. Activities Survive Page Reload
expected: Refreshing the dashboard page (F5) reloads the same activity history from the server. Activities are not lost or duplicated on page reload.
result: [pending]

## Summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0

## Gaps

[none yet]
