# Phase 1: Foundation and Types - Context

**Gathered:** 2026-02-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Compilable TypeScript ESM project skeleton with shared type definitions, persistent state store (atomic writes), structured logger, and config loading system. This is the substrate every other component depends on. No runtime behavior beyond build, config load, and state read/write.

</domain>

<decisions>
## Implementation Decisions

### Project Structure
- npm package name: `@gsd/autopilot`
- Claude's Discretion: source code organization (single src/ with subdirectories vs flat modules)
- Claude's Discretion: dashboard source location (root-level dashboard/ vs src/dashboard/)
- Claude's Discretion: CLI entry point pattern (single command + flags vs subcommands)

### Config Hierarchy
- Config format: JSON only (`.gsd-autopilot.json`)
- Environment variable prefix: `GSD_AUTOPILOT_` (e.g., `GSD_AUTOPILOT_NOTIFY`, `GSD_AUTOPILOT_PORT`)
- Claude's Discretion: which CLI flags are configurable as persistent defaults vs run-only
- Claude's Discretion: config file search locations (project root only vs project root + home directory)

### State File Design
- Claude's Discretion: state granularity (phase+step vs phase+step+sub-step)
- Error history: keep error log in state file (last N errors with timestamps, phase, step, truncated output) — not just in log files
- Resume UX: always show resume summary on `--resume` ("Resuming from Phase 3, step: execute. Phases 1-2 complete (12 commits). Continuing...")
- Pending questions survive restart: persist unanswered questions in state, re-send notification on resume

### Logging Behavior
- Log file organization: one file per phase-step (e.g., `phase-1-plan.log`, `phase-1-execute.log`)
- Three terminal verbosity modes, all configurable:
  - `--quiet`: minimal spinners + phase summaries
  - Default (no flag): progress bars + step indicators
  - `--verbose`: streaming Claude output in real-time
- Claude's Discretion: log file retention strategy (fresh per run vs accumulate with timestamps)

### Claude's Discretion (Summary)
- Source code directory structure
- Dashboard source location
- CLI command pattern (single vs subcommands)
- Which config keys are persistent defaults vs run-only
- Config file search locations
- State granularity level
- Log retention strategy

</decisions>

<specifics>
## Specific Ideas

- Package scoped under `@gsd` namespace to match parent ecosystem
- Three verbosity levels was the user's explicit request — not just --verbose/--quiet but a full spectrum including real-time streaming
- Error history in state file specifically for debugging patterns across retries

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-and-types*
*Context gathered: 2026-02-13*
