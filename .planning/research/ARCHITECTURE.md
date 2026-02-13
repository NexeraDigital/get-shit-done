# Architecture Patterns

**Domain:** Node.js CLI orchestration tool with embedded web dashboard and AI agent integration
**Researched:** 2026-02-13

## Recommended Architecture

### High-Level System Diagram

```
                                     ┌──────────────────────────┐
                                     │    Human (Browser)       │
                                     │  http://localhost:3847   │
                                     └────────┬───────▲─────────┘
                                              │       │
                                         POST │   SSE │
                                      answers │  events│
                                              │       │
┌─────────────────────────────────────────────▼───────┴──────────────────────┐
│  gsd-autopilot (single Node.js process)                                    │
│                                                                            │
│  ┌──────────────┐     events     ┌─────────────────────────────────────┐  │
│  │  CLI Entry    │──────────────>│  Orchestrator (EventEmitter-based)   │  │
│  │  (Commander)  │               │                                     │  │
│  └──────────────┘               │  States: init → phase_discuss →     │  │
│                                  │  phase_plan → phase_execute →       │  │
│                                  │  phase_verify → [next phase] →      │  │
│                                  │  complete                           │  │
│                                  │                                     │  │
│                                  │  ┌───────────────┐                  │  │
│                                  │  │ State Store    │ <──> autopilot- │  │
│                                  │  │ (in-memory +   │      state.json │  │
│                                  │  │  file-backed)  │                  │  │
│                                  │  └───────────────┘                  │  │
│                                  └──────┬─────────┬───────────────────┘  │
│                                         │         │                      │
│                          ┌──────────────┘         └──────────────┐      │
│                          │                                        │      │
│                          ▼                                        ▼      │
│  ┌──────────────────────────────┐    ┌────────────────────────────────┐  │
│  │  Claude Integration           │    │  Response Server (Express.js)  │  │
│  │  (@anthropic-ai/              │    │                                │  │
│  │   claude-agent-sdk)           │    │  GET  /api/status              │  │
│  │                               │    │  GET  /api/questions           │  │
│  │  query() → async generator    │    │  POST /api/questions/:id       │  │
│  │  canUseTool → intercept       │    │  GET  /api/log/stream (SSE)    │  │
│  │  AskUserQuestion              │    │  GET  /*  → React SPA          │  │
│  └──────────────────────────────┘    └────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────┐    ┌────────────────────────────────┐  │
│  │  Notification Manager         │    │  Logger                        │  │
│  │                               │    │                                │  │
│  │  adapters: console, system,   │    │  writes to:                    │  │
│  │  teams, slack, custom         │    │  .planning/autopilot-log/      │  │
│  └──────────────────────────────┘    └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | Interface |
|-----------|---------------|-------------------|-----------|
| **CLI Entry** | Parse args, load config, bootstrap all components, start orchestrator | Orchestrator, Response Server, Notification Manager | Commander.js parsed options object |
| **Orchestrator** | Sequence GSD phases, manage state transitions, coordinate all work | Claude Integration, Notification Manager, Response Server, State Store, Logger | EventEmitter events + async methods |
| **Claude Integration** | Execute GSD commands via Agent SDK, intercept questions, parse results | Orchestrator (returns results), Agent SDK (query calls) | `async runCommand(prompt, options): Promise<CommandResult>` |
| **Response Server** | Serve React SPA, expose REST API, push SSE events, collect human responses | Orchestrator (question/answer bridge), React SPA (serves static + API) | Express routes + SSE stream |
| **Notification Manager** | Dispatch notifications to configured adapters | Notification Adapters (send calls) | `async notify(notification): Promise<void>` |
| **Notification Adapters** | Format and deliver notifications per channel | External services (Teams/Slack webhooks, OS notifications) | `NotificationAdapter` interface |
| **State Store** | In-memory state with file-backed persistence | Orchestrator (read/write state), Response Server (read state for API) | `getState()`, `setState()`, `persist()`, `restore()` |
| **Logger** | Structured logging to files and in-memory buffer for SSE streaming | All components (write), Response Server (read for log stream) | `log(level, component, message, meta?)` |
| **React SPA** | Dashboard UI, question response forms, log viewer | Response Server (HTTP + SSE) | Browser client |

### Data Flow

**Primary flow — autonomous phase execution:**

```
CLI Entry
  │ parses args, creates config
  ▼
