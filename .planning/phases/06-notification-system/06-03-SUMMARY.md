---
phase: 06-notification-system
plan: "03"
subsystem: notifications
tags: [notifications, cli-wiring, event-listeners, config-schema, package-exports, node-notifier]
dependency_graph:
  requires:
    - autopilot/src/notifications/manager.ts (NotificationManager from Plan 01)
    - autopilot/src/notifications/adapters/ (all adapters from Plans 01-02)
    - autopilot/src/cli/index.ts (CLI action handler from Plan 03-04)
    - autopilot/src/types/config.ts (AutopilotConfigSchema from Plan 01-03)
  provides:
    - autopilot/src/cli/index.ts (NotificationManager wiring with event listeners)
    - autopilot/src/types/config.ts (questionReminderMs config field)
    - autopilot/src/index.ts (NotificationManager and all adapter exports from package entry)
    - autopilot/package.json (node-notifier as optionalDependency)
  affects:
    - Any future autopilot runs will fire notifications on question:pending, build:complete, error:escalation
tech-stack:
  added:
    - node-notifier@^10.0.1 (optionalDependency - only needed for --notify system)
  patterns:
    - Event-driven notification dispatch: claudeService.on('question:pending') -> notify + startReminder
    - LIFO shutdown ordering: notificationManager.close() registered before responseServer.close()
    - Adapter switch pattern: config.notify selects adapter; console always added as fallback
    - Optional dependency graceful failure: node-notifier missing -> SystemAdapter removed during init
key-files:
  created: []
  modified:
    - autopilot/src/cli/index.ts (NotificationManager creation, event wiring, shutdown registration)
    - autopilot/src/types/config.ts (questionReminderMs field, notify z.enum)
    - autopilot/src/notifications/index.ts (full barrel with all adapter exports)
    - autopilot/src/index.ts (notification system exports from package entry)
    - autopilot/package.json (node-notifier optionalDependency, example-adapter.js in files)
    - autopilot/src/orchestrator/__tests__/orchestrator.test.ts (fixed missing questionReminderMs in mock config)
key-decisions:
  - "[06-03]: NotificationManager constructor only takes questionReminderMs (not port/stopSpinner) -- ConsoleAdapter receives port/stopSpinner directly"
  - "[06-03]: Console adapter always added as fallback before channel-specific adapter switch"
  - "[06-03]: notificationManager.close() called in success path, error path, and registered in ShutdownManager for all exit scenarios"
  - "[06-03]: build:complete has two listeners: one for streamRenderer.stopSpinner(), one for notification dispatch (separate concerns)"
patterns-established:
  - "Notification wiring pattern: event listener creates Notification object -> notify() + startReminder()"
  - "Config type change requires updating all test mock configs to include new required fields"
metrics:
  duration: "3min"
  completed: "2026-02-18"
  tasks_completed: 2
  files_changed: 6
  tests_added: 0
---

# Phase 6 Plan 03: CLI Integration and Package Wiring Summary

**NotificationManager wired into CLI bootstrap with question/build/error event listeners, questionReminderMs config field, full adapter barrel exports, and node-notifier as optional dependency -- notification system now fires during real autopilot runs.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-18T21:14:14Z
- **Completed:** 2026-02-18T21:18:01Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- NotificationManager created in CLI with adapter selection via `config.notify` switch
- `question:pending` fires question notification with title, body, options, respondUrl + starts reminder timer
- `question:answered` cancels the reminder timer
- `build:complete` fires complete notification with phase count and elapsed time summary
- `error:escalation` fires error notification with phase/step context and resume instructions
- `notificationManager.close()` called in all exit paths (success, error, ShutdownManager LIFO)
- `questionReminderMs` added to `AutopilotConfigSchema` with 5-minute default
- `notify` field narrowed from `z.string()` to `z.enum(['console', 'system', 'teams', 'slack', 'webhook'])`
- `--adapter-path` CLI option added, wired through config to `loadCustomAdapter`
- All notification classes exported from `@gsd/autopilot` package entry point
- `node-notifier` added as optional dependency (not blocking installs when unavailable)
- `example-adapter.js` added to `package.json` files array

