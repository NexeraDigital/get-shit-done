# Architecture Research

**Domain:** Parallel phase orchestration for AI-driven build system
**Researched:** 2026-03-11
**Confidence:** HIGH (based on direct codebase analysis + established concurrency patterns)

## System Overview

```
+-----------------------------------------------------------------+
|                    CLI Entry (--parallel flag)                    |
+-----------------------------------------------------------------+
         |
+-----------------------------------------------------------------+
|                     Parallel Orchestrator                        |
|  +-----------+  +----------------+  +------------------------+  |
|  | Dependency|  | Worker Pool    |  | Unified State Manager  |  |
|  | Scheduler |  | Manager        |  | (single-writer)        |  |
|  +-----------+  +----------------+  +------------------------+  |
|       |              |                       |                   |
|       | readyPhases  | spawn/track           | read/write       |
|       +-------->-----+ workers               | state.json       |
+-----------------------------------------------------------------+
         |              |                       |
    +----+---------+----+----+---------+        |
    |              |         |         |        |
+--------+   +--------+  +--------+   |  +----------+
|Worker 1|   |Worker 2|  |Worker N|   |  | Dashboard|
| Phase3 |   | Phase5 |  | Phase7 |   |  | Server   |
|--------|   |--------|  |--------|   |  |----------|
|Claude  |   |Claude  |  |Claude  |   |  | SSE mux  |
|Service |   |Service |  |Service |   |  | API      |
|--------|   |--------|  |--------|   |  | React UI |
|EventW. |   |EventW. |  |EventW. |   |  +----------+
|per-wkr |   |per-wkr |  |per-wkr |   |       |
+---+----+   +---+----+  +---+----+   |       |
    |            |            |        |       |
    +------------+------------+--------+-------+
    |            IPC Layer (file-based)        |
    |  events-{workerId}.ndjson (per-worker)   |
    |  state.json (single-writer via orch.)    |
    |  answers/{questionId}.json (dashboard)   |
    |  heartbeat-{workerId}.json (per-worker)  |
    +------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| Parallel Orchestrator | Owns the run loop, decides which phases to start, owns StateStore exclusively | Dependency Scheduler, Worker Pool, Dashboard (via events) |
| Dependency Scheduler | Parses ROADMAP.md `dependsOn` fields, computes which phases are ready to execute | Parallel Orchestrator (provides ready-phase list) |
| Worker Pool Manager | Spawns/tracks/reaps ClaudeService child processes, enforces concurrency limit | Parallel Orchestrator (lifecycle), Workers (spawn/kill) |
| Worker (per-phase) | Runs the discuss-plan-execute-verify lifecycle for one phase, writes events | Worker Pool (parent), IPC layer (events/heartbeat) |
| Unified State Manager | Single-writer wrapper around StateStore, accepts state-update messages from workers via callback | Parallel Orchestrator (exclusive writer) |
| Event Multiplexer | Merges per-worker event streams into single SSE broadcast for dashboard | Workers (reads their event files), Dashboard (SSE push) |
| Dashboard Server | Renders all active phases, routes questions to correct worker | Event Multiplexer (SSE), API routes (questions/answers) |

## Recommended Project Structure

```
autopilot/src/
  orchestrator/
    index.ts              # Existing sequential orchestrator (unchanged)
    parallel.ts           # NEW: ParallelOrchestrator class
    scheduler.ts          # NEW: Dependency graph + ready-phase computation
    worker-pool.ts        # NEW: Worker lifecycle management
    worker.ts             # NEW: Single-phase worker (wraps ClaudeService)
    gap-detector.ts       # Existing (reused per-worker)
    discuss-handler.ts    # Existing (reused per-worker)
    yolo-config.ts        # Existing (reused)
  ipc/
    types.ts              # MODIFIED: Add workerId to IPCEvent
    event-writer.ts       # MODIFIED: Accept workerId prefix
    event-multiplexer.ts  # NEW: Tails multiple event files, merges into single stream
    heartbeat-writer.ts   # MODIFIED: Support per-worker heartbeat files
    answer-poller.ts      # MODIFIED: Route answers to correct worker
    file-state-reader.ts  # Existing (unchanged)
    answer-writer.ts      # Existing (unchanged)
  state/
    index.ts              # MODIFIED: Add worker-state tracking fields
  server/
    routes/
      sse.ts              # MODIFIED: Wire EventMultiplexer as event source
      api.ts              # MODIFIED: Add per-worker phase status, question routing
    index.ts              # Existing (unchanged)
  claude/
    index.ts              # Existing (unchanged, one instance per worker)
  types/
    state.ts              # MODIFIED: Add parallel execution fields
