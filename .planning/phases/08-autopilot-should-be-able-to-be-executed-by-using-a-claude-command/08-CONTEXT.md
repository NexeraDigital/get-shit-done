# Phase 8: Autopilot Claude Command Integration - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable launching GSD Autopilot from within a Claude Code session via `/gsd:autopilot` slash command. The command shells out to the existing `npx gsd-autopilot` CLI, supports multi-instance (one per git branch), and runs in the background with per-branch port persistence.

</domain>

<decisions>
## Implementation Decisions

### Invocation method
- New GSD slash command: `/gsd:autopilot`
- Registered by the `gsd-autopilot` npm package (not bundled with core GSD workflows)
- Package copies/installs the workflow .md file into the GSD workflows directory during setup
- Works via `npx` — no global install required

### Parameter passing
- Raw argument pass-through: `/gsd:autopilot --phases 3-5 --notify teams` runs `npx gsd-autopilot --phases 3-5 --notify teams`
- Same precedence as existing CLI: .gsd-autopilot.json for defaults, inline args override
- If no args and no .planning exists, the workflow asks for PRD path before shelling out (minimal — PRD path only, no other settings)
- If .planning/ROADMAP.md exists, auto-detects and continues (same smart detection as CLI)

### Session behavior — multi-instance
- Autopilot runs as a background process, returns control to user immediately
- Each git branch gets its own autopilot instance on its own port
- Port assignment: deterministic hash from branch name (base 3847 + hash % 1000)
- Port collision: increment +1 until a free port is found
- Port number saved in `.planning/autopilot-state.json` (persisted per branch)
- On subsequent runs for same branch, reuse the saved port

### Subcommands
- `/gsd:autopilot` — launch (or resume) autopilot for current branch
- `/gsd:autopilot status` — show current phase, progress %, dashboard URL for current branch
- `/gsd:autopilot stop` — gracefully stop the autopilot for current branch (SIGTERM + wait)

### Output integration
- Launch confirmation only: "Autopilot started on port XXXX" + dashboard URL
- No log streaming in Claude terminal — all monitoring via web dashboard
- Build completion handled by existing notification adapters (console, Teams, Slack, system toast)

### Claude's Discretion
- How to register the workflow .md file during package install (copy vs symlink vs other)
- PID file location and format for stop/status commands
- Hash algorithm for branch-to-port mapping
- Exact error messages and formatting

</decisions>

<specifics>
## Specific Ideas

- User wants to run multiple autopilots simultaneously across different git branches, each isolated with its own port
- Port reuse is important — same branch should always get the same port across sessions (saved in state)
- The workflow should feel lightweight — just a thin launcher over the existing CLI, not a reimplementation

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-autopilot-should-be-able-to-be-executed-by-using-a-claude-command*
*Context gathered: 2026-02-23*
