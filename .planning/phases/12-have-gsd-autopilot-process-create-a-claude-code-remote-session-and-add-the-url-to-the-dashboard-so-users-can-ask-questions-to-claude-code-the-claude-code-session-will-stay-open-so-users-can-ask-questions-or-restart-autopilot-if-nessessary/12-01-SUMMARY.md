---
phase: 12-claude-code-remote-session
plan: 01
subsystem: remote-session
tags: [backend, process-management, lifecycle, state]
dependency_graph:
  requires:
    - tunnel-manager
    - state-store
    - shutdown-manager
  provides:
    - remote-session-manager
    - remote-session-url-state
  affects:
    - cli-startup-flow
    - autopilot-state-schema
tech_stack:
  added:
    - node:child_process spawn API
    - node:readline for stdout parsing
  patterns:
    - child process lifecycle management
    - graceful shutdown (SIGTERM -> SIGKILL)
    - URL pattern matching from stdout
    - optional feature with graceful degradation
key_files:
  created:
    - autopilot/src/server/remote-session/manager.ts
    - autopilot/src/server/remote-session/index.ts
  modified:
    - autopilot/src/types/state.ts
    - autopilot/src/state/index.ts
    - autopilot/src/cli/index.ts
decisions:
  - RemoteSessionManager follows TunnelManager pattern for consistency
  - Remote session spawned with project directory as cwd (matches autopilot working dir)
  - 30-second timeout for URL detection (per research recommendation)
  - No auto-restart on process death - log warning only (per research)
  - SIGTERM -> 5s wait -> SIGKILL shutdown pattern (matches TunnelManager)
  - Graceful degradation - autopilot continues without remote session on failure
  - CLI flag --no-remote for opt-out (enabled by default like --no-tunnel)
metrics:
  duration: 3min
  tasks_completed: 2
  files_created: 2
  files_modified: 3
  commits: 2
  completed_at: 2026-02-26T18:15:00Z
---

# Phase 12 Plan 01: Remote Session Manager Summary

**One-liner:** Claude Code remote session integration with `claude remote-control` process management, stdout URL parsing, and graceful lifecycle handling.

## What Was Built

### RemoteSessionManager Class (`autopilot/src/server/remote-session/manager.ts`)

Created a process manager for `claude remote-control` that:

1. **Process Spawning**: Spawns `claude remote-control` as a child process with:
   - Project directory as working directory (matches autopilot context)
   - Shell mode on Windows for `.cmd` resolution from PATH
   - Piped stdout/stderr for monitoring, ignored stdin

2. **URL Capture**: Parses stdout line-by-line using `readline` interface:
   - Matches pattern: `https://claude.ai/code/sessions/[a-zA-Z0-9_-]+`
   - 30-second timeout with `.unref()` to not block Node.js exit
   - Calls `onUrlDetected` callback when URL found
   - Resolves promise with URL once captured

3. **Error Handling**:
   - Spawn errors (command not found) reject the promise
   - Early process exit before URL captured rejects with descriptive error
   - Post-capture exit monitoring logs warnings but doesn't fail
   - No auto-restart (per research: avoid restart loops)

4. **Graceful Shutdown**: Implements stop() method with:
   - SIGTERM sent to process
   - 5-second grace period for graceful exit
   - SIGKILL if still running after timeout
   - Safe to call multiple times (null checks)
   - Windows-compatible (process.kill sends equivalent via taskkill)

5. **URL Getter**: Exposes `get url(): string | null` for current session URL

### State Type Extensions

Extended `AutopilotState` interface and Zod schema with:
- `remoteSessionUrl?: string` field in `types/state.ts`
- Corresponding Zod validation in `state/index.ts`
- Placed after `tunnelUrl` field for logical grouping

### CLI Integration (`autopilot/src/cli/index.ts`)

Wired RemoteSessionManager into CLI startup flow:

