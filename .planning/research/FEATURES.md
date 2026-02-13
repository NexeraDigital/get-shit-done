# Feature Landscape

**Domain:** AI-assisted development orchestration CLI with web dashboard
**Researched:** 2026-02-13
**Overall confidence:** MEDIUM-HIGH (broad competitive landscape surveyed; specific feature depth varies)

---

## Table Stakes

Features users expect. Missing = product feels incomplete.

### CLI UX

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Single-command start (`npx gsd-autopilot --prd ./idea.md`) | Every competitor (Codex CLI, Taskmaster, Aider) launches with one command. Users won't tolerate multi-step setup. | Low | Already in PRD. The `npx` pattern is standard for Node.js CLI tools. |
| `--resume` flag to continue interrupted runs | LangGraph checkpointing, Taskmaster resume, and Claude Code's `/gsd:resume-work` set this expectation. Agents crash, machines sleep, networks drop. Without resume, long builds are fragile. | Med | Depends on robust state persistence (see Orchestration). File-based state in `.planning/autopilot-state.json` is the right approach. |
| Config file support (`.gsd-autopilot.json`) | Cosmiconfig pattern (used by Prettier, ESLint, etc.) is standard. Users expect CLI flags to be overridable via config file. The 12-factor app methodology demands env var support too. | Low | Support hierarchy: CLI flags > env vars > config file > defaults. |
| `--dry-run` mode | Users need to preview what the tool will do before committing to a full run. Taskmaster has `list` and `next` commands; Kiro has spec preview. No dry-run = anxiety about uncontrolled execution. | Low | Show planned phases, estimated steps, and which notifications will fire without executing anything. |
| Progress display in terminal | `cli-progress` bars, phase/step indicators, and colored output are universal in CLI tools. Claude Squad and Conductor both show real-time status. Silent CLIs feel broken. | Low | Spinner during execution, phase summary on completion, clear error formatting. |
| `--phases N-M` to run subset | Partial execution is expected for iteration and debugging. GSD already has per-phase commands. An orchestrator that forces all-or-nothing is too rigid. | Low | Already in PRD. |
| `--verbose` / `--quiet` flags | Standard CLI convention. Every Node.js CLI tool supports log verbosity control. Kilo emphasizes visible context windows; users want control over noise level. | Low | Default: summary output. `--verbose`: full claude output. `--quiet`: errors only. |
| Graceful Ctrl+C handling | Process must clean up state on interrupt so `--resume` works. Half-written state files corrupt workflows. This is a baseline CLI expectation. | Low | Trap SIGINT/SIGTERM, flush state to disk, log clean exit. |

### Orchestration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Linear phase sequencing (init > plan > execute > verify per phase) | Every spec-driven tool (GSD, BMAD, Kiro, Spec Kit) follows this pattern. It's the core workflow. | Med | The state machine is the heart of the product. Get this right first. |
| Automatic retry on transient failure (1 retry per step) | Codex iterates without drifting. LangGraph supports retry policies. A single failed `claude -p` call shouldn't halt the entire build. | Low | Already in PRD. Retry once, then escalate to human via notification. |
| State persistence to disk after every step | LangGraph checkpointing, Temporal durable workflows, and the filesystem-based agent state pattern all converge on this. Without it, resume is impossible. | Med | JSON file in `.planning/autopilot-state.json`. Must be atomic writes (write temp file, rename) to avoid corruption. |
| Phase-level status tracking (pending/in-progress/completed/failed) | Conductor, Claude Squad, and Taskmaster all show per-task status. Users need to know where they are. | Low | Stored in state file, rendered in both CLI and dashboard. |
| Timeout per `claude -p` call | LLM calls can hang. The PRD specifies 10-minute timeout. Without it, the orchestrator blocks forever on a stalled call. | Low | Already in PRD. Configurable via `--timeout` flag. |
| Output parsing for success/failure signals | The orchestrator must detect whether each step succeeded. Pattern matching on `claude -p` stdout is the mechanism in the PRD. | Med | Fragile if GSD output format changes. Consider structured markers or exit codes as primary signal, text patterns as fallback. |