## Task Commits

Each task was committed atomically:

1. **Task 1: Update config schema, wire NotificationManager in CLI, connect all events** - `f057d22` (feat)
2. **Task 2: Update package exports and add node-notifier optional dependency** - `80a4078` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `autopilot/src/cli/index.ts` - NotificationManager creation, adapter switch, question/build/error event wiring, shutdown registration
- `autopilot/src/types/config.ts` - Added `questionReminderMs`, narrowed `notify` to `z.enum`
- `autopilot/src/notifications/index.ts` - Full barrel export with all 5 adapters and `loadCustomAdapter`
- `autopilot/src/index.ts` - NotificationManager, all adapters, loadCustomAdapter exported from package entry
- `autopilot/package.json` - `node-notifier` in `optionalDependencies`, `example-adapter.js` in `files`
- `autopilot/src/orchestrator/__tests__/orchestrator.test.ts` - Added `questionReminderMs: 300_000` to mock config

## Decisions Made

- **NotificationManager constructor**: Only accepts `questionReminderMs` -- `port` and `stopSpinner` go to `ConsoleAdapter` directly (matched existing manager.ts implementation)
- **Console always added first**: ConsoleAdapter is the guaranteed zero-dependency fallback, added before the channel-specific adapter switch
- **Three exit paths for close()**: Success path (`await orchestrator.run()`), error path (catch block), and ShutdownManager registration cover all scenarios
- **Dual build:complete listeners**: One calls `streamRenderer.stopSpinner()`, one dispatches the notification -- separate concerns on same event

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed NotificationManager constructor call with unsupported options**
- **Found during:** Task 1 (NotificationManager creation)
- **Issue:** Plan specified passing `port` and `stopSpinner` to `NotificationManager` constructor, but the actual implementation only accepts `Pick<NotificationManagerOptions, 'questionReminderMs'>`. Passing extra props would cause TS error.
- **Fix:** Removed `port` and `stopSpinner` from NotificationManager constructor call; kept them in ConsoleAdapter constructor only
- **Files modified:** autopilot/src/cli/index.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** f057d22 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed orchestrator test mock config missing required questionReminderMs field**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** Adding `questionReminderMs` as a non-optional field in `AutopilotConfigSchema` caused `orchestrator.test.ts` `createDefaultConfig()` to fail type checking -- missing required field
- **Fix:** Added `questionReminderMs: 300_000` to the default config object in the test helper
- **Files modified:** autopilot/src/orchestrator/__tests__/orchestrator.test.ts
- **Verification:** `npx tsc --noEmit` passes clean, all 584 tests pass
- **Committed in:** f057d22 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs - type mismatches between plan spec and implementation)
**Impact on plan:** Both fixes necessary for TypeScript correctness. No scope creep.

## Issues Encountered

Pre-existing failure in `yolo-config.test.ts` (`plan_checker` property assertion fails -- not related to this plan's changes). Verified pre-existing by stash-testing before/after.

## User Setup Required

None - no external service configuration required. Teams/Slack URLs wired through `--webhook-url` CLI flag.

## Next Phase Readiness

- All three phases of the notification system are complete (Plans 01-02-03)
- Phase 06 notification system is fully integrated and operational
- Notifications fire automatically during autopilot runs based on events
- This was the final plan in Phase 06 -- Phase 7 (Integration and CLI Wiring) is next

---
*Phase: 06-notification-system*
*Completed: 2026-02-18*

## Self-Check: PASSED

All files confirmed present:
- FOUND: autopilot/src/cli/index.ts
- FOUND: autopilot/src/types/config.ts
- FOUND: autopilot/src/notifications/index.ts
- FOUND: autopilot/src/index.ts
- FOUND: autopilot/package.json
- FOUND: .planning/phases/06-notification-system/06-03-SUMMARY.md

All commits confirmed present:
- FOUND: f057d22 (feat(06-03): wire NotificationManager into CLI with event listeners)
- FOUND: 80a4078 (feat(06-03): add notification exports to package entry and node-notifier optionalDependency)
