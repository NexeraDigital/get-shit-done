# Requirements: GSD Autopilot

**Defined:** 2026-02-13
**Core Value:** Turn a PRD document into a fully built project by running one command, with human decisions collected asynchronously through notifications instead of synchronous CLI prompts.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### CLI Entry Point

- [ ] **CLI-01**: User can start autonomous build with `npx gsd-autopilot --prd ./idea.md`
- [ ] **CLI-02**: User can specify notification channel via `--notify <channel>` flag (default: console)
- [ ] **CLI-03**: User can specify webhook URL via `--webhook-url <url>` for Teams/Slack/custom channels
- [ ] **CLI-04**: User can specify local web server port via `--port <number>` (default: 3847)
- [ ] **CLI-05**: User can control planning depth via `--depth quick|standard|comprehensive`
- [ ] **CLI-06**: User can control model profile via `--model quality|balanced|budget`
- [ ] **CLI-07**: User can skip discuss-phase via `--skip-discuss` flag
- [ ] **CLI-08**: User can skip verification via `--skip-verify` flag
- [ ] **CLI-09**: User can run specific phases via `--phases N-M` flag
- [ ] **CLI-10**: User can resume interrupted runs via `--resume` flag
- [ ] **CLI-11**: User can preview planned actions via `--dry-run` flag without executing
- [ ] **CLI-12**: User can override CLI flags via `.gsd-autopilot.json` config file or environment variables
- [ ] **CLI-13**: User can control output verbosity via `--verbose` / `--quiet` flags
- [ ] **CLI-14**: Tool handles Ctrl+C gracefully, persisting state for clean resume

### Orchestrator

- [ ] **ORCH-01**: Orchestrator sequences GSD commands through full lifecycle: init project > plan phase > execute phase > verify phase > next phase > complete milestone
- [ ] **ORCH-02**: Orchestrator persists state to `.planning/autopilot-state.json` after every step for resume capability
- [ ] **ORCH-03**: Orchestrator retries failed `claude` calls once before escalating to human
- [ ] **ORCH-04**: Orchestrator sends error notification with retry/skip/abort options on repeated failure
- [ ] **ORCH-05**: Orchestrator supports phase-level gap detection: verify > find gaps > plan gaps > execute gaps > re-verify (max 3 iterations)
- [ ] **ORCH-06**: Orchestrator tracks phase status (pending/in-progress/completed/failed) in state file
- [ ] **ORCH-07**: Orchestrator logs all command output to `.planning/autopilot-log/` per phase and step
- [ ] **ORCH-08**: Orchestrator writes YOLO-mode config.json with all gates disabled before running GSD commands
- [ ] **ORCH-09**: Orchestrator sends progress notification after each phase completes
- [ ] **ORCH-10**: Orchestrator sends completion notification with summary when build finishes

### Claude Integration

- [ ] **CLDE-01**: Tool executes GSD slash commands via Claude Agent SDK `query()` function
- [ ] **CLDE-02**: Tool intercepts `AskUserQuestion` tool calls from Claude to route questions to notification system
- [ ] **CLDE-03**: Tool parses structured SDK message types to detect command success/failure
- [ ] **CLDE-04**: Tool enforces configurable timeout per command execution (default: 10 minutes)
- [ ] **CLDE-05**: Tool blocks orchestrator on pending human input using deferred Promise pattern until response received

### Discuss-Phase Handler

- [ ] **DISC-01**: When `--skip-discuss` is not set, handler analyzes phase description to identify gray areas needing human input
- [ ] **DISC-02**: Handler batches related questions together (2-3 at a time) to reduce notification spam
- [ ] **DISC-03**: Handler collects responses via local web UI and writes CONTEXT.md in GSD format
- [ ] **DISC-04**: When `--skip-discuss` is set, handler generates CONTEXT.md marking all areas as "Claude's Discretion"

### Notification System