```

### Structure Rationale

- **orchestrator/parallel.ts separate from index.ts**: The sequential orchestrator remains the default. `--parallel` flag instantiates ParallelOrchestrator instead. No risk to existing behavior.
- **orchestrator/scheduler.ts**: Dependency graph logic is pure (no I/O) and independently testable. Extracting it avoids bloating the orchestrator.
- **orchestrator/worker-pool.ts**: Worker lifecycle (spawn, health check, reap) is a distinct concern from scheduling. Separation enables testing pool behavior without real ClaudeService instances.
- **ipc/event-multiplexer.ts**: Merging N event streams is a new concern that doesn't belong in the existing EventWriter or EventTailer. The multiplexer tails all `events-{workerId}.ndjson` files and emits a unified stream.

## Architectural Patterns

### Pattern 1: Single-Writer State with Worker Callbacks

**What:** Only the ParallelOrchestrator writes to `state.json`. Workers report progress via typed callbacks (not direct StateStore access). The orchestrator serializes all state mutations through its event loop.

**When to use:** Always for parallel mode. The existing StateStore uses in-memory state + atomic file writes, which assumes a single writer. Multiple writers to the same `state.json` would cause lost updates (last-write-wins).

**Trade-offs:**
- Pro: Zero concurrency bugs in state management. StateStore code unchanged.
- Pro: Workers don't need StateStore dependency injection.
- Con: Slight latency between worker progress and state persistence (milliseconds, negligible).

**Example:**
```typescript
// ParallelOrchestrator owns the StateStore
class ParallelOrchestrator {
  private readonly stateStore: StateStore;

  // Workers report progress via this callback
  private handleWorkerProgress(workerId: string, update: WorkerUpdate): void {
    const state = this.stateStore.getState();
    const phase = state.phases.find(p => p.number === update.phaseNumber);
    if (!phase) return;

    // Merge worker update into phase state
    phase.steps[update.step] = update.stepStatus;
    phase.status = update.phaseStatus;

    // Single atomic write -- no races
    this.stateStore.setState({ phases: state.phases });
  }
}

// Worker emits typed events, never touches StateStore
class PhaseWorker extends EventEmitter {
  async run(phase: PhaseState): Promise<void> {
    this.emit('progress', {
      phaseNumber: phase.number,
      step: 'discuss',
      stepStatus: 'discuss', // in-progress
      phaseStatus: 'in_progress',
    });
    // ... run discuss via ClaudeService ...
    this.emit('progress', {
      phaseNumber: phase.number,
      step: 'discuss',
      stepStatus: 'done',
      phaseStatus: 'in_progress',
    });
  }
}
```

### Pattern 2: Per-Worker Event Files with Multiplexed Tailing

**What:** Each worker writes to its own NDJSON event file (`events-{workerId}.ndjson`). An EventMultiplexer tails all active event files and merges events into a single ordered stream for SSE broadcast.

**When to use:** For parallel mode where multiple ClaudeService processes produce log output simultaneously.

**Trade-offs:**
- Pro: No write contention. `appendFile` to separate files is naturally safe.
- Pro: Each worker's log is independently readable for debugging.
- Pro: Multiplexer uses the existing EventTailer pattern (proven, tested).
- Con: More files on disk. Acceptable -- these are in `.planning/autopilot/log/`.

**Example:**
```typescript
class EventMultiplexer extends EventEmitter {
  private tailers = new Map<string, EventTailer>();

