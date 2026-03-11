# Stack Research: Parallel Process Orchestration in Node.js

**Domain:** Concurrent child process orchestration, DAG-based task scheduling, file-based IPC with multiple writers
**Researched:** 2026-03-11
**Confidence:** HIGH (core patterns use Node.js built-ins and battle-tested libraries)

## Context: What Already Exists

The GSD Autopilot already has:
- **ClaudeService** wrapping `@anthropic-ai/claude-agent-sdk` `query()` -- spawns Claude Code child processes
- **EventWriter** appending NDJSON lines to `events.ndjson` via `fs.appendFile`
- **StateStore** using `write-file-atomic` for crash-safe JSON persistence (single-writer assumption)
- **Orchestrator** running phases sequentially in a `for` loop with EventEmitter events
- **IPC types** defining file paths for events, heartbeat, answers, and state

The parallel milestone extends this -- it does NOT replace it. Stack choices must integrate with the existing codebase, not introduce a parallel framework that fights the current architecture.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js built-in `child_process` | (Node 20+) | Child process spawning | Already used via ClaudeService. No reason to add a wrapper layer -- the SDK handles process lifecycle. |
| Node.js built-in `EventEmitter` | (Node 20+) | Event aggregation from parallel workers | Orchestrator already extends EventEmitter. Each parallel worker emits tagged events; a multiplexer merges them. Zero dependencies. |
| Node.js built-in `fs/promises` | (Node 20+) | File-based IPC reads/writes | Already used throughout. `appendFile` with `O_APPEND` flag is safe for concurrent NDJSON line appends on the same machine (lines under 4KB, which all IPC events are). |
| `write-file-atomic` | ^7.0.0 | Atomic state file writes | Already a dependency. Critical: its internal queue serializes concurrent writes TO THE SAME FILE within one process. For multi-process writes, need a coordination layer on top (see Architecture below). |
| `p-limit` | ^7.3.0 | Concurrency limiter for parallel phase execution | Lightweight (no queue overhead), 170M weekly downloads, actively maintained. Limits how many ClaudeService instances run simultaneously. Use over p-queue because we don't need priority queuing or pause/resume -- just a concurrency cap. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `async-lock` | ^1.4.1 | In-process async mutex for StateStore writes | Use to serialize `setState()` calls from multiple parallel workers within the single orchestrator process. Prevents interleaved read-modify-write on state.json. Lightweight, zero-dependency, well-tested. |
| `dependency-graph` | ^1.0.0 | DAG construction and topological traversal | Use to model phase dependencies from ROADMAP.md `dependsOn` fields. Provides `overallOrder()` for full sort and `dependenciesOf(node)` for individual lookups. Higher-level API than raw toposort -- addNode/addDependency is more readable than edge arrays. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest (existing ^4.0.0) | Testing parallel orchestration logic | Use `vi.useFakeTimers()` for testing heartbeat/polling. Mock ClaudeService to simulate parallel phase completion. |
| TypeScript (existing ~5.9.0) | Type safety for worker state and event contracts | Define discriminated union types for parallel worker events. |

## Why NOT These Alternatives

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `p-queue` | Overkill -- adds priority queuing, pause/resume, and event system we don't need. More surface area for bugs. | `p-limit` -- does exactly one thing (concurrency limiting) and does it well. |
| `worker_threads` | ClaudeService spawns external Claude Code processes via the Agent SDK, not CPU-bound work. Worker threads add complexity (SharedArrayBuffer, structured clone) with zero benefit for I/O-bound orchestration. | `child_process` via existing ClaudeService -- already proven. |
| `proper-lockfile` (^4.1.2) | Inter-process file locking via mkdir + mtime staleness checks. Adds complexity and stale-lock cleanup concerns. Not needed because the orchestrator is a SINGLE process that coordinates multiple ClaudeService child processes -- locking is in-process, not inter-process. | `async-lock` for in-process mutex. The orchestrator process is the single coordinator; child processes communicate through file-based IPC, not shared file writes. |
| `toposort` (^2.0.2) | Works with raw edge arrays `[a, b]` which is less readable than `addDependency('phase3', 'phase2')`. Last published 8 years ago. | `dependency-graph` -- clearer API, similar maturity, better fit for the existing phase model. |
| `flowed` | Full orchestration engine with its own task model, resolvers, and flow definitions. Would require rewriting the Orchestrator to fit flowed's paradigm instead of extending the existing EventEmitter-based design. | Extend existing Orchestrator with DAG scheduling built from `dependency-graph` + `p-limit`. |
| `Bree` / `Agenda` / job schedulers | Designed for recurring cron jobs and persistent job queues with database backends. Massive overkill for one-shot parallel phase execution within a CLI session. | Custom scheduler using `dependency-graph` for ordering + `p-limit` for concurrency. ~50 lines of code. |
| `ipc-event-emitter` / `distributed-eventemitter` | Designed for multi-server or multi-process EventEmitter bridging. The orchestrator is single-process; it doesn't need IPC bridging because it directly holds references to all ClaudeService instances. | Standard EventEmitter with worker-tagged events. |

## Architecture Integration Notes

### How Parallel Execution Fits the Existing System

The orchestrator remains a **single Node.js process**. It does NOT spawn worker threads or child orchestrators. Instead:

1. **DAG Resolution**: Parse ROADMAP.md `dependsOn` fields into a `dependency-graph` instance
2. **Ready Queue**: After each phase completes, recompute which phases have all dependencies satisfied
3. **Concurrency Control**: `p-limit` gates how many ClaudeService instances run simultaneously (default: CPU cores or user-configured `--parallel N`)
4. **State Coordination**: `async-lock` serializes all `StateStore.setState()` calls within the single orchestrator process
5. **Event Multiplexing**: Each parallel worker tags events with `{ workerId, phaseNumber }`. The EventWriter already appends lines atomically via `appendFile` -- multiple calls from the same process are safe.

