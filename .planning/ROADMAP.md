# Roadmap: GSD Autopilot

## Overview

GSD Autopilot transforms a PRD into a built project via a single command, orchestrating GSD workflows autonomously and collecting human decisions asynchronously through notifications and a local web dashboard. The build-out progresses from foundational types and state management, through the Claude integration and core orchestrator that form the product's backbone, then layers on the web server, dashboard UI, and notification adapters, before final hardening for npm distribution. Each phase delivers a verifiable capability boundary: types compile, commands execute, phases sequence, APIs respond, the dashboard renders, notifications dispatch, and the package publishes.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Types** - Project skeleton, shared types, state store, logger, config loading
- [x] **Phase 2: Claude Integration** - Agent SDK wrapper, GSD command execution, question interception
- [ ] **Phase 3: Core Orchestrator** - Phase sequencing, state machine, resume, retry, discuss-phase handler
- [x] **Phase 03.2: Add Sub phase support to orchestrator and dashboard** (INSERTED)
- [ ] **Phase 4: Response Server and API** - Express server, REST endpoints, SSE streaming, static serving
- [x] **Phase 5: React Dashboard** - SPA with progress view, question response UI, phase detail, log viewer
- [x] **Phase 6: Notification System** - Adapter pattern, console/system/Teams/Slack/custom adapters
- [ ] **Phase 7: CLI Polish and Distribution** - Full CLI flags, dry-run, graceful shutdown, npm packaging

## Phase Details

### Phase 1: Foundation and Types
**Goal**: Developer has a compilable TypeScript project with shared types, persistent state store, structured logger, and config loading -- the substrate every other component depends on
**Depends on**: Nothing (first phase)
**Requirements**: FNDN-01, FNDN-02, FNDN-03, CLI-12
**Success Criteria** (what must be TRUE):
  1. Running `npm run build` produces a working ESM TypeScript build with strict mode and no errors
  2. State store writes and reads `autopilot-state.json` using atomic write pattern (survives simulated crash mid-write)
  3. Config is loaded from `.gsd-autopilot.json` with CLI flags overriding config file values overriding defaults
  4. Logger writes structured JSON to `.planning/autopilot-log/` files and exposes an in-memory ring buffer for future SSE consumption
  5. All file paths in the codebase use `path.join()` -- no hardcoded path separators
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md -- Project skeleton and shared type definitions
- [x] 01-02-PLAN.md -- State store with atomic persistence (TDD)
- [x] 01-03-PLAN.md -- Config loader with precedence chain (TDD)
- [x] 01-04-PLAN.md -- Logger system with pino and ring buffer

### Phase 2: Claude Integration
**Goal**: The system can execute GSD slash commands via the Claude Agent SDK and intercept human-in-the-loop questions, returning structured results
**Depends on**: Phase 1
**Requirements**: CLDE-01, CLDE-02, CLDE-03, CLDE-04, CLDE-05
**Success Criteria** (what must be TRUE):
  1. A GSD slash command (e.g., `/gsd:new-project`) can be executed via Agent SDK `query()` and returns a structured success/failure result
  2. When Claude issues an `AskUserQuestion` tool call, the system intercepts it and blocks the orchestrator until a human response is provided
  3. Command execution respects a configurable timeout (default 10 minutes) and returns a timeout error if exceeded
  4. The integration layer exposes a clean async interface (`runGsdCommand(prompt): Promise<CommandResult>`) that the orchestrator can call without knowing SDK internals
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md -- Types, polyfills, timeout utility, and SDK installation
- [x] 02-02-PLAN.md -- Result parser (TDD)
- [x] 02-03-PLAN.md -- Question handler (TDD)
- [x] 02-04-PLAN.md -- ClaudeService facade with mocked SDK tests