Orchestrator.start()
  │ reads ROADMAP.md, determines next phase
  ▼
Orchestrator transitions to phase_plan
  │ emits 'phase:started'
  │ calls Claude Integration
  ▼
Claude Integration
  │ calls Agent SDK query() with GSD prompt
  │ streams messages, captures result
  │ returns CommandResult to Orchestrator
  ▼
Orchestrator receives result
  │ persists state to file
  │ emits 'phase:step-completed'
  │ transitions to next step (execute, verify, etc.)
  ▼
Notification Manager.notify({ type: 'progress' })
  │ dispatches to all configured adapters
  ▼
Logger.log('info', 'orchestrator', 'Phase N plan complete')
  │ writes to file + pushes to in-memory buffer
  ▼
Response Server picks up SSE events
  │ pushes to connected browser clients
```

**Human-in-the-loop flow — question/response:**

```
Claude Integration (during query execution)
  │ Agent SDK fires canUseTool('AskUserQuestion', input)
  ▼
Claude Integration intercepts
  │ extracts questions from input
  │ creates deferred promise (Promise.withResolvers)
  │ emits 'question:pending' with question data
  ▼
Orchestrator receives 'question:pending'
  │ stores question in State Store
  │ calls Notification Manager
  ▼
Notification Manager
  │ sends notification with respondUrl to all adapters
  ▼
Response Server
  │ pushes SSE event 'question-pending' to dashboard
  │ ... time passes ...
  │ receives POST /api/questions/:id with answer
  ▼
Orchestrator receives answer
  │ resolves the deferred promise
  ▼
Claude Integration
  │ canUseTool callback returns { behavior: 'allow', updatedInput: { answers } }
  │ Agent SDK continues execution with answers
  ▼
Orchestrator transitions to next step
```

**State persistence flow:**

```
Any state change in Orchestrator
  │
  ▼
State Store.setState(patch)
  │ updates in-memory state
  │ writes JSON to .planning/autopilot-state.json
  │ emits 'state:changed'
  ▼
Response Server picks up 'state:changed'
  │ pushes SSE event to connected clients
```

## Component Detail

### 1. CLI Entry Point

**Technology:** Commander.js

**Why Commander over Yargs:** GSD Autopilot has a single command with flags, not a multi-subcommand hierarchy. Commander provides clean, declarative flag definitions with less boilerplate. Its programmatic, object-oriented approach maps well to the startup sequence: parse args, validate, create config, bootstrap components, start orchestrator.

**Responsibility boundary:** The CLI entry does setup only. It creates instances of all components, wires them together, then calls `orchestrator.start()`. It does not contain business logic. If the `--resume` flag is present, it restores state from the state store before starting.

**Confidence:** HIGH (Commander is well-established, 1.4B+ downloads on npm)

### 2. Orchestrator (Custom EventEmitter-based State Machine)

**Technology:** Custom implementation extending Node.js EventEmitter. Not XState.

**Why NOT XState:** XState v5 is a powerful state machine library (~1.5M weekly npm downloads, zero dependencies) with excellent features including deep actor persistence via `getPersistedSnapshot()` / `createActor({ snapshot })`, async actor orchestration, and TypeScript support. However, for this project it is overkill:

- The autopilot has a **linear, predictable flow** (init -> discuss -> plan -> execute -> verify -> next phase -> complete). There are no parallel states, no hierarchical nesting, no complex guard conditions.
- The state transitions map directly to a simple `switch/case` or lookup table. Adding XState adds 16.7 kB to the bundle and a learning curve for contributors without proportional benefit.
- The "wait for human response" blocking pattern maps naturally to a deferred Promise — XState's actor model would add indirection without simplifying the pattern.
- State persistence needs are simple: serialize a plain object to JSON. XState's `getPersistedSnapshot()` is designed for complex nested actor trees we do not have.

**What XState would buy that we sacrifice:** Formal state machine visualization via Stately editor, built-in guards/actions/services abstraction, and protection against impossible state transitions. These are valuable for complex UI state or multi-actor systems but not for a linear CLI orchestration flow.

**Implementation pattern:**

```typescript
interface AutopilotState {
  status: 'idle' | 'running' | 'waiting_for_human' | 'error' | 'complete';
  currentPhase: number;
  currentStep: 'discuss' | 'plan' | 'execute' | 'verify' | 'done';
  phases: PhaseState[];
  pendingQuestions: Question[];
  errorHistory: ErrorRecord[];
  startedAt: string;
  lastUpdatedAt: string;
}