- [ ] **NOTF-01**: Notification Manager dispatches to one or more configured adapters simultaneously
- [ ] **NOTF-02**: Console adapter prints formatted, colored messages to terminal with web UI link (default, zero-dependency)
- [ ] **NOTF-03**: System notification adapter sends OS-native toasts via node-notifier (opt-in)
- [ ] **NOTF-04**: Teams adapter sends Adaptive Cards via incoming webhook URL
- [ ] **NOTF-05**: Slack adapter sends Block Kit messages via incoming webhook URL
- [ ] **NOTF-06**: Custom webhook adapter sends raw Notification JSON POST to any URL
- [ ] **NOTF-07**: User can load custom adapter from local file via `--adapter-path`
- [ ] **NOTF-08**: All adapters receive same structured Notification object (id, type, title, body, severity, respondUrl, options)
- [ ] **NOTF-09**: Notification types include: question, progress, error, and complete
- [ ] **NOTF-10**: If all adapters fail, console fallback is always attempted

### Web Dashboard & Response Server

- [ ] **DASH-01**: Express.js API server starts on configured port (default 3847) when autopilot runs
- [ ] **DASH-02**: `GET /api/status` returns current autopilot state (phase, step, progress percentage)
- [ ] **DASH-03**: `GET /api/phases` returns all phases with status
- [ ] **DASH-04**: `GET /api/questions` returns pending questions awaiting human input
- [ ] **DASH-05**: `GET /api/questions/:questionId` returns single question with options
- [ ] **DASH-06**: `POST /api/questions/:questionId` submits response and unblocks orchestrator
- [ ] **DASH-07**: `GET /api/log/stream` provides SSE endpoint for real-time log streaming
- [ ] **DASH-08**: `GET /api/health` returns health check status
- [ ] **DASH-09**: Server serves React SPA for all non-API routes
- [ ] **DASH-10**: Dashboard shows overall progress bar (phases completed vs total)
- [ ] **DASH-11**: Dashboard shows current phase card with name, description, and active step
- [ ] **DASH-12**: Dashboard shows pending questions count with prominent call-to-action
- [ ] **DASH-13**: Dashboard shows recent activity feed (completions, errors, commits)
- [ ] **DASH-14**: Dashboard shows live log stream (collapsible, auto-scrolling)
- [ ] **DASH-15**: Question response page shows phase context, question with markdown, options as clickable cards, and freeform text input
- [ ] **DASH-16**: User can change question response before orchestrator picks it up
- [ ] **DASH-17**: Phase detail page shows step-by-step progress, commits, filtered logs, and verification status
- [ ] **DASH-18**: Log viewer page shows full log with phase/step filtering, search, and auto-scroll
- [ ] **DASH-19**: SSE pushes real-time events: phase-started, phase-completed, question-pending, question-answered, error, log-entry, build-complete
- [ ] **DASH-20**: Server shuts down automatically when autopilot completes

### Foundation

- [ ] **FNDN-01**: Project uses ESM-only TypeScript on Node.js >= 20
- [ ] **FNDN-02**: State store uses atomic write pattern (write temp file, rename) to prevent corruption
- [ ] **FNDN-03**: All file paths use `path.join()` for cross-platform compatibility
- [ ] **FNDN-04**: Package is published as npm package runnable via `npx gsd-autopilot`
- [ ] **FNDN-05**: React SPA is pre-built at publish time and served as static files (no runtime build)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Observability

- **OBSV-01**: Structured JSON logs alongside human-readable logs (`.planning/autopilot-log/events.jsonl`)
- **OBSV-02**: Per-phase timing and token usage metrics saved to state file
- **OBSV-03**: Estimated cost/token usage preview before execution starts

### Enhanced Dashboard

- **EDSH-01**: Activity feed with timeline visualization
- **EDSH-02**: Log viewer with regex search and save-to-file

### Enhanced Notifications

