# Project Research Summary

**Project:** GSD Autopilot — Parallel Phase Execution
**Domain:** Concurrent child process orchestration, DAG-based task scheduling, file-based IPC
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

GSD Autopilot currently executes roadmap phases sequentially. This feature extends it to run independent phases in parallel, using a DAG derived from existing ROADMAP.md `dependsOn` fields. The recommended approach treats the orchestrator as a single coordinating Node.js process that spawns one ClaudeService instance per phase worker, gates concurrency via `p-limit`, and serializes all state mutations through a single-writer pattern. This is an extension of the existing architecture, not a replacement — the sequential path stays untouched and `--parallel` opts into the new behavior. Only three new npm packages are needed: `p-limit`, `async-lock`, and `dependency-graph`.

The most important architectural decision is the single-writer state model. Workers must never write directly to `state.json` — they emit progress events to the orchestrator via typed callbacks, and the orchestrator applies all state transitions. Similarly, each worker must have its own event file (`events-phase-{N}.ndjson`) rather than sharing a single append target, and its own git worktree to prevent index corruption. These three isolation boundaries — state ownership, event file separation, and git worktree isolation — are prerequisites for all subsequent work and must be established in Phase 1.

The critical risk is the git layer. Multiple Claude Code child processes operating on the same git working tree will corrupt the git index even when they touch different files, because `.git/index` is a single binary file with no concurrent-write support. The mitigation — `git worktree add` per worker — is well-understood and ClaudeService already supports per-worker `cwd` injection. Without this, parallel execution will produce unreliable commits regardless of how well the scheduler and state management are implemented.

## Key Findings

### Recommended Stack

The parallel milestone adds minimal new dependencies on top of the existing Node.js + TypeScript + Vitest codebase. The orchestrator remains a single process — no worker threads, no external job queues, no distributed coordination. This decision is justified by the fact that ClaudeService spawns external Claude Code processes (I/O-bound), not CPU-bound work.

**Core technologies:**
- `p-limit@^7.3.0`: Concurrency cap for parallel phase execution — simpler than p-queue (no priority/pause/resume overhead), 170M weekly downloads, ESM-compatible
- `async-lock@^1.4.1`: In-process async mutex for StateStore read-modify-write cycles — prevents lost updates when workers report state changes simultaneously
- `dependency-graph@^1.0.0`: DAG construction and topological traversal — higher-level API than raw toposort, `addDependency()` maps cleanly to ROADMAP.md `dependsOn` semantics
- Node.js built-ins (`child_process`, `EventEmitter`, `fs/promises`): Already used throughout; no reason to add abstraction layers
- `write-file-atomic@^7.0.0` (existing): Atomic state file writes — sufficient for single-writer pattern; the `async-lock` mutex handles the read-modify-write cycle on top

**What to avoid:** `p-queue` (overkill), `worker_threads` (wrong tool for I/O-bound work), `proper-lockfile` (inter-process locking not needed — orchestrator is single process), `flowed`/`Bree`/`Agenda` (full orchestration engines that fight the existing architecture).

### Expected Features

The feature set is clear and maps directly to what build-tool task runners (Turborepo, Nx) offer, with the addition of interactive question routing that those tools lack entirely.

**Must have (table stakes):**
- DAG-based dependency scheduling — users expect phases to only run when dependencies are satisfied
- `--concurrency N` flag with sensible default (3-4) — AI agent processes are heavyweight; unbounded parallelism will hit API rate limits or OOM
- Fail-fast default behavior — stop all workers when one fails; `--continue` opt-in for independent recovery
- Per-phase status in dashboard — parallel mode demands showing N active statuses, not one "current phase"
- Consolidated event stream with phase tagging — interleaved output without tags is unreadable
- Graceful shutdown on SIGINT — zombie Claude Code child processes are unacceptable
- Conflict-free state management — atomic updates to `state.json` are essential for correctness
- Backward compatibility — `--parallel` is opt-in; sequential mode must be unaffected

**Should have (differentiators):**
- Automatic parallelism detection — auto-group parallelizable phases from the DAG rather than requiring manual specification
- Per-phase question routing in dashboard — the key differentiator over Turborepo/Nx; tag questions with `phaseId` and show them in context
- `--continue` flag for post-failure recovery
- Execution time estimation from ActivityStore historical data

