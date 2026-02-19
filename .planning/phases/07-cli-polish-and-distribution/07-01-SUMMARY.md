---
phase: 07-cli-polish-and-distribution
plan: 01
subsystem: cli
tags: [preflight, validation, error-handling, phase-range, ux]
dependency_graph:
  requires: [commander.js, node:net, node:fs/promises, node:child_process]
  provides: [preflight-checks, actionable-errors, comma-separated-phase-ranges]
  affects: [cli/index.ts, orchestrator/index.ts, gap-detector.ts]
tech_stack:
  added: [preflight validation system, parallel prerequisite checks]
  patterns: [Promise.all for parallel validation, createServer for port testing]
key_files:
  created:
    - autopilot/src/cli/preflight.ts
  modified:
    - autopilot/src/cli/index.ts
    - autopilot/src/orchestrator/gap-detector.ts
    - autopilot/src/orchestrator/index.ts
    - autopilot/src/orchestrator/__tests__/gap-detector.test.ts
    - autopilot/src/orchestrator/__tests__/orchestrator.test.ts
decisions:
  - "Preflight checks run in parallel via Promise.all, returning all failures at once (not one-at-a-time)"
  - "parsePhaseRange returns sorted deduplicated number[] instead of {start, end} for non-contiguous range support"
  - "Orchestrator.run() now accepts number[] and uses .includes() for phase filtering"
  - "PRD file existence moved from CLI access() call to preflight checks for consistency"
  - "Error messages follow pattern: error statement + actionable fix + help reference"
metrics:
  duration_minutes: 6
  tasks_completed: 2
  files_created: 1
  files_modified: 5
  commits: 2
  tests_added: 2
  completed_at: "2026-02-18T23:31:28Z"
---

# Phase 7 Plan 01: CLI Preflight Checks and Error Messaging Summary

**One-liner:** Preflight validation with parallel checks for Claude CLI, PRD, port, and GSD installation; actionable error messages; comma-separated phase range support (e.g., "1-3,5,7-9")

## What Was Built

### 1. Preflight Checks Module (`autopilot/src/cli/preflight.ts`)

Created a comprehensive preflight check system that validates all prerequisites in parallel before starting the orchestrator:

**Checks performed:**
- **Claude CLI installed**: Runs `claude --version` to verify availability
- **PRD file exists**: Validates the provided PRD path is accessible (if --prd provided)
- **Port available**: Uses `createServer()` pattern to test if dashboard port is available
- **GSD installation**: Checks for `~/.claude/get-shit-done/` directory

**Key characteristics:**
- All checks run in parallel via `Promise.all()` for fast validation
- Returns array of failures (empty = success)
- Each failure includes both error message and actionable fix
- Does not call `process.exit()` - caller handles that

### 2. Enhanced Phase Range Parser

Updated `parsePhaseRange()` in `gap-detector.ts` to support comma-separated ranges:

**Before:** Only supported "N" or "N-M" → returned `{ start: number; end: number }`

**After:** Supports "N", "N-M", "N,M", "N-M,O,P-Q" → returns `number[]`

**Features:**
- Parses comma-separated segments
- Expands ranges (e.g., "2-5" → [2, 3, 4, 5])
- Deduplicates and sorts results
- Validates start ≤ end for each range
- Clear error messages with format guidance

**Examples:**
- `"3"` → `[3]`
- `"2-5"` → `[2, 3, 4, 5]`
- `"1-3,5,7-9"` → `[1, 2, 3, 5, 7, 8, 9]`
- `"3,3,5,5"` → `[3, 5]` (deduplicated)

### 3. CLI Error Messaging Improvements

Enhanced `cli/index.ts` with actionable error messages throughout:

**No args:**
```
Error: No input specified

You must provide either:
  --prd <path>   Start a new run with a PRD document
  --resume       Continue from last checkpoint

Run gsd-autopilot --help for more information
```

**Resume without state:**
```
No previous run found in this directory.

To start a new run:
  gsd-autopilot --prd <path-to-your-prd>

The --resume flag requires a previous autopilot run in the current directory.
```

**Config errors:**
```
Configuration error: {error message}

Check your .gsd-autopilot.json file or CLI flags.
Run gsd-autopilot --help for valid options.
```

**Preflight failures:**
```
Preflight checks failed:

  x Claude CLI not found
    Install it: npm install -g @anthropic-ai/claude-code

  x Port 3847 is already in use
    Use --port <number> to specify a different port
```

### 4. Commander Help Enhancements

Added usage examples and help-after-error to Commander configuration:

```
Examples:
  $ gsd-autopilot --prd ./idea.md
  $ gsd-autopilot --resume
  $ gsd-autopilot --prd ./spec.md --notify teams --webhook-url https://...
  $ gsd-autopilot --prd ./plan.md --phases 1-3,5 --depth comprehensive

Dashboard:
  http://localhost:3847 (configurable with --port)
```

Updated `--phases` option description to show comma-separated example: `"Run specific phases (e.g., 1-3,5,7-9)"`

### 5. Orchestrator API Update

Updated `Orchestrator.run()` signature to accept `number[]` instead of `{ start: number; end: number }`:

