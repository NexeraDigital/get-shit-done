# Pitfalls Research

**Domain:** Parallel phase orchestration for file-based IPC CLI system
**Researched:** 2026-03-11
**Confidence:** HIGH (based on direct codebase analysis and established concurrency engineering principles)

## Critical Pitfalls

### Pitfall 1: NDJSON Event File Corruption from Concurrent appendFile Calls

**What goes wrong:**
Multiple parallel workers each have their own `EventWriter` instance calling `appendFile()` to the same `events.ndjson` file. On Node.js, `appendFile()` does NOT guarantee atomic line-level appends for writes larger than the OS pipe buffer (typically 4096 bytes on Linux, varies on Windows). Two workers writing simultaneously can interleave bytes mid-line, producing corrupted JSON that breaks the dashboard's NDJSON tailer. Even with small payloads, Windows `appendFile` does not use `O_APPEND` semantics consistently -- Node.js opens, seeks, writes, which creates a TOCTOU window.

**Why it happens:**
The current `EventWriter` (line 35 of `event-writer.ts`) uses `appendFile(this.filePath, JSON.stringify(entry) + '\n')` with no file locking. This works fine for a single writer but silently corrupts under concurrent writers. Developers assume append = atomic because it works in testing with low contention.

**How to avoid:**
Give each parallel worker its own event file: `events-phase-{N}.ndjson`. The dashboard tailer watches all files via glob or a manifest. This eliminates contention entirely -- no locking needed. Merge into a single stream in memory on the dashboard side using timestamp+seq ordering. This is cheaper and more reliable than file-level locking.

**Warning signs:**
- Dashboard SSE stream shows JSON parse errors or garbled event lines
- Event tailer crashes with "Unexpected token" errors
- Events appear out of order or with duplicate sequence numbers
- Works fine with 2 parallel workers but breaks at 3+

**Phase to address:**
First phase -- IPC file isolation must be designed before any parallel execution code is written. The per-worker file convention propagates into every component that reads/writes events.

---

### Pitfall 2: StateStore Read-Modify-Write Race Destroying Phase State

**What goes wrong:**
The `StateStore.setState()` method (line 98 of `state/index.ts`) does a shallow merge then atomic write. With multiple parallel workers, this pattern is catastrophically unsafe:

