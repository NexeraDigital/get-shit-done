# Phase 1: Scheduler and Isolation Model - Research

**Researched:** 2026-03-11
**Domain:** DAG scheduling, single-writer state serialization, per-worker event isolation
**Confidence:** HIGH

## Summary

Phase 1 builds three foundational modules for parallel execution: (1) a DAG-based dependency scheduler that parses `dependsOn` fields from ROADMAP.md and produces topologically-ordered phase batches, (2) a single-writer state serialization layer that ensures concurrent worker state updates do not lose data, and (3) per-worker event files that isolate NDJSON event streams by worker. No actual parallel execution happens -- these are testable infrastructure components consumed by Phase 2's execution engine.

The existing codebase provides strong foundations. `extractPhasesFromContent()` already parses ROADMAP.md and returns `dependsOn` as raw strings. `StateStore` already uses `write-file-atomic` for crash-safe persistence. `EventWriter` already writes NDJSON events. The work is primarily: parsing `dependsOn` strings into structured dependency arrays, building a topological sort with cycle detection, adding a state serialization queue, and parameterizing `EventWriter` for per-worker file paths.

**Primary recommendation:** Hand-roll Kahn's algorithm (~40 lines) rather than adding the `dependency-graph` npm package. The problem is small (4-20 phases), the code is straightforward, and it avoids a dependency with no TypeScript types for a critical path component.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use ROADMAP.md `dependsOn` field as the source of truth for phase dependencies
- `dependsOn` is reliably written by the roadmapper and parsed by both autopilot (`extractDependsOn()`) and gsd-tools (`roadmap.cjs`), but never enforced at runtime -- this phase adds enforcement
- The raw string format ("Phase 1", "Phase 1, Phase 2", "Nothing") needs structured parsing into phase number arrays
- Phases with no `dependsOn` field are treated as ready immediately (no implicit sequential ordering)
- Missing dependency references (e.g., depends on Phase 99 which doesn't exist): lenient -- warn but treat as satisfied
- Manual mode (`--parallel 2,3,5`): warn but proceed if user specifies phases with unmet dependencies
- Each worker runs in its own git worktree, which naturally isolates `.planning/`
- Workers write state/events to their own worktree's `.planning/autopilot/`
- Orchestrator polls each worktree's `.planning/autopilot/` to track progress
- On merge, worker's `.planning/` contents merge into main branch automatically -- no special cleanup needed
- Orchestrator is the only process that maintains the master view of all workers' state
- Per-worker events must carry: `phaseNumber`, `workerId`, and `stepName` (discuss/plan/execute/verify) in addition to existing `seq`, `timestamp`, `event`, `data` fields
- `dependsOn` string parser lives in autopilot only -- not shared with gsd-tools
- The existing `extractPhasesFromContent()` in `orchestrator/index.ts` already returns `dependsOn` as a raw string -- the scheduler parser should consume this output directly rather than re-parsing ROADMAP.md
- Plan-level `depends_on` (wave ordering within a phase) is a separate concept from phase-level `dependsOn` -- don't conflate them

### Claude's Discretion
- Cycle detection behavior (error vs fallback)
- Event file naming convention
- Backward compat strategy for events.jsonl
- Module organization (new scheduler/ directory vs extending orchestrator/)
- dependency-graph package vs hand-rolled DAG (~30 lines of Kahn's)
- p-limit and async-lock adoption vs alternatives

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-02 | Autopilot auto-detects parallelizable phases from ROADMAP.md `dependsOn` fields using DAG scheduling | DependencyScheduler with parseDependsOn() + Kahn's algorithm topo sort; consumes extractPhasesFromContent() output |
| SCHED-05 | Phases with unmet dependencies are queued until dependencies complete | getReady() method returns only phases whose deps are all in the completed set |
| SCHED-06 | As phases complete, newly eligible phases are automatically dispatched | markComplete(phaseNumber) recalculates ready set and returns newly-eligible phases |
| EXEC-03 | Phase completion updates are atomic and conflict-free across concurrent workers | Single-writer pattern: orchestrator serializes all setState() calls through an async queue; workers write to isolated worktree state |
| EXEC-04 | State consistency is maintained -- STATE.md and state.json reflect accurate parallel status | Orchestrator is sole writer of master state.json; worker states are read-only inputs polled from worktree paths |
| EVNT-01 | Events are tagged with phase/worker ID for source identification | Extended IPCEvent type with phaseNumber, workerId, stepName fields |
| EVNT-02 | Per-worker event files prevent concurrent write conflicts | EventWriter parameterized with worker-specific file path (events-phase-{N}.ndjson) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.0 | Test framework | Already in project devDependencies |
| zod | ^4.0.0 | Schema validation | Already used for state validation |
| write-file-atomic | ^7.0.0 | Crash-safe file writes | Already used by StateStore |
| typescript | ~5.9.0 | Type safety | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | ^10.3.0 | Logging | Already used; scheduler should log warnings via AutopilotLogger |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Kahn's algorithm | `dependency-graph` npm (v1.0.0) | Package lacks TypeScript types, last published Dec 2023, adds dependency for ~40 lines of straightforward code. Hand-roll recommended. |
| Simple async queue for state writes | `async-lock` or `async-mutex` npm | Overkill: Node.js is single-threaded; a simple promise chain (queue pattern) serializes writes without a mutex library. The orchestrator already runs in one event loop. |

**Installation:**
```bash
# No new packages needed -- all dependencies already in project
```

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
  scheduler/
    index.ts              # DependencyScheduler class
    parse-depends-on.ts   # parseDependsOn(raw: string | null): number[]
    __tests__/
      scheduler.test.ts
      parse-depends-on.test.ts
  ipc/
    event-writer.ts       # Extended with workerId/phaseNumber support
    types.ts              # Extended IPCEvent interface
  state/
    index.ts              # StateStore (add write queue if needed)
  orchestrator/
    index.ts              # Existing -- consumes scheduler
```

### Pattern 1: DependencyScheduler Class
**What:** Stateful scheduler that holds the DAG, tracks completed phases, and returns ready-to-execute phases.
**When to use:** Orchestrator creates one instance at startup, feeds it RoadmapPhase[] data, then queries it as phases complete.
**Example:**
```typescript
// Source: Hand-rolled based on Kahn's algorithm pattern
interface SchedulerPhase {
  number: number;
  name: string;
  dependencies: number[];  // parsed from dependsOn string
}

class DependencyScheduler {
  private phases: Map<number, SchedulerPhase>;
  private completed: Set<number>;
  private inProgress: Set<number>;

  constructor(phases: SchedulerPhase[]) {
    this.phases = new Map(phases.map(p => [p.number, p]));
    this.completed = new Set();
    this.inProgress = new Set();
    this.validateNoCycles();
  }

  /** Returns phases whose dependencies are all satisfied and not yet started */
  getReady(): SchedulerPhase[] {
    return [...this.phases.values()].filter(p =>
      !this.completed.has(p.number) &&
      !this.inProgress.has(p.number) &&
      p.dependencies.every(dep => this.completed.has(dep))
    );
  }

  /** Marks a phase as in-progress */
  markInProgress(phaseNumber: number): void {
    this.inProgress.add(phaseNumber);
  }

  /** Marks a phase complete and returns newly-eligible phases */
  markComplete(phaseNumber: number): SchedulerPhase[] {
    this.completed.add(phaseNumber);
    this.inProgress.delete(phaseNumber);
    return this.getReady();
  }

  /** Kahn's algorithm cycle detection */
  private validateNoCycles(): void {
    const inDegree = new Map<number, number>();
    for (const p of this.phases.values()) {
      if (!inDegree.has(p.number)) inDegree.set(p.number, 0);
      for (const dep of p.dependencies) {
        // Only count edges to known phases (lenient on missing refs)
        if (this.phases.has(dep)) {
          inDegree.set(p.number, (inDegree.get(p.number) ?? 0) + 1);
        }
      }
    }
    const queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([num]) => num);
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      for (const p of this.phases.values()) {
        if (p.dependencies.includes(current) && this.phases.has(current)) {
          const newDeg = (inDegree.get(p.number) ?? 1) - 1;
          inDegree.set(p.number, newDeg);
          if (newDeg === 0) queue.push(p.number);
        }
      }
    }
    if (visited < this.phases.size) {
      throw new CycleError(/* identify cycle participants */);
    }
  }
}
```

### Pattern 2: parseDependsOn String Parser
**What:** Pure function that converts raw `dependsOn` strings into phase number arrays.
**When to use:** Called once per phase when building the scheduler from RoadmapPhase[].
**Example:**
```typescript
/**
 * Parses the raw dependsOn string from ROADMAP.md into an array of phase numbers.
 *
 * Handles formats:
 *   "Nothing" | "Nothing (first phase)" | null | "" -> []
 *   "Phase 1" -> [1]
 *   "Phase 1, Phase 2" -> [1, 2]
 *   "Phase 1 and Phase 3" -> [1, 3]
 *   "Phases 1, 2" -> [1, 2]  (less common but possible)
 */