1. **CLI Flag**: Added `--no-remote` option to disable remote session
2. **Lifecycle Position**: Remote session starts AFTER tunnel setup (tunnel first, then remote)
3. **Graceful Degradation**: Try/catch around `remoteSessionManager.start()`:
   - Success: Store URL in state, print to console, register shutdown cleanup
   - Failure: Log warning, print helpful instructions, continue without remote session
4. **Terminal Banner**: Prints `Claude remote session: <url>` on successful startup
5. **ShutdownManager**: Registers cleanup handler before tunnel cleanup (LIFO ordering)
6. **Opt-out**: `--no-remote` flag skips startup and clears state field

## Deviations from Plan

None - plan executed exactly as written.

## Testing & Verification

All verification criteria met:
- ✅ TypeScript compiles without errors (`npx tsc --noEmit`)
- ✅ `remoteSessionUrl` field exists in AutopilotState interface and Zod schema
- ✅ RemoteSessionManager has `start()`, `stop()`, and `url` getter methods
- ✅ CLI `--help` shows `--no-remote` flag
- ✅ CLI code contains graceful degradation try/catch for remote session startup
- ✅ ShutdownManager cleanup registered for process termination

All success criteria met:
- ✅ RemoteSessionManager spawns `claude remote-control`, parses URL, manages lifecycle
- ✅ AutopilotState extended with optional `remoteSessionUrl` field
- ✅ CLI starts remote session on startup (unless --no-remote), stores in state, prints in terminal
- ✅ Graceful degradation on failure (autopilot continues with warning)
- ✅ Process cleanup uses SIGTERM -> 5s -> SIGKILL pattern

## Architecture Notes

**Pattern Consistency**: RemoteSessionManager mirrors TunnelManager's architecture:
- Same options interface structure (logger, callbacks)
- Same lifecycle methods (start/stop/url getter)
- Same graceful degradation approach
- Same ShutdownManager integration pattern

**Ordering**: Remote session lifecycle block placed AFTER tunnel block in CLI:
- Tunnel creates public access to dashboard
- Remote session creates interactive Claude Code access
- Both independent, both optional, both gracefully degrade

**State Persistence**: `remoteSessionUrl` stored in AutopilotState for:
- Cross-session persistence (survives autopilot restart)
- Dashboard access via API endpoint
- Notification inclusion (future: link in notifications)

**Windows Compatibility**: Shell mode (`shell: true`) required on Windows for `claude` command resolution since it's a `.cmd` file, not a native executable.

## Implementation Details

**URL Detection Timeout**: 30-second timeout chosen per research:
- Typical startup: URL appears within 5-10 seconds
- Network delays: up to 20 seconds
- 30 seconds provides buffer without excessive wait
- Uses `.unref()` to not block Node.js exit

**No Auto-Restart**: Process death after URL capture only logs warning:
- Avoids restart loops if Claude CLI has persistent issues
- User can see warning and decide to fix/restart manually
- Dashboard shows last known URL (may be stale)

**SIGTERM -> SIGKILL Pattern**: Matches TunnelManager for consistency:
- SIGTERM gives process chance to cleanup
- 5-second grace period is generous (most processes exit quickly)
- SIGKILL ensures process terminates (no zombie processes)

## Commits

| Hash    | Message                                                     |
| ------- | ----------------------------------------------------------- |
| c343a88 | feat(12-01): create RemoteSessionManager and extend state types |
| 2225dab | feat(12-01): wire RemoteSessionManager into CLI with --no-remote flag |

## Self-Check: PASSED

**Created files exist:**
- ✅ FOUND: autopilot/src/server/remote-session/manager.ts
- ✅ FOUND: autopilot/src/server/remote-session/index.ts

**Modified files contain expected changes:**
- ✅ FOUND: remoteSessionUrl in autopilot/src/types/state.ts
- ✅ FOUND: remoteSessionUrl in autopilot/src/state/index.ts
- ✅ FOUND: RemoteSessionManager import in autopilot/src/cli/index.ts
- ✅ FOUND: --no-remote flag in autopilot/src/cli/index.ts

**Commits exist:**
- ✅ FOUND: c343a88 (Task 1)
- ✅ FOUND: 2225dab (Task 2)
