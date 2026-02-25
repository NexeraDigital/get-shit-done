---
phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access
plan: "02"
subsystem: infra
tags: [dev-tunnels, microsoft, state-management, cli, server]

# Dependency graph
requires:
  - phase: 11-01
    provides: TunnelManager class with lifecycle management
provides:
  - tunnelUrl field in AutopilotState for cross-tool access
  - CLI --no-tunnel flag for local-only mode
  - Automatic tunnel startup with graceful degradation
  - ShutdownManager integration for clean tunnel teardown
affects: [dashboard, state-management, cli-commands]

# Tech tracking
tech-stack:
  added: []
  patterns: [state-persistence, graceful-degradation, LIFO-shutdown]

key-files:
  created: []
  modified:
    - autopilot/src/types/state.ts
    - autopilot/src/state/index.ts
    - autopilot/src/cli/index.ts
    - autopilot/src/server/standalone.ts

key-decisions:
  - "tunnelUrl stored in AutopilotState for persistence across restarts"
  - "Tunnel enabled by default in CLI, explicit opt-out with --no-tunnel"
  - "Tunnel failure is non-fatal - dashboard works locally with warning"
  - "Tunnel cleanup registered in ShutdownManager LIFO order (runs before server shutdown)"
  - "Standalone server checks env vars (DEVTUNNEL_TOKEN/AAD_TOKEN) to auto-enable tunnel"

patterns-established:
  - "State field addition: TypeScript interface + Zod schema in sync"
  - "Graceful degradation: try tunnel → catch → warn → continue with localhost"
  - "LIFO shutdown ordering: tunnel cleanup before server close"

# Metrics
duration: 2min
completed: 2026-02-25
---

# Phase 11 Plan 02: Wire Tunnel Lifecycle Summary

**Tunnel URL persistence, CLI integration, and graceful degradation complete - tunnels start automatically, save URL to state, clean up properly, and fail gracefully**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-25T17:51:10Z
- **Completed:** 2026-02-25T17:54:02Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added tunnelUrl field to AutopilotState type and Zod schema for persistence
- Integrated TunnelManager into CLI with --no-tunnel flag and automatic startup
- Added tunnel support to standalone dashboard server with env var detection
- Implemented graceful degradation on tunnel failure (warns but continues locally)
- Registered tunnel cleanup with ShutdownManager in LIFO order

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tunnelUrl field to AutopilotState types and StateStore** - `eee375e` (feat)
2. **Task 2: Integrate TunnelManager into CLI with --no-tunnel flag and ShutdownManager cleanup** - `7e0342d` (feat)
3. **Task 3: Add tunnel support to standalone dashboard server** - `44a7731` (feat)

**Plan metadata:** (committed separately after SUMMARY creation)

## Files Created/Modified

- `autopilot/src/types/state.ts` - Added tunnelUrl?: string to AutopilotState interface
- `autopilot/src/state/index.ts` - Added tunnelUrl: z.string().optional() to Zod schema
- `autopilot/src/cli/index.ts` - Imported TunnelManager, added --no-tunnel flag, wired lifecycle with state persistence and ShutdownManager cleanup
- `autopilot/src/server/standalone.ts` - Imported TunnelManager, added env var detection, wired lifecycle with SIGINT/SIGTERM cleanup

## Decisions Made

**State persistence:** tunnelUrl stored in AutopilotState so any tool can read the current tunnel URL from state.json without requiring direct access to TunnelManager instance.

**Default behavior:** Tunnel enabled by default for best remote access experience. Users can opt out with --no-tunnel for local-only mode.

**Graceful degradation:** Tunnel creation failure logs a warning but allows server to start locally. This prevents dev-tunnel issues from blocking local dashboard access.

**Shutdown ordering:** Tunnel cleanup registered after server cleanup in ShutdownManager, so LIFO execution order ensures tunnel stops before server closes.

**Standalone mode:** Checks DEVTUNNEL_TOKEN/AAD_TOKEN env vars to auto-enable tunnel when credentials are available, respects NO_TUNNEL=true to disable.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled cleanly, all verification checks passed.

## User Setup Required

External services require manual configuration. See [11-USER-SETUP.md](./11-USER-SETUP.md) for:
- Environment variables to add (DEVTUNNEL_TOKEN)
- Azure CLI configuration steps
- Verification commands

## Next Phase Readiness

Plan 11-02 complete. Ready for Plan 11-03 (create USER-SETUP documentation and finalize phase).

## Self-Check: PASSED

All files verified:
- FOUND: autopilot/src/types/state.ts
- FOUND: autopilot/src/state/index.ts
- FOUND: autopilot/src/cli/index.ts
- FOUND: autopilot/src/server/standalone.ts

All commits verified:
- FOUND: eee375e
- FOUND: 7e0342d
- FOUND: 44a7731

---
*Phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access*
*Completed: 2026-02-25*