class Orchestrator extends EventEmitter {
  private state: AutopilotState;
  private stateStore: StateStore;
  private claudeIntegration: ClaudeIntegration;

  async start(): Promise<void> {
    // Linear phase loop
    for (const phase of this.state.phases) {
      if (phase.status === 'completed') continue;
      await this.runPhase(phase);
    }
    await this.completeMilestone();
  }

  private async runPhase(phase: PhaseState): Promise<void> {
    this.transition('phase_discuss', phase);
    await this.runDiscussStep(phase);

    this.transition('phase_plan', phase);
    await this.runPlanStep(phase);

    this.transition('phase_execute', phase);
    await this.runExecuteStep(phase);

    this.transition('phase_verify', phase);
    await this.runVerifyStep(phase);
  }

  private transition(step: string, phase: PhaseState): void {
    this.state.currentStep = step;
    this.state.lastUpdatedAt = new Date().toISOString();
    this.stateStore.persist(this.state);
    this.emit('state:changed', this.state);
  }
}
```

**Confidence:** HIGH (EventEmitter is a core Node.js pattern; the orchestration flow is linear enough that a custom approach is simpler and more transparent)

### 3. Claude Code Integration

**Technology:** `@anthropic-ai/claude-agent-sdk` (the Claude Agent SDK)

**Critical finding:** The Claude Agent SDK (formerly Claude Code SDK) replaces the need to spawn `claude -p` as a child process. It provides a programmatic TypeScript API with the same capabilities as Claude Code CLI.

**Why Agent SDK over `claude -p` spawn:**

| Factor | `claude -p` spawn | Agent SDK `query()` |
|--------|-------------------|---------------------|
| **Reliability** | Known hanging bug with Node.js child_process (stdio config issues, see anthropics/claude-code#771) | In-process, no spawn issues |
| **Output parsing** | Must parse stdout strings for patterns like "PHASE X PLANNED" | Structured `SDKMessage` types with typed fields |
| **Question interception** | Must parse stdout for question patterns | Built-in `canUseTool('AskUserQuestion', ...)` callback |
| **Error handling** | Parse exit codes and stderr strings | Typed `SDKResultMessage` with `subtype: 'error_during_execution'` |
| **Streaming** | Must manage stdout/stderr streams manually | Async generator with `includePartialMessages` option |
| **Session management** | Fresh context per spawn (no history) | `resume: sessionId` for conversation continuity |
| **Cost tracking** | Not available | `total_cost_usd` in result messages |

**Key pattern — question interception via `canUseTool`:**

```typescript
class ClaudeIntegration {
  private questionResolver: Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (reason: Error) => void;
  }> = new Map();

  async runGsdCommand(prompt: string, options: RunOptions): Promise<CommandResult> {
    const messages: SDKMessage[] = [];

    for await (const message of query({
      prompt,
      options: {
        cwd: this.projectDir,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'AskUserQuestion'],
        canUseTool: async (toolName, input) => {
          if (toolName === 'AskUserQuestion') {
            return this.handleQuestion(input);
          }
          return { behavior: 'allow', updatedInput: input };
        },
      }
    })) {
      messages.push(message);
      if ('result' in message) {
        return this.parseResult(message, messages);
      }
    }
  }

  private async handleQuestion(input: AskUserQuestionInput): Promise<PermissionResult> {
    const questionId = crypto.randomUUID();
    // Deferred promise — resolved when human responds via web UI
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();

    this.questionResolver.set(questionId, { resolve, reject });
    this.emit('question:pending', { id: questionId, questions: input.questions });

    const answers = await promise; // Blocks until human responds

    return {
      behavior: 'allow',
      updatedInput: { questions: input.questions, answers }
    };
  }

  // Called by Response Server when POST /api/questions/:id arrives
  submitAnswer(questionId: string, answers: Record<string, string>): void {
    const resolver = this.questionResolver.get(questionId);
    if (resolver) {
      resolver.resolve(answers);
      this.questionResolver.delete(questionId);
    }
  }
}
```

**Note on GSD command execution:** The Agent SDK `query()` replaces `claude -p` for executing GSD slash commands. The prompt would include the GSD command (e.g., `"/gsd:plan-phase 1"`), and the agent would execute it using its built-in tools. The `systemPrompt` option can load GSD's CLAUDE.md files via `settingSources: ['project']`. Each GSD command call creates a fresh `query()` invocation (equivalent to `/clear` in the CLI).

**Note on `--skip-discuss` behavior:** When discuss is skipped, the orchestrator bypasses question interception entirely and generates a CONTEXT.md marking all areas as "Claude's Discretion" without invoking the question flow.

**Confidence:** HIGH (Agent SDK is official Anthropic product, actively maintained, documented for production automation use cases)

### 4. Response Server (Express.js + React SPA)

**Technology:** Express.js backend, React 18 SPA built with Vite, SSE for real-time updates

**Architecture pattern — Express serves dual purpose:**

1. **REST API** for state queries and answer submission
2. **Static file server** for the pre-built React SPA
3. **SSE endpoint** for real-time push to connected browsers

**SSE implementation pattern:**

```typescript
class ResponseServer {
  private clients: Set<Response> = new Set();
  private stateStore: StateStore;

