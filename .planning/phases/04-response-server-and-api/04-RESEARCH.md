# Phase 4: Response Server and API - Research

**Researched:** 2026-02-16
**Domain:** Express.js REST API server with SSE streaming, TypeScript ESM, question management, graceful shutdown
**Confidence:** HIGH

## Summary

Phase 4 adds an Express.js HTTP server that launches alongside the autopilot, exposing REST endpoints for state/question management and an SSE endpoint for real-time event streaming. The server is the bridge between the running orchestrator and the browser-based dashboard (Phase 5). It reads state from the existing `StateStore`, receives questions via `ClaudeService` events, and pushes real-time events (phase lifecycle, questions, errors, logs) to connected SSE clients.

The existing codebase provides strong integration points: `Orchestrator` extends `EventEmitter` and emits `phase:started`, `phase:completed`, `step:started`, `step:completed`, `build:complete`, and `error:escalation` events. `ClaudeService` emits `question:pending` and `question:answered` events, and exposes `submitAnswer()`, `getPendingQuestions()` methods. The `AutopilotLogger` ring buffer provides recent log entries via `getRecentEntries()`. The `ShutdownManager` supports LIFO cleanup handler registration. All these exist and are tested -- the server merely wires them together behind HTTP endpoints.

Express 5 (v5.1+) is now the npm default with built-in async error handling improvements and `@types/express@5.x` for TypeScript. SSE should be implemented natively (three headers + `res.write()`) rather than via a library -- the pattern is trivial and avoids an unnecessary dependency for what amounts to ~30 lines of code. The server should serve the React SPA static files from `dashboard/dist/` with an SPA fallback for client-side routing.

**Primary recommendation:** Use Express 5 with native SSE, inject `StateStore`, `ClaudeService`, `Orchestrator`, and `AutopilotLogger` via constructor, register the server's `close()` with `ShutdownManager`, and keep all route handlers thin (delegate to existing service methods).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.1.0 | HTTP server, routing, middleware, static serving | Industry standard, now default on npm, async error handling in v5, 30M+ weekly downloads |
| @types/express | ^5.0.6 | TypeScript type definitions for Express | DefinitelyTyped maintained, matches Express 5 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cors | ^2.8.5 | CORS middleware for development | Only needed if dashboard dev server runs on different port; not needed in production since same-origin |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native SSE | better-sse v0.16 | Adds dependency for ~30 lines of code; better-sse has channels/broadcasting but we have <5 concurrent clients |
| Native SSE | expresse | Adds Redis dependency for multi-node; we are single-process localhost |
| express | fastify | Faster, but team has no Express 5 compatibility concern; switching adds learning curve for zero benefit on localhost |
| express | hono | Lighter, but doesn't have the same ecosystem maturity for static file serving + SPA fallback |

**Installation:**
```bash
npm install express @types/express
```

Note: `cors` should only be added if Phase 5 dashboard development requires a separate Vite dev server on a different port. For production (same-origin), no CORS middleware is needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── server/
│   ├── index.ts          # ResponseServer class: creates app, starts/stops http.Server
│   ├── routes/
│   │   ├── api.ts        # REST route factory: status, phases, questions, health
│   │   └── sse.ts        # SSE endpoint factory: /api/log/stream
│   └── middleware/
│       └── error.ts      # Express error handling middleware
```

### Pattern 1: Dependency Injection via Constructor
**What:** The `ResponseServer` class receives all services (StateStore, ClaudeService, Orchestrator, AutopilotLogger) through its constructor. Route factories receive these services as parameters rather than importing singletons.
**When to use:** Always -- this is the established pattern in the existing codebase (see `Orchestrator` constructor accepting `OrchestratorOptions`).
**Example:**
```typescript
// Source: Existing codebase pattern (autopilot/src/orchestrator/index.ts)
export interface ResponseServerOptions {
  stateStore: StateStore;
  claudeService: ClaudeService;
  orchestrator: Orchestrator;
  logger: AutopilotLogger;
  config: AutopilotConfig;
  dashboardDir?: string;  // path to dashboard/dist/
}

export class ResponseServer {
  private server: http.Server | null = null;
  private readonly app: Express;
  private readonly sseClients: Set<Response> = new Set();

