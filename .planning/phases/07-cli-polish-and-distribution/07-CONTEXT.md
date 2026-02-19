# Phase 7: CLI Polish and Distribution - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Feature-complete CLI with all documented flags, npm packaging as `gsd-autopilot`, cross-platform verification, and polished developer experience. This phase hardens what's already built — no new core capabilities.

</domain>

<decisions>
## Implementation Decisions

### Dry-run mode
- **Dropped from scope** — user decided --dry-run is unnecessary; if something's misconfigured, the real run surfaces it fast enough
- Remove from CLI flags and success criteria

### Flag design
- All flags from roadmap kept: --prd, --notify, --webhook-url, --port, --depth, --model, --skip-discuss, --skip-verify, --phases, --resume, --verbose, --quiet, --adapter-path
- Long flags only — no short aliases (users can create their own shell aliases)
- --verbose and --quiet affect EVERYTHING: autopilot logging AND Claude SDK output (Phase 3.1 StreamRenderer respects verbosity)

### First-run experience
- When run without args: interactive setup wizard (PRD path, notification channel, model selection)
- Not just help text — guide the user through their first run

### Error messaging
- Friendly errors with actionable fix steps (e.g., "Claude CLI not found. Install it: npm i -g @anthropic-ai/claude-code")
- Preflight check on startup: validate claude CLI, GSD installation, PRD file readable, port available — report ALL issues at once, not one-at-a-time
- When --resume used with no previous state: offer to start fresh ("No previous run found. Start a new run with --prd instead?")

### Shutdown behavior
- Ctrl+C = immediate abort — kill Claude process, persist state, exit
- No graceful timeout — fast and predictable

### npm packaging
- Package name: `gsd-autopilot`, bin name: `gsd-autopilot`
- Invocation: `npx gsd-autopilot --prd ./idea.md`

### Claude's Discretion
- Default --port value and --phases syntax (ranges, commas, or both)
- Whether dashboard is pre-built in package or built on first run
- Whether to include a postinstall message or check prerequisites at runtime
- Package size optimization approach (target under 2MB)

</decisions>

<specifics>
## Specific Ideas

- The interactive setup wizard should feel like `npm init` — quick questions, sensible defaults, then go
- Error messages should be actionable: always tell the user what to DO, not just what went wrong

</specifics>

<deferred>
## Deferred Ideas

- --dry-run flag — dropped from Phase 7 scope by user decision. Could be added in a future iteration if users request build preview capability.

</deferred>

---

*Phase: 07-cli-polish-and-distribution*
*Context gathered: 2026-02-18*