**Defer (v2+):**
- Live dependency graph visualization — high frontend complexity (dagre/elk.js), significant work for a nice-to-have
- Intelligent resource-aware scheduling — static concurrency cap handles 90% of cases; add only if users report resource contention
- Per-phase log files as persistent artifacts

### Architecture Approach

The architecture follows a hub-and-spoke model: the ParallelOrchestrator is the hub that owns all coordination — state writes, scheduling decisions, worker lifecycle — while PhaseWorker instances are isolated spokes that run their phase lifecycle and report back via typed events. This enforces the actor model: one writer, many readers. The key new components are the DependencyScheduler (pure DAG logic, fully unit-testable), the WorkerPool (lifecycle management with concurrency cap), and the EventMultiplexer (tails per-worker NDJSON files and merges into a single SSE stream). All existing components — ClaudeService, StateStore, EventWriter, Dashboard Server — are reused without API changes; only data shapes and wiring change.

**Major components:**
1. **DependencyScheduler** — Parses `dependsOn` fields into a DAG, detects cycles, returns ready-phase list after each completion
2. **WorkerPool** — Spawns and reaps PhaseWorker instances up to the concurrency limit; calls `shutdownAll()` on SIGINT
3. **PhaseWorker** — Wraps ClaudeService for one phase's discuss/plan/execute/verify lifecycle; emits typed progress events, never touches StateStore
4. **ParallelOrchestrator** — Single-writer coordinator: drives the scheduler loop, applies worker progress to state, owns git worktree setup and merge
5. **EventMultiplexer** — Tails all `events-phase-{N}.ndjson` files, tags events with `workerId`, emits unified stream to SSE broadcast
6. **Git Worktree Manager** — Creates per-worker worktrees pre-execution, merges branches in dependency order post-completion, prunes on crash recovery

### Critical Pitfalls

1. **StateStore lost-update race** — Multiple workers sharing StateStore will clobber each other's phase progress (classic read-modify-write race). Prevention: single-writer pattern where only the orchestrator calls `setState()`. Workers communicate via in-process callbacks, not direct state access.

2. **Git index corruption from concurrent commits** — Parallel Claude Code processes sharing a git working tree corrupt `.git/index` even when touching different files. Prevention: `git worktree add` per worker before execution starts; orchestrator merges branches in dependency order after completion.

3. **NDJSON event file corruption** — Concurrent `appendFile` calls to the same event file can interleave bytes mid-line on Windows and under high load. Prevention: per-worker event files (`events-phase-{N}.ndjson`); EventMultiplexer merges in memory.

4. **ClaudeService singleton guard blocking parallel execution** — ClaudeService throws if `this.running === true`; sharing one instance across workers causes all-but-one to fail. Prevention: one ClaudeService instance per worker; orchestrator maintains a `Map<phaseNumber, ClaudeService>`.

5. **Shared `.planning/` directory conflicts** — Workers calling `gsd-tools state set-field` on the same STATE.md and config.json produce data races. Prevention: git worktree isolation gives each worker its own `.planning/` copy; orchestrator reconciles shared files after merge.

6. **Dependency graph violations** — Launching a phase before its dependency completes produces silently incorrect AI-generated code that may pass per-phase verification but fail at integration. Prevention: reactive Kahn's-algorithm scheduler that only dispatches phases with all dependencies in `completed` status; mark transitive dependents `blocked` on failure.

## Implications for Roadmap

Based on combined research, four phases are recommended. The ordering is driven by hard prerequisites: isolation boundaries must exist before any parallel execution code can be correct, and the execution engine must work before dashboard polish is valuable.

### Phase 1: Foundation — Isolation Boundaries and Scheduler

**Rationale:** Three critical pitfalls (state race, NDJSON corruption, ClaudeService singleton) and one architectural prerequisite (DAG scheduler) all block every subsequent phase. These must be solved together because they define the concurrency model for the entire feature.

**Delivers:**
- DependencyScheduler with cycle detection and reactive ready-phase computation
- Single-writer state model (orchestrator owns all `setState()` calls)
- Multi-instance ClaudeService support (one per worker)
- Per-worker event file convention (`events-phase-{N}.ndjson`)
- IPC type changes (`workerId` on IPCEvent, `activeWorkers` in AutopilotState)

**Features addressed:** DAG-based dependency scheduling, concurrency limit infrastructure, conflict-free state management, backward compatibility (sequential path untouched)

