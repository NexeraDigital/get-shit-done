---
phase: 06-notification-system
plan: "01"
subsystem: notifications
tags: [notifications, manager, console-adapter, types, tdd]
dependency_graph:
  requires:
    - autopilot/src/types/notification.ts
    - autopilot/src/output/colors.ts (ansis palette)
  provides:
    - autopilot/src/notifications/index.ts (barrel export)
    - autopilot/src/notifications/manager.ts (NotificationManager)
    - autopilot/src/notifications/adapters/console.ts (ConsoleAdapter)
  affects:
    - Any future adapter implementations must implement init/send/close lifecycle
tech_stack:
  added: []
  patterns:
    - Promise.allSettled for parallel adapter dispatch
    - timer.unref() to prevent blocking Node exit (same as claude/timeout.ts)
    - WritableOutput interface for testable stream output (same pattern as StreamRenderer)
    - Graceful init failure: remove failing adapters without crashing
key_files:
  created:
    - autopilot/src/notifications/types.ts
    - autopilot/src/notifications/manager.ts
    - autopilot/src/notifications/adapters/console.ts
    - autopilot/src/notifications/index.ts
    - autopilot/src/notifications/__tests__/manager.test.ts
    - autopilot/src/notifications/__tests__/console.test.ts
  modified:
    - autopilot/src/types/notification.ts (added init/close lifecycle, summary/nextSteps/errorMessage fields)
decisions:
  - "[06-01]: Terminal bell uses \\x07 (not \\a which is not a JS escape) for question notifications"
  - "[06-01]: NotificationManager.createNotification() static helper for building notifications without manual UUID/timestamp"
  - "[06-01]: ConsoleAdapter format() method is public for testability, allowing format verification without I/O"
metrics:
  duration: "3min"
  completed: "2026-02-18"
  tasks_completed: 2
  files_changed: 7
  tests_added: 33
---

# Phase 6 Plan 01: Notification System Foundation Summary

Notification system foundation built: NotificationManager with Promise.allSettled dispatch, graceful init failure handling, question reminders with unref'd timers, and ConsoleAdapter as the always-on zero-dependency notification channel.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update notification types and create NotificationManager | 32f07ae | notification.ts, types.ts, manager.ts, manager.test.ts |
| 2 | Create ConsoleAdapter with inline colored output and barrel exports | eff46c6 | console.ts, console.test.ts, index.ts |

## What Was Built

### NotificationAdapter Interface (updated in types/notification.ts)

Full lifecycle-based adapter contract replacing the stub:

```typescript
export interface NotificationAdapter {
  readonly name: string;
  init(): Promise<void>;
  send(notification: Notification): Promise<void>;
  close(): Promise<void>;
}
```

Also added `summary`, `nextSteps`, and `errorMessage` fields to the `Notification` interface for stop notifications.

### NotificationManager (notifications/manager.ts)

- `addAdapter(adapter)` registers adapters before `init()`
- `init()` calls each adapter's init; failing adapters are removed with a warning (no crash)
- `notify(notification)` dispatches to ALL adapters via `Promise.allSettled` -- one failure never blocks others
- `startReminder(questionId, notification)` fires re-notification after `questionReminderMs` (default 5 min); uses `timer.unref()` to prevent blocking Node exit
- `cancelReminder(questionId)` cancels the timer (wire to `question:answered` event)
- `close()` cancels all reminders and calls each adapter's `close()`
- Static `createNotification()` helper for building notifications with auto-generated ID and timestamp

### ConsoleAdapter (notifications/adapters/console.ts)

Inline colored output -- NOT a box/banner -- per locked decisions:

- **Question**: `\x07[?] Phase 3: What approach? (http://localhost:3847/questions/abc-123)` + options list
- **Error**: `[!] Autopilot stopped: ...` + Summary + Next steps (no bell)
- **Complete**: `[v] Build complete: ...` + summary + next steps (no bell)
- **Progress**: `[i] Phase 3 discuss complete` (no bell)

Uses `palette` from `output/colors.ts`, `stopSpinner` callback for ora compatibility, and `WritableOutput` interface for testability.

### Barrel Exports (notifications/index.ts)

```typescript
export { NotificationManager } from './manager.js';
export { ConsoleAdapter } from './adapters/console.js';
export type { NotificationManagerOptions } from './types.js';
```

## Test Coverage

- **manager.test.ts**: 13 tests covering parallel dispatch, allSettled failure isolation, console fallback, init failure removal, reminder fire/cancel, close behavior
- **console.test.ts**: 20 tests covering question format (bell, URL, options), error/complete/progress formats (no bell), stopSpinner callback, lifecycle no-ops

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JavaScript does not recognize `\a` as bell character**
- **Found during:** Task 2 -- console tests failed with 3 failing assertions
- **Issue:** In JavaScript, `'\a'` is not the bell character (U+0007); it's simply the letter 'a'. The bell character must be written as `'\x07'` or `'\u0007'`
- **Fix:** Changed `\a` to `\x07` in ConsoleAdapter formatQuestion() and all test assertions
- **Files modified:** console.ts, console.test.ts
- **Commit:** eff46c6 (included in same commit after fix)

## Self-Check: PASSED

All files confirmed present:
- FOUND: autopilot/src/notifications/manager.ts
- FOUND: autopilot/src/notifications/adapters/console.ts
- FOUND: autopilot/src/notifications/index.ts
- FOUND: autopilot/src/notifications/types.ts
- FOUND: autopilot/src/notifications/__tests__/manager.test.ts
- FOUND: autopilot/src/notifications/__tests__/console.test.ts
- FOUND: autopilot/src/types/notification.ts (modified)

All commits confirmed present:
- FOUND: 32f07ae (feat(06-01): add NotificationManager with dispatch, fallback, and reminders)
- FOUND: eff46c6 (feat(06-01): add ConsoleAdapter with inline colored output and barrel exports)