### Notification Channels

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Console notifications (default, zero-config) | Every CLI tool has terminal output. This is the baseline channel. | Low | Already in PRD. Colored, formatted, with clickable URL to web UI. |
| Multiple simultaneous channels (`--notify console,system`) | n8n, Kilo-for-Slack, and GitHub Actions all support multi-channel notifications. Users want redundancy (terminal + toast, or terminal + Slack). | Low | Already in PRD. Adapter pattern makes this straightforward. |
| Notification includes enough context to act | GitHub Copilot's agent posts to Slack with PR links; n8n surfaces outputs with approve/reject. A notification that says "question pending" with no context forces unnecessary clicks. | Low | Include: phase name, question summary, options preview, response URL. |

### Web Dashboard

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Overall progress view (phases completed / total) | Conductor's unified dashboard, Claude Squad's terminal status — every orchestrator shows progress. | Low | Progress bar + phase list with status indicators. |
| Question response interface | This is the core human-in-the-loop mechanism. Options as clickable buttons, freeform text for "other." Kiro and GSD discuss-phase both collect structured decisions. | Med | Already detailed in PRD. Card-style buttons with descriptions. |
| Real-time updates (SSE) | SSE is the standard for server-to-client push in 2026. Conductor shows live agent status. A dashboard that requires manual refresh feels broken. | Med | SSE is lighter than WebSockets for this unidirectional use case. Auto-reconnect on connection drop is essential. |
| Log viewer with filtering | Every monitoring tool (PM2, Grafana, Datadog) provides filterable logs. Users debugging a failed phase need to see that phase's logs, not scroll through everything. | Med | Filter by phase, by log level. Search within logs. Auto-scroll with pause-on-hover. |

### Error Recovery

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Human-escalation on repeated failure | After retry fails, the tool must notify the human with context (what failed, error output, suggested actions: retry/skip/abort). Autonomous tools that silently fail are useless. | Med | Already in PRD. Error notification with response options via web UI. |
| Skip-phase option on failure | Sometimes a phase is blocked by an external dependency. The human should be able to skip it and continue, not abort the entire build. | Low | Add "skip" as a response option alongside "retry" and "abort." |

---

## Differentiators

Features that set GSD Autopilot apart. Not expected, but valued.

### CLI UX

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `--skip-discuss` / `--skip-verify` flags for full autonomy | Competitors (Codex, Devin) are fully autonomous. GSD's discuss-phase is unique but adds friction. Letting users opt out per-run gives flexibility that neither fully-autonomous nor fully-manual tools offer. | Low | Already in PRD. The spectrum from full-human-control to full-autonomy in a single tool is a genuine differentiator vs. competitors that pick one mode. |
| `--depth` and `--model` flags for cost/quality control | GSD's profile system (quality/balanced/budget) is unique in the orchestration space. Taskmaster supports multi-model but doesn't tie it to planning depth. Developers want token-spend control. | Low | Already in PRD. Expose as simple flags, not complex config. |
| Estimated cost / token usage preview | No competitor shows estimated cost before execution. With LLM API costs being a real concern, showing "this build will use ~X tokens across Y calls" builds trust and prevents bill shock. | Med | Requires token estimation heuristics based on phase count, depth, and model profile. Doesn't need to be exact — ballpark is valuable. |
| Post-build summary report | After completion, generate a concise summary: phases completed, total commits, files created/modified, total time, questions answered, errors recovered. Devin provides session summaries; GSD Autopilot should too. | Low | Aggregate from state file and logs. Print to console and save to `.planning/autopilot-summary.md`. |

