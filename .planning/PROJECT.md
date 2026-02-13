# GSD Autopilot

## What This Is

A local Node.js command-line tool that runs the entire Get Shit Done (GSD) workflow autonomously — from PRD to working code — without requiring manual CLI interaction. When the system needs a human decision, it sends a notification through a configurable channel and waits for the human to respond through a local web interface before continuing.

## Core Value

Turn a PRD document into a fully built project by running one command, with human decisions collected asynchronously through notifications instead of synchronous CLI prompts.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can run a single command (`npx gsd-autopilot --prd ./idea.md`) to start autonomous project building
- [ ] Orchestrator sequences GSD commands (new-project → plan → execute → verify per phase → complete-milestone)
- [ ] Orchestrator persists state to `.planning/autopilot-state.json` for resume capability
- [ ] Pluggable notification system with adapter interface for sending human-in-the-loop questions
- [ ] Console notification adapter (default, zero-dependency, prints to terminal with web UI link)
- [ ] System notification adapter (OS-native toasts via node-notifier)
- [ ] Teams notification adapter (Adaptive Cards via incoming webhook)
- [ ] Slack notification adapter (Block Kit via incoming webhook)
- [ ] Custom webhook adapter (raw JSON POST to any URL)
- [ ] Local Express.js API server for collecting human responses
- [ ] React SPA dashboard with real-time progress, question response UI, phase detail, and log viewer
- [ ] SSE-based real-time updates from backend to dashboard
- [ ] Claude Code CLI integration via `claude -p` pipe mode with output parsing
- [ ] Discuss-phase handler that extracts gray areas and batches questions for human input
- [ ] CLI flags for customization (--notify, --webhook-url, --port, --depth, --model, --skip-discuss, --skip-verify, --phases, --resume)
- [ ] Error handling with retry-once and human escalation on repeated failure
- [ ] Logging all `claude -p` output to `.planning/autopilot-log/`
- [ ] Custom adapter loading from local file via --adapter-path

### Out of Scope

- CI/CD execution (GitHub Actions) — designed for local execution only
- Modifying GSD core workflows or agents — autopilot wraps GSD, does not fork it
- Authentication on local web server — runs on localhost only
- Bidirectional notification channels — all responses come through local web UI, notifications are outbound-only
- Running multiple projects simultaneously — one project per invocation

## Context

- GSD is an existing workflow system installed via npm (`get-shit-done-cc`) that provides slash commands for project planning and execution within Claude Code
- The autopilot sits above GSD, automating the manual CLI interaction pattern
- Claude Code's `-p` (pipe) mode enables non-interactive command execution
- GSD's `--auto` flag on `/gsd:new-project` already supports non-interactive project initialization
- GSD's YOLO mode and config gates allow disabling all interactive prompts
- The notification system is the key innovation — converting synchronous CLI prompts into asynchronous web-based decisions
- The web dashboard serves dual purpose: response collection AND progress monitoring

## Constraints

- **Runtime**: Node.js >= 18 (native fetch, stable async patterns)
- **Dependencies**: Claude Code CLI must be installed and authenticated (`claude` in PATH)
- **Dependencies**: GSD must be installed globally (`~/.claude/get-shit-done/` exists)
- **Storage**: No external database — all state in `.planning/` files (JSON + markdown)
- **Network**: No cloud services — everything local except outbound webhook POSTs
- **Concurrency**: Single project at a time per invocation
- **Package**: Published as npm package (`gsd-autopilot`) runnable via npx

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Express + React SPA for web UI | Familiar stack, SSE support, serves both API and static files | — Pending |
| Adapter pattern for notifications | Extensible without modifying core, teams can add custom integrations | — Pending |
| File-based state (no database) | Aligns with GSD's existing `.planning/` pattern, zero setup | — Pending |
| `claude -p` for command execution | Official pipe mode, fresh context per command, no interactive IO needed | — Pending |
| Vite + Tailwind for frontend | Fast builds, utility CSS, modern DX | — Pending |
| SSE over WebSockets for real-time | Simpler server implementation, sufficient for one-way push updates | — Pending |

---
*Last updated: 2026-02-13 after initialization*