  addWorker(workerId: string, eventFilePath: string): void {
    const tailer = new EventTailer(eventFilePath);
    tailer.on('event', (evt) => {
      // Tag event with worker ID before broadcasting
      this.emit('event', {
        ...evt,
        data: { ...evt.data, workerId },
      });
    });
    this.tailers.set(workerId, tailer);
    tailer.start();
  }

  removeWorker(workerId: string): void {
    const tailer = this.tailers.get(workerId);
    if (tailer) {
      tailer.stop();
      this.tailers.delete(workerId);
    }
  }
}
```

### Pattern 3: Dependency Graph Scheduling (Kahn's Algorithm Variant)

**What:** Parse `dependsOn` fields from ROADMAP.md phases into a DAG. Use a reactive variant of topological sort: when a phase completes, re-evaluate which phases are now unblocked. Phases with no unmet dependencies are "ready" and can be dispatched to workers.

**When to use:** Every scheduling decision in parallel mode.

**Trade-offs:**
- Pro: Correct by construction -- impossible to run a phase before its dependencies.
- Pro: Maximizes parallelism (all independent phases run simultaneously).
- Pro: The `dependsOn` field already exists in ROADMAP.md, no new markup needed.
- Con: Circular dependencies cause deadlock. Must detect cycles at parse time and fail fast.

**Example:**
```typescript
class DependencyScheduler {
  private readonly deps: Map<number, number[]>; // phase -> depends-on phases
  private readonly completed: Set<number>;

  constructor(phases: PhaseState[]) {
    this.deps = new Map();
    this.completed = new Set();

    for (const phase of phases) {
      if (phase.status === 'completed' || phase.status === 'skipped') {
        this.completed.add(phase.number);
      }
      this.deps.set(phase.number, this.parseDependsOn(phase.dependsOn));
    }

    this.detectCycles(); // Throws if circular
  }

  /** Returns phases ready to execute (all deps met, not completed, not running) */
  getReadyPhases(running: Set<number>): number[] {
    const ready: number[] = [];
    for (const [phase, deps] of this.deps) {
      if (this.completed.has(phase)) continue;
      if (running.has(phase)) continue;
      if (deps.every(d => this.completed.has(d))) {
        ready.push(phase);
      }
    }
    return ready;
  }

  markCompleted(phase: number): void {
    this.completed.add(phase);
  }

  private parseDependsOn(dep: string | null | undefined): number[] {
    if (!dep || dep === 'None') return [];
    // Parse "Phase 1", "Phase 1, Phase 2", "Phases 1-3"
    const nums: number[] = [];
    const pattern = /(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = pattern.exec(dep)) !== null) {
      nums.push(parseFloat(m[1]!));
    }
    return nums;
  }

  private detectCycles(): void {
    // Standard DFS cycle detection on the dependency graph
    // Throws Error with cycle path if found
  }
}
```

### Pattern 4: Concurrency-Limited Worker Pool

**What:** A pool that maintains at most N active workers. When a worker completes, the pool checks the scheduler for newly ready phases and spawns replacements up to the limit.

**When to use:** Always in parallel mode. The concurrency limit prevents resource exhaustion (each ClaudeService spawns a Claude Code child process consuming memory and API quota).

**Trade-offs:**
- Pro: Prevents resource exhaustion. Default limit of 3-4 workers is sensible for local execution.
- Pro: Backpressure is automatic -- scheduler only returns ready phases, pool only spawns up to limit.
- Con: Suboptimal if limit is too low (phases that could run don't). User-configurable via `--max-workers`.

**Example:**
```typescript
class WorkerPool {
  private readonly maxWorkers: number;
  private readonly active = new Map<number, PhaseWorker>(); // phaseNumber -> worker