  setupSSE(app: Express): void {
    app.get('/api/log/stream', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
    });
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }
}
```

**Why SSE over WebSockets:** SSE is sufficient because data flows one direction (server to browser). The browser sends answers via regular POST requests. SSE has built-in reconnection, simpler server implementation, and works through proxies without upgrade negotiation. The native `EventSource` API in browsers handles connection management automatically.

**React SPA bundling for npm distribution:**

The React SPA is built at publish time (not at runtime) using Vite. The built static files (HTML, JS, CSS) are included in the npm package under a `dashboard/dist/` directory. Express serves them with `express.static()`. This means:

- Users running `npx gsd-autopilot` get a working dashboard with zero build step
- The Vite dev server is only used during development of the dashboard
- `package.json` includes a `prepublishOnly` script that runs `vite build`

**Confidence:** HIGH (Express + SSE + static React SPA is a well-established pattern; SSE has broad browser support)

### 5. Notification Manager + Adapters

**Technology:** Custom adapter pattern with a simple interface

**Implementation pattern — adapter interface:**

```typescript
interface NotificationAdapter {
  name: string;
  init(config: AdapterConfig): Promise<void>;
  send(notification: Notification): Promise<boolean>;
  shutdown(): Promise<void>;
}

class NotificationManager {
  private adapters: NotificationAdapter[] = [];

  async notify(notification: Notification): Promise<void> {
    await Promise.allSettled(
      this.adapters.map(adapter => adapter.send(notification))
    );
  }
}
```

**Key design decisions:**

- `Promise.allSettled` (not `Promise.all`) so one adapter failure does not block others
- Adapters are initialized once at startup and shut down on process exit
- The console adapter is always loaded (zero dependencies, acts as fallback)
- Custom adapters loaded via `--adapter-path` using dynamic `import()`

**Confidence:** HIGH (adapter/strategy pattern is standard; notification adapters are simple wrappers around HTTP POST or native APIs)

### 6. State Store

**Technology:** Plain TypeScript class, JSON file persistence

**Pattern:** In-memory state object with synchronous reads and async file writes. The state store is the single source of truth for orchestrator state and is shared (read-only) with the Response Server for API responses.

```typescript
class StateStore {
  private state: AutopilotState;
  private filePath: string;

  getState(): Readonly<AutopilotState> {
    return this.state;
  }