**Pitfalls addressed:** Pitfall 1 (NDJSON corruption), Pitfall 2 (StateStore race), Pitfall 4 (ClaudeService singleton), Pitfall 5 (dependency violations)

**Stack used:** `dependency-graph`, `async-lock`, `p-limit`

### Phase 2: Execution Engine — Parallel Orchestrator and Git Isolation

**Rationale:** With isolation boundaries in place, the execution engine can be built. Git worktree isolation is included here because it affects the `cwd` passed to each ClaudeService — it cannot be added after workers are already running phases.

**Delivers:**
- ParallelOrchestrator (main run loop: scheduler -> pool -> workers -> state)
- WorkerPool with concurrency cap and `shutdownAll()` shutdown
- PhaseWorker class (wraps existing discuss/plan/execute/verify lifecycle)
- Git worktree setup per worker and sequential merge on completion
- `--parallel` and `--concurrency N` CLI flags
- Fail-fast behavior (abort all workers on first failure)
- Graceful shutdown on SIGINT with process group cleanup

**Features addressed:** Multiple ClaudeService instances running simultaneously, concurrency limit (`--concurrency N`), fail-fast behavior, graceful shutdown, phase completion ordering

**Pitfalls addressed:** Pitfall 3 (git merge conflicts), Pitfall 6 (shared `.planning/` conflicts)

**Stack used:** `p-limit`, `async-lock` for state serialization, `git worktree` via child process

### Phase 3: Event Stream and Dashboard Integration

**Rationale:** The execution engine can run headlessly before this phase. Dashboard integration is a distinct concern — EventMultiplexer and SSE wiring are separable from the orchestration logic and can be built and tested after the execution engine is validated.

**Delivers:**
- EventMultiplexer (tails per-worker NDJSON files, emits tagged unified stream)
- SSE route wired to EventMultiplexer for parallel mode
- StateStore `activeWorkers` array populated during parallel execution
- Dashboard API endpoints for per-phase status and question routing
- Per-phase question routing (answers delivered to correct ClaudeService instance)

**Features addressed:** Consolidated event stream with phase tagging, per-phase status in dashboard, per-phase question routing

**Pitfalls addressed:** Pitfall 7 (dashboard SSE confusion from interleaved multi-phase events)

**Stack used:** EventEmitter (existing), `fs.watch` or existing EventTailer pattern

### Phase 4: Polish, Recovery, and UX

**Rationale:** After the three core phases are validated with real parallel runs, polish items become visible. This phase addresses the gaps that emerge from actual usage rather than speculative requirements.

**Delivers:**
- Dashboard UI updates (multi-panel or tabbed view per active worker)
- `--continue` flag (let independent phases finish after a failure)
- Automatic parallelism detection (auto-group parallelizable levels without user specification)
- Startup recovery (git worktree prune, state reconciliation from disk artifacts)
- Per-worker resource cleanup (event file archival, heartbeat cleanup)
- "Looks done but isn't" checklist validation (cycle detection, resume-from-crash, error isolation)

**Features addressed:** `--continue` flag, automatic parallelism detection, execution time estimation

**Pitfalls addressed:** Worker process leak recovery, stale git worktree cleanup, cascading failure isolation

### Phase Ordering Rationale