  constructor(maxWorkers: number = 3) {
    this.maxWorkers = maxWorkers;
  }

  get availableSlots(): number {
    return this.maxWorkers - this.active.size;
  }

  spawn(phase: PhaseState, claudeService: ClaudeService): PhaseWorker {
    if (this.active.size >= this.maxWorkers) {
      throw new Error('Worker pool at capacity');
    }
    const worker = new PhaseWorker(phase, claudeService);
    this.active.set(phase.number, worker);
    worker.on('done', () => this.active.delete(phase.number));
    worker.on('failed', () => this.active.delete(phase.number));
    return worker;
  }

  async shutdownAll(): Promise<void> {
    const aborts = Array.from(this.active.values()).map(w => w.abort());
    await Promise.allSettled(aborts);
  }
}
```

## Data Flow

### Parallel Execution Flow

```
[CLI --parallel]
    |
    v
[ParallelOrchestrator.run()]
    |
    v
[DependencyScheduler.getReadyPhases(running={})]
    |
    | returns: [Phase 1, Phase 2, Phase 3]  (no dependencies)
    v
[WorkerPool.spawn(phase1), spawn(phase2), spawn(phase3)]
    |         |               |
    v         v               v
[Worker1]  [Worker2]       [Worker3]
  discuss    discuss         discuss
  plan       plan            plan
  execute    execute         execute
  verify     verify          verify
    |         |               |
    | emit    | emit          | emit
    | progress| progress      | progress
    v         v               v
[ParallelOrchestrator.handleWorkerProgress()]
    |
    v
[StateStore.setState()] <-- single writer, serialized
    |
    v
[EventMultiplexer merges worker event files]
    |
    v
[Dashboard SSE broadcast to all connected clients]
```

### Worker Completion Triggers Re-scheduling

```
[Worker1 completes Phase 1]
    |
    v
[ParallelOrchestrator]
    |
    +---> [DependencyScheduler.markCompleted(1)]
    |
    +---> [DependencyScheduler.getReadyPhases(running={2,3})]
    |       |
    |       | returns: [Phase 4]  (depended on Phase 1)
    |       v
    +---> [WorkerPool.spawn(phase4)]
```

### Question Routing Flow

```
[Worker2 ClaudeService emits question:pending]
    |
    v
[ParallelOrchestrator records question with workerId + phaseNumber]
    |
    v
[StateStore.setState({ pendingQuestions: [...] })]
    |
    v
[Dashboard SSE: question-pending { workerId, phase, questions }]
    |
    v
[User answers in dashboard UI]
    |
    v
[POST /api/questions/:id { answers }]
    |
    v