export function parseDependsOn(raw: string | null): number[] {
  if (!raw || /^nothing/i.test(raw.trim())) return [];
  const numbers: number[] = [];
  const matches = raw.matchAll(/(\d+(?:\.\d+)?)/g);
  for (const m of matches) {
    numbers.push(parseFloat(m[1]!));
  }
  return [...new Set(numbers)]; // deduplicate
}
```

### Pattern 3: Per-Worker EventWriter
**What:** EventWriter parameterized with worker identity for isolated event files.
**When to use:** Each worker gets its own EventWriter instance writing to a worker-specific path.
**Example:**
```typescript
// Extended IPCEvent with worker metadata
export interface IPCEvent {
  seq: number;
  timestamp: string;
  event: string;
  data: unknown;
  phaseNumber?: number;   // NEW: which phase this worker handles
  workerId?: string;      // NEW: unique worker identifier
  stepName?: string;      // NEW: discuss/plan/execute/verify
}

// Event file path with worker isolation
export const IPC_PATHS = {
  // ... existing paths ...
  workerEvents: (projectDir: string, phaseNumber: number) =>
    join(projectDir, '.planning', 'autopilot', 'log', `events-phase-${phaseNumber}.ndjson`),
} as const;
```

### Pattern 4: Single-Writer State Queue
**What:** Async queue ensuring setState() calls are serialized even if multiple async paths try to write concurrently.
**When to use:** Orchestrator's master state store when polling multiple worktrees.
**Example:**
```typescript
// Simple promise-chain queue (no library needed)
class StateWriteQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn, fn); // run fn regardless of prior failure
    this.chain = next;
    return next;
  }
}