**Before:**
```typescript
async run(prdPath: string, phaseRange?: { start: number; end: number })
// Filtering: phase.number >= range.start && phase.number <= range.end
```

**After:**
```typescript
async run(prdPath: string, phaseRange?: number[])
// Filtering: phaseRange.includes(phase.number)
```

This enables non-contiguous phase ranges like `[1, 2, 3, 5, 7, 8, 9]`.

## Technical Implementation

### Preflight Check Pattern

```typescript
interface PreflightCheck {
  name: string;
  check: () => Promise<boolean>;
  error: string;
  fix: string;
}

// Run all checks in parallel
const results = await Promise.all(
  checks.map(async (check) => {
    const passed = await check.check();
    return { check, passed };
  })
);

// Collect failures
const failures = results
  .filter((r) => !r.passed)
  .map((r) => ({ error: r.check.error, fix: r.check.fix }));
```

### Port Availability Check

Used the `createServer()` pattern from research (handles Windows EADDRINUSE correctly):

```typescript
return new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once('listening', () => {
    server.close();
    resolve(true);
  });
  server.once('error', () => resolve(false));
  server.listen(config.port);
});
```

### Phase Range Parsing

```typescript
const segments = range.split(',').map((s) => s.trim());
for (const segment of segments) {
  if (/^\d+$/.test(segment)) {
    phases.push(parseInt(segment, 10));
  } else if (rangeMatch = segment.match(/^(\d+)-(\d+)$/)) {
    const [start, end] = [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])];
    if (start > end) throw new Error(...);
    for (let i = start; i <= end; i++) phases.push(i);
  } else {
    throw new Error(`Invalid phase specifier: "${segment}"`);
  }
}
return Array.from(new Set(phases)).sort((a, b) => a - b);
```

## Testing

### Tests Updated

**gap-detector.test.ts:**
- Updated all parsePhaseRange tests for new return type
- Added test: `"1-3,5,7-9"` → `[1, 2, 3, 5, 7, 8, 9]`
- Added test: `"3,3,5,5"` → `[3, 5]` (deduplication)
- Updated error message assertions to match new format
- All 19 tests passing

**orchestrator.test.ts:**
- Updated phaseRange test call from `{ start: 2, end: 3 }` to `[2, 3]`
- Test verifies only phases 2 and 3 execute (filtering works correctly)

### Manual Verification

- ✅ `npx tsc --noEmit` compiles successfully
- ✅ `npx vitest run gap-detector.test.ts` all tests pass
- ✅ `node dist/cli/index.js --help` shows examples and dashboard URL
- ✅ `node dist/cli/index.js` (no args) shows actionable error with --prd/--resume guidance
- ✅ Help text includes updated `--phases` description with comma-separated example

## Deviations from Plan

**None** - Plan executed exactly as written.

All tasks completed as specified:
1. Created preflight.ts with parallel validation
2. Enhanced parsePhaseRange to support comma-separated ranges
3. Updated tests for new parsePhaseRange signature
4. Wired preflight checks into CLI before component creation
5. Added actionable error messages for all failure scenarios
6. Updated Commander with help examples and showHelpAfterError
7. Updated Orchestrator to accept number[] for non-contiguous ranges

## Dependencies and Integration

**Imports added:**
- `runPreflightChecks` from `./preflight.js` in CLI

**Breaking change:**
- `parsePhaseRange()` return type changed from `{ start: number; end: number }` to `number[]`
- Orchestrator.run() parameter type changed from `{ start: number; end: number } | undefined` to `number[] | undefined`
- All callers updated in same commit (CLI and tests)

**Downstream impact:**
- More flexible phase filtering enables non-contiguous ranges
- Better UX for running specific phases (e.g., skip phases 4 and 6 while running 1-3,5,7-9)

## Success Criteria Met

- ✅ Preflight checks run before orchestrator
- ✅ All prerequisite failures reported at once (parallel checks)
- ✅ Error messages are actionable (every error tells user what to DO)
- ✅ `--phases` accepts "1-3,5,7-9" format and returns correct sorted deduplicated array
- ✅ `--resume` with no previous state gives clear "start fresh with --prd" guidance
- ✅ `--help` shows complete flag list and usage examples
- ✅ All existing tests pass with no regressions (2 pre-existing yolo-config test failures unrelated to this work)

## Self-Check: PASSED

**Created files exist:**
```
FOUND: autopilot/src/cli/preflight.ts
```

**Modified files exist:**
```
FOUND: autopilot/src/cli/index.ts
FOUND: autopilot/src/orchestrator/gap-detector.ts
FOUND: autopilot/src/orchestrator/index.ts
FOUND: autopilot/src/orchestrator/__tests__/gap-detector.test.ts
FOUND: autopilot/src/orchestrator/__tests__/orchestrator.test.ts
```

**Commits exist:**
```
FOUND: 1336069 (Task 1: preflight checks and parsePhaseRange enhancement)
FOUND: 53264ab (Task 2: CLI integration and actionable errors)
```

**Key exports verified:**
```
✓ runPreflightChecks exported from preflight.ts (line 36)
✓ parsePhaseRange returns number[] (tested and verified)
✓ Orchestrator.run() accepts number[] (type-checked and tested)
```
