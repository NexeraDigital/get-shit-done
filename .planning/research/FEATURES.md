# Feature Research

**Domain:** Parallel phase orchestration for CLI-based AI agent workflows
**Researched:** 2026-03-11
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| DAG-based dependency scheduling | Every parallel task runner (Turborepo, Nx, Airflow) uses DAGs. Users expect phases to only run when dependencies are satisfied. | MEDIUM | ROADMAP.md already encodes `dependsOn` fields. Parse into DAG, topological sort, dispatch ready nodes. |
| Concurrency limit (`--concurrency N`) | Systems like Turborepo offer `--concurrency` to cap parallel workers. AI agents are resource-heavy (CPU, memory, API rate limits). Unbounded parallelism will crash machines or hit rate limits. | LOW | Default to `os.cpus().length` or a sensible cap like 3-4. Claude Code processes are heavyweight. |
| Fail-fast with `--continue` option | Default: stop all workers when one fails (safe). Opt-in `--continue`: let independent phases finish (useful for collecting all failures). Turborepo, Nx, and Make all support this duality. | MEDIUM | Need cancellation signaling to running ClaudeService instances. The `--continue` flag is the escape hatch. |
| Per-phase status in dashboard | Users running parallel phases need to see which phases are running, completed, failed, or queued. Sequential had one "current phase" -- parallel needs N active statuses. | MEDIUM | Dashboard already renders phase status. Extend to show multiple active phases with individual progress indicators. |
| Consolidated log output with phase tagging | When N phases run simultaneously, interleaved stdout is unreadable. Every phase's output must be tagged/prefixed so users can distinguish sources. Turborepo prefixes output with package names. | LOW | Tag each event in `events.jsonl` with a `phaseId` / `workerId` field. Dashboard groups by phase. |
| Graceful shutdown on SIGINT/SIGTERM | User hits Ctrl+C during parallel execution; all child processes must be cleaned up. Zombie processes are unacceptable. | MEDIUM | Need process group management. Track all spawned ClaudeService PIDs, send SIGTERM on shutdown, force SIGKILL after timeout. |
| Backward compatibility (sequential default) | `--parallel` is opt-in. Running without it must behave identically to current sequential execution. Zero regressions for existing users. | LOW | Guard all parallel code paths behind the flag. Sequential path remains untouched. |
| Phase completion ordering | Even with parallel execution, the final state must reflect phases completed in dependency-valid order. State.json and STATE.md must be consistent. | MEDIUM | Use a completion queue that updates state atomically as each phase finishes, respecting topological order for reporting. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Automatic parallelism detection | Instead of users specifying which phases to parallelize, auto-detect parallelizable groups from the dependency graph. "Just add `--parallel` and it figures it out." | MEDIUM | Topological sort already gives parallelizable levels. Each level's independent nodes run concurrently. This is the expected UX -- users should not manually specify parallelism. |
| Live dependency graph visualization in dashboard | Show a DAG in the dashboard with color-coded nodes (queued/running/done/failed). Users see the execution plan and progress at a glance. | HIGH | Requires frontend DAG rendering (e.g., dagre or elk.js). High value for understanding complex roadmaps but significant frontend work. |
| Intelligent resource-aware scheduling | Monitor system resources (CPU, memory) and throttle worker spawning when the machine is under pressure, rather than using a fixed concurrency limit. | HIGH | Requires polling `os.loadavg()` or similar. Diminishing returns -- a static concurrency cap handles 90% of cases. Defer unless users report resource problems. |
| Per-phase question routing in dashboard | When multiple phases are running, questions from each phase must be routed to the correct context. User sees "Phase 3 asks: ..." and "Phase 5 asks: ..." distinctly. | MEDIUM | Tag questions with `phaseId` in `questions.json`. Dashboard UI groups questions by active phase. Essential for the dashboard experience but not blocking CLI-only usage. |
| Execution time estimation | Track historical phase execution times and estimate remaining time for the overall parallel run. "3 of 7 phases complete. ~12 min remaining." | MEDIUM | ActivityStore already records phase timing. Use historical data to estimate. Accuracy depends on phase similarity. |
| Phase output isolation (separate working directories) | Each parallel phase gets its own working context so file operations don't conflict. Phases write to their own `phases/N/` directory, which is already the convention. | LOW | The existing convention (`phases/N/` directories) already provides natural isolation. Just verify no phase writes outside its directory. The real risk is shared files like STATE.md. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dynamic worker scaling (add/remove mid-run) | "Scale up when machine is idle, scale down under load." | Massive complexity for marginal gain. Adding workers mid-execution means reassigning queued phases, tracking partial state, handling handoffs. The orchestrator run is typically minutes, not hours. | Use static concurrency with `--concurrency N`. User sets it once at start. |
| Cross-phase file locking | "What if two phases edit the same file?" | If two phases need to edit the same file, they have an undeclared dependency. File locking hides a design problem and adds deadlock risk. | Enforce phase independence through the dependency graph. If phases touch the same files, they must be sequential (add a dependency). |
| Distributed execution across machines | "Run phases on multiple machines for more parallelism." | Requires network coordination, shared state, authentication, and failure recovery across machines. Completely different architecture. | Keep it local-only. A single machine with 3-4 parallel Claude Code instances is the practical ceiling for most workflows anyway (API rate limits are the real bottleneck). |
| Automatic retry on failure | "If a phase fails, automatically retry it N times." | AI agent phases are not idempotent -- retrying a partially-completed phase can create duplicate files, duplicate commits, or corrupted state. Blind retry is dangerous. | On failure, stop the phase and let the existing gap-iteration mechanism handle recovery. The user/orchestrator decides whether to re-run, not an automatic retry loop. |
| Priority-based scheduling | "Some phases are more important than others; run them first." | The dependency graph already determines ordering. Adding priority on top creates conflicts (what if a high-priority phase depends on a low-priority one?). Over-engineering for the use case. | Dependency ordering is sufficient. If a phase needs to run early, encode that as a dependency constraint in ROADMAP.md. |
| Speculative execution | "Start a phase before its dependency finishes, discard if dependency fails." | AI agent work is expensive (tokens, time). Discarding completed work wastes money. Speculative execution only makes sense when work is cheap and fast to redo. | Wait for dependencies to complete. The time saved is not worth the token cost of discarded speculative work. |