// Usage in orchestrator:
const writeQueue = new StateWriteQueue();
// All state mutations go through queue
await writeQueue.enqueue(() => stateStore.setState({ ... }));
```

### Anti-Patterns to Avoid
- **Re-parsing ROADMAP.md in the scheduler:** The scheduler should accept pre-parsed `RoadmapPhase[]` from `extractPhasesFromContent()`, not read files itself.
- **Confusing phase-level `dependsOn` with plan-level `depends_on`:** These are different concepts. This phase only handles phase-level dependencies.
- **Implicit sequential ordering:** Phases without `dependsOn` are ready immediately -- do not assume they must wait for lower-numbered phases.
- **Strict failure on missing deps:** A phase depending on "Phase 99" (which doesn't exist) should warn and treat the dep as satisfied, not throw.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes | Custom rename-swap | `write-file-atomic` (already in deps) | Handles Windows EPERM retries, platform edge cases |
| Schema validation | Manual type checks | Zod schemas (already used) | Consistent with existing StateStore pattern |
| NDJSON serialization | Custom protocol | `JSON.stringify() + '\n'` per line | Simple enough, no library needed |

**Key insight:** This phase is primarily algorithmic (DAG operations) plus mechanical extensions of existing patterns (EventWriter, StateStore). The codebase already has the right tools; the work is connecting them correctly.

## Common Pitfalls

### Pitfall 1: dependsOn String Format Variations
**What goes wrong:** Parser fails on unexpected string formats from the roadmapper.
**Why it happens:** The roadmapper (Claude-generated ROADMAP.md) produces varied natural language: "Phase 1", "Phase 1, Phase 2", "Phase 1 and Phase 3", "Nothing (first phase)", "Phases 1-3", etc.
**How to avoid:** Extract ALL numbers via regex `\d+(?:\.\d+)?` and treat everything else as decoration. Test with all known variants from existing ROADMAP.md files.
**Warning signs:** Unit tests only cover "Phase 1" format.

### Pitfall 2: Cycle Detection Must Be Constructor-Time
**What goes wrong:** Cycles only detected when trying to get ready phases, causing confusing errors mid-execution.
**Why it happens:** Lazy validation defers the error to runtime.
**How to avoid:** Run cycle detection in the DependencyScheduler constructor. Fail fast with a descriptive error listing the cycle path.
**Warning signs:** No constructor-time validation tests.

### Pitfall 3: Decimal Phase Numbers
**What goes wrong:** Phase numbers like 2.1 (inserted phases) don't parse or compare correctly.
**Why it happens:** Using parseInt instead of parseFloat, or string comparison instead of numeric.
**How to avoid:** The existing codebase uses `parseFloat()` consistently (see `extractPhasesFromContent()`). Follow this pattern. Dependencies like "Phase 2.1" must parse to 2.1.
**Warning signs:** Tests only use integer phase numbers.

### Pitfall 4: Event File Backward Compatibility
**What goes wrong:** Dashboard EventTailer breaks because it hardcodes `events.ndjson` path.
**Why it happens:** New per-worker event files use different paths but EventTailer still reads the old path.
**How to avoid:** Keep the original `events.ndjson` path for single-worker (sequential) mode. Only use `events-phase-{N}.ndjson` when running in parallel. EventTailer changes are Phase 4 scope (EVNT-03 consolidation).
**Warning signs:** EventTailer tests fail after changes.

### Pitfall 5: State Mutation Race Conditions
**What goes wrong:** Two async operations both read state, modify different fields, and write back -- one overwrites the other.
**Why it happens:** Even though Node.js is single-threaded, async operations interleave between awaits.
**How to avoid:** Use a write queue that serializes all setState() calls. Each mutation reads-modifies-writes within a single queued operation.
**Warning signs:** Intermittent test failures when running concurrent state updates.

## Code Examples

Verified patterns from existing codebase:

### Consuming extractPhasesFromContent() for Scheduler Input
```typescript
// Source: autopilot/src/orchestrator/index.ts (existing code)
import { extractPhasesFromContent } from '../orchestrator/index.js';
import { parseDependsOn } from './parse-depends-on.js';