  async setState(patch: Partial<AutopilotState>): Promise<void> {
    this.state = { ...this.state, ...patch, lastUpdatedAt: new Date().toISOString() };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2));
  }

  static async restore(filePath: string): Promise<StateStore> {
    const data = await fs.readFile(filePath, 'utf-8');
    return new StateStore(JSON.parse(data), filePath);
  }
}
```

**Why not XState persistence:** XState v5 offers deep recursive actor snapshot persistence via `getPersistedSnapshot()` and `createActor({ snapshot })`. This is powerful for complex nested actor hierarchies. Our state is a single flat object with no child actors, making a plain JSON serialize/deserialize simpler and more transparent.

**Confidence:** HIGH (file-based JSON state is aligned with GSD's existing `.planning/` patterns)

### 7. Logger

**Technology:** Custom structured logger writing to files and an in-memory ring buffer

**Pattern:** Each log entry includes timestamp, level, component name, message, and optional metadata. Logs are written to `.planning/autopilot-log/` as one file per phase-step. The in-memory ring buffer (last N entries) feeds the SSE log stream.

```typescript
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  phase?: number;
  step?: string;
  meta?: Record<string, unknown>;
}
```

**Confidence:** HIGH (standard logging pattern)

## Inter-Component Communication Pattern

All components communicate through a shared EventEmitter bus on the Orchestrator. This provides loose coupling — components only know about events, not each other.

| Event | Emitter | Listeners | Data |
|-------|---------|-----------|------|
| `state:changed` | Orchestrator | Response Server, Logger | `AutopilotState` |
| `phase:started` | Orchestrator | Notification Manager, Logger | `{ phase, title }` |
| `phase:step-completed` | Orchestrator | Response Server, Logger | `{ phase, step, result }` |
| `phase:completed` | Orchestrator | Notification Manager, Logger | `{ phase, title, commits }` |
| `question:pending` | Claude Integration | Orchestrator, Notification Manager, Response Server | `{ id, questions }` |
| `question:answered` | Response Server | Orchestrator, Claude Integration | `{ id, answers }` |
| `error` | Any component | Orchestrator, Notification Manager, Logger | `{ source, error, phase? }` |
| `build:complete` | Orchestrator | Notification Manager, Logger | `{ phases, commits, duration }` |
| `log:entry` | Logger | Response Server (for SSE push) | `LogEntry` |

**Why EventEmitter over shared mutable state:** EventEmitter creates explicit, traceable communication paths. Components declare what they care about (via `.on()`) rather than polling shared state. This makes the system easier to test (mock events) and debug (log events).

## Patterns to Follow

### Pattern 1: Deferred Promise for Human-in-the-Loop Blocking

**What:** Use `Promise.withResolvers()` to create a promise that pauses execution until a human responds through the web UI. The resolve function is stored in a map keyed by question ID. When the Response Server receives a POST with the answer, it looks up and calls the resolve function.

**When:** Anytime the orchestrator must block on human input — discuss-phase questions, error triage decisions, and `AskUserQuestion` tool interceptions from the Agent SDK.

**Why:** `Promise.withResolvers()` (ES2024, available in Node.js 22+; polyfillable for Node.js 18) cleanly separates promise creation from resolution. The orchestrator `await`s the promise in its linear flow, while the Express route handler resolves it from a completely different call stack. No polling, no callbacks, no shared mutable flag.

**Example:**
```typescript
// In Claude Integration — creates the promise
const { promise, resolve } = Promise.withResolvers<Record<string, string>>();
this.pendingResolvers.set(questionId, resolve);
this.emit('question:pending', { id: questionId, questions });
const answers = await promise; // Execution pauses here