### Phase 3: Core Orchestrator
**Goal**: User can run the autopilot and it sequences through all GSD lifecycle phases autonomously, persisting state for resume, retrying failures, and collecting discuss-phase input
**Depends on**: Phase 2
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05, ORCH-06, ORCH-07, ORCH-08, ORCH-09, ORCH-10, DISC-04, CLI-01, CLI-10, CLI-09, CLI-07, CLI-08, CLI-14
**Note**: DISC-01, DISC-02, DISC-03 (analyze gray areas, batch questions, collect responses via web UI) are implemented by the existing GSD `/gsd:discuss-phase` command. Phase 3 delegates to this command via `claudeService.runGsdCommand('/gsd:discuss-phase N')` -- the orchestrator invokes it but does not re-implement the discuss logic. DISC-04 (skip-discuss with Claude's Discretion) IS implemented directly in Phase 3.
**Success Criteria** (what must be TRUE):
  1. Running `npx gsd-autopilot --prd ./idea.md` starts autonomous project building and sequences through init > plan > execute > verify for each phase
  2. If the process is interrupted (Ctrl+C or crash), running `--resume` picks up from the last completed step without re-executing completed work
  3. When a Claude command fails, it retries once; on second failure, it escalates to the human with retry/skip/abort options
  4. With `--skip-discuss`, the orchestrator writes "Claude's Discretion" CONTEXT.md directly (DISC-04); without `--skip-discuss`, the orchestrator delegates to `/gsd:discuss-phase` which handles gray area analysis, question batching, and response collection (DISC-01-03)
  5. After each phase completes verification, if gaps are found, the orchestrator re-plans and re-executes gaps (up to 3 iterations before escalating)
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md -- Shutdown manager and YOLO config writer (TDD)
- [x] 03-02-PLAN.md -- Discuss-phase handler and gap detector (TDD)
- [ ] 03-03-PLAN.md -- Orchestrator core class with phase lifecycle loop
- [ ] 03-04-PLAN.md -- CLI entry point with Commander.js

### Phase 03.1: Display claude console output to parent node process so users can see whats happening (INSERTED)

**Goal:** Stream real-time Claude Agent SDK output to the terminal with rich formatting (colors, spinners, banners) and persist raw messages to a separate log file, giving users full visibility into what the autopilot is doing
**Depends on:** Phase 3
**Requirements:** CLI-13, ORCH-07
**Plans:** 2 plans

Plans:
- [x] 03.1-01-PLAN.md -- Output module: StreamRenderer, StreamLogger, verbosity, colors, banners
- [x] 03.1-02-PLAN.md -- SDK integration: ClaudeService message emission and CLI wiring

### Phase 03.2: Add Sub phase support to orchestrator and dashboard (INSERTED)

**Goal:** Fix extractPhasesFromContent to merge checklist and heading sources, making all phases (including inserted decimal phases like 03.1, 06.1) visible to the orchestrator and dashboard
**Depends on:** Phase 3
**Plans:** 2 plans

Plans:
- [x] 03.2-01-PLAN.md -- Fix extractPhasesFromContent with merged extraction and type extension (TDD)
- [x] 03.2-02-PLAN.md -- Dashboard type mirroring and INSERTED badge on PhaseCard

### Phase 4: Response Server and API
**Goal**: A local Express server exposes REST endpoints for autopilot state, question management, and real-time log streaming via SSE, enabling the dashboard and human-in-the-loop flow
**Depends on**: Phase 3
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DASH-09, DASH-19, DASH-20
**Success Criteria** (what must be TRUE):
  1. When autopilot starts, an Express server launches on the configured port (default 3847) and responds to `GET /api/health`
  2. `GET /api/status` returns current phase, step, and progress percentage; `GET /api/phases` returns all phases with status
  3. `GET /api/questions` returns pending questions; `POST /api/questions/:questionId` submits a response and unblocks the orchestrator's waiting Promise
  4. `GET /api/log/stream` opens an SSE connection that pushes real-time events (phase-started, phase-completed, question-pending, question-answered, error, log-entry, build-complete)
  5. Server shuts down cleanly when autopilot completes
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- ResponseServer class, Express 5, REST endpoints (health, status, phases, questions), error middleware
- [x] 04-02-PLAN.md -- SSE streaming with event wiring, AutopilotLogger EventEmitter, SPA fallback, CLI integration

### Phase 5: React Dashboard
**Goal**: User can open a browser to the local server and see real-time build progress, respond to questions, inspect phase details, and view live logs
**Depends on**: Phase 4
**Requirements**: FNDN-05, DASH-10, DASH-11, DASH-12, DASH-13, DASH-14, DASH-15, DASH-16, DASH-17, DASH-18
**Success Criteria** (what must be TRUE):
  1. Navigating to `http://localhost:3847` shows an overview page with an overall progress bar, current phase card, pending questions count with call-to-action, and recent activity feed
  2. Clicking a pending question opens a response page showing phase context, the question in markdown, selectable option cards, and a freeform text input; submitting a response unblocks the build
  3. User can change a submitted response before the orchestrator picks it up
  4. Phase detail page shows step-by-step progress, commits, filtered logs, and verification status for any phase
  5. Log viewer page shows live log stream with phase/step filtering, search, and auto-scroll
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md -- Vite project scaffold, dashboard types, Zustand store, API client, SSE hook
- [x] 05-02-PLAN.md -- Layout shell, Overview page with ProgressBar, PhaseCard, QuestionBadge, ActivityFeed, LogStream
- [x] 05-03-PLAN.md -- QuestionResponse page with OptionCard, PhaseDetail page with StepProgress
- [x] 05-04-PLAN.md -- LogViewer page with filtering/search, build integration, visual verification

### Phase 6: Notification System
**Goal**: When the autopilot needs human attention or wants to report progress, it dispatches notifications through one or more configured adapter channels simultaneously
**Depends on**: Phase 3
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06, NOTF-07, NOTF-08, NOTF-09, NOTF-10, CLI-02, CLI-03
**Success Criteria** (what must be TRUE):
  1. With default settings, questions and progress updates print formatted colored messages to the terminal including a clickable web UI link
  2. With `--notify system`, OS-native toast notifications appear (via node-notifier) alongside console output
  3. With `--notify teams --webhook-url <url>`, Adaptive Card messages are POSTed to the Teams webhook; similarly for `--notify slack`
  4. With `--adapter-path ./my-adapter.js`, a user-provided adapter module is loaded and receives the standard Notification object (id, type, title, body, severity, respondUrl, options)
  5. If all configured adapters fail, console fallback is always attempted as a last resort
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md -- NotificationManager with parallel dispatch, console fallback, reminders; ConsoleAdapter with inline colored output
- [x] 06-02-PLAN.md -- Teams, Slack, Webhook, System adapters; custom adapter loader; example-adapter.js
- [x] 06-03-PLAN.md -- CLI wiring, config schema update, package exports, node-notifier optional dependency

### Phase 06.1: add browser notifications to alert users when needed (INSERTED)

**Goal:** [Urgent work - to be planned]
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 06.1 to break down)