## Feature Dependencies

```
[DAG-based dependency scheduling]
    |--requires--> [ROADMAP.md dependency parsing]  (already exists)
    |--enables---> [Automatic parallelism detection]
    |--enables---> [Live dependency graph visualization]

[Concurrency limit]
    |--enables---> [Intelligent resource-aware scheduling]

[Per-phase status in dashboard]
    |--requires--> [Consolidated log output with phase tagging]
    |--enables---> [Per-phase question routing]
    |--enables---> [Live dependency graph visualization]

[Fail-fast with --continue]
    |--requires--> [Graceful shutdown / process cleanup]

[Phase completion ordering]
    |--requires--> [DAG-based dependency scheduling]
    |--requires--> [Conflict-free state management]

[Conflict-free state management]  (implicit requirement)
    |--required-by--> [Phase completion ordering]
    |--required-by--> [Per-phase status in dashboard]
```

### Dependency Notes

- **DAG scheduling requires ROADMAP.md parsing:** Already exists via `extractPhasesFromContent()` which reads `dependsOn` fields. Need to build an adjacency list from this.
- **Per-phase dashboard status requires event tagging:** Cannot show per-phase progress without knowing which events belong to which phase. Event tagging is the foundation.
- **Fail-fast requires process cleanup:** If we stop early, we must terminate running workers cleanly. Graceful shutdown is a prerequisite.
- **Phase completion ordering requires conflict-free state:** Multiple workers finishing near-simultaneously must not corrupt `state.json`. Atomic state updates are essential.
- **Live DAG visualization enhances per-phase status:** The DAG view is a richer presentation of the same underlying data. Build the data model first, visualize later.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate parallel execution works.

- [x] `--parallel` CLI flag to enable parallel mode (backward compatible)
- [ ] DAG-based dependency scheduling from ROADMAP.md `dependsOn` fields
- [ ] `--concurrency N` flag with sensible default (e.g., 3)
- [ ] Multiple ClaudeService instances running simultaneously
- [ ] Consolidated event stream with phase tagging in `events.jsonl`
- [ ] Per-phase status display in dashboard (running/queued/done/failed)
- [ ] Fail-fast default behavior (stop all on first failure)
- [ ] Graceful shutdown with child process cleanup on SIGINT
- [ ] Conflict-free state management (atomic updates to `state.json`)
- [ ] Phase completion ordering (state consistency)

### Add After Validation (v1.x)

Features to add once core parallel execution is stable.