- **ENOT-01**: Notification retry with exponential backoff on webhook failure

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| CI/CD execution (GitHub Actions) | Designed for local execution only; CI environments have different security/auth models |
| Modifying GSD core workflows | Autopilot wraps GSD, does not fork it |
| Dashboard authentication | Runs on localhost only; auth adds complexity with no security benefit |
| Bidirectional Slack/Teams interaction | All responses through local web UI; bidirectional requires bot infrastructure |
| Multi-project orchestration | Single-project depth is the value; multi-project adds enormous complexity |
| Built-in AI model/API management | Delegates to GSD config and Claude Code |
| Visual code diff viewer in dashboard | Duplicates git tooling; link to git diffs instead |
| Mobile-responsive full dashboard | Localhost dev tool; question response page minimally mobile-usable |
| Plugin/extension system for orchestrator | Notification adapters are the right extension point; orchestration stays opinionated |
| Persistent cross-run history/analytics | Each run is independent; users parse structured logs for analytics |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-01 | Phase 3 | Pending |
| CLI-02 | Phase 6 | Pending |
| CLI-03 | Phase 6 | Pending |
| CLI-04 | Phase 7 | Pending |
| CLI-05 | Phase 7 | Pending |
| CLI-06 | Phase 7 | Pending |
| CLI-07 | Phase 3 | Pending |
| CLI-08 | Phase 3 | Pending |
| CLI-09 | Phase 3 | Pending |
| CLI-10 | Phase 3 | Pending |
| CLI-11 | Phase 7 | Pending |
| CLI-12 | Phase 1 | Pending |
| CLI-13 | Phase 7 | Pending |
| CLI-14 | Phase 3 | Pending |
| ORCH-01 | Phase 3 | Pending |
| ORCH-02 | Phase 3 | Pending |
| ORCH-03 | Phase 3 | Pending |
| ORCH-04 | Phase 3 | Pending |
| ORCH-05 | Phase 3 | Pending |
| ORCH-06 | Phase 3 | Pending |
| ORCH-07 | Phase 3 | Pending |
| ORCH-08 | Phase 3 | Pending |
| ORCH-09 | Phase 3 | Pending |
| ORCH-10 | Phase 3 | Pending |
| CLDE-01 | Phase 2 | Pending |
| CLDE-02 | Phase 2 | Pending |
| CLDE-03 | Phase 2 | Pending |
| CLDE-04 | Phase 2 | Pending |
| CLDE-05 | Phase 2 | Pending |
| DISC-01 | Phase 3 | Pending |
| DISC-02 | Phase 3 | Pending |
| DISC-03 | Phase 3 | Pending |
| DISC-04 | Phase 3 | Pending |
| NOTF-01 | Phase 6 | Pending |
| NOTF-02 | Phase 6 | Pending |
| NOTF-03 | Phase 6 | Pending |
| NOTF-04 | Phase 6 | Pending |
| NOTF-05 | Phase 6 | Pending |
| NOTF-06 | Phase 6 | Pending |
| NOTF-07 | Phase 6 | Pending |
| NOTF-08 | Phase 6 | Pending |
| NOTF-09 | Phase 6 | Pending |
| NOTF-10 | Phase 6 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DASH-05 | Phase 4 | Pending |
| DASH-06 | Phase 4 | Pending |
| DASH-07 | Phase 4 | Pending |
| DASH-08 | Phase 4 | Pending |
| DASH-09 | Phase 4 | Pending |
| DASH-10 | Phase 5 | Pending |
| DASH-11 | Phase 5 | Pending |
| DASH-12 | Phase 5 | Pending |
| DASH-13 | Phase 5 | Pending |
| DASH-14 | Phase 5 | Pending |
| DASH-15 | Phase 5 | Pending |
| DASH-16 | Phase 5 | Pending |
| DASH-17 | Phase 5 | Pending |
| DASH-18 | Phase 5 | Pending |
| DASH-19 | Phase 4 | Pending |
| DASH-20 | Phase 4 | Pending |
| FNDN-01 | Phase 1 | Pending |
| FNDN-02 | Phase 1 | Pending |
| FNDN-03 | Phase 1 | Pending |
| FNDN-04 | Phase 7 | Pending |
| FNDN-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after roadmap creation*
