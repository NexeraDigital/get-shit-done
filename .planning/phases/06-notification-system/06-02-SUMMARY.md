---
phase: 06-notification-system
plan: "02"
subsystem: notifications
tags: [notifications, adapters, teams, slack, webhook, system, node-notifier, fetch, dynamic-import]
dependency_graph:
  requires:
    - autopilot/src/notifications/types.ts (NotificationAdapter interface from Plan 01)
    - autopilot/src/notifications/adapters/console.ts (ConsoleAdapter pattern to follow)
  provides:
    - autopilot/src/notifications/adapters/teams.ts (TeamsAdapter with Adaptive Card formatting)
    - autopilot/src/notifications/adapters/slack.ts (SlackAdapter with Block Kit formatting)
    - autopilot/src/notifications/adapters/webhook.ts (CustomWebhookAdapter with raw JSON POST)
    - autopilot/src/notifications/adapters/system.ts (SystemAdapter via node-notifier)
    - autopilot/src/notifications/loader.ts (loadCustomAdapter for dynamic import)
    - autopilot/example-adapter.js (copyable starting point for users)
  affects:
    - Plan 03 (package.json update - node-notifier as optional dependency)
    - CLI integration (--adapter-path flag wiring to loadCustomAdapter)
tech-stack:
  added: []
  patterns:
    - Node.js built-in fetch for HTTP POST (Teams, Slack, Webhook adapters)
    - createRequire workaround for CJS-only library in ESM project (node-notifier)
    - pathToFileURL for dynamic import of user-provided adapter paths
    - Method validation pattern (init/send/close) before returning loaded adapter
key-files:
  created:
    - autopilot/src/notifications/adapters/teams.ts
    - autopilot/src/notifications/adapters/slack.ts
    - autopilot/src/notifications/adapters/webhook.ts
    - autopilot/src/notifications/adapters/system.ts
    - autopilot/src/notifications/loader.ts
    - autopilot/src/notifications/__tests__/teams.test.ts
    - autopilot/src/notifications/__tests__/slack.test.ts
    - autopilot/src/notifications/__tests__/adapters.test.ts
    - autopilot/example-adapter.js
  modified: []
key-decisions:
  - "[06-02]: TeamsAdapter uses Adaptive Card format in message/attachments envelope (NOT deprecated MessageCard)"
  - "[06-02]: SlackAdapter requires top-level text fallback field alongside blocks (Slack API requirement)"
  - "[06-02]: SystemAdapter uses createRequire(import.meta.url) for CJS node-notifier in ESM project"
  - "[06-02]: loadCustomAdapter resolves paths relative to process.cwd() (not import.meta.url)"
  - "[06-02]: loadCustomAdapter validates init/send/close methods before returning adapter"
patterns-established:
  - "fetch POST pattern: all HTTP adapters use Node.js built-in fetch, throw on !response.ok"
  - "Optional dependency pattern: node-notifier loaded via createRequire, init() throws if not installed (graceful removal via NotificationManager)"
  - "Dynamic import pattern: user paths resolved via resolve()+pathToFileURL() before import()"
metrics:
  duration: "2min"
  completed: "2026-02-18"
  tasks_completed: 2
  files_changed: 9
  tests_added: 29
---

# Phase 6 Plan 02: Remote Notification Adapters Summary

**Four notification adapters added: Teams Adaptive Cards, Slack Block Kit, raw webhook POST, and OS-native toast via node-notifier with createRequire ESM workaround -- plus a dynamic custom adapter loader and example file.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-18T21:08:51Z
- **Completed:** 2026-02-18T21:11:44Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- TeamsAdapter POSTs Adaptive Card JSON to Teams Workflows webhooks (link-only, no action buttons)
- SlackAdapter POSTs Block Kit with required top-level `text` fallback field
- CustomWebhookAdapter POSTs raw Notification JSON with no transformation
- SystemAdapter wraps node-notifier via `createRequire` for ESM+CJS compatibility
- `loadCustomAdapter` dynamically imports from user-provided file path with method validation
- `example-adapter.js` ships as a self-documenting copyable starting point

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Teams, Slack, and Webhook adapters with tests** - `575a457` (feat)
2. **Task 2: Create SystemAdapter, custom adapter loader, and example-adapter.js** - `ed522e7` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `autopilot/src/notifications/adapters/teams.ts` - TeamsAdapter with Adaptive Card format
- `autopilot/src/notifications/adapters/slack.ts` - SlackAdapter with Block Kit format
- `autopilot/src/notifications/adapters/webhook.ts` - CustomWebhookAdapter with raw JSON POST
- `autopilot/src/notifications/adapters/system.ts` - SystemAdapter via node-notifier + createRequire
- `autopilot/src/notifications/loader.ts` - loadCustomAdapter with dynamic import and validation
- `autopilot/src/notifications/__tests__/teams.test.ts` - 7 tests for TeamsAdapter
- `autopilot/src/notifications/__tests__/slack.test.ts` - 8 tests for SlackAdapter
- `autopilot/src/notifications/__tests__/adapters.test.ts` - 14 tests (SystemAdapter, loadCustomAdapter, CustomWebhookAdapter)
- `autopilot/example-adapter.js` - Copyable example adapter for users

## Decisions Made

- **Teams format**: Adaptive Card in `message/attachments` envelope -- Teams Workflows connector accepts this format (MessageCard is deprecated)
- **Slack fallback text**: Top-level `text` field is required by Slack API for notifications and message unfurling -- included alongside blocks
- **SystemAdapter**: node-notifier is CJS-only; ESM projects must use `createRequire(import.meta.url)` to load it. If not installed, `init()` throws and NotificationManager silently removes it (per Plan 01 design)
- **loadCustomAdapter**: Paths resolved relative to `process.cwd()` (where user runs the CLI), not `import.meta.url` (where the loader code lives)
- **Adapter validation**: All three methods (init/send/close) validated before returning to fail fast with a clear error message

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required at this stage. Teams/Slack webhook URLs will be wired through config in a later plan.

## Next Phase Readiness

- All 5 adapter classes importable (ConsoleAdapter from Plan 01, plus 4 new ones)
- loadCustomAdapter ready for CLI --adapter-path flag wiring
- example-adapter.js ready to ship alongside dist/
- Plan 03 needs to add node-notifier as optional dependency in package.json
- Total notification tests: 62 passing across 5 test files

---
*Phase: 06-notification-system*
*Completed: 2026-02-18*

## Self-Check: PASSED

All files confirmed present:
- FOUND: autopilot/src/notifications/adapters/teams.ts
- FOUND: autopilot/src/notifications/adapters/slack.ts
- FOUND: autopilot/src/notifications/adapters/webhook.ts
- FOUND: autopilot/src/notifications/adapters/system.ts
- FOUND: autopilot/src/notifications/loader.ts
- FOUND: autopilot/src/notifications/__tests__/teams.test.ts
- FOUND: autopilot/src/notifications/__tests__/slack.test.ts
- FOUND: autopilot/src/notifications/__tests__/adapters.test.ts
- FOUND: autopilot/example-adapter.js
- FOUND: .planning/phases/06-notification-system/06-02-SUMMARY.md

All commits confirmed present:
- FOUND: 575a457 (feat(06-02): add Teams, Slack, and Webhook adapters with tests)
- FOUND: ed522e7 (feat(06-02): add SystemAdapter, custom adapter loader, and example-adapter.js)
