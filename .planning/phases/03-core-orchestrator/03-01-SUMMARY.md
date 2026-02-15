---
phase: 03-core-orchestrator
plan: 01
subsystem: orchestrator
tags: [shutdown, sigint, sigterm, graceful-shutdown, yolo-config, config-merge]

# Dependency graph
requires:
  - phase: 01-foundation-and-types
    provides: AutopilotConfig type with depth/model/skipVerify fields
provides:
  - ShutdownManager class for graceful Ctrl+C handling with LIFO cleanup
  - writeYoloConfig function for autonomous GSD execution config generation
affects: [03-core-orchestrator plan 03 (orchestrator integration), 03-core-orchestrator plan 04 (CLI entry point)]

# Tech tracking
tech-stack:
  added: []
  patterns: [injectable-exit-function, config-merge-preserving-user-settings, LIFO-cleanup-ordering]

key-files:
  created:
    - autopilot/src/orchestrator/shutdown.ts
    - autopilot/src/orchestrator/yolo-config.ts
    - autopilot/src/orchestrator/__tests__/shutdown.test.ts
    - autopilot/src/orchestrator/__tests__/yolo-config.test.ts

key-decisions:
  - "Injectable exit function in ShutdownManager.install() for testability (default: process.exit)"
  - "YOLO config uses spread merge ({...existing, ...yoloSettings}) preserving user keys not in override set"
  - "Invalid JSON in existing config.json treated as empty object (YOLO settings take priority)"

patterns-established:
  - "Injectable dependencies for process-level operations (exit, signals) enabling test isolation"
  - "Config merge pattern: existing user settings preserved, only orchestrator-controlled keys overridden"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 3 Plan 1: Shutdown & YOLO Config Summary

**ShutdownManager with LIFO cleanup and SIGINT/SIGTERM trapping plus writeYoloConfig with existing-config-preserving merge**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T17:18:45Z
- **Completed:** 2026-02-15T17:21:28Z
- **Tasks:** 4 (2 TDD RED + 2 TDD GREEN)
- **Files created:** 4

## Accomplishments
- ShutdownManager traps SIGINT/SIGTERM with double-shutdown guard, runs cleanup handlers in LIFO order with best-effort error handling
- writeYoloConfig reads existing .planning/config.json, merges YOLO overrides while preserving user settings (branching_strategy, commit_docs, git templates)
- 20 tests total (10 shutdown + 10 yolo-config), all passing
- Both modules are pure utilities with zero dependency on the Orchestrator class

## Task Commits

Each task was committed atomically:

1. **TDD RED: ShutdownManager tests** - `0b101ad` (test)
2. **TDD GREEN: ShutdownManager implementation** - `bd6ae47` (feat)
3. **TDD RED: writeYoloConfig tests** - `8928b78` (test)
4. **TDD GREEN: writeYoloConfig implementation** - `da4a3ab` (feat)

_Note: TDD tasks have separate RED/GREEN commits per feature_

## Files Created/Modified
- `autopilot/src/orchestrator/shutdown.ts` - ShutdownManager class: SIGINT/SIGTERM signal trapping, LIFO cleanup, double-shutdown guard, injectable exit function
- `autopilot/src/orchestrator/yolo-config.ts` - writeYoloConfig function: reads existing config, merges YOLO overrides, preserves user settings, creates .planning/ directory
- `autopilot/src/orchestrator/__tests__/shutdown.test.ts` - 10 tests: register, install, LIFO order, error resilience, double-shutdown, isShuttingDown, uninstall, exit function, SIGTERM
- `autopilot/src/orchestrator/__tests__/yolo-config.test.ts` - 10 tests: fresh config, skipVerify variants, setting preservation, invalid JSON, directory creation, formatting, override priority

## Decisions Made
- **Injectable exit function:** ShutdownManager.install() accepts optional exitFn parameter (defaults to process.exit) to avoid calling process.exit in tests while keeping production behavior unchanged
- **Spread merge for config:** Uses `{...existing, ...yoloSettings}` so user-owned keys (branching_strategy, commit_docs, search_gitignored, git templates) that are NOT in the YOLO override set are naturally preserved
- **Invalid JSON as empty object:** When existing config.json contains invalid JSON, it is treated as an empty object rather than throwing -- YOLO settings take full priority, no crash on corrupted config

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ShutdownManager ready for integration into Orchestrator class (Plan 03) via `shutdown.register()` and `shutdown.install()`
- writeYoloConfig ready for use in CLI entry point (Plan 04) during initialization before first GSD command
- Both modules export cleanly and compile without errors

## Self-Check: PASSED

- All 4 source files verified present on disk
- All 4 commit hashes verified in git log (0b101ad, bd6ae47, 8928b78, da4a3ab)
- 20/20 tests passing
- TypeScript build and typecheck clean