  constructor(private readonly options: ResponseServerOptions) {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSSE();
    this.setupSpaFallback();
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => resolve());
    });
  }

  async close(): Promise<void> {
    // Close all SSE connections first
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    // Then close the HTTP server
    return new Promise((resolve, reject) => {
      if (!this.server) { resolve(); return; }
      this.server.close((err) => err ? reject(err) : resolve());
    });
  }
}
```

### Pattern 2: Native SSE with Client Set
**What:** SSE endpoint sets three headers, calls `flushHeaders()`, and adds the response to a `Set<Response>`. A `broadcast()` method writes formatted SSE payloads to all connected clients. Client removal happens on the `close` event.
**When to use:** For the `/api/log/stream` endpoint (DASH-07, DASH-19).
**Example:**
```typescript
// Source: Express.js SSE pattern (verified via official docs + Mastering JS)
app.get('/api/log/stream', (req: Request, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  // Send recent log entries as initial burst so new clients catch up
  const recentEntries = logger.getRecentEntries();
  for (const entry of recentEntries) {
    res.write(`event: log-entry\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}
```

### Pattern 3: Event Wiring in Constructor
**What:** The server listens to Orchestrator and ClaudeService events in its constructor and broadcasts them to SSE clients. This wiring happens once at startup.
**When to use:** For DASH-19 (real-time SSE event types).
**Example:**
```typescript
// Wire orchestrator events to SSE broadcast
orchestrator.on('phase:started', (data) => this.broadcast('phase-started', data));
orchestrator.on('phase:completed', (data) => this.broadcast('phase-completed', data));
orchestrator.on('build:complete', () => this.broadcast('build-complete', {}));
orchestrator.on('error:escalation', (data) => this.broadcast('error', data));

// Wire ClaudeService question events to SSE broadcast
claudeService.on('question:pending', (data) => this.broadcast('question-pending', data));
claudeService.on('question:answered', (data) => this.broadcast('question-answered', data));

// Wire logger ring buffer for log entries
// Option A: Poll ring buffer (simple but adds latency)
// Option B: Add an event to AutopilotLogger (preferred, requires small change)
```

### Pattern 4: Progress Calculation
**What:** The `/api/status` endpoint needs a progress percentage. This is computed from state, not stored in state.
**When to use:** For DASH-02.
**Example:**
```typescript
function computeProgress(state: AutopilotState): number {
  if (state.phases.length === 0) return 0;
  const totalSteps = state.phases.length * 4; // 4 steps per phase: discuss, plan, execute, verify
  let completedSteps = 0;
  for (const phase of state.phases) {
    if (phase.steps.discuss === 'done') completedSteps++;
    if (phase.steps.plan === 'done') completedSteps++;
    if (phase.steps.execute === 'done') completedSteps++;
    if (phase.steps.verify === 'done') completedSteps++;
  }
  return Math.round((completedSteps / totalSteps) * 100);
}
```

### Pattern 5: SPA Fallback
**What:** Express serves static files from `dashboard/dist/` first, then falls back to `index.html` for all non-API GET requests (client-side routing support).
**When to use:** For DASH-09.
**Example:**
```typescript
import { join } from 'node:path';
import express from 'express';

// Serve static files first
app.use(express.static(dashboardDir));

// SPA fallback: non-API GET requests serve index.html
app.get('*', (req: Request, res: Response) => {
  // Only for non-API routes
  if (!req.path.startsWith('/api/')) {
    res.sendFile(join(dashboardDir, 'index.html'));
  }
});
```

### Anti-Patterns to Avoid
- **Shared mutable state between server and orchestrator:** Route handlers must NOT directly mutate orchestrator state. POST /api/questions/:id calls `claudeService.submitAnswer()` which resolves the deferred promise. The orchestrator reacts to the resolved promise, not to HTTP requests.
- **Building React SPA at runtime:** The SPA must be pre-built at publish time. The server only serves static files from `dashboard/dist/`. If the directory does not exist (development without dashboard), the server should still start and serve API endpoints -- just skip static file serving.
- **Using `res.send()` or `res.end()` in SSE handler:** These terminate the connection. SSE must only use `res.write()`.
- **Forgetting `res.flushHeaders()`:** Without this call, SSE headers are buffered and the client never receives the initial response.
- **Polling state instead of using events:** The Orchestrator and ClaudeService already emit events. Wire them to SSE broadcast. Do not poll StateStore on a timer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON body parsing | Custom req body parser | `express.json()` built-in middleware | Handles content-type, encoding, size limits, error cases |
| Static file serving | Custom file reader with mime types | `express.static()` built-in middleware | Handles caching headers, etags, range requests, security |
| SPA fallback routing | Custom path matching | `app.get('*', ...)` after `express.static()` | Standard Express pattern, well-documented |
| SSE retry/reconnect | Custom reconnection logic | Browser `EventSource` built-in retry + `retry:` field in SSE | Spec-compliant, automatic reconnection with configurable interval |
| Graceful server shutdown | Custom connection tracking | `server.close()` callback | Node.js HTTP server handles in-flight request draining |

**Key insight:** Express 5 with its built-in middleware (`json()`, `static()`) and Node.js native `http.Server.close()` handle 90% of the complexity. The SSE spec itself handles reconnection on the client side. The only custom code needed is the thin route handlers and the SSE broadcast wiring.

## Common Pitfalls

### Pitfall 1: SSE Compression Buffering
**What goes wrong:** If Node.js compression middleware (like `compression`) is enabled, SSE events get buffered and arrive in batches instead of in real-time.
**Why it happens:** Compression middleware waits to accumulate data before compressing and flushing. SSE events are small and frequent, causing them to be held in the buffer.
**How to avoid:** Either do not use compression middleware for SSE routes, or call `res.flush()` after each `res.write()`. Since this is a localhost tool, compression provides negligible benefit -- skip it entirely.
**Warning signs:** SSE events arrive in large batches after delays instead of individually in real-time.

### Pitfall 2: SSE Client Cleanup on Disconnect
**What goes wrong:** When a browser tab closes or navigates away, the SSE connection closes but the server keeps the `Response` object in its client set, causing `res.write()` to throw errors.
**Why it happens:** Not listening for the `close` event on the request.
**How to avoid:** Always register `req.on('close', () => sseClients.delete(res))` when adding a client. Wrap `res.write()` in a try-catch in the broadcast method, removing clients that throw.
**Warning signs:** Unhandled error events on Response objects after clients disconnect; growing memory from stale client references.

### Pitfall 3: Express 5 Async Error Handling
**What goes wrong:** Express 5 automatically catches rejected promises in async route handlers and passes them to error middleware. If you wrap handlers in try-catch unnecessarily, you may swallow errors or double-send responses.
**Why it happens:** Developers coming from Express 4 where async errors needed explicit `next(err)` calls or `express-async-errors` patches.
**How to avoid:** In Express 5, simply write async route handlers. Rejected promises are forwarded to error middleware automatically. Add a single error-handling middleware at the end of the middleware chain.
**Warning signs:** Double `res.json()` calls, or errors that silently disappear.

### Pitfall 4: Missing `dashboard/dist/` Directory
**What goes wrong:** During development (before Phase 5 builds the React SPA), `express.static()` pointing at a nonexistent `dashboard/dist/` directory causes confusing 404s or startup errors.
**Why it happens:** Phase 4 (server) ships before Phase 5 (dashboard).
**How to avoid:** Check if `dashboard/dist/` exists before registering `express.static()` and the SPA fallback. If it does not exist, skip static serving and only serve API routes. Log a warning that the dashboard is not built.
**Warning signs:** 404 on `GET /` when no dashboard is built.

### Pitfall 5: Port Already in Use
**What goes wrong:** `server.listen(port)` fails with `EADDRINUSE` if another process is using port 3847.
**Why it happens:** Previous autopilot run did not shut down cleanly, or another service uses the same port.
**How to avoid:** Catch `EADDRINUSE` in the `listen` error handler and provide a clear error message suggesting `--port <other>`. Do not auto-increment ports (that would make the dashboard URL unpredictable for notification links).
**Warning signs:** Immediate crash on startup with cryptic error.

### Pitfall 6: Question Answer Race Condition
**What goes wrong:** The human submits an answer via POST, but the orchestrator has already timed out or aborted the question.
**Why it happens:** `ClaudeService.abortCurrent()` calls `questionHandler.rejectAll()`, which clears pending questions. A late POST arrives after the question is gone.
**How to avoid:** `submitAnswer()` already returns `false` if the question ID is not found. The POST handler should return a 404 or 409 status code with a clear message when `submitAnswer()` returns `false`.
**Warning signs:** User submits an answer but nothing happens; the orchestrator has already moved on.

### Pitfall 7: Log Entry SSE Delivery Gap
**What goes wrong:** Log entries written between the time a client connects and the time the initial burst of ring buffer entries is sent may be lost.
**Why it happens:** The ring buffer `toArray()` returns a snapshot; entries pushed after the snapshot but before the `close` event listener is registered are not delivered.
**How to avoid:** When a new SSE client connects: (1) add client to set, (2) send ring buffer snapshot, (3) wire event listener. New entries after step 1 are delivered by the event listener. Entries between ring buffer read and event wire-up are the gap. Keep this gap minimal by performing these steps synchronously. Alternatively, include a sequence number in events and let the client request missed entries.
**Warning signs:** Dashboard log viewer missing entries that appear in the ring buffer.

## Code Examples

Verified patterns from official sources and existing codebase:

### Express 5 App Setup with TypeScript ESM
```typescript
// Source: Express 5 official docs + reactsquad.io Express 5 guide
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer, type Server } from 'node:http';

const app = express();
app.use(express.json());

// Health check (DASH-08)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Error middleware (must be last, must have 4 params for Express to recognize it)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const server: Server = app.listen(3847, () => {
  console.log('Server listening on port 3847');
});
```

### Status Endpoint with Progress (DASH-02)
```typescript
// Source: Existing codebase types (autopilot/src/types/state.ts)
app.get('/api/status', (_req: Request, res: Response) => {
  const state = stateStore.getState();
  res.json({
    status: state.status,
    currentPhase: state.currentPhase,
    currentStep: state.currentStep,
    progress: computeProgress(state),
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
  });
});
```

### Phases Endpoint (DASH-03)
```typescript
// Source: Existing codebase types (autopilot/src/types/state.ts)
app.get('/api/phases', (_req: Request, res: Response) => {
  const state = stateStore.getState();
  res.json({ phases: state.phases });
});
```

### Questions Endpoints (DASH-04, DASH-05, DASH-06)
```typescript
// Source: Existing ClaudeService API (autopilot/src/claude/index.ts)

// GET /api/questions -- returns all pending questions
app.get('/api/questions', (_req: Request, res: Response) => {
  const pending = claudeService.getPendingQuestions();
  res.json({ questions: pending });
});

// GET /api/questions/:questionId -- returns single question
app.get('/api/questions/:questionId', (req: Request, res: Response) => {
  const question = claudeService.getPendingQuestions()
    .find(q => q.id === req.params.questionId);
  if (!question) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }
  res.json(question);
});

// POST /api/questions/:questionId -- submit answer, unblock orchestrator
app.post('/api/questions/:questionId', (req: Request, res: Response) => {
  const { answers } = req.body as { answers: Record<string, string> };
  if (!answers || typeof answers !== 'object') {
    res.status(400).json({ error: 'Missing or invalid answers object' });
    return;
  }
  const resolved = claudeService.submitAnswer(req.params.questionId, answers);
  if (!resolved) {
    res.status(404).json({ error: 'Question not found or already answered' });
    return;
  }
  res.json({ ok: true });
});
```

### SSE Endpoint with Event Wiring (DASH-07, DASH-19)
```typescript
// Source: Mastering JS SSE guide + existing Orchestrator/ClaudeService event API

const sseClients = new Set<Response>();

app.get('/api/log/stream', (req: Request, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  // Send retry interval (10 seconds)
  res.write('retry: 10000\n\n');

  // Send initial burst of recent log entries
  for (const entry of logger.getRecentEntries()) {
    res.write(`event: log-entry\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// SSE event types per DASH-19:
// phase-started, phase-completed, question-pending, question-answered,
// error, log-entry, build-complete
```

### Graceful Shutdown Integration (DASH-20)
```typescript
// Source: Existing ShutdownManager pattern (autopilot/src/orchestrator/shutdown.ts)
// Source: Express.js official docs on graceful shutdown

// Register server shutdown with existing ShutdownManager
shutdown.register(async () => {
  logger.log('info', 'server', 'Shutting down response server');
  await responseServer.close();
});

// In ResponseServer.close():
async close(): Promise<void> {
  // End all SSE connections
  for (const client of this.sseClients) {
    client.end();
  }
  this.sseClients.clear();

  // Close HTTP server (drains in-flight requests)
  return new Promise<void>((resolve, reject) => {
    if (!this.server) { resolve(); return; }
    this.server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 with `express-async-errors` | Express 5 native async error handling | Express 5.0 (Sep 2024) | No need for wrapper utility or third-party patch |
| `@types/express@4.x` | `@types/express@5.x` | Dec 2024 | Must use v5 types to match Express 5 |
| WebSockets for server push | SSE for unidirectional push | Always (but SSE gaining popularity) | Simpler server code, no upgrade negotiation, built-in reconnection |
| `express-sse` / `better-sse` libraries | Native SSE (3 headers + res.write) | Always available | Zero dependencies, ~30 lines of code, full spec compliance |
| Express 4 `body-parser` package | Express 5 built-in `express.json()` | Express 4.16+ (2017) | No separate package needed |

**Deprecated/outdated:**
- `body-parser` package: Replaced by `express.json()` built-in middleware since Express 4.16
- `express-async-errors`: No longer needed in Express 5 (async rejections automatically forwarded to error middleware)
- Express 4.x: Now in MAINTENANCE mode (EOL no sooner than 2026-10-01); new projects should use Express 5

## Open Questions

1. **Log entry SSE delivery: event-based vs polling**
   - What we know: The `AutopilotLogger` ring buffer stores entries, and `getRecentEntries()` returns a snapshot. There is no event emitted when a new entry is added.
   - What's unclear: Whether to add an event to `AutopilotLogger` (e.g., `on('entry', ...)`) or to have the server poll the ring buffer.
   - Recommendation: Add an `on('entry', LogEntry)` event to `AutopilotLogger` (small change to existing code). This is cleaner than polling and consistent with the EventEmitter patterns used by `Orchestrator` and `ClaudeService`. The change is minimal: make `AutopilotLogger` extend `EventEmitter`, emit `'entry'` in the `log()` method, and the server subscribes in its constructor.

2. **CORS during development**
   - What we know: In production (Phase 7), the SPA is served from the same origin as the API. During Phase 5 development, Vite dev server runs on a different port.
   - What's unclear: Whether to add `cors` middleware now or defer to Phase 5.
   - Recommendation: Defer CORS to Phase 5. Phase 4 only serves the API; there is no browser client yet. If needed later, a simple `cors({ origin: 'http://localhost:5173' })` for dev mode.

3. **Dashboard directory path resolution**
   - What we know: `package.json` lists `"dashboard/dist/"` in the `files` array. The server needs to resolve this path at runtime.
   - What's unclear: Exact path resolution strategy for both development and npm-installed contexts.
   - Recommendation: Use `import.meta.url` to resolve the dashboard path relative to the server module's location: `new URL('../../dashboard/dist', import.meta.url)`. Pass it as a configurable option to `ResponseServer` for testability.

4. **State change SSE events**
   - What we know: The architecture document mentions a `state:changed` event on the Orchestrator, but the current Orchestrator implementation does not emit this event (it emits `phase:started`, `phase:completed`, etc. instead).
   - What's unclear: Whether the individual events are sufficient or whether a generic `state:changed` SSE event is also needed.
   - Recommendation: The individual events (phase-started, phase-completed, question-pending, etc.) are sufficient for the dashboard to update its UI. No need for a generic state:changed event. The dashboard can call `GET /api/status` on reconnect to get full state.

## Sources

### Primary (HIGH confidence)
- Express 5.1.0 release announcement: https://expressjs.com/2025/03/31/v5-1-latest-release.html -- Version info, LTS timeline, breaking changes
- Express.js health check and graceful shutdown guide: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html -- server.close() pattern
- Existing codebase `autopilot/src/orchestrator/index.ts` -- Orchestrator EventEmitter events, constructor pattern
- Existing codebase `autopilot/src/claude/index.ts` -- ClaudeService events, submitAnswer(), getPendingQuestions()
- Existing codebase `autopilot/src/logger/index.ts` -- AutopilotLogger ring buffer, getRecentEntries()
- Existing codebase `autopilot/src/orchestrator/shutdown.ts` -- ShutdownManager register/install pattern
- Existing codebase `autopilot/src/cli/index.ts` -- CLI wiring pattern, shutdown registration order
- Existing codebase `autopilot/src/types/state.ts` -- AutopilotState, PhaseState, PendingQuestion types
- Existing codebase `.planning/research/ARCHITECTURE.md` -- Architecture patterns, data flow, SSE design

### Secondary (MEDIUM confidence)
- React Squad Express 5 setup guide: https://www.reactsquad.io/blog/how-to-set-up-express-5-in-2025 -- TypeScript ESM configuration verified against official docs
- Mastering JS SSE tutorial: https://masteringjs.io/tutorials/express/server-sent-events -- Native SSE pattern (headers, res.write, flushHeaders)
- better-sse GitHub README: https://github.com/MatthewWid/better-sse -- v0.16.1 API, TypeScript support (evaluated then rejected as unnecessary)

### Tertiary (LOW confidence)
- None. All findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Express 5 is the npm default, well-documented, types available; native SSE is spec-compliant and trivial
- Architecture: HIGH -- All integration points exist in the codebase and are well-tested; the ARCHITECTURE.md doc pre-designs the server component
- Pitfalls: HIGH -- SSE pitfalls are well-known and documented; the question flow race condition is derivable from the existing QuestionHandler implementation

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (30 days -- stable domain, Express 5 in ACTIVE LTS)