### Orchestration

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Discuss-phase question batching | The PRD's approach of batching 2-3 related questions reduces notification spam and context-switching. No competitor batches human decisions this way — they either ask one-by-one (Kiro) or skip human input entirely (Devin, Codex). | Med | Already in PRD. The gray-area extraction via lightweight analysis prompt is the key innovation. |
| Phase-level gap detection and re-execution loop | GSD's verify > find gaps > plan gaps > execute gaps cycle is more sophisticated than competitors' pass/fail verification. Most tools (Codex, Taskmaster) run once and report results. GSD Autopilot's self-healing loop is a genuine differentiator. | High | Already in PRD. This is the most complex orchestration feature. The verify-gap-fix cycle can theoretically loop forever — needs a max-iterations guard (e.g., 3 attempts). |
| YOLO-mode config auto-generation | Automatically writing `.planning/config.json` with all gates disabled removes the friction of configuring GSD for automation. No other wrapper tool handles this transparently. | Low | Already in PRD. |
| Pluggable adapter system for custom notification channels | Teams, Slack, and console cover 90% of users. But enterprise teams have PagerDuty, Opsgenie, Discord, custom bots. The `--adapter-path ./my-adapter.js` pattern lets anyone extend without forking. BMAD and Taskmaster don't offer this. | Med | Already in PRD. The `NotificationAdapter` interface is clean. Document it well with examples. |

### Web Dashboard

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Phase detail view with step-by-step progress | Conductor shows diffs; Claude Squad shows terminal output. GSD Autopilot can show the full phase lifecycle (discuss > plan > execute > verify) with status per step. This granularity is unique to spec-driven orchestrators. | Med | Already in PRD. Leverage the rich `.planning/` file structure that GSD generates. |
| Question change-before-pickup | The PRD mentions users can change their response before the orchestrator picks it up. This is a subtle but important UX detail — no competitor offers this. Prevents regret from hasty clicks. | Low | Already in PRD. Requires polling interval between question submission and orchestrator consumption. |
| Activity feed (completions, errors, commits) | A real-time feed of what's happening creates a sense of momentum and transparency. Conductor's dashboard provides similar visibility. | Med | SSE events already cover the data. Render as a scrollable timeline. |

### Error Recovery & Resilience

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Structured error context in notifications | When sending error notifications, include: phase, step, error message, last 20 lines of output, and suggested actions. Most tools dump raw error output. Structured context helps humans triage faster without opening logs. | Med | Parse `claude -p` stderr and last stdout lines. Format into the `Notification` object's `body` field with markdown. |
| Automatic state cleanup on abort | If the user chooses "abort," the orchestrator should leave the project in a clean, resumable state — not a half-written mess. The "land the plane" pattern from Mike Mason's analysis applies here. | Med | On abort: commit any uncommitted work, update state to last-completed-phase, write abort reason to state file. |