1. Worker A reads state (phases 1,2,3 -- phase 1 status: "in_progress")
2. Worker B reads state (phases 1,2,3 -- phase 2 status: "in_progress")
3. Worker A writes state (phase 1 now "completed")
4. Worker B writes state (phase 2 now "completed", but phase 1 reverts to "in_progress" because B's read was stale)

The `write-file-atomic` library only guarantees the write itself is atomic (no partial files), NOT that the read-modify-write cycle is serialized. This is the classic lost-update problem.

**Why it happens:**
The existing code was designed for single-writer sequential execution. `setState()` uses spread-merge (`{ ...this.state, ...patch }`) which assumes no concurrent mutations. The CONCERNS.md already flags this as a known bug ("State File Race on Concurrent Writes") but the current workaround (idempotent re-runs) does not work when parallel workers clobber each other's phase progress.

**How to avoid:**
Move to an architecture where workers never write to the shared StateStore directly. The orchestrator (single process) owns all state mutations. Workers communicate completion/failure/progress via their per-worker IPC event files. The orchestrator's main event loop reads worker events and applies state transitions sequentially. This is the actor model -- one writer, many readers.

Alternative (if workers must write): use a lock file (`state.json.lock`) with `proper-lockfile` or similar, wrapping every `setState()` in acquire/release. But this adds complexity and deadlock risk. The single-writer approach is strongly preferred.

**Warning signs:**
- Phase status oscillates between "in_progress" and "completed" in dashboard
- Completed phases re-appear as pending after another worker writes state
- State file `lastUpdatedAt` jumps backward in time
- More parallel workers = more frequent state regression

**Phase to address:**
First phase -- the concurrency model for state ownership must be decided before building the scheduler. Every subsequent component depends on who owns state writes.

---

### Pitfall 3: Git Merge Conflicts from Parallel Claude Code Instances Committing

**What goes wrong:**
Each Claude Code child process (spawned via `ClaudeService`) operates on the same git working tree. When two parallel phases both modify and commit files, they create conflicting git states. Phase A commits to HEAD, then Phase B tries to commit but its working tree is now behind HEAD. Even if phases touch different files, git operations are not atomic -- `git add . && git commit` from two processes interleave, causing:
- Staging area corruption (one process's `git add` includes the other's uncommitted changes)
- Commit failures ("not a valid object name" or "merge conflict in index")
- Silently merged changes (Phase B's commit accidentally includes Phase A's files)

**Why it happens:**
Git's index (staging area) is a single shared file (`.git/index`). There is no built-in support for concurrent operations on the same worktree. Developers assume "different files = no conflict" but the git index is global, not per-file.

**How to avoid:**
Use `git worktree` to give each parallel worker its own working directory linked to the same repo. Each worker commits to a temporary branch, and the orchestrator merges branches sequentially after workers complete. This provides full isolation:

```
git worktree add .worktrees/phase-3 -b autopilot/phase-3
git worktree add .worktrees/phase-4 -b autopilot/phase-4
```

After both complete, the orchestrator fast-forward merges each branch into the main branch in dependency order. If a merge conflict occurs (which indicates the dependency graph was wrong), the orchestrator can flag it for resolution.

The `ClaudeService` `cwd` option (line 90 of `claude/index.ts`) already supports per-worker working directories -- pass the worktree path instead of `projectDir`.

**Warning signs:**
- Claude Code processes fail with git errors ("index.lock exists", "merge conflict")
- Commits contain files from unrelated phases
- `git log` shows interleaved commits from different phases (hard to rollback)
- Phase verification fails because expected files are missing (staged by wrong worker)

**Phase to address:**
Second phase (after scheduler design) -- git isolation must be implemented before the execute step runs in parallel. Discuss and plan steps produce files in `.planning/` which is less risky but still needs isolation.

---

### Pitfall 4: ClaudeService Single-Instance Guard Blocking Parallel Execution

**What goes wrong:**
`ClaudeService.runGsdCommand()` (line 71 of `claude/index.ts`) throws immediately if `this.running === true`. With the current design, you cannot run two commands concurrently from a single ClaudeService instance. Naively sharing one instance across parallel workers causes all-but-one to fail with "A command is already running."

**Why it happens:**
ClaudeService was designed as a singleton facade. The `running` flag, `currentAbort`, `currentPhase`, and `currentStep` instance variables all assume single-command execution. The QuestionHandler also assumes one active question context.

**How to avoid:**
Create one `ClaudeService` instance per parallel worker. Each instance manages its own lifecycle, abort controller, and question handler. The orchestrator maintains a `Map<number, ClaudeService>` keyed by phase number. Question events from each instance are tagged with the phase number so the dashboard can route answers correctly.

Do NOT try to make ClaudeService support concurrent commands internally -- that requires rewriting the question handler, abort logic, and event emission to be multiplexed. One instance per worker is simpler and safer.

**Warning signs:**
- "A command is already running" errors when starting second parallel phase
- Questions appear in dashboard without phase context (wrong worker answers)
- Aborting one phase's command kills the other phase's work
- Question answers delivered to wrong worker

**Phase to address:**
First phase -- multi-instance ClaudeService is a prerequisite for any parallel execution.

---

### Pitfall 5: Dependency Graph Violations Causing Silent Correctness Failures

**What goes wrong:**
The ROADMAP.md `dependsOn` field is parsed but never enforced at runtime. If the scheduler launches Phase 4 (which depends on Phase 3's API definitions) concurrently with Phase 3, Phase 4 will execute against stale or missing artifacts. The phase may "succeed" (Claude generates code) but produce incorrect output that fails at integration time or, worse, passes verification because the verifier doesn't cross-check phase dependencies.

**Why it happens:**
Dependency information exists in ROADMAP.md headings (`extractDependsOn()` in orchestrator) but the current sequential loop doesn't need to check it -- phases run in order. When switching to parallel, developers add a "run non-blocked phases concurrently" scheduler but forget to re-validate dependencies when a phase completes (the completion may unblock a phase whose dependencies have changed since the scheduler was initialized).

**How to avoid:**
Build a proper DAG (directed acyclic graph) from ROADMAP.md dependencies. Before launching any phase:
1. Parse all `dependsOn` fields into a dependency graph
2. Validate graph is acyclic (circular dependencies = fatal error, refuse to run)
3. Only enqueue phases whose ALL dependencies have status "completed"
4. When a phase completes, re-evaluate the ready set from the graph (not from a static list)
5. When a phase fails, mark all transitive dependents as "blocked" and skip them

Store the DAG in memory, not in state -- it's derived from ROADMAP.md and should be re-parsed on resume.

**Warning signs:**
- Phase executes but produces code referencing APIs/types from an incomplete dependency
- Verification passes for individual phases but integration fails
- Phase starts before its dependency's verification step completes
- Parallel execution produces different results than sequential execution

**Phase to address:**
First phase -- the scheduler/DAG is the core of parallel orchestration. Get this wrong and correctness is impossible.

---

### Pitfall 6: Shared .planning/ Directory File Conflicts Between Parallel Workers

**What goes wrong:**
Parallel Claude Code instances all read and write to the same `.planning/` directory tree. Even though each phase has its own subdirectory (`.planning/phases/N/`), several shared files exist:
- `.planning/STATE.md` -- gsd-tools updates this during execution
- `.planning/config.json` -- read/written by agents
- `.planning/ROADMAP.md` -- executor may insert sub-phases
- `.planning/autopilot/state.json` -- StateStore writes (covered in Pitfall 2)

Two workers running `/gsd:execute-phase` simultaneously will both call `gsd-tools state set-field`, both read STATE.md, both modify it, and one write clobbers the other.

**Why it happens:**
The GSD tools layer (`gsd-tools`) was built for interactive single-agent use. Every state mutation does read-parse-modify-write on Markdown/JSON files without locking. In sequential mode this is fine. In parallel, it's a data race.

**How to avoid:**
For parallel execution, only the orchestrator should update shared files (STATE.md, ROADMAP.md). Workers should operate on their isolated worktree (see Pitfall 3) where they can modify their own phase directory freely. The orchestrator merges results back.

For `gsd-tools state set-field` calls made by Claude Code child processes: either (a) intercept and redirect these via the system prompt telling Claude Code not to modify STATE.md directly, or (b) use the worktree approach so each worker has its own copy of `.planning/STATE.md` which the orchestrator reconciles.

**Warning signs:**
- STATE.md `current_phase` flickers between different phase numbers
- config.json loses settings that were just written
- ROADMAP.md phase checklist marks regress (completed phases become unchecked)
- gsd-tools errors about malformed frontmatter (partially written files)

**Phase to address:**
Second phase -- directly tied to the git worktree isolation strategy. Design the isolation boundary before implementing execution.

---

### Pitfall 7: Dashboard SSE Stream Confusion with Multiple Active Phases

**What goes wrong:**
The current SSE route (`server/routes/sse.ts`) broadcasts a single event stream to all connected clients. With parallel workers, events from different phases interleave in the stream. The frontend Zustand store expects a single `currentPhase` / `currentStep` -- receiving interleaved updates causes the UI to flicker between phases, show wrong progress indicators, and confuse users about which phase is doing what.

**Why it happens:**
The dashboard was designed for sequential execution where there is exactly one active phase at any time. The state model (`currentPhase: number, currentStep: string`) is singular -- it cannot represent "Phase 3 is executing, Phase 5 is planning, Phase 7 is discussing."

**How to avoid:**
Redesign the state model to support per-phase active status:
- Replace `currentPhase`/`currentStep` with a `Map<phaseNumber, { step, status, startedAt }>` structure (or array of active workers)
- Tag every SSE event with `phaseNumber` so the frontend can route events to the correct UI panel
- Frontend needs a multi-panel layout showing each active worker's progress independently
- Keep `currentPhase` for backward compatibility in sequential mode but add an `activeWorkers` array for parallel mode

**Warning signs:**
- Dashboard progress bar jumps between phases rapidly
- User sees "Executing Phase 3" then "Planning Phase 5" then "Executing Phase 3" in quick succession
- Question prompts appear without clear phase context
- SSE event stream shows events from multiple phases with no grouping

**Phase to address:**
Third phase -- after the scheduler and isolation are working, update the dashboard to render parallel state. This can be deferred because parallel execution can work headlessly without the dashboard initially.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single events.ndjson for all workers | No file management changes | Corruption under load, impossible to debug which worker wrote what | Never for parallel -- always use per-worker files |
| Mutex/lockfile on state.json | Quick fix for concurrent writes | Deadlocks if worker crashes while holding lock, performance bottleneck | Only as interim before single-writer architecture |
| Shared git worktree with "don't touch other phase's files" instruction | No git worktree setup overhead | Silent staging area corruption, unreliable commits | Never -- git index is global, instructions don't prevent race conditions |
| Per-phase branches without worktrees (`git checkout -b`) | Simpler than worktrees | Workers still share index, branch switching is not concurrent-safe | Never -- checkout is mutually exclusive |
| Polling-based worker completion detection | Simple to implement | Latency proportional to poll interval, wasted CPU | Acceptable for MVP if poll interval is 1-2s; replace with event-driven later |
| Reusing sequential dashboard UI for parallel | No frontend work | Confusing UX, users can't tell which phase is active | Acceptable for initial parallel MVP if only used headlessly |

## Integration Gotchas

Common mistakes when connecting parallel workers to existing components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Agent SDK | Sharing one SDK query session across workers | Each worker needs its own `query()` call with independent `AbortController` -- the SDK async generator is not multiplexable |
| AnswerPoller + parallel questions | Routing answers to wrong ClaudeService instance | Tag answer files with phase number (`{questionId}-phase-{N}.json`), each worker's AnswerPoller filters for its phase |
| HeartbeatWriter | Single heartbeat for all workers | Heartbeat should report per-worker liveness; if one worker hangs, others should continue. Use `heartbeat-phase-{N}.json` or a single heartbeat with per-worker status map |
| ActivityStore | All workers appending to same activity array | Either use per-worker activity files (merged on read) or funnel all activity writes through orchestrator |
| Notification Manager | Duplicate notifications when multiple workers trigger similar events | Debounce notifications at the orchestrator level, not worker level; batch "phase started" notifications |
| gsd-tools CLI | Workers calling `gsd-tools state set-field` concurrently on shared STATE.md | Either disable STATE.md writes from workers (orchestrator updates) or provide per-worktree STATE.md copies |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Serializing full state.json on every worker update | Write latency increases, I/O becomes bottleneck | Single-writer model where orchestrator batches state updates; workers communicate via lightweight event files | 4+ parallel workers with frequent step transitions |
| Dashboard polling all per-worker event files individually | CPU spike on dashboard, SSE latency increases | Use `fs.watch()` or `chokidar` on the IPC directory, process only changed files | 6+ workers generating events at high frequency |
| Spawning too many Claude Code processes simultaneously | System OOM, API rate limits, context thrashing | Cap max concurrent workers (default 3-4), queue excess phases | Depends on machine RAM -- each Claude Code process can consume 500MB+ |
| Sequential git merge of all worker branches after completion | Merge time grows linearly with worker count | Merge as workers complete (not all-at-end), fast-forward when possible | 8+ phases completing in rapid succession |

## Security Mistakes

Domain-specific security issues for parallel orchestration.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Worker git worktrees inheriting env vars with secrets | Each Claude Code process gets full `process.env` (noted in CONCERNS.md) -- multiply by N workers means N copies in memory | Whitelist-only env propagation per worker; secrets needed by workers should use per-process scoped tokens |
| Per-worker IPC files world-readable on disk | Parallel execution creates more IPC files, increasing attack surface for local file enumeration | Set restrictive file permissions (0600) on all IPC files; clean up worker files after phase completion |
| Worktree directories left after crash | `git worktree add` creates directories that persist across restarts; stale worktrees can contain uncommitted sensitive code | Register cleanup handler on process exit; add startup sweep that prunes orphaned worktrees |

## UX Pitfalls

Common user experience mistakes with parallel orchestration dashboards.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing all parallel workers in a single log stream | Users cannot follow any one phase's progress -- information overload | Tabbed or split-panel view with one panel per active worker; combined view optional |
| Single progress bar for "overall completion" | Progress jumps erratically as different workers complete at different rates | Show per-worker progress bars plus overall percentage based on total phases completed/total |
| Questions from multiple workers appearing in one list | User answers question thinking it's for Phase 3 but it's for Phase 5 | Tag questions prominently with phase number and color-code; show question in context of its worker's log |
| No indication of which phases are blocked vs. running vs. queued | User thinks system is stuck when phases are just waiting for dependencies | Show dependency graph visualization with phase status: running (green), queued (yellow), blocked (gray), completed (checkmark) |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Parallel scheduler:** Often missing cycle detection in dependency graph -- verify DAG validation rejects circular `dependsOn` references
- [ ] **Per-worker IPC:** Often missing cleanup of worker event files after phase completion -- verify old files are archived or deleted
- [ ] **Git worktree isolation:** Often missing worktree cleanup on crash -- verify `git worktree prune` runs on startup
- [ ] **Dashboard multi-phase view:** Often missing question routing -- verify answering a question delivers to the correct worker's ClaudeService instance
- [ ] **State consistency:** Often missing resume-from-parallel-crash -- verify that restarting after a crash with 3 workers mid-execution correctly reconciles all worker states
- [ ] **Worker resource limits:** Often missing max concurrency cap -- verify that a 20-phase project doesn't spawn 15 simultaneous Claude Code processes
- [ ] **Error isolation:** Often missing cascading failure handling -- verify that one worker crashing doesn't orphan other workers' question handlers or leave lock files
- [ ] **Sequential fallback:** Often missing graceful degradation -- verify that `--parallel` with a linear dependency chain (every phase depends on previous) runs sequentially without overhead

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Event file corruption (interleaved writes) | LOW | Delete corrupted events.ndjson, restart workers -- events are ephemeral, state is in state.json |
| State.json lost-update (concurrent writes) | MEDIUM | Reconcile from disk artifacts (VERIFICATION.md, PLAN.md) -- orchestrator already has reconciliation logic (lines 295-362). May need to re-run verification for affected phases |
| Git index corruption from parallel commits | HIGH | `git stash` uncommitted work, `git fsck` to verify repo integrity, manual merge of worker branches. If index is unrecoverable, workers' worktree directories still contain the source files |
| Dependency violation (phase ran against stale artifacts) | HIGH | Must re-run the affected phase after its dependency completes correctly. No shortcut -- incorrect code generation must be discarded |
| Dashboard state confusion (interleaved SSE) | LOW | Refresh browser -- dashboard re-fetches full state from REST endpoint on reconnect |
| Worker process leak (orphaned Claude Code processes) | MEDIUM | `pkill -f "claude"` or check for orphans via `ps aux | grep claude`. Add PID tracking in orchestrator to kill orphans on shutdown |
| Stale git worktrees after crash | LOW | Run `git worktree list` and `git worktree remove` for any orphaned entries. Add to startup cleanup routine |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| NDJSON corruption (Pitfall 1) | Phase 1: IPC isolation | Test: 4 workers writing events simultaneously for 60s, all lines valid JSON |
| StateStore lost-update (Pitfall 2) | Phase 1: Single-writer architecture | Test: 4 workers completing phases simultaneously, state reflects all completions |
| Git merge conflicts (Pitfall 3) | Phase 2: Git worktree isolation | Test: 2 workers modifying overlapping files, both commits preserved after merge |
| ClaudeService singleton (Pitfall 4) | Phase 1: Multi-instance setup | Test: 3 ClaudeService instances running commands concurrently without interference |
| Dependency violations (Pitfall 5) | Phase 1: DAG scheduler | Test: Phase with unmet dependency is never launched; completes only after dependency |
| Shared .planning/ conflicts (Pitfall 6) | Phase 2: Worktree isolation | Test: Workers cannot see each other's uncommitted changes to .planning/ |
| Dashboard SSE confusion (Pitfall 7) | Phase 3: Dashboard redesign | Test: Dashboard shows correct per-phase status with 3 concurrent workers |

## Sources

- Direct codebase analysis: `autopilot/src/state/index.ts`, `autopilot/src/ipc/event-writer.ts`, `autopilot/src/claude/index.ts`, `autopilot/src/orchestrator/index.ts`
- `.planning/codebase/CONCERNS.md` -- existing known bugs ("State File Race on Concurrent Writes", "ClaudeService Concurrency Protection")
- Node.js `fs.appendFile` documentation -- does not guarantee atomic appends for all platforms and payload sizes
- Git internals -- `.git/index` is a single binary file, not concurrent-safe (established fact, git documentation)
- `write-file-atomic` -- guarantees atomic file replacement but not serialized read-modify-write cycles (package documentation)
- Actor model concurrency pattern -- single-writer principle for state management (established computer science)

---
*Pitfalls research for: GSD Autopilot Parallel Phase Execution*
*Researched: 2026-03-11*
