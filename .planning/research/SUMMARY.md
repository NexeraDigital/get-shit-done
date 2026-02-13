# Project Research Summary

**Project:** GSD Autopilot
**Domain:** AI-assisted development orchestration CLI with embedded web dashboard
**Researched:** 2026-02-13
**Confidence:** HIGH

## Executive Summary

GSD Autopilot is a Node.js CLI tool that orchestrates the GSD (Get Shit Done) spec-driven development workflow end-to-end, replacing manual phase-by-phase execution with an automated state machine that sequences planning, execution, and verification while keeping a human in the loop for ambiguous decisions. The established pattern for this class of tool -- validated by competitors like Conductor, Taskmaster, Devin, and Claude Squad -- is a single-process architecture combining a CLI entry point, a linear state machine with disk-persisted state, an embedded Express web server for a React dashboard, and SSE for real-time updates. The critical technology decision is to use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) instead of spawning `claude -p` as a child process. The Agent SDK provides structured message types, built-in `AskUserQuestion` interception for the human-in-the-loop flow, cost tracking, and avoids a documented Node.js child process hanging bug. This single decision eliminates the two highest-risk pitfalls (fragile stdout parsing and zombie child processes) and simplifies the entire architecture.

The recommended stack is ESM-only TypeScript on Node.js 20+, with Commander for CLI parsing, Express 5 for the embedded server, a custom EventEmitter-based orchestrator (XState is overkill for this linear workflow), React 19 + Zustand + Tailwind for the dashboard SPA, Vite for the frontend build, pino for structured logging, Zod for schema validation, and `better-sse` for server-sent events. The stack is mature and high-confidence across the board, with only two medium-confidence choices: `tsdown` (pre-1.0 bundler, fallback to plain `tsc` if unstable) and `node-notifier` (effectively unmaintained, mitigated by making system notifications opt-in with console as the always-available default).

The primary risks are: (1) state file corruption from non-atomic writes during crashes -- mitigated by the write-temp-then-rename pattern; (2) error cascades where a failed phase poisons downstream phases -- mitigated by precondition checks and stop-on-failure behavior; and (3) cross-platform failures on Windows (path separators, `.cmd` shim spawning, line endings) -- mitigated by using `path.join()` everywhere, `shell: true` on spawn calls, and Windows CI from day one. The architecture is intentionally simple: single process, single package (no monorepo), file-based JSON state, EventEmitter for inter-component communication. This simplicity is a strength for a localhost-only single-user tool.

## Key Findings

### Recommended Stack

The stack targets Node.js >= 20 (Node 18 is EOL), ESM-only modules, and TypeScript 5.9.x. Every library choice prioritizes small bundle size and minimal dependencies since the tool ships via `npx` where download speed matters. See [STACK.md](STACK.md) for full rationale and alternatives considered.

**Core technologies:**
- **Node.js >= 20 + TypeScript 5.9**: Runtime floor is Node 20 LTS (EOL April 2026), recommended Node 22 (active LTS). TypeScript strict mode. ESM-only (`"type": "module"`).
- **Commander 13**: Lightweight CLI parsing for a single-command-with-flags pattern. Preferred over Yargs (overkill) and oclif (enterprise-heavy).
- **Claude Agent SDK**: Replaces `claude -p` child process spawning. Structured output, question interception via `canUseTool`, cost tracking, no spawn bugs.
- **Express 5**: Embedded web server for REST API + static React SPA serving. Async middleware native in v5.
- **React 19 + Zustand + Tailwind v4**: Dashboard SPA stack. Zustand for minimal state management (~1KB), Tailwind for utility-first styling with zero-runtime CSS.
- **Vite 7 / tsdown 0.20**: Vite builds the React SPA; tsdown compiles the CLI/server TypeScript. tsdown is pre-1.0 (fallback: plain `tsc`).
- **better-sse**: SSE server with connection management, heartbeats, and reconnection support. Native `EventSource` on the client.
- **pino 10**: Structured JSON logging. 5x faster than Winston, NDJSON output feeds the dashboard log viewer directly.
- **Zod 4**: TypeScript-first schema validation for config files, API payloads, and adapter interfaces.
- **picocolors**: Terminal colors at 3.8KB (14x smaller than chalk).