### Logging & Observability

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Structured JSON logs alongside human-readable logs | AgentTrace (2026) and OpenTelemetry convergence show that structured logs are becoming standard for agent workflows. JSON logs enable programmatic analysis; human-readable logs enable quick debugging. Both are needed. | Med | Write `.planning/autopilot-log/phase-N-step.log` (human-readable) and `.planning/autopilot-log/events.jsonl` (structured). |
| Per-phase timing and token metrics | No competitor tracks per-phase resource consumption. This data helps users optimize their `--depth` and `--model` choices for future runs. | Med | Capture: wall-clock time per phase, estimated tokens per `claude -p` call (from output if available), total time. Write to state file. |
| Log streaming to dashboard via SSE | Already in PRD. The real differentiator is making logs useful — color-coded by level, filterable by phase, searchable. Most agent dashboards show raw terminal output. | Med | Depends on SSE infrastructure. |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Multi-project orchestration** | Running multiple GSD projects simultaneously adds enormous complexity (shared ports, resource contention, state conflicts). Conductor and Claude Squad already solve multi-agent parallelism at the agent level. GSD Autopilot's value is single-project depth, not breadth. | Keep single-project-per-invocation constraint. Users who want parallelism can run multiple instances with different `--port` values. |
| **Built-in CI/CD integration** | The PRD explicitly scopes this out. CI/CD environments have different security models, authentication patterns, and resource constraints. Attempting to support GitHub Actions, Jenkins, etc. would dilute focus. | Stay local-only. If users want CI/CD, they wrap the CLI in their pipeline scripts. |
| **Authentication on the web dashboard** | The dashboard runs on localhost. Adding auth adds complexity with zero security benefit for the target use case (solo developer on local machine). Enterprise teams needing auth are a different product. | Document that the dashboard is localhost-only. If users need remote access, they handle SSH tunneling or VPN themselves. |
| **Bidirectional Slack/Teams interaction** | The PRD correctly identifies that notifications are outbound-only and responses come through the web UI. Bidirectional chat integration (respond to questions in Slack) requires bot infrastructure, message threading, state synchronization, and platform-specific quirks. Massive complexity for marginal convenience. | Keep notifications outbound-only. All responses through the local web UI. The notification includes a clickable URL — one click to respond. |
| **Built-in AI model/API management** | GSD Autopilot wraps `claude -p`. It should not manage API keys, model selection beyond GSD's profiles, or provider switching. Tools like Cline and Kilo that support 500+ models have a completely different architecture. | Delegate model management to GSD config and Claude Code. Autopilot controls depth/profile flags, not the underlying model infrastructure. |
| **Visual code diff viewer in dashboard** | Conductor's diff-first review is compelling but requires a full diff rendering engine (Monaco editor, syntax highlighting, multi-file diffs). This is a large frontend investment that duplicates git tooling. | Link to git diffs from the phase detail page. Users already have VS Code, GitHub, or `git diff` for reviewing changes. Show commit hashes and file lists, not inline diffs. |
| **Mobile-responsive dashboard** | Conductor advertises phone-based review. For GSD Autopilot, the dashboard is a local development tool. Building mobile-responsive layouts for a localhost app used during active development sessions is unnecessary scope. The question-response page could be minimally mobile-friendly since notification links open on phones, but the full dashboard should not target mobile. | Make the question response page (`/respond/:id`) mobile-usable (simple buttons, readable text). Don't optimize the dashboard, log viewer, or phase detail for mobile. |
| **Plugin/extension system for the orchestrator** | Notification adapters are pluggable (good). But making the entire orchestration pipeline pluggable (custom phases, custom verification strategies, hook points) creates an API surface that's expensive to maintain and constrains future changes. | Keep orchestration opinionated. If users need different workflows, they fork or contribute upstream. Notification adapters are the right extension point. |
| **Persistent cross-run history/analytics** | Tracking build history across multiple runs, showing trends, comparing builds — this is a monitoring product, not an orchestrator. First run should work perfectly without any historical context. | Each run is independent. State file is per-run. If users want analytics, they parse the structured logs. |

---

## Feature Dependencies

```
Config file support → All flag-based features (config provides defaults for flags)
State persistence → Resume capability
State persistence → Phase status tracking
State persistence → Dashboard progress view
SSE infrastructure → Real-time dashboard updates
SSE infrastructure → Log streaming to dashboard
SSE infrastructure → Activity feed
Notification adapter interface → All notification channels (console, system, Teams, Slack, custom)
Notification adapter interface → Pluggable custom adapters
Question response API → Question response UI
Question response API → Orchestrator blocking/unblocking on human input
Express server → All web dashboard features
Express server → API routes
React SPA → All dashboard pages (progress, question response, phase detail, log viewer)
Output parsing → Phase-level gap detection loop
Output parsing → Automatic retry logic
Discuss-phase handler → Question batching
Phase sequencing (state machine) → Gap detection loop
Phase sequencing (state machine) → Skip-phase on failure
Structured JSON logs → Per-phase timing metrics
Structured JSON logs → Programmatic log analysis
Graceful Ctrl+C handling → Clean resume state
```

Dependency chains (critical path):

```
State machine (core) → State persistence → Resume → Ctrl+C handling
                     → Phase tracking → Dashboard progress
                     → Output parsing → Gap detection loop
                     → Error escalation → Notification system → Adapters

Express server → API routes → SSE infrastructure → Dashboard real-time
             → React SPA → Question response UI → Human-in-the-loop flow

Notification adapter interface → Console adapter (P0)
                               → System toast adapter (P1)
                               → Webhook adapters (Teams/Slack/custom) (P2)
```

---

## MVP Recommendation

