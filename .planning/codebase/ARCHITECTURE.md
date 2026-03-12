# Architecture

**Analysis Date:** 2026-03-11

## Pattern Overview

**Overall:** Multi-layer orchestration system for AI-driven software development. Two complementary architectures:

1. **GSD Core** — Command/workflow dispatch system targeting Claude Code, OpenCode, Gemini, and Codex IDEs
2. **GSD Autopilot** — Autonomous orchestrator that runs headlessly without human intervention

**Key Characteristics:**
- Separation of concerns: tool generation, workflow definition, state management, command dispatch
- File-centric state: `.planning/` directory structure (Markdown + JSON) is source of truth
- Subagent orchestration: Each workflow/command spawns specialized agents via XML prompts
- Cross-platform: Works with multiple IDE runtimes and operating systems (Mac, Windows, Linux)
- Plug-and-play: Installation copies agents/commands to IDE config directories; no code modification needed

## Layers

**CLI Installation Layer:**
- Purpose: Detect IDE runtime, prompt user for scope, copy GSD assets to correct IDE config directory
- Location: `bin/install.js`
- Contains: Runtime detection (Claude Code, OpenCode, Gemini, Codex), directory path resolution, interactive prompts
- Depends on: Node.js filesystem APIs, runtime-specific config paths (~/.claude/, ~/.config/opencode/, etc.)
- Used by: Initial setup; spawned by `npx get-shit-done-cc@latest`

**Command/Workflow Definition Layer:**
- Purpose: Declare available commands and orchestrate agent invocation
- Location:
  - `commands/gsd/*.md` — Command metadata (name, agent, allowed tools, frontmatter spec)
  - `get-shit-done/workflows/*.md` — Workflow prompts (orchestration logic, subagent references)
  - `get-shit-done/references/*.md` — Reusable prompt snippets (UI brand, context templates)
- Contains: Frontmatter (YAML metadata), execution_context blocks (@-references), process definitions
- Depends on: IDE command registration system, gsd-tools CLI for state/config queries
- Used by: IDE runtime parses commands, triggers orchestration agents

**State & Config Layer:**
- Purpose: Persist project state, configuration, and planning artifacts
- Location: `.planning/` directory structure
- Contains:
  - `config.json` — User preferences (model profile, branching strategy, verification flags)
  - `STATE.md` — Frontmatter-based project state (current phase, completed phases, milestone version)
  - `ROADMAP.md` — Phase definitions (checklist + heading metadata: dependencies, insertion markers)
  - `phases/*/` — Phase directories with PLAN.md, SUMMARY.md, VERIFICATION.md per phase
  - `todos/pending/`, `todos/completed/` — User-created follow-up tasks
- Depends on: Frontmatter parser (`frontmatter.cjs`), Node.js filesystem
- Used by: gsd-tools queries, agent context loading, verification cycles

**Tools Library (gsd-tools):**
- Purpose: Centralized CLI utility replacing ~50 inline bash patterns across commands/workflows
- Location: `get-shit-done/bin/lib/*.cjs` and `get-shit-done/bin/gsd-tools.cjs`
- Key modules:
  - `core.cjs` — Shared constants, model profiles, path normalization, output formatting
  - `config.cjs` — Config.json CRUD
  - `state.cjs` — STATE.md field updates, metric recording
  - `phase.cjs` — Phase CRUD, lifecycle operations (add, insert, complete, remove)
  - `commands.cjs` — Standalone utilities (slug generation, timestamp, todo management)
  - `verify.cjs` — Validation commands (plan structure, phase completeness, commit hashes)
  - `frontmatter.cjs` — YAML frontmatter extraction/reconstruction
- Depends on: Node.js child_process (git), filesystem APIs
- Used by: Every GSD command invokes gsd-tools for state queries; agents include output in context

**Subagent System (Agents):**
- Purpose: Specialized AI agents that handle specific workflow steps
- Location: `agents/*.md` (XML prompts with embedded instructions)
- Key agents:
  - `gsd-planner.md` — Creates detailed PLAN.md from phase spec and research
  - `gsd-executor.md` — Executes plans with wave-based parallelization and gap closure
  - `gsd-phase-researcher.md` — Researches domain/tech for phase context
  - `gsd-verifier.md` — Verifies plans meet MUST_HAVE criteria
  - `gsd-codebase-mapper.md` — Maps codebase structure, conventions, tech stack
  - `gsd-debugger.md` — Analyzes failures, suggests fixes
  - `gsd-plan-checker.md` — Validates plan structure before execution