[QuestionProvider routes to correct Worker's ClaudeService.submitAnswer()]
    |
    v
[Worker2 ClaudeService unblocks, continues execution]
```

### State Management

```
                    Single Writer
                         |
+---[Worker1]---+        v        +---[Dashboard]---+
| emit progress |---> [Parallel   | GET /api/status  |
+---------------+     Orchestr.]  | GET /api/phases  |
+---[Worker2]---+        |        +---------+--------+
| emit progress |---> setState()            |
+---------------+        |           reads state.json
+---[Worker3]---+        v           (FileStateReader)
| emit progress |---> state.json
+---------------+
```

**Key invariant:** Only the ParallelOrchestrator process calls `stateStore.setState()`. Workers communicate progress via in-process EventEmitter callbacks (not file writes to state.json). The dashboard reads `state.json` via FileStateReader (read-only).

## Integration with Existing Architecture

### What Changes

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `orchestrator/index.ts` | **Unchanged** | Sequential orchestrator remains default |
| `cli/index.ts` | **Modified** | Parse `--parallel` and `--max-workers` flags, instantiate ParallelOrchestrator when parallel |
| `state/index.ts` (StateStore) | **Modified** | Add `activeWorkers` field to AutopilotState for dashboard display |
| `types/state.ts` | **Modified** | Add `WorkerState`, `activeWorkers` array, per-phase `workerId` |
| `ipc/types.ts` | **Modified** | Add optional `workerId` to IPCEvent |
| `ipc/event-writer.ts` | **Modified** | Constructor accepts workerId, writes to `events-{workerId}.ndjson` |
| `server/routes/sse.ts` | **Modified** | Accept EventMultiplexer as event source in addition to existing modes |
| `server/routes/api.ts` | **Modified** | Question routing looks up workerId to dispatch answer |
| `claude/index.ts` | **Unchanged** | Each worker creates its own ClaudeService instance |

### What Does Not Change

- The `ClaudeService` class is instantiated per-worker with no modifications. Its `running` guard prevents concurrent commands within a single worker, which is correct (each worker runs one phase sequentially).
- The `StateStore` class API does not change. Only the data shape (AutopilotState) gains new optional fields.
- The dashboard React UI needs updates but the Express server structure stays the same.
- All existing IPC file paths remain valid. Parallel mode adds new files alongside them.
- Sequential mode (`--parallel` omitted) uses the existing Orchestrator class with zero changes.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| CLI to Orchestrator | Constructor injection | CLI decides sequential vs parallel, instantiates the right class |
| Orchestrator to Workers | EventEmitter callbacks | Workers emit 'progress', 'question', 'done', 'failed' events |
| Orchestrator to StateStore | Direct method calls | Single-writer pattern, `setState()` is serialized |
| Workers to IPC | Per-worker EventWriter | Each worker has its own event file, no contention |
| EventMultiplexer to Dashboard | EventEmitter (in-process) or file-tail | Multiplexer emits merged events, SSE broadcasts |
| Dashboard to Workers (answers) | File-based via answers/{id}.json | AnswerPoller in each worker checks for its questions |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-3 parallel phases | Default. No tuning needed. 3 ClaudeService processes + orchestrator fit in ~2GB RAM. |
| 4-8 parallel phases | Increase `--max-workers`. Monitor API rate limits. Each Claude Code process uses ~200-500MB. |
| 8+ parallel phases | Likely hits API rate limits before local resources. Consider staggered starts (500ms delay between spawns). |

### Scaling Priorities

1. **First bottleneck: API rate limits.** Multiple Claude Code processes hit the same Anthropic API key. Mitigation: `--max-workers` defaults to 3. Workers retry on 429 responses (already handled by Claude Agent SDK).
2. **Second bottleneck: Memory.** Each Claude Code child process loads its own Node.js runtime + model context. At 8+ workers, expect 4-8GB memory usage. Mitigation: configurable pool size, worker reap on completion.
3. **Third bottleneck: Git contention.** Multiple workers running `git commit` simultaneously can cause lock conflicts. Mitigation: Workers should serialize git operations through a shared mutex or queue commits through the orchestrator.

## Anti-Patterns

### Anti-Pattern 1: Multiple Writers to state.json

**What people do:** Give each worker its own StateStore instance that writes to the same `state.json`.
**Why it's wrong:** `write-file-atomic` prevents corruption but not lost updates. Worker A reads state, Worker B reads state, both modify and write -- one update is lost. The `setState()` method does read-modify-write without any locking.
**Do this instead:** Single-writer pattern. Only the orchestrator process writes state. Workers report progress via in-process callbacks.

### Anti-Pattern 2: Shared NDJSON Event File for All Workers

**What people do:** All workers append to the same `events.ndjson` file.
**Why it's wrong:** `appendFile` is atomic per-call on most OS/FS combinations, but NDJSON lines from different workers can interleave within a single flush buffer, producing malformed JSON lines. Also makes per-worker log inspection impossible.
**Do this instead:** Per-worker event files (`events-{workerId}.ndjson`). EventMultiplexer merges them for the dashboard.

### Anti-Pattern 3: Spawning All Phases Immediately

**What people do:** Launch workers for all N phases at once, hoping the dependency graph sorts itself out.
**Why it's wrong:** Phases with unmet dependencies will try to read artifacts (PLAN.md, CONTEXT.md) that don't exist yet, causing failures and wasted API spend.
**Do this instead:** Dependency-driven scheduling. Only spawn workers for phases whose `dependsOn` phases are all completed.

### Anti-Pattern 4: Worker-to-Worker Communication

**What people do:** Have workers coordinate directly (e.g., worker A signals worker B that a shared resource is ready).
**Why it's wrong:** Creates hidden coupling, race conditions, and debugging nightmares. The phases are independent by design -- the dependency graph enforces ordering.
**Do this instead:** All coordination goes through the orchestrator. Workers are isolated. When a worker completes, the orchestrator checks what's newly unblocked.

### Anti-Pattern 5: Polling state.json from Workers

**What people do:** Workers poll `state.json` to check if other phases completed.
**Why it's wrong:** Unnecessary I/O, race conditions, and violates single-writer invariant (workers should not even read state.json -- they get their phase config at spawn time).
**Do this instead:** Workers receive their phase config at construction time and report back via events. The orchestrator manages all cross-phase knowledge.

## Build Order Implications

The components have clear dependency ordering for implementation:

### Wave 1: Foundation (no dependencies)
1. **DependencyScheduler** -- Pure logic, no I/O, fully unit-testable. Parse `dependsOn` strings, build DAG, detect cycles, compute ready phases.
2. **IPC type changes** -- Add `workerId` to `IPCEvent`, new state fields. Non-breaking additions.

### Wave 2: Worker Infrastructure (depends on Wave 1)
3. **PhaseWorker** -- Extract per-phase lifecycle (discuss/plan/execute/verify) from existing Orchestrator into a standalone class. This is mostly reorganizing existing code.
4. **Per-worker EventWriter** -- Modify EventWriter constructor to accept workerId and use `events-{workerId}.ndjson` path.
5. **WorkerPool** -- Spawn/track/reap PhaseWorker instances with concurrency limit.

### Wave 3: Orchestration (depends on Wave 2)
6. **ParallelOrchestrator** -- Main run loop: scheduler -> pool -> workers -> state updates. Single-writer state management.
7. **EventMultiplexer** -- Tail multiple per-worker event files, emit merged stream.

### Wave 4: Dashboard Integration (depends on Wave 3)
8. **SSE wiring** -- Connect EventMultiplexer to SSE broadcast.
9. **Question routing** -- Route answers from dashboard to correct worker's ClaudeService.
10. **CLI integration** -- `--parallel` and `--max-workers` flags, instantiate correct orchestrator.

### Wave 5: Polish
11. **Dashboard UI updates** -- Show per-worker status, parallel phase indicators.
12. **Graceful shutdown** -- Abort all workers on SIGINT, persist state.
13. **Error isolation** -- When one worker fails, others continue. Failed phase can be retried.

## Sources

- Direct codebase analysis of `autopilot/src/orchestrator/index.ts` (sequential orchestrator pattern)
- Direct codebase analysis of `autopilot/src/state/index.ts` (StateStore single-writer pattern)
- Direct codebase analysis of `autopilot/src/ipc/` (file-based IPC, EventWriter append pattern)
- Direct codebase analysis of `autopilot/src/claude/index.ts` (ClaudeService concurrency guard)
- Direct codebase analysis of `autopilot/src/server/routes/sse.ts` (SSE broadcast pattern)
- Direct codebase analysis of `autopilot/src/types/state.ts` (AutopilotState shape)
- Established patterns: Kahn's algorithm for topological sort, worker pool pattern, single-writer concurrency

---
*Architecture research for: GSD Autopilot Parallel Phase Execution*
*Researched: 2026-03-11*