### Phase 7: CLI Polish and Distribution
**Goal**: The CLI is feature-complete with all flags, published as an npm package, cross-platform tested, and provides a polished developer experience
**Depends on**: Phase 5, Phase 6
**Requirements**: FNDN-04, CLI-04, CLI-05, CLI-06, CLI-13
**Success Criteria** (what must be TRUE):
  1. `npx gsd-autopilot --help` shows all documented flags (--prd, --notify, --webhook-url, --port, --depth, --model, --skip-discuss, --skip-verify, --phases, --resume, --verbose, --quiet, --adapter-path)
  2. `--verbose` increases log detail; `--quiet` suppresses all non-error output; `--port` changes the server port; `--depth` and `--model` pass through to GSD config
  3. `npm pack` produces a package under 2MB that installs and runs correctly via `npx gsd-autopilot` on macOS, Linux, and Windows
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md -- Preflight checks, actionable error messaging, enhanced phase range parser
- [ ] 07-02-PLAN.md -- Interactive setup wizard, CLI help text polish
- [ ] 07-03-PLAN.md -- npm packaging, distribution config, build verification

### Phase 8: Autopilot should be able to be executed by using a claude command

**Goal:** Enable launching GSD Autopilot from within a Claude Code session via /gsd:autopilot slash command, with multi-instance support per git branch, background process management, and subcommands for status and stop
**Depends on:** Phase 7
**Plans:** 3 plans

Plans:
- [ ] 08-01-PLAN.md -- Port manager with deterministic branch-to-port hashing (TDD)
- [ ] 08-02-PLAN.md -- PID manager and launcher script with subcommand routing
- [ ] 08-03-PLAN.md -- Slash command SKILL.md, postinstall registration, end-to-end verification

## Progress

**Execution Order:**
Phases execute in numeric order: 1 > 2 > 3 > 4 > 5 > 6 > 7
(Note: Phases 4-5 and Phase 6 can proceed in parallel after Phase 3, but are numbered sequentially for simplicity.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Types | 4/4 | Complete | 2026-02-14 |
| 2. Claude Integration | 4/4 | Complete | 2026-02-15 |
| 3. Core Orchestrator | 4/4 | Complete | 2026-02-15 |
| 03.1. Display Console Output | 2/2 | Complete | 2026-02-16 |
| 03.2. Sub-phase Support | 2/2 | Complete | 2026-02-23 |
| 4. Response Server and API | 2/2 | Complete | 2026-02-17 |
| 5. React Dashboard | 4/4 | Complete | 2026-02-18 |
| 6. Notification System | 3/3 | Complete | 2026-02-18 |
| 7. CLI Polish and Distribution | 0/3 | Not started | - |
| 8. Autopilot Claude Command | 0/3 | Not started | - |