- Phase 1 before Phase 2: The scheduler and isolation boundaries are prerequisites for a correct execution engine. Building the executor first and retrofitting isolation is the primary source of parallel orchestration bugs in practice.
- Phase 2 before Phase 3: The EventMultiplexer requires per-worker event files (established in Phase 1) and active workers (created in Phase 2). Dashboard integration without a working execution engine has no data to display.
- Phase 3 before Phase 4: UX polish decisions depend on observing real parallel execution behavior. Speculative UI design for multi-phase dashboards consistently diverges from what users actually need once they see it running.
- Git worktree in Phase 2, not Phase 1: Worktree setup requires knowing the `cwd` per worker, which is a WorkerPool responsibility. The isolation model (per-worker files) is a Phase 1 decision; the git-level isolation mechanism is a Phase 2 implementation detail.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (git isolation):** `git worktree` behavior during branch merge conflicts when parallel phases touch overlapping files needs validation against the actual codebase. The ROADMAP.md dependency model should guarantee no overlapping files between non-dependent phases, but empirical testing is warranted.
- **Phase 3 (question routing):** The AnswerPoller architecture and how to scope per-worker answer file lookup without breaking the existing sequential flow needs codebase-specific investigation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (scheduler + isolation):** DAG scheduling with Kahn's algorithm and single-writer state are textbook concurrency patterns. `dependency-graph` npm package is well-documented.
- **Phase 4 (polish):** Recovery strategies and UX patterns follow directly from the pitfalls analysis. No novel research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended packages verified on npm. p-limit (170M downloads), async-lock (777 dependents), dependency-graph (stable 1.0.0 API). Only dependency-graph is MEDIUM individually — simple enough to vendor if abandoned. |
| Features | HIGH | Directly comparable to Turborepo/Nx feature sets. MVP feature list is conservative and based on confirmed user expectations from build-tool ecosystems. |
| Architecture | HIGH | Based on direct codebase analysis of the existing orchestrator, StateStore, ClaudeService, and IPC layer. Component boundaries follow from existing code structure. |
| Pitfalls | HIGH | Pitfalls 1-4 are confirmed against actual source code (state/index.ts, event-writer.ts, claude/index.ts). Pitfall 3 (git) is established computer science fact (git index is not concurrent-safe). Pitfall 5-6 are confirmed via CONCERNS.md. |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude Code process resource footprint:** Each Claude Code child process is estimated at 200-500MB RAM and consumes Anthropic API quota. The default concurrency cap of 3-4 is a heuristic. Empirical measurement on the target machine during Phase 2 will determine if this default needs adjustment.
- **Windows-specific appendFile behavior:** Node.js `appendFile` on Windows does not use `O_APPEND` semantics consistently (documented in write-file-atomic issue #28). The per-worker event file approach eliminates this concern entirely, but any code path that still uses shared append writes needs Windows-specific testing.
- **ROADMAP.md dependency parsing edge cases:** The `dependsOn` field has informal syntax ("Phase 1", "Phase 1, Phase 2", "Phases 1-3", "None"). The DependencyScheduler's regex parser needs to handle all variants. Validation against the actual ROADMAP.md in use is needed during Phase 1 implementation.
- **Merge strategy for overlapping worktree changes:** The research recommends fast-forward merges in dependency order, but if two non-dependent phases both modify a file (indicating a missing dependency declaration), the merge will conflict. The orchestrator needs a clear policy for surfacing this to the user rather than silently failing.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `autopilot/src/orchestrator/index.ts`, `autopilot/src/state/index.ts`, `autopilot/src/ipc/event-writer.ts`, `autopilot/src/claude/index.ts`, `autopilot/src/server/routes/sse.ts`
- `.planning/codebase/CONCERNS.md` — confirmed existing known bugs (StateStore race, ClaudeService concurrency guard)
- [p-limit on npm](https://www.npmjs.com/package/p-limit) — v7.3.0, 170M weekly downloads, verified Feb 2026
- [async-lock on npm](https://www.npmjs.com/package/async-lock) — v1.4.1, in-process async mutex
- [dependency-graph on npm](https://www.npmjs.com/package/dependency-graph) — v1.0.0, DAG with addDependency API
- [Node.js fs documentation](https://nodejs.org/api/fs.html) — appendFile O_APPEND behavior
- [write-file-atomic EPERM issue #28](https://github.com/npm/write-file-atomic/issues/28) — Windows multi-process write race confirmed

### Secondary (MEDIUM confidence)
- [Turborepo configuration reference](https://turborepo.dev/docs/reference/configuration) — concurrency, continue, parallel flags (feature comparison basis)
- [Nx vs Turborepo comparison](https://generalistprogrammer.com/comparisons/turborepo-vs-nx) — feature parity analysis
- [Multi-Agent Parallel Execution patterns](https://skywork.ai/blog/agent/multi-agent-parallel-execution-running-multiple-ai-agents-simultaneously/) — concurrent AI agent state management patterns
- [Building Concurrent Agentic AI Systems](https://dev.to/yeahiasarker/how-to-build-concurrent-agentic-ai-systems-without-losing-control-5ag0) — state management approaches
- [POSIX append atomicity analysis](https://nullprogram.com/blog/2016/08/03/) — PIPE_BUF guarantees for append writes

### Tertiary (LOW confidence)
- [Concurrent vs Parallel LLM API Calls](https://medium.com/@neeldevenshah/concurrent-vs-parallel-execution-in-llm-api-calls-from-an-ai-engineers-perspective-5842e50974d4) — rate limit behavior under concurrent API usage (needs empirical validation for Anthropic Claude Code specifically)

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