### File-Based IPC: Multi-Writer Safety

**events.ndjson (APPEND-only)**: Safe for concurrent appends from the single orchestrator process. Each `appendFile` call writes one JSON line. Node.js serializes `appendFile` calls to the same fd within a single process. Tag each event with `phaseNumber` for the dashboard to demux.

**state.json (READ-MODIFY-WRITE)**: NOT safe for concurrent access without coordination. The `async-lock` mutex around `StateStore.setState()` ensures serial read-modify-write cycles. This is the critical coordination point.

**heartbeat.json (OVERWRITE)**: Write-file-atomic handles this. With parallel phases, use a single heartbeat that reports all active workers, not per-worker heartbeats.

**answers/ directory (per-question files)**: Already safe -- each question gets its own file keyed by UUID. No contention.

### What Does NOT Need to Change

- **ClaudeService API**: Already returns `Promise<CommandResult>`. Multiple instances can run concurrently -- each has its own AbortController and question handler.
- **EventWriter append pattern**: Already uses `appendFile` which is safe for concurrent calls from the same process.
- **IPC file paths**: Stay the same. Events get a `phaseNumber` field. State gets mutex protection.
- **Dashboard SSE stream**: Already reads NDJSON lines and state.json. Parallel events are naturally multiplexed in the event stream.

## Installation

```bash
# New dependencies (only 2 new packages)
npm install p-limit@^7.3.0 async-lock@^1.4.1 dependency-graph@^1.0.0

# Dev dependencies (for async-lock types)
npm install -D @types/async-lock@^1.4.0
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| p-limit@^7.3.0 | Node >= 18, ESM only | Project already uses ESM (`"type": "module"`). No CommonJS fallback needed. |
| async-lock@^1.4.1 | Node >= 4, CJS + ESM | Has CJS export but also works via ESM import. `@types/async-lock` provides TypeScript types. |
| dependency-graph@^1.0.0 | Node >= 0.10, CJS | Stable API, import via default export. Types included. |
| write-file-atomic@^7.0.0 | (existing) | Internal queue serializes same-file writes within one process. Still need `async-lock` for the read-modify-write cycle in StateStore. |

## Stack Patterns by Variant

**If parallel phases are few (2-3 concurrent):**
- `p-limit` with concurrency = number of phases. Simple, no tuning needed.
- `async-lock` on StateStore is sufficient -- low contention.

**If parallel phases are many (5+ concurrent):**
- `p-limit` with concurrency cap (e.g., 4) to avoid API rate limits and memory pressure from concurrent Claude sessions.
- Consider batching state updates (collect updates from completed workers, flush once) to reduce lock contention.
- Monitor NDJSON append performance -- at very high event rates, consider buffering events with periodic flush.

**If cross-phase file conflicts emerge (despite dependency guarantees):**
- Add a file-level advisory lock using `proper-lockfile` on specific contested files.
- This should NOT be needed if the dependency graph is correct -- phases with no dependency relationship should not touch the same files.

## Confidence Assessment

| Recommendation | Confidence | Rationale |
|----------------|------------|-----------|
| p-limit for concurrency | HIGH | 170M weekly downloads, actively maintained (v7.3.0 released Feb 2026), well-understood API. Verified on npm. |
| async-lock for StateStore | HIGH | Standard pattern for in-process async mutex. 777 dependents. Only concern: last published 2 years ago, but API is stable and simple. |
| dependency-graph for DAG | MEDIUM | Less popular than toposort but clearer API for this use case. 1.0.0 published 2 years ago. Simple enough to vendor if abandoned. Alternatively, hand-roll topological sort in ~30 lines. |
| No worker_threads | HIGH | ClaudeService spawns external processes via SDK. Worker threads add complexity for zero benefit in I/O-bound orchestration. |
| No proper-lockfile | HIGH | Single orchestrator process means inter-process locking is unnecessary. In-process async-lock is sufficient and simpler. |
| appendFile for NDJSON | HIGH | POSIX O_APPEND guarantees atomic appends for writes under PIPE_BUF (4KB+). All IPC events are well under this. Same-process serialization by Node.js event loop adds further safety. |

## Sources

- [p-limit on npm](https://www.npmjs.com/package/p-limit) -- v7.3.0, 170M weekly downloads
- [p-queue on npm](https://www.npmjs.com/package/p-queue) -- v9.1.0, evaluated and rejected (overkill)
- [async-lock on npm](https://www.npmjs.com/package/async-lock) -- v1.4.1, in-process async mutex
- [dependency-graph on npm](https://www.npmjs.com/package/dependency-graph) -- v1.0.0, DAG with addDependency API
- [toposort on npm](https://www.npmjs.com/package/toposort) -- v2.0.2, evaluated and rejected (lower-level API)
- [proper-lockfile on npm](https://www.npmjs.com/package/proper-lockfile) -- v4.1.2, evaluated and rejected (inter-process locking not needed)
- [write-file-atomic on GitHub](https://github.com/npm/write-file-atomic) -- concurrent write queuing behavior verified
- [write-file-atomic EPERM issue #28](https://github.com/npm/write-file-atomic/issues/28) -- Windows multi-process write race confirmed (supports our single-process coordinator approach)
- [Node.js File System docs](https://nodejs.org/api/fs.html) -- appendFile O_APPEND behavior
- [POSIX append atomicity analysis](https://nullprogram.com/blog/2016/08/03/) -- PIPE_BUF guarantees for append writes

---
*Stack research for: Parallel Process Orchestration in Node.js CLI*
*Researched: 2026-03-11*