**Version-critical notes:**
- Node.js 18 is end-of-life. Do not target it.
- TypeScript 6.0 is in beta. Use 5.9.x for stability; upgrade after 6.0 GA.
- ESLint 9 (not 10) until typescript-eslint confirms v10 compatibility.

### Expected Features

The feature landscape was assessed against 12+ competitors (Conductor, Claude Squad, Taskmaster, Kiro, Devin, BMAD, Codex CLI, Aider, Spec Kit, claude-flow, Cline, Kilo). See [FEATURES.md](FEATURES.md) for the complete analysis.

**Must have (table stakes):**
- Single-command start (`npx gsd-autopilot --prd ./idea.md`) with `--resume` for interrupted runs
- Config file support (`.gsd-autopilot.json`) with CLI > env > config > defaults hierarchy
- `--dry-run`, `--phases N-M`, `--verbose`/`--quiet`, graceful Ctrl+C
- Linear phase sequencing (discuss > plan > execute > verify) with auto-retry and state persistence
- Console notifications (default, zero-config) with enough context to act
- Web dashboard with progress view, question response interface, SSE real-time updates, and log viewer
- Human-escalation on repeated failure with retry/skip/abort options

**Should have (differentiators):**
- `--skip-discuss` / `--skip-verify` for full autonomy spectrum (unique vs. competitors)
- `--depth` and `--model` for cost/quality control
- Discuss-phase question batching (2-3 at a time, reduces notification spam)
- Phase-level gap detection and re-execution loop (GSD's self-healing verify cycle)
- Pluggable notification adapter system (`--adapter-path ./my-adapter.js`)
- Post-build summary report
- Question change-before-pickup in web UI

**Defer (v2+):**
- System toast / Teams / Slack notification adapters (console + web UI sufficient for launch)
- Structured JSON logs and per-phase timing/token metrics
- Estimated cost/token usage preview
- Phase detail drill-down view in dashboard
- Log viewer with search/filter

**Anti-features (explicitly do NOT build):**
- Multi-project orchestration, CI/CD integration, dashboard authentication
- Bidirectional Slack/Teams interaction, built-in AI model management
- Visual code diff viewer, mobile-responsive dashboard, plugin/extension system
- Persistent cross-run history/analytics

### Architecture Approach

The architecture is a single Node.js process containing 8 components communicating via a shared EventEmitter bus. The orchestrator follows a linear async loop (not a formal state machine library) with disk-persisted JSON state. The Claude Agent SDK replaces child process spawning, and a deferred Promise pattern (`Promise.withResolvers`) enables blocking on human input without polling. See [ARCHITECTURE.md](ARCHITECTURE.md) for full component diagrams, data flows, and code examples.

**Major components:**
1. **CLI Entry (Commander)** -- Parses args, loads config, bootstraps components, calls `orchestrator.start()`
2. **Orchestrator (EventEmitter-based)** -- Sequences phases through discuss/plan/execute/verify, manages state transitions, coordinates all work
3. **Claude Integration (Agent SDK)** -- Executes GSD commands via `query()`, intercepts `AskUserQuestion` tool calls, returns structured results
4. **State Store** -- In-memory state with atomic JSON file persistence, shared read-only with the Response Server
5. **Response Server (Express 5)** -- REST API for status/questions, SSE for real-time push, serves pre-built React SPA
6. **Notification Manager + Adapters** -- Dispatches to configured channels using `Promise.allSettled` (one failure does not block others)
7. **Logger (pino)** -- Structured logging to files + in-memory ring buffer feeding SSE stream
8. **React SPA** -- Dashboard UI with progress view, question response, phase detail, log viewer

**Key architectural decisions:**
- Custom orchestrator over XState: The flow is linear (6 states in a line), does not warrant a 16.7KB state machine library. XState can be introduced later if complexity grows.
- Agent SDK over `claude -p` spawn: Eliminates stdout parsing fragility, zombie processes, and Node.js hanging bugs. This is the single most impactful architecture decision.
- Single package over monorepo: Dashboard is tightly coupled to server. One deployable artifact, no workspace overhead.
- Pre-built React SPA: Built at publish time via `prepublishOnly`, served as static files. No runtime build step.

### Critical Pitfalls

The top 5 pitfalls that could cause rewrites or fundamental failures. All 5 affect Phase 1 (Core Orchestrator). See [PITFALLS.md](PITFALLS.md) for 17 total pitfalls with detection and prevention strategies.

1. **Blocking the event loop with synchronous execution** -- Using `spawnSync` or any sync operation during Claude command execution kills the Express server, SSE, and dashboard. Prevention: async-only orchestrator from day one. (Partially mitigated by Agent SDK, which is async-native.)
2. **Fragile stdout string parsing** -- Parsing `claude -p` output for patterns like "PHASE X PLANNED" is brittle against LLM output variance. Prevention: Use Claude Agent SDK's structured `SDKMessage` types instead. (Fully mitigated by the Agent SDK decision.)
3. **State file corruption from non-atomic writes** -- `fs.writeFileSync` mid-crash produces truncated JSON, losing all run progress. Prevention: Write to temp file, fsync, rename (atomic write pattern). Use `write-file-atomic` package.
4. **Cross-platform spawn failures on Windows** -- `spawn('claude', ...)` without `shell: true` cannot find `.cmd` shims on Windows. Prevention: Always use `shell: true`, test on Windows CI, use `path.join()` everywhere.
5. **Error cascade from failed phases** -- A failed phase poisons downstream phases, triggering a flood of error notifications. Prevention: Precondition checks before each phase, stop-on-failure default behavior, batch error notifications.

## Implications for Roadmap

Based on the combined research, the project naturally decomposes into 7 phases following the architecture's build-order dependencies. The Claude Integration module is the critical path item -- everything else can be stubbed while it is built.

### Phase 1: Foundation and Types
**Rationale:** All other components depend on shared types, interfaces, and the state store. Build the skeleton first.
**Delivers:** TypeScript project setup (ESM, strict mode), shared type definitions (`AutopilotState`, `PhaseState`, `Notification`, `NotificationAdapter`), State Store with atomic writes, Logger (pino) with file output, config loading (`.gsd-autopilot.json` + env vars).
**Addresses:** Config file support (table stakes), state persistence (table stakes), graceful foundations.
**Avoids:** Pitfall 4 (state file corruption) by implementing atomic writes from the start. Pitfall 11 (Windows paths) by establishing `path.join()` convention. Pitfall 17 (line endings) by adding `.gitattributes`.

### Phase 2: Claude Integration
**Rationale:** The orchestrator cannot function without the ability to execute GSD commands. This is the critical path dependency for everything that follows.
**Delivers:** Claude Agent SDK wrapper, `runGsdCommand()` with structured result parsing, `AskUserQuestion` interception via `canUseTool`, deferred Promise pattern for blocking on human input, timeout management, cost tracking extraction.
**Addresses:** Output parsing (table stakes), question interception (table stakes for human-in-the-loop).
**Avoids:** Pitfall 1 (sync blocking) by using async Agent SDK. Pitfall 2 (fragile parsing) by using structured `SDKMessage` types. Pitfall 3 (zombie processes) eliminated -- no child processes to orphan. Pitfall 15 (Claude CLI update breakage) mitigated by thin adapter layer.

### Phase 3: Core Orchestrator
**Rationale:** With Claude Integration and State Store ready, the orchestrator can sequence phases through the full lifecycle. This is the heart of the product.
**Delivers:** EventEmitter-based orchestrator with linear phase loop, discuss/plan/execute/verify sequencing, state transitions with disk persistence after every step, `--resume` capability, `--phases N-M` subset execution, phase-level gap detection loop (max 3 iterations), retry logic (1 retry per step), graceful Ctrl+C shutdown cascade, `--skip-discuss` / `--skip-verify` flags.
**Addresses:** Linear phase sequencing (table stakes), resume (table stakes), retry (table stakes), gap detection loop (differentiator), autonomy spectrum flags (differentiator).
**Avoids:** Pitfall 9 (error cascade) by implementing precondition checks and stop-on-failure. Pitfall 16 (question overload) by enforcing batch limits and response timeouts.

### Phase 4: Response Server and API
**Rationale:** The Express server enables the web dashboard and human-in-the-loop flow. It depends on the orchestrator for state and events.
**Delivers:** Express 5 server with REST API (`/api/status`, `/api/questions`, `/api/questions/:id`), SSE endpoint (`/api/log/stream`) with event IDs and replay buffer, static file serving for React SPA, port conflict detection, centralized shutdown manager, health check endpoint.
**Addresses:** Web dashboard foundation (table stakes), real-time updates via SSE (table stakes), question response API (table stakes).
**Avoids:** Pitfall 6 (server lifecycle mismanagement) by implementing shutdown manager. Pitfall 7 (SSE connection drops) by implementing event IDs, heartbeats, and replay. Pitfall 13 (SSE connection limits) documented.

### Phase 5: React Dashboard SPA
**Rationale:** With the API and SSE in place, the dashboard can be built against a real backend. Pre-building at publish time avoids runtime build complexity.
**Delivers:** React 19 + Zustand + Tailwind SPA with 4 pages: progress overview, question response interface (with change-before-pickup), phase detail view, log viewer. SSE integration via custom `useSSE` hook. Vite build pipeline outputting to `dashboard/dist/`. `prepublishOnly` build script.
**Addresses:** Progress view (table stakes), question response UI (table stakes), log viewer (table stakes), activity feed (differentiator), question change-before-pickup (differentiator).
**Avoids:** Pitfall 8 (npm package bloat) by configuring explicit `files` whitelist and disabling source maps in production. Anti-Pattern 4 (building React at runtime) by pre-building at publish.

### Phase 6: Notification System
**Rationale:** Console notifications should work from Phase 3 (inline terminal output). This phase adds the formal adapter system and additional channels.
**Delivers:** NotificationManager with adapter interface, console adapter (always-on default), system toast adapter (opt-in, `node-notifier`), Teams/Slack webhook adapters, custom adapter loading via `--adapter-path`, retry with exponential backoff, mandatory console fallback on adapter failure.
**Addresses:** Multiple simultaneous channels (table stakes), notification context (table stakes), pluggable adapters (differentiator).
**Avoids:** Pitfall 10 (webhook failures silently swallowed) by verifying at least one adapter succeeded. Pitfall 14 (node-notifier quirks) by making system notifications opt-in with platform detection.

### Phase 7: Polish and Distribution
**Rationale:** Final hardening before npm publish. Focuses on cross-platform reliability, package optimization, and developer experience.
**Delivers:** `--dry-run` mode, post-build summary report, estimated cost preview (basic), structured JSON logs alongside human-readable logs, per-phase timing metrics, npm package optimization (size-limit budget, `files` whitelist validation), Windows CI, cross-platform test coverage, `.gitattributes` for line endings, comprehensive error messages.
**Addresses:** Dry-run (table stakes), post-build summary (differentiator), cost estimation (differentiator), structured logs (differentiator).
**Avoids:** Pitfall 5 (Windows spawn failures) validated by CI. Pitfall 11 (Windows paths) validated by CI. Pitfall 12 (log growth) by implementing rotation.

### Phase Ordering Rationale

- **Phases 1-2 are foundational.** The State Store and Claude Integration are dependencies for everything else. Building them first with tests creates a reliable base.
- **Phase 3 (Orchestrator) is the product.** Everything before it is infrastructure; everything after it is interface. Ship a working CLI-only orchestrator before investing in the dashboard.
- **Phases 4-5 (Server + Dashboard) are the user experience.** They depend on the orchestrator being functional but can be developed against stubbed data during Phase 3.
- **Phase 6 (Notifications) is deferred because console output from Phase 3 is sufficient for initial use.** The adapter system adds value but is not blocking.
- **Phase 7 (Polish) is last because cross-platform hardening and package optimization are best done against the complete codebase.**
- **The discuss-phase question batching (differentiator) is embedded in Phase 3** rather than deferred, because it is GSD Autopilot's signature feature and validates the human-in-the-loop architecture early.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Claude Integration):** The Agent SDK's `canUseTool` callback behavior, session management (`resume: sessionId`), and error handling patterns need API-level exploration. The SDK is well-documented but the specific integration with GSD slash commands (passing prompts like `"/gsd:plan-phase 1"` through `query()`) is novel and untested.
- **Phase 5 (React Dashboard):** The SSE-to-Zustand state synchronization pattern and the question-change-before-pickup UX flow need prototyping to validate.
- **Phase 6 (Notification System):** Teams/Slack webhook payload formats, rate limits, and authentication patterns need per-platform research.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** TypeScript project setup, config loading, file persistence -- well-documented patterns.
- **Phase 3 (Orchestrator):** EventEmitter-based async loops are standard Node.js. The research already provides complete code patterns.
- **Phase 4 (Response Server):** Express + SSE + static serving is a thoroughly documented pattern.
- **Phase 7 (Polish):** npm packaging, CI configuration, cross-platform testing -- standard practices.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core technologies verified against official docs. Only tsdown (pre-1.0) and node-notifier (unmaintained) are below HIGH confidence. Both have documented fallbacks. |
| Features | MEDIUM-HIGH | Broad competitive landscape surveyed (12+ tools). Table stakes are clear. Differentiator value is inferred from competitor gaps, not validated with users. |
| Architecture | HIGH | Agent SDK integration verified against official Anthropic docs. EventEmitter + async loop is a standard Node.js pattern. Single-process architecture is appropriate for the single-user localhost use case. |
| Pitfalls | HIGH | All critical pitfalls verified against Node.js official documentation, GitHub issue trackers, and npm package docs. Prevention strategies are concrete and actionable. |

**Overall confidence:** HIGH

### Gaps to Address

- **Agent SDK + GSD slash commands:** No verified example of passing GSD-specific prompts (like `/gsd:plan-phase 1`) through the Agent SDK `query()` function. The SDK docs show general prompts, not IDE slash command invocation. This needs validation in Phase 2.
- **`Promise.withResolvers` on Node.js 20:** This API is available in Node.js 22+ natively. Node.js 20 (the minimum target) requires a polyfill. The polyfill is trivial (5 lines) but must be included. Alternatively, bump the minimum to Node.js 22.
- **tsdown stability:** At v0.20 (pre-1.0), tsdown could have breaking changes. If stability issues arise, fall back to plain `tsc` (no bundling needed for a CLI tool -- only the React SPA needs Vite). Monitor tsdown releases during development.
- **node-notifier deprecation:** Marked deprecated on npm, last published 4+ years ago. System notifications are opt-in with console fallback, so this is low risk. Monitor `node-toasted-notifier` fork as potential replacement.
- **Dashboard bundle size impact on npx:** The pre-built React SPA adds to the npm package size. Must be measured and optimized (target < 2MB total package). If too large, consider lazy-loading the dashboard assets on first use.

## Sources

### Primary (HIGH confidence)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases) -- LTS versions, EOL dates
- [Claude Agent SDK documentation](https://platform.claude.com/docs/en/agent-sdk/overview) -- SDK API, query(), canUseTool, user input handling
- [Commander.js](https://www.npmjs.com/package/commander) -- CLI framework API
- [Express 5](https://www.npmjs.com/package/express) -- Async middleware, routing
- [XState v5](https://stately.ai/docs/xstate) -- Evaluated and decided against for this use case
- [Node.js child_process](https://nodejs.org/api/child_process.html) -- spawn vs spawnSync, Windows .cmd limitation
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) -- SSE spec, reconnection, Last-Event-ID
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) -- Output formats, flags

### Secondary (MEDIUM confidence)
- [Faros AI: Best AI Coding Agents 2026](https://www.faros.ai/blog/best-ai-coding-agents-2026) -- Competitor feature landscape
- [Mike Mason: AI Coding Agents](https://mikemason.ca/writing/ai-coding-agents-jan-2026/) -- Conductor vs orchestrator patterns
- [Addy Osmani: LLM Coding Workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/) -- Multi-agent patterns, human oversight
- [tsdown documentation](https://tsdown.dev/) -- Migration from tsup, build configuration
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) -- CSS-first config, Lightning CSS engine

### Tertiary (LOW confidence)
- [node-notifier npm](https://www.npmjs.com/package/node-notifier) -- Cross-platform notifications (unmaintained, needs monitoring)
- Blog posts on 2026 JavaScript ecosystem trends -- Informative but not authoritative

---
*Research completed: 2026-02-13*
*Ready for roadmap: yes*