- Contains: Shared instructions (tools, examples), phase-specific context from files_to_read blocks
- Depends on: Orchestrator providing structured context, file paths to read
- Used by: Orchestrator spawns agent for each phase step; agent runs independently with fresh context

**Autopilot Autonomous Engine:**
- Purpose: Headless orchestrator that sequences GSD workflow without human intervention
- Location: `autopilot/src/` (TypeScript, compiled to dist/)
- Key modules:
  - `orchestrator/index.ts` — Core execution loop, phase sequencing, gate validation
  - `cli/index.ts` — CLI entry point, command-line argument parsing, setup wizard
  - `claude/index.ts` — ClaudeService wrapper for spawning Claude Code processes
  - `state/index.ts` — StateStore with atomic write-file persistence (Zod-validated)
  - `config/index.ts` — Config loader with user-level defaults (~/.gsd/defaults.json)
  - `ipc/` — Inter-process communication (IPC) for dashboard-CLI coordination (event files, heartbeat, answer polling)
  - `server/` — Express-based dashboard server with SSE for live updates, push notifications, tunnel support
  - `logger/` — RingBuffer-based circular logging for large workflows
  - `activity/` — Records phase execution metrics and timing
  - `notifications/` — Pluggable notification adapters (Console, Teams, Slack, Webhook, System)
- Depends on: @anthropic-ai/claude-agent-sdk, Express, Zod, Pino (logging), write-file-atomic
- Used by: `gsd-autopilot` CLI command or programmatically via npm import

## Data Flow

**Interactive (IDE-driven) Flow:**

1. **User**: Runs `/gsd:new-project` command in Claude Code
2. **IDE Runtime**: Looks up command metadata from `commands/gsd/new-project.md`, parses frontmatter
3. **Orchestrator Agent**: Loads execution_context files, runs interactive workflow from `workflows/new-project.md`
4. **gsd-tools queries**: Agent calls `gsd-tools state load`, `gsd-tools config ensure-section`, etc. to bootstrap `.planning/`
5. **User provides PRD**: Creates `.planning/ROADMAP.md`, `.planning/STATE.md`, phase directories
6. **Next cycle**: User runs `/gsd:plan-phase 1` → loads phase context → spawns gsd-planner agent → writes PLAN.md → triggers gsd-plan-checker verification

**State Management:**
- `.planning/config.json` is single source of truth for user preferences
- `.planning/STATE.md` frontmatter tracks: current_phase, milestone_version, status fields
- Each phase directory (`phases/1/`, `phases/1.1/`, etc.) owns its PLAN.md, SUMMARY.md, VERIFICATION.md
- Gsd-tools updates STATE.md fields atomically (read → modify → write)
- Git commits are recorded in phase metadata for rollback/audit

**Autonomous (Autopilot) Flow:**

1. **User**: Runs `gsd-autopilot --prd ./idea.md` on command line
2. **CLI (`cli/index.ts`)**: Loads or creates StateStore, initializes Orchestrator
3. **Orchestrator main loop** (`orchestrator/index.ts`):
   - Parses ROADMAP.md via `extractPhasesFromContent()`
   - For each phase: spawn discuss → plan → execute → verify
   - Captures error history, calls EventWriter to record progress
4. **ClaudeService** (`claude/index.ts`): Spawns child processes running Claude Code with GSD workflows
5. **IPC coordination**:
   - EventWriter writes `.planning/autopilot/ipc/events.jsonl` (one event per line)
   - AnswerPoller watches `.planning/autopilot/ipc/questions.json` for answers from CLI user
   - HeartbeatWriter periodically updates `.planning/autopilot/ipc/heartbeat.json`
6. **Dashboard Server**: Express app on derived port serves state/questions via REST+SSE to web UI
7. **State persistence**: Each checkpoint atomically persists to `.planning/autopilot/state.json` via write-file-atomic

## Key Abstractions

**Phase:**
- Purpose: Represents a discrete work unit in project roadmap
- Examples: `.planning/phases/1/`, `.planning/phases/2.1/`, `.planning/phases/5/ [INSERTED]`
- Pattern: Phases can be integers (1, 2, 3) or decimals (1.1, 1.2, 2.1) for sub-phases; nested decimals allowed