- [ ] `--continue` flag to let independent phases finish on failure
- [ ] Per-phase question routing in dashboard
- [ ] Automatic parallelism detection (auto-group parallelizable levels)
- [ ] Execution time estimation from ActivityStore historical data
- [ ] Phase output isolation verification (warn if phase writes outside its directory)

### Future Consideration (v2+)

Features to defer until parallel execution is proven in practice.

- [ ] Live dependency graph visualization in dashboard -- HIGH complexity, needs frontend DAG rendering
- [ ] Intelligent resource-aware scheduling -- only if users report resource contention issues
- [ ] Per-phase log files (write each phase's output to `phases/N/autopilot.log`)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| DAG-based dependency scheduling | HIGH | MEDIUM | P1 |
| Concurrency limit | HIGH | LOW | P1 |
| Multiple ClaudeService instances | HIGH | MEDIUM | P1 |
| Consolidated event stream with tagging | HIGH | LOW | P1 |
| Per-phase dashboard status | HIGH | MEDIUM | P1 |
| Fail-fast behavior | HIGH | MEDIUM | P1 |
| Graceful shutdown / cleanup | HIGH | MEDIUM | P1 |
| Conflict-free state management | HIGH | MEDIUM | P1 |
| Phase completion ordering | MEDIUM | LOW | P1 |
| `--continue` flag | MEDIUM | LOW | P2 |
| Per-phase question routing | MEDIUM | MEDIUM | P2 |
| Automatic parallelism detection | MEDIUM | MEDIUM | P2 |
| Execution time estimation | LOW | MEDIUM | P3 |
| Live DAG visualization | MEDIUM | HIGH | P3 |
| Resource-aware scheduling | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- parallel execution is broken or dangerous without these
- P2: Should have, add when core is stable
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Turborepo | Nx | GSD Autopilot (planned) |
|---------|-----------|-----|-------------------------|
| DAG-based scheduling | Yes, via `dependsOn` in turbo.json | Yes, via project graph | Yes, via ROADMAP.md `dependsOn` |
| Concurrency control | `--concurrency N` flag | `--parallel N` flag | `--concurrency N` flag |
| Continue on failure | `--continue` flag | `--nx-bail=false` | `--continue` flag (P2) |
| Progress UI | Terminal output with package prefixes | Terminal output with project prefixes | Web dashboard with SSE live updates (existing advantage) |
| Caching | Remote and local caching of task outputs | Nx Cloud remote caching | Not applicable (AI agent work is not cacheable) |
| Question routing | N/A (no interactive tasks) | N/A | Per-phase question routing in dashboard |
| Resource monitoring | Not built-in | Not built-in | Defer (P3) |
| Graph visualization | Not built-in (CLI only) | Built-in `nx graph` web UI | Defer (P3) |

**Key insight:** GSD Autopilot's main advantage over build-tool task runners is the **interactive dashboard with question routing**. Turborepo and Nx don't have interactive tasks -- their workers are fire-and-forget builds. GSD's phases involve AI agents that ask questions, making the dashboard and question routing a genuine differentiator.

## Sources

- [Turborepo configuration reference](https://turborepo.dev/docs/reference/configuration) -- concurrency, continue, parallel flags
- [Turborepo concurrency bug with errors](https://github.com/vercel/turborepo/issues/2887) -- failure mode insights
- [Nx vs Turborepo comparison](https://generalistprogrammer.com/comparisons/turborepo-vs-nx) -- feature comparison
- [Multi-Agent Parallel Execution patterns](https://skywork.ai/blog/agent/multi-agent-parallel-execution-running-multiple-ai-agents-simultaneously/) -- concurrent AI agent patterns
- [Building Concurrent Agentic AI Systems](https://dev.to/yeahiasarker/how-to-build-concurrent-agentic-ai-systems-without-losing-control-5ag0) -- state management for parallel agents
- [CLI UX Progress Display Patterns](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays) -- terminal progress UI patterns
- [Google ADK Parallel Agents](https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/) -- parallel agent execution patterns
- [Concurrent vs Parallel LLM API Calls](https://medium.com/@neeldevenshah/concurrent-vs-parallel-execution-in-llm-api-calls-from-an-ai-engineers-perspective-5842e50974d4) -- resource management for concurrent LLM usage

---
*Feature research for: Parallel phase orchestration in GSD Autopilot*
*Researched: 2026-03-11*