// In Response Server — resolves the promise (different call stack)
app.post('/api/questions/:id', (req, res) => {
  const resolver = claudeIntegration.pendingResolvers.get(req.params.id);
  resolver(req.body.answers);
  res.json({ ok: true });
});
```

**Node.js 18 polyfill (if needed):**
```typescript
if (!Promise.withResolvers) {
  Promise.withResolvers = function<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
```

### Pattern 2: Async Generator Consumption for Agent SDK

**What:** Consume the Agent SDK's `query()` async generator in a `for await...of` loop, processing each message type as it arrives.

**When:** Every GSD command execution.

**Example:**
```typescript
for await (const message of query({ prompt, options })) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
  if (message.type === 'assistant') {
    logger.log('debug', 'claude', message.message.content);
  }
  if (message.type === 'result') {
    if (message.subtype === 'success') return parseSuccess(message);
    if (message.is_error) return parseError(message);
  }
}
```

### Pattern 3: Graceful Shutdown Cascade

**What:** On SIGINT/SIGTERM, shut down components in reverse startup order: stop accepting new questions, wait for current Claude query to finish (with timeout), shut down Express server, flush logs, persist final state.

**When:** Process termination.

**Example:**
```typescript
process.on('SIGINT', async () => {
  await orchestrator.stop();        // Stop phase loop, persist state
  await responseServer.close();     // Close SSE connections, stop Express
  await notificationManager.shutdown(); // Close adapter connections
  await logger.flush();             // Write remaining buffer
  process.exit(0);
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parsing stdout strings from `claude -p`

**What:** Spawning `claude -p` as a child process and parsing stdout for success/failure patterns like "PHASE X PLANNED" or "VERIFICATION PASSED".

**Why bad:** Brittle (output format can change without notice), has a known Node.js hanging bug (anthropics/claude-code#771 — stdio configuration causes indefinite hangs), loses structured data (cost, tokens, session IDs), and cannot intercept `AskUserQuestion` tool calls cleanly. The PRD's original design used this approach, but the Claude Agent SDK makes it obsolete.

**Instead:** Use `@anthropic-ai/claude-agent-sdk` `query()` with typed `SDKMessage` handling. All the same capabilities, structured output, no spawn issues.

### Anti-Pattern 2: Shared Mutable State Between Server and Orchestrator

**What:** Having the Express route handlers directly mutate the orchestrator's state object.

**Why bad:** Race conditions between the Express request handling (triggered by HTTP) and the orchestrator's async flow. Difficult to trace state changes. Testing requires spinning up the full server.

**Instead:** Use the EventEmitter pattern. Route handlers emit events; the orchestrator listens and updates its own state. State flows in one direction.

### Anti-Pattern 3: XState for a Linear Workflow

**What:** Using XState's full state machine formalism (states, transitions, guards, actors) for what is fundamentally a sequential loop with occasional pauses.

**Why bad:** Adds 16.7 kB dependency, learning curve, and abstraction overhead without proportional benefit. The autopilot flow has ~6 states in a straight line. XState shines for complex, branching, parallel state management — not linear orchestration.

**Instead:** Use a simple state enum + EventEmitter + switch/case. If the flow becomes significantly more complex in the future (parallel phase execution, conditional phase skipping based on complex rules), XState can be introduced then.

### Anti-Pattern 4: Building React SPA at Runtime

**What:** Having `npx gsd-autopilot` run `vite build` on first launch to compile the React dashboard.

**Why bad:** Requires Vite and all dev dependencies at runtime, adds 30+ seconds to first launch, fails in environments without build tools, bloats the npm package with dev dependencies.

**Instead:** Pre-build the React SPA during `npm publish` (via `prepublishOnly` script). Include the compiled static assets in the npm package. Express serves them directly from `dashboard/dist/`.

## Project Structure (Single Package)

```
gsd-autopilot/
├── bin/
│   └── gsd-autopilot.js           # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── cli/
│   │   ├── index.ts                # Commander setup, arg parsing
│   │   └── config.ts               # Config loading (.gsd-autopilot.json, env vars)
│   ├── orchestrator/
│   │   ├── index.ts                # Orchestrator class (EventEmitter-based)
│   │   ├── state-store.ts          # State persistence
│   │   └── types.ts                # AutopilotState, PhaseState, etc.
│   ├── claude/
│   │   ├── index.ts                # ClaudeIntegration class
│   │   ├── command-runner.ts       # query() wrapper with GSD-specific logic
│   │   └── result-parser.ts        # Parse SDKMessage streams into CommandResult
│   ├── notifications/
│   │   ├── manager.ts              # NotificationManager
│   │   ├── types.ts                # Notification, NotificationAdapter interfaces
│   │   └── adapters/
│   │       ├── console.ts
│   │       ├── system.ts
│   │       ├── teams.ts
│   │       ├── slack.ts
│   │       └── custom-webhook.ts
│   ├── server/
│   │   ├── index.ts                # Express app setup
│   │   ├── routes/
│   │   │   ├── api.ts              # REST API routes
│   │   │   └── sse.ts              # SSE endpoint
│   │   └── static.ts               # Serve React SPA from dashboard/dist
│   ├── logger/
│   │   └── index.ts                # Logger class
│   └── discuss/
│       └── index.ts                # Discuss-phase handler (gray area extraction)
├── dashboard/                      # React SPA (separate Vite project)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── QuestionResponse.tsx
│   │   │   ├── PhaseDetail.tsx
│   │   │   └── LogViewer.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   │   └── useSSE.ts           # SSE connection hook
│   │   └── api/
│   │       └── client.ts           # API client
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── dist/                       # Built output (committed or built at publish)
├── package.json                    # Single package, bin entry, prepublishOnly builds dashboard
├── tsconfig.json
└── vitest.config.ts
```

**Why single package over monorepo:** The dashboard is tightly coupled to the server (API contract, SSE events). A monorepo adds tooling overhead (workspaces, hoisting, linked dependencies) without real benefit — there is only one deployable artifact (`gsd-autopilot` npm package). The dashboard is a build artifact consumed by the server, not an independent package.

**npm distribution:**

```json
{
  "name": "gsd-autopilot",
  "bin": {
    "gsd-autopilot": "./bin/gsd-autopilot.js"
  },
  "files": [
    "bin/",
    "dist/",
    "dashboard/dist/"
  ],
  "scripts": {
    "build": "tsc && cd dashboard && npm run build",
    "prepublishOnly": "npm run build"
  }
}
```

## Scalability Considerations

| Concern | GSD Autopilot (single user, single project) | Notes |
|---------|---------------------------------------------|-------|
| Concurrent users | 1 (localhost only) | No auth needed; if >1 browser tabs, SSE handles multiple connections |
| State size | Small (phases + questions, < 1 MB JSON) | File-backed persistence is sufficient |
| Log volume | Moderate (all Claude output) | Ring buffer for SSE; files for archive |
| Long-running processes | Hours (large projects with many phases) | State persistence enables resume after crashes |
| Memory | Low (Node.js process + Express + Agent SDK) | Agent SDK manages its own memory for query contexts |

Scaling beyond single-user/single-project is explicitly out of scope per the PRD.

## Build Order (Dependencies Between Components)

Components should be built in this order based on dependencies:

```
Phase 1: Foundation (no cross-dependencies)
├── Logger
├── State Store
└── Types / Interfaces

Phase 2: Core (depends on Phase 1)
├── Claude Integration (needs Logger, types)
└── Notification Manager + Console Adapter (needs Logger, types)

Phase 3: Orchestrator (depends on Phase 2)
└── Orchestrator (needs Claude Integration, State Store,
    Notification Manager, Logger)

Phase 4: Server (depends on Phase 3)
├── Express API routes (needs State Store, Orchestrator events)
├── SSE endpoint (needs Logger buffer, Orchestrator events)
└── React SPA (needs API contract defined in Phase 4)

Phase 5: CLI Entry (depends on everything)
└── CLI (needs Orchestrator, Server, Notification Manager)

Phase 6: Additional Adapters (independent, parallel)
├── System notification adapter
├── Teams adapter
├── Slack adapter
└── Custom webhook adapter

Phase 7: Polish
├── Discuss-phase handler (needs Claude Integration, question flow)
├── Resume functionality (needs State Store)
└── Error handling / retry logic
```

**Key dependency insight:** The Claude Integration module is the most critical path item. Everything else can be stubbed while it is being built, but the orchestrator cannot function without it. Build it first (with tests) and the rest follows.

## Sources

- [Claude Agent SDK documentation](https://platform.claude.com/docs/en/agent-sdk/overview) — HIGH confidence
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — HIGH confidence
- [Claude Agent SDK user input handling](https://platform.claude.com/docs/en/agent-sdk/user-input) — HIGH confidence
- [XState v5 documentation](https://stately.ai/docs/xstate) — HIGH confidence (consulted, then decided against)
- [XState v5 persistence](https://stately.ai/docs/persistence) — HIGH confidence
- [Node.js child_process documentation](https://nodejs.org/api/child_process.html) — HIGH confidence
- [Claude Code Node.js spawn bug #771](https://github.com/anthropics/claude-code/issues/771) — HIGH confidence (verified, closed/resolved)
- [Promise.withResolvers() MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers) — HIGH confidence
- [Commander.js](https://www.npmjs.com/package/commander) — HIGH confidence
- [Express.js SSE pattern](https://blog.tericcabrel.com/implement-server-sent-event-in-node-js/) — MEDIUM confidence (community source, verified pattern)
- [Vite build for production](https://vite.dev/guide/build) — HIGH confidence