// Build scheduler from roadmap phases
const roadmapPhases = extractPhasesFromContent(roadmapContent);
const schedulerPhases = roadmapPhases
  .filter(p => !p.completed)
  .map(p => ({
    number: p.number,
    name: p.name,
    dependencies: parseDependsOn(p.dependsOn),
  }));
const scheduler = new DependencyScheduler(schedulerPhases);
```

### Extending EventWriter for Worker Metadata
```typescript
// Source: autopilot/src/ipc/event-writer.ts (existing pattern, extended)
export class EventWriter {
  private seq = 0;
  private readonly filePath: string;
  private readonly metadata: { phaseNumber?: number; workerId?: string };
  private initialized = false;

  constructor(projectDir: string, options?: { phaseNumber?: number; workerId?: string }) {
    // Use worker-specific path if phaseNumber provided, else default
    this.filePath = options?.phaseNumber
      ? IPC_PATHS.workerEvents(projectDir, options.phaseNumber)
      : IPC_PATHS.events(projectDir);
    this.metadata = {
      phaseNumber: options?.phaseNumber,
      workerId: options?.workerId,
    };
  }

  async write(event: string, data: unknown, stepName?: string): Promise<void> {
    await this.ensureDir();
    this.seq++;
    const entry: IPCEvent = {
      seq: this.seq,
      timestamp: new Date().toISOString(),
      event,
      data,
      ...(this.metadata.phaseNumber != null && { phaseNumber: this.metadata.phaseNumber }),
      ...(this.metadata.workerId != null && { workerId: this.metadata.workerId }),
      ...(stepName != null && { stepName }),
    };
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
```

### Existing StateStore Atomic Write Pattern
```typescript
// Source: autopilot/src/state/index.ts (existing code)
// StateStore.persist() already uses write-file-atomic with EPERM retry.
// The single-writer queue wraps this existing method:

const writeQueue = new StateWriteQueue();
await writeQueue.enqueue(async () => {
  await stateStore.setState({
    phases: updatedPhases,
    currentPhase: nextPhase,
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential phase loop | DAG-based scheduling | This phase | Enables Phase 2 parallel execution |
| Single events.ndjson | Per-worker event files | This phase | Eliminates write conflicts in parallel mode |
| Direct setState() calls | Queued setState() calls | This phase | Prevents interleaved state mutations |

**Deprecated/outdated:**
- Nothing deprecated in this phase. All changes are additive/backward-compatible.

## Open Questions

1. **Event file naming: `events-phase-{N}.ndjson` vs `events-worker-{id}.ndjson`**
   - What we know: ROADMAP.md success criteria says `events-phase-{N}.ndjson`. Workers are 1:1 with phases.
   - What's unclear: Whether worker ID should be the phase number or a separate UUID.
   - Recommendation: Use phase number as worker ID (e.g., `events-phase-3.ndjson`, `workerId: "phase-3"`). Simpler, matches the success criteria, and each worker handles exactly one phase.

2. **Backward compatibility of events.ndjson**
   - What we know: EventTailer hardcodes `IPC_PATHS.events()` which returns `events.ndjson`. Dashboard consumes this.
   - What's unclear: Whether to keep writing to `events.ndjson` in parallel mode or only use per-worker files.
   - Recommendation: In sequential mode (no --parallel), continue writing to `events.ndjson`. In parallel mode, write to per-worker files only. Phase 4 (EVNT-03) will consolidate worker files for the dashboard.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.0 |
| Config file | `autopilot/vitest.config.ts` |
| Quick run command | `cd autopilot && npx vitest run src/scheduler` |
| Full suite command | `cd autopilot && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-02 | DAG scheduling from dependsOn fields | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts -x` | Wave 0 |
| SCHED-05 | Unmet deps queued until satisfied | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts -x` | Wave 0 |
| SCHED-06 | Newly eligible phases dispatched on completion | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts -x` | Wave 0 |
| EXEC-03 | Atomic conflict-free state updates | unit | `cd autopilot && npx vitest run src/state/__tests__/state-store.test.ts -x` | Existing (extend) |
| EXEC-04 | State consistency across parallel status | unit | `cd autopilot && npx vitest run src/state/__tests__/state-store.test.ts -x` | Existing (extend) |
| EVNT-01 | Events tagged with phase/worker/step | unit | `cd autopilot && npx vitest run src/ipc/__tests__/event-writer.test.ts -x` | Existing (extend) |
| EVNT-02 | Per-worker event files prevent conflicts | unit | `cd autopilot && npx vitest run src/ipc/__tests__/event-writer.test.ts -x` | Existing (extend) |

### Sampling Rate
- **Per task commit:** `cd autopilot && npx vitest run src/scheduler`
- **Per wave merge:** `cd autopilot && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `autopilot/src/scheduler/__tests__/scheduler.test.ts` -- covers SCHED-02, SCHED-05, SCHED-06
- [ ] `autopilot/src/scheduler/__tests__/parse-depends-on.test.ts` -- covers dependsOn string parsing
- [ ] Extend `autopilot/src/ipc/__tests__/event-writer.test.ts` -- covers EVNT-01, EVNT-02
- [ ] Extend `autopilot/src/state/__tests__/state-store.test.ts` -- covers EXEC-03, EXEC-04

## Sources

### Primary (HIGH confidence)
- `autopilot/src/orchestrator/index.ts` -- extractPhasesFromContent(), extractDependsOn(), RoadmapPhase interface
- `autopilot/src/ipc/event-writer.ts` -- existing EventWriter pattern
- `autopilot/src/ipc/types.ts` -- IPCEvent interface, IPC_PATHS
- `autopilot/src/state/index.ts` -- StateStore with write-file-atomic, Zod validation
- `autopilot/src/types/state.ts` -- PhaseState with dependsOn field
- `.planning/ROADMAP.md` -- dependsOn format examples
- `.planning/phases/01-scheduler-and-isolation-model/01-CONTEXT.md` -- locked decisions

### Secondary (MEDIUM confidence)
- [jriecken/dependency-graph GitHub](https://github.com/jriecken/dependency-graph) -- evaluated and rejected: no TypeScript types, v1.0.0 from Dec 2023

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, no new deps needed
- Architecture: HIGH -- patterns directly derived from existing codebase conventions
- Pitfalls: HIGH -- identified from reading actual code (EventTailer path hardcoding, parseFloat usage, string format variations)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain, no external API changes expected)
