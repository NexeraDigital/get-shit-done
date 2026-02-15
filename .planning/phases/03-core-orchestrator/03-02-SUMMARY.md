---
phase: 03-core-orchestrator
plan: 02
subsystem: orchestrator
tags: [tdd, discuss-handler, gap-detector, phase-range, context-md, vitest]

# Dependency graph
requires:
  - phase: 01-foundation-and-types
    provides: PhaseState and AutopilotConfig types
provides:
  - generateSkipDiscussContext function for DISC-04 skip-discuss flow
  - writeSkipDiscussContext for writing CONTEXT.md to phase directories
  - checkForGaps function for ORCH-05 gap detection loop
  - parsePhaseRange function for CLI-09 --phases flag
  - findPhaseDir function for locating phase directories by number
affects: [03-core-orchestrator, 07-cli-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.useFakeTimers() for Date mocking in vitest"
    - "ENOENT error handling with type guard for filesystem operations"
    - "Phase slug derivation: lowercase, hyphen-separated, zero-padded number prefix"

key-files:
  created:
    - autopilot/src/orchestrator/discuss-handler.ts
    - autopilot/src/orchestrator/gap-detector.ts
    - autopilot/src/orchestrator/__tests__/discuss-handler.test.ts
    - autopilot/src/orchestrator/__tests__/gap-detector.test.ts
  modified: []

key-decisions:
  - "Pure functions with separate I/O wrappers -- generateSkipDiscussContext is pure, writeSkipDiscussContext adds filesystem I/O"
  - "ENOENT means passed -- missing verification/UAT files assume the phase passed, avoiding false gap detection"
  - "Regex-based parsePhaseRange for CLI --phases flag with strict validation"

patterns-established:
  - "Phase slug: padStart(2, '0') + slugified name (lowercase, hyphens)"
  - "Filesystem error handling: isEnoent type guard with code property check"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 3 Plan 2: Discuss-Phase Handler and Gap Detector Summary

**TDD-driven discuss-handler (generateSkipDiscussContext) and gap-detector (checkForGaps, parsePhaseRange, findPhaseDir) utilities for orchestrator integration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T17:18:59Z
- **Completed:** 2026-02-15T17:22:50Z
- **Tasks:** 2 features (4 TDD commits: 2 RED + 2 GREEN)
- **Files created:** 4

## Accomplishments
- Discuss-handler generates valid CONTEXT.md with Claude's Discretion sections when --skip-discuss is set (DISC-04)
- Gap detector checks VERIFICATION.md and UAT.md for gap/failure indicators (ORCH-05)
- Phase range parser handles "N" and "N-M" formats with full validation (CLI-09)
- findPhaseDir locates phase directories by zero-padded number prefix
- All 29 tests passing (12 discuss-handler + 17 gap-detector)

## Task Commits

Each feature followed TDD RED-GREEN cycle:

1. **Feature 1 RED: Discuss-handler tests** - `f6e8360` (test)
2. **Feature 1 GREEN: Discuss-handler implementation** - `2a9079b` (feat)
3. **Feature 2 RED: Gap-detector tests** - `7d45a9a` (test)
4. **Feature 2 GREEN: Gap-detector implementation** - `e6a69d1` (feat)

## Files Created/Modified
- `autopilot/src/orchestrator/discuss-handler.ts` - generateSkipDiscussContext (pure), writeSkipDiscussContext (I/O), PhaseInfo interface, slugify/padPhase helpers
- `autopilot/src/orchestrator/gap-detector.ts` - checkForGaps (reads verification files), parsePhaseRange (CLI flag parsing), findPhaseDir (directory lookup)
- `autopilot/src/orchestrator/__tests__/discuss-handler.test.ts` - 12 tests: title, date, sections, slug, padding, file writing
- `autopilot/src/orchestrator/__tests__/gap-detector.test.ts` - 17 tests: gap indicators, pass indicators, ENOENT, range parsing, directory lookup

## Decisions Made
- Used vi.useFakeTimers() instead of vi.spyOn(Date) for reliable date mocking -- spyOn approach breaks constructor calls
- Pure function separation: generateSkipDiscussContext returns string (testable without mocks), writeSkipDiscussContext adds I/O layer
- ENOENT handling assumes passed -- if no verification file exists, the phase is treated as having passed (prevents false positives from missing files)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both modules ready for integration into the Orchestrator class (Plan 03)
- Exports: generateSkipDiscussContext, writeSkipDiscussContext, checkForGaps, parsePhaseRange, findPhaseDir
- Ready for Plan 03-03: Orchestrator core class with phase lifecycle loop

## Self-Check: PASSED

- All 4 created files verified on disk
- All 4 commit hashes verified in git log
- 29/29 tests passing
- Build and typecheck clean

---
*Phase: 03-core-orchestrator*
*Completed: 2026-02-15*