**Plan:**
- Purpose: Executable specification for a single work item within a phase
- Examples: `PLAN.md`, `1-PLAN.md`, `gap-fix-PLAN.md`
- Pattern: Frontmatter defines wave, dependencies, must_haves (artifacts, key_links); body lists numbered tasks with checkboxes

**Workflow:**
- Purpose: Orchestration script that defines how a phase progresses through its lifecycle
- Examples: `workflows/plan-phase.md`, `workflows/execute-phase.md`
- Pattern: Markdown with XML blocks (objective, execution_context, process); agent invokes workflow directly or delegates to subagents

**Agent Prompt:**
- Purpose: Specialized AI instructions for a single workflow step
- Examples: `agents/gsd-executor.md`, `agents/gsd-debugger.md`
- Pattern: XML-formatted instruction set with tools list, example patterns, context injection via `<files_to_read>`

**GAP Iteration:**
- Purpose: Failure recovery loop for incomplete phases
- Pattern: If plan execution has gaps, create gap-fix plans (new PLAN.md files), re-execute, verify, iterate until complete
- Tracked in: phase state as `gapIterations` counter; VERIFICATION.md records gap-closure lineage

## Entry Points

**Installation:**
- Location: `bin/install.js`
- Triggers: `npx get-shit-done-cc@latest` or `npx get-shit-done-cc --claude --local`
- Responsibilities: Detect IDE, prompt for scope, copy agents/commands to IDE config, print success message

**IDE Command Dispatch:**
- Location: `commands/gsd/*.md` (metadata files)
- Triggers: User types `/gsd:command` in IDE
- Responsibilities: IDE reads frontmatter (name, description, agent, allowed-tools), spawns agent process with execution context

**Orchestrator (Interactive):**
- Location: `workflows/*.md` files
- Triggers: Orchestration agent (@orchestrator in command metadata)
- Responsibilities: Parse arguments, validate state, load context files, call gsd-tools queries, decide next step

**Orchestrator (Autonomous):**
- Location: `autopilot/src/cli/index.ts`
- Triggers: `gsd-autopilot --prd ./idea.md` or `gsd-autopilot --resume`
- Responsibilities: Initialize project, load/resume state, run phase loop, handle errors, serve dashboard

## Error Handling

**Strategy:** Multi-layered with human escalation options

**Patterns:**
- **gsd-tools validation**: Normalize phase input, check directory existence, return `error:` on invalid input
- **Schema validation**: Zod schemas validate StateStore on restore; frontmatter YAML parsing with fallbacks
- **Agent error capture**: Orchestrator catches agent exit codes, records to StateStore.errorHistory, logs with timestamp
- **Gap iteration**: If verify step fails, capture VERIFICATION.md output, generate fix plans, re-execute
- **Manual intervention**: Dashboard allows user to answer questions, adjust phase order, mark gaps as manual-close

## Cross-Cutting Concerns

**Logging:**
- Interactive: Console output from agents + command logs
- Autonomous: Pino-based structured logging with RingBuffer for large workflows; outputs to console and .planning/autopilot/logs/
- Verbosity controlled by CLI flags (--verbose, --quiet)

**Validation:**
- Phase number normalization: `normalizePhaseName()` converts "1", "01", "1.0" to canonical form
- Directory existence checks: `pathExistsInternal()` validates `.planning/phases/N/` before operations
- Plan structure verification: gsd-plan-checker validates PLAN.md has required frontmatter + task lists
- Commit verification: gsd-tools verifies git commit hashes exist before recording in state

**Authentication:**
- None enforced; works on local filesystem
- Autopilot spawns Claude Code processes which authenticate via ~user/.claude/config
- Codex uses agent skills (skills/gsd-*/) which run with agent credentials
- IDE runtimes manage their own authentication (Claude Code via API key env var, etc.)

**State Consistency:**
- Single .planning/ directory is ACID boundary (path.join ensures cross-platform consistency)
- All writes use write-file-atomic for crash-safe persistence
- Phase ordering preserved via numeric comparison (comparePhaseNum handles decimals)
- Git commits recorded per-phase for rollback audit trail

---

*Architecture analysis: 2026-03-11*
