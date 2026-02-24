---
phase: 08-autopilot-should-be-able-to-be-executed-by-using-a-claude-command
plan: 01
subsystem: infra
tags: [port-management, hashing, collision-detection, state-persistence, multi-instance]

# Dependency graph
requires:
  - phase: 07-cli-polish-and-distribution
    provides: CLI infrastructure and package distribution foundation
provides:
  - Deterministic branch-to-port mapping with SHA-256 hashing
  - Port collision detection with linear probing
  - State persistence in autopilot-state.json for port reuse
  - Port availability checking with net.createServer
affects: [08-02-pid-manager, 08-03-skill-md, launcher-script]

# Tech tracking
tech-stack:
  added: [node:crypto, node:net, node:test]
  patterns: [deterministic-hashing, linear-probing, state-persistence, pure-esm-testing]

key-files:
  created:
    - autopilot/workflows/gsd-autopilot/port-manager.js
    - autopilot/workflows/gsd-autopilot/__tests__/port-manager.test.js
  modified: []

key-decisions:
  - "SHA-256 hash for deterministic port assignment (first 8 hex chars modulo 1000)"
  - "Port range 3847-4846 (base 3847 + hash % 1000) for 1000 available ports"
  - "Linear probing for collision resolution (increment until free port found)"
  - "Reuse persisted port if still available, otherwise fall back to hash"
  - "Node.js built-in test runner (node:test) instead of vitest for standalone .js module"
  - "Plain JavaScript (not TypeScript) since module runs from ~/.claude/skills/ outside build pipeline"

patterns-established:
  - "TDD workflow: RED (failing test) → GREEN (implementation) → REFACTOR (cleanup)"
  - "Pure ESM modules with node: protocol imports for built-in modules"
  - "State file schema: branches[branchName] = { port, assignedAt }"
  - "Port availability check: net.createServer().listen() with error handling"

# Metrics
duration: 8min
completed: 2026-02-23
---

# Phase 08 Plan 01: Port Manager Summary

**Deterministic branch-to-port hashing with SHA-256, collision detection via linear probing, and state persistence for multi-instance autopilot support**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-24T00:31:54Z
- **Completed:** 2026-02-24T00:39:54Z
- **Tasks:** 1 (TDD task with 2 commits: test + feat)
- **Files modified:** 2

## Accomplishments
- Pure function `branchToPort()` deterministically maps branch names to ports using SHA-256 hash
- Async `isPortAvailable()` checks port binding with net.createServer
- Main `assignPort()` function reuses persisted ports when available, falls back to hash with collision detection
- Complete test coverage with 13 passing tests using Node.js built-in test runner
- State persistence in `.planning/autopilot-state.json` with per-branch port metadata

## Task Commits

Each task was committed atomically (TDD workflow):

1. **Task 1 (RED): Write failing tests** - `d354a07` (test)
2. **Task 1 (GREEN): Implement port manager** - `1ca07d4` (feat)

_Note: TDD task completed in 2 commits (RED → GREEN). No refactoring needed._

## Files Created/Modified
- `autopilot/workflows/gsd-autopilot/port-manager.js` - Port manager module with branchToPort, isPortAvailable, assignPort
- `autopilot/workflows/gsd-autopilot/__tests__/port-manager.test.js` - Test suite with 13 tests covering determinism, collision, persistence

## Decisions Made

**SHA-256 hash algorithm:** Chosen over murmurhash/xxhash because crypto.createHash is built-in, deterministic, and sufficient for non-cryptographic use case. Research confirmed this is standard for branch-to-port mapping patterns.

**Port range [3847, 4846]:** Base port 3847 (autopilot default) + 1000 range provides sufficient capacity for multi-instance scenarios. Linear probing handles collisions by incrementing until free port found.

**State persistence schema:** Extended AutopilotState type with `branches[branchName] = { port, assignedAt }`. Reuses persisted port if available, falls back to hash + collision detection if port taken.

**Node.js built-in test runner:** Used node:test instead of vitest because this is a standalone .js module that runs from `~/.claude/skills/` outside the TypeScript build pipeline. No extra dependencies needed.

**Plain JavaScript (not TypeScript):** Module must run directly from `~/.claude/skills/` via SKILL.md launcher without compilation. ESM with JSDoc comments provides type hints without build step.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Test setup bug:** Initial test run failed for "assigns new port when persisted port is unavailable" because test didn't create `.planning/` directory before writing state file. Fixed by adding `mkdir(planningDir, { recursive: true })` in test setup. This was a test issue, not an implementation bug.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Port manager foundation complete and ready for Plan 02 (PID manager and launcher script). Key integration points:

- **For launcher.js:** Call `assignPort(branch, projectDir)` to get stable port before spawning autopilot process
- **For status command:** Read port from state file `branches[branch].port` to construct dashboard URL
- **For SKILL.md:** Pass assigned port to `npx gsd-autopilot --port {port}` command

All exported functions (`branchToPort`, `isPortAvailable`, `assignPort`) are tested and verified working. State file schema is established and documented.

## Self-Check: PASSED

All claims verified:
- ✓ `autopilot/workflows/gsd-autopilot/port-manager.js` exists
- ✓ `autopilot/workflows/gsd-autopilot/__tests__/port-manager.test.js` exists
- ✓ Commit d354a07 (test) exists
- ✓ Commit 1ca07d4 (feat) exists

---
*Phase: 08-autopilot-should-be-able-to-be-executed-by-using-a-claude-command*
*Completed: 2026-02-23*