Prioritize in this order:

1. **State machine + state persistence** (table stakes orchestration) — Without this, nothing works. The orchestrator's phase sequencing and disk-persisted state are the foundation.
2. **Console notifications** (table stakes notification) — Zero-dependency default channel. Users see progress and questions in terminal.
3. **Express server + question response API/UI** (table stakes human-in-the-loop) — The single-page question response is the minimum viable web interface. No full dashboard needed for MVP.
4. **Resume capability** (table stakes CLI) — Long builds will be interrupted. Resume prevents lost work.
5. **SSE + dashboard progress view** (table stakes dashboard) — Once the Express server exists, adding SSE and a progress page is incremental.
6. **Discuss-phase question batching** (differentiator) — This is GSD Autopilot's signature feature. Ship it early to differentiate from fully-autonomous competitors.

Defer:
- **System/Teams/Slack adapters**: Console + web UI is sufficient for launch. Webhook adapters come in a later phase.
- **Structured JSON logs**: Human-readable logs first. Structured logs are a v1.1 feature.
- **Cost estimation preview**: Useful but not blocking. Add after real-world usage data informs the heuristics.
- **Phase detail view**: The progress overview and question response cover MVP needs. Drill-down comes later.
- **Log viewer with search/filter**: Raw log files are accessible for debugging. A polished log viewer is a later phase.

---

## Sources

- [Faros AI: Best AI Coding Agents for 2026](https://www.faros.ai/blog/best-ai-coding-agents-2026) — Competitor feature comparison across Cursor, Claude Code, Codex, Copilot, Cline, Aider
- [Tembo: 2026 Guide to Coding CLI Tools](https://www.tembo.io/blog/coding-cli-tools-comparison) — Table stakes vs differentiators for 15 CLI coding tools
- [Conductor (GoForIt)](https://www.goforgeit.com/) — Dashboard, parallel execution, mobile review, git worktree isolation
- [Claude Squad](https://github.com/smtg-ai/claude-squad) — Terminal-based multi-agent management with tmux and git worktrees
- [Taskmaster AI](https://github.com/eyaltoledano/claude-task-master) — PRD parsing, task management, multi-model support
- [Kiro (AWS)](https://kiro.dev/) — Spec-driven development, agent hooks, structured specs from natural language
- [BMAD Method](https://pasqualepillitteri.it/en/news/158/framework-ai-spec-driven-development-guide-bmad-gsd-ralph-loop) — 21 specialized agents, role-based collaboration, sprint ceremonies
- [GitHub Spec Kit](https://github.com/github/spec-kit) — Microsoft/GitHub's spec-driven development toolkit
- [Mike Mason: AI Coding Agents (Jan 2026)](https://mikemason.ca/writing/ai-coding-agents-jan-2026/) — Conductor vs orchestrator patterns, "land the plane" error recovery, Beads state management
- [Addy Osmani: LLM Coding Workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/) — Multi-agent parallel work, human oversight, CI as quality gate
- [claude-flow (ruvnet)](https://github.com/ruvnet/claude-flow) — Multi-agent swarms, hive mind coordination, 60+ pre-built agents
- [RedMonk: 10 Things Developers Want from Agentic IDEs](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/) — Developer expectations for agent tooling
- [Devin AI](https://devin.ai/agents101) — Fully autonomous agent, sandboxed execution, Slack integration
- [AgentTrace: Structured Logging for Agent Observability](https://arxiv.org/html/2602.10133) — Schema-based multi-surface observability model
- [Galileo: Multi-Agent Failure Recovery](https://galileo.ai/blog/multi-agent-ai-system-failure-recovery) — Checkpoint/retry patterns for agent systems
- [Filesystem-Based Agent State Pattern](https://agentic-patterns.com/patterns/filesystem-based-agent-state/) — File-based state persistence for agent workflows
- [n8n: Human-in-the-Loop Automation](https://blog.n8n.io/human-in-the-loop-automation/) — Notification + wait + approve patterns
- [Node.js CLI Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices) — Config file conventions, signal handling, output formatting
