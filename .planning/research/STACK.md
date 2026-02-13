# Technology Stack

**Project:** GSD Autopilot
**Researched:** 2026-02-13
**Overall confidence:** HIGH

## Node.js Version Target

**Recommendation: Node.js >= 20 (not >= 18 as stated in the PRD)**

Node.js 18 reached end-of-life on April 30, 2025 and receives no updates including security patches. Node.js 20 enters maintenance LTS until April 30, 2026 and Node.js 22 is active LTS until April 30, 2027. Since this is a greenfield project shipping in 2026, target **Node.js >= 20** as the floor with Node.js 22 as the recommended runtime. This also unlocks Commander 14, ESLint 10, and native ESM-from-CJS interop (backported to Node 20).

| Version | Status | EOL |
|---------|--------|-----|
| 18.x | **End-of-life** (April 2025) | Do not target |
| 20.x | Maintenance LTS | April 2026 |
| 22.x | Active LTS | April 2027 |

**Confidence: HIGH** -- Verified via nodejs.org release schedule.

---

## Module Format

**Recommendation: ESM-only (`"type": "module"` in package.json)**

2026 is the year of full ESM adoption. All sindresorhus packages (execa, ora, etc.) are ESM-only. Node 20+ supports `import()` of ESM from CJS natively. tsdown is ESM-first. There is no compelling reason to ship CJS for a greenfield CLI tool in 2026.

TypeScript config: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.

**Confidence: HIGH** -- Industry consensus, verified via multiple 2026 ecosystem analyses.

---

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | >= 20.x | Runtime | Minimum LTS still in support; unlocks modern APIs and library compatibility | HIGH |
| TypeScript | ~5.9.x | Language | Current stable; strict mode required. TS 6.0 is in beta (Feb 2026) -- use 5.9.x for stability, upgrade to 6.0 after GA | HIGH |

### CLI Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Commander | ^13.0.0 | CLI argument parsing, subcommands | Lightweight, battle-tested, excellent TypeScript support, minimal learning curve. Use v13 (Node 18+ compat) rather than v14 (requires Node 20+) to maximize compatibility within the >= 20 floor. v14 is also acceptable if the project formally targets >= 20 only. | HIGH |

**Decision rationale:** Commander over Yargs because GSD Autopilot has a single primary command with flags, not a complex subcommand tree. Commander's compact option syntax (`--prd <path>`) maps directly to the PRD's CLI design. Yargs' fluent builder API and middleware system are overkill here.

**Alternative considered:** Yargs -- more powerful validation and middleware, but Commander's simplicity better fits the "one command, many flags" pattern. Clipanion -- excellent type safety but smaller community and steeper learning curve. oclif -- enterprise-grade, heavy, designed for CLIs with dozens of commands.

### Child Process Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| execa | ^9.6.x | Execute `claude -p` commands | ESM-only. Ensures child processes exit cleanly even on termination signals. Streaming stdout/stderr parsing. Promise-based with proper error handling. Vastly better DX than raw `child_process`. | HIGH |

**Why execa over raw `child_process`:** The PRD shows `spawnSync` usage in the concept code, but the actual orchestrator needs streaming output (for real-time log capture), proper signal handling (SIGINT/SIGTERM propagation to claude processes), and timeout management. execa handles all of this out of the box. It also ensures zombie process cleanup when the parent exits abruptly, which is critical for long-running `claude -p` calls.

**ESM note:** execa 9.x is ESM-only. Since the project targets ESM-only (`"type": "module"`), this is not a concern.

**Alternative considered:** Raw `node:child_process` -- requires manual signal handling, cleanup, stream management. Acceptable for simple cases but error-prone for production orchestration. `tinyexec` -- lighter weight but lacks execa's streaming, piping, and cleanup guarantees.

### Web Server

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Express | ^5.2.x | API server + static file serving | Express 5 released Oct 2024 after 10-year wait. Now supports async middleware (rejected promises caught automatically), improved security via path-to-regexp v8, dropped legacy Node.js baggage. The standard choice for embedded HTTP servers in CLI tools. | HIGH |

**Why Express 5 over alternatives:** Express 5 is the natural choice because: (1) the PRD already specifies Express, (2) async/await support is now native (no `express-async-errors` hack), (3) the ecosystem is massive, (4) it is lightweight enough to embed in a CLI tool without bloat. Fastify is faster but adds complexity for a localhost-only server where performance is irrelevant. Hono is trendy but its ecosystem is smaller and it optimizes for edge runtimes, not this use case.

### Frontend (React SPA Dashboard)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React | ^19.2.x | Dashboard UI framework | Current stable. The dashboard is a simple SPA with 4 pages -- React's component model fits naturally. | HIGH |
| React Router | ^7.13.x | Client-side routing | v7 merges react-router-dom into react-router (single import). Non-breaking upgrade from v6 patterns. Simplified API. | HIGH |
| Zustand | ^5.0.x | Client-side state management | Minimal boilerplate, tiny bundle (~1KB), perfect for dashboard state (current phase, pending questions, SSE event state). No Redux ceremony for a simple dashboard. | HIGH |
| Tailwind CSS | ^4.1.x | Styling | Utility-first CSS, v4 uses Lightning CSS engine (faster builds), CSS-first config (no tailwind.config.js needed), simpler setup with Vite. | HIGH |

**Why Zustand over Redux/Context:** The dashboard has simple state: current phase, list of questions, log entries from SSE. Zustand's `create()` store with SSE event handlers is 20 lines of code vs. hundreds with Redux Toolkit. Context API causes unnecessary re-renders at this scale.

**Why not a heavier UI framework:** No data tables, no complex forms, no authentication. The dashboard is 4 pages with cards, a log viewer, and button-click responses. Tailwind + React is the minimum viable stack.

### Build Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vite | ^7.3.x | React SPA build tool | Standard React build tool in 2026. Lightning-fast HMR in development, optimized production builds via Rollup. The built assets get served by Express as static files. | HIGH |
| tsdown | ^0.20.x | TypeScript CLI/server bundler | Successor to tsup (which is now unmaintained). Built on Rolldown (same engine as Vite 8). ESM-first, zero-config, generates `.d.ts` declarations. Bundles the Node.js CLI + server code into distributable JS. | MEDIUM |

**Why tsdown over tsup:** tsup's maintainer has deprecated it and recommends tsdown. tsdown is built on Rolldown (the Rust-based bundler powering Vite 8), is ESM-first by default, and emits proper file extensions. The migration path from tsup is documented and straightforward.

**Confidence note on tsdown:** MEDIUM because tsdown is at v0.20.x (pre-1.0). If stability concerns arise during development, fall back to tsup v8.5.x (still functional, just unmaintained) or use plain `tsc` + Node.js native ESM (no bundling needed for a CLI tool -- only the React SPA needs bundling).

**Build strategy:**
1. **React SPA:** Vite builds to `dist/dashboard/` (static HTML/JS/CSS)
2. **CLI + Server:** tsdown compiles TypeScript to ESM JS in `dist/`
3. **npm package:** Ships both the compiled CLI code and the pre-built React SPA assets
4. The Express server uses `express.static()` to serve the Vite build output

### SSE (Server-Sent Events)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| better-sse | ^0.16.x | SSE server implementation | Zero dependencies, TypeScript-native, spec-compliant. Works with Express out of the box. Handles connection management, keep-alive, and reconnection. | HIGH |

**Why better-sse over manual implementation:** SSE is simple in theory (set headers, `res.write()`), but production SSE needs: connection cleanup on client disconnect, keep-alive heartbeats, event ID tracking for reconnection, multi-client broadcast. better-sse handles all of this in a single `createSession()` call. Rolling your own SSE leads to memory leaks from zombie connections.

**Client-side:** Use the native `EventSource` browser API. No library needed.

### State Machine / Orchestrator

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| XState | ^5.27.x | Orchestrator state machine | Actor-based state management with zero dependencies. Models the complex phase lifecycle (init -> plan -> execute -> verify -> retry/next) as explicit states with guarded transitions. Provides: persistence (serialize/restore for `--resume`), visual debugging via Stately Inspector, and protection against invalid state transitions. | HIGH |

**Why XState over a hand-rolled state machine:** The orchestrator has non-trivial state logic: phases can retry, verification can loop, errors need human triage with three options (retry/skip/abort), and the whole thing must be serializable for resume. XState v5 models this as a state machine with context, making impossible states impossible. A hand-rolled `switch` statement with a state string becomes unmaintainable as edge cases accumulate.

**Why XState over simpler alternatives (robot, stately):** XState v5 has the largest community, best TypeScript support, and is the only option with built-in persistence (`getPersistedSnapshot()`/`createActor({ snapshot })`) which maps directly to the `autopilot-state.json` resume requirement.

### Notification System

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-notifier | ^10.0.1 | OS-native toast notifications (system adapter) | Cross-platform (Windows toasters, macOS Notification Center, Linux notify-send). Despite limited recent maintenance, it remains the only viable cross-platform option with 2157+ dependents. No actively maintained alternative exists. | LOW |
| Native `fetch` (Node.js built-in) | N/A | Webhook HTTP calls (Teams/Slack/custom adapters) | Node.js 20+ has stable built-in `fetch()` powered by undici. No need for axios or node-fetch for simple POST requests to webhook URLs. | HIGH |

**node-notifier risk mitigation:** node-notifier v10 works but is effectively unmaintained (last published 4 years ago, deprecated flag on npm). Mitigation strategy:
1. Make the system notification adapter optional (graceful degradation if node-notifier fails)
2. Keep it as an optional peer dependency, not a hard dependency
3. The console adapter (zero-dependency) is the default; system toasts are opt-in
4. If node-notifier breaks on a future OS update, users still have console + webhook channels
5. Monitor the `node-toasted-notifier` fork as a potential replacement

**Why native `fetch` over axios/got:** For simple webhook POSTs with JSON bodies, native `fetch` is sufficient. axios adds 430KB to the bundle for features not needed here. got is ESM-only and larger than needed. The webhook adapters make at most 1-2 HTTP calls per notification -- performance is irrelevant.

### Logging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | ^10.3.x | Structured logging | 5x faster than Winston, JSON output by default (machine-readable for log viewer parsing), child logger support (per-phase log context), tiny footprint. The dashboard's log viewer consumes pino's NDJSON output directly. | HIGH |
| pino-pretty | latest | Dev-mode human-readable logs | Transforms pino's JSON output to colorized, human-readable console output during development. | HIGH |

**Why pino over Winston:** Winston is more configurable but slower and heavier. For a CLI tool that streams logs to both a file and an SSE endpoint, pino's async I/O and NDJSON format are ideal. The log viewer page needs to parse log entries -- pino's structured JSON is trivially parseable; Winston's format varies by transport.

**Why pino over console.log:** The orchestrator runs multiple phases sequentially, each with plan/execute/verify steps. Structured logging with phase context (`log.child({ phase: 3, step: 'verify' })`) is essential for filtering in the dashboard's log viewer.

### Schema Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | ^4.3.x | Config validation, notification payload validation | TypeScript-first schema validation with static type inference. Validate `.gsd-autopilot.json` config, notification payloads, and API request/response shapes from a single schema definition. | HIGH |

**Why Zod:** Eliminates duplicate type definitions. Define a `NotificationSchema` once, get both runtime validation and TypeScript types. Critical for the pluggable adapter interface where external adapters might send malformed data.

### CLI UX (Terminal Output)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| picocolors | ^1.1.x | Terminal color output | 14x smaller than chalk (3.8KB vs 44KB), supports both CJS and ESM (unlike chalk 5 which is ESM-only and larger), used by PostCSS/Vite/Browserslist. The e18e community recommends it as the modern chalk replacement. | HIGH |
| ora | ^8.x | Terminal spinners | Elegant loading spinners for long-running operations (phase execution, claude -p calls). ESM-only, which aligns with our module strategy. | MEDIUM |

**Why picocolors over chalk:** chalk 5 is ESM-only and 44KB. picocolors is 3.8KB, supports both module systems, and covers all the color/bold/dim formatting needed for CLI output. For a CLI tool where bundle size matters (npx downloads on every run), picocolors is the responsible choice.

**ora confidence note:** MEDIUM because ora is ESM-only and from the sindresorhus ecosystem which tends to make breaking changes. If ora causes issues, a simple custom spinner using `process.stdout.write()` with ANSI escape codes is ~20 lines of code.

### Unique ID Generation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `node:crypto` (built-in) | N/A | Generate notification IDs, question IDs | `crypto.randomUUID()` is built into Node.js 20+. No need for nanoid or uuid packages for generating unique identifiers. Zero dependencies. | HIGH |

### File Watching (Optional)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `node:fs.watch` (built-in) | N/A | Watch `.planning/` files for state changes | Node.js built-in `fs.watch` is sufficient for watching a small number of known files in `.planning/`. chokidar v5 (Node 20+, ESM-only) is available if cross-platform edge cases arise, but likely unnecessary for this use case. | MEDIUM |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^4.0.x | Unit and integration testing | Vite-native test runner, Jest-compatible API, TypeScript out of the box, fast watch mode. Since Vite is already in the stack for the React SPA, Vitest shares the same config and transform pipeline. | HIGH |

### Linting & Formatting

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ESLint | ^9.x | Code linting | Use v9 with flat config (eslint.config.mjs). ESLint 10 (released Feb 2026) requires Node >= 20.19.0 which is fine, but typescript-eslint compatibility with v10 is unconfirmed -- use v9 initially and upgrade after ecosystem catches up. | MEDIUM |
| typescript-eslint | ^8.55.x | TypeScript linting rules | Standard TypeScript ESLint integration. Confirmed compatible with ESLint 9.x. | HIGH |
| Prettier | ^3.8.x | Code formatting | Opinionated formatter, zero-config. Handles TypeScript, JSX, JSON, CSS. | HIGH |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CLI framework | Commander ^13 | Yargs | Overkill for single-command CLI; heavier API |
| CLI framework | Commander ^13 | oclif | Enterprise-grade, massive overhead for a single-command tool |
| CLI framework | Commander ^13 | Clipanion | Smaller community, steeper learning curve |
| Process execution | execa ^9 | Raw `node:child_process` | No stream helpers, no signal cleanup, error-prone |
| Process execution | execa ^9 | tinyexec | Lacks streaming, piping, cleanup guarantees |
| Web server | Express ^5 | Fastify | Performance irrelevant for localhost; Express is simpler to embed |
| Web server | Express ^5 | Hono | Optimized for edge runtimes, not local CLI servers |
| Web server | Express ^5 | Koa | Smaller ecosystem, less middleware available |
| State management | Zustand ^5 | Redux Toolkit | Massive overkill for 4-page dashboard |
| State management | Zustand ^5 | React Context | Re-render issues, no devtools, awkward for SSE state |
| Build (CLI) | tsdown ^0.20 | tsup ^8.5 | Unmaintained, maintainer recommends tsdown |
| Build (CLI) | tsdown ^0.20 | Plain `tsc` | No bundling, no tree-shaking, slower |
| SSE | better-sse ^0.16 | Manual implementation | Memory leaks from zombie connections, no heartbeat |
| SSE | better-sse ^0.16 | Socket.io | Massive overkill; SSE is unidirectional which is exactly what we need |
| State machine | XState ^5.27 | Hand-rolled switch/state | Unmaintainable at scale; no persistence; no visualization |
| State machine | XState ^5.27 | robot | No persistence API, smaller community |
| Logging | pino ^10 | Winston | Slower, heavier, unstructured by default |
| Logging | pino ^10 | console.log | No structure, no child loggers, no JSON output |
| Colors | picocolors ^1.1 | chalk ^5 | 14x larger bundle, same features for our use case |
| Notifications | node-notifier ^10 | Electron | Would require bundling an entire browser runtime |
| HTTP client | Native `fetch` | axios | 430KB for features not needed |
| HTTP client | Native `fetch` | got | Larger than needed for simple POSTs |
| Schema validation | Zod ^4.3 | Joi | No TypeScript type inference, heavier |
| Schema validation | Zod ^4.3 | Yup | Weaker TypeScript support, designed for forms not APIs |
| Testing | Vitest ^4 | Jest | Slower, requires separate TS transform config, Vite already in stack |
| IDs | `crypto.randomUUID()` | nanoid | Built-in is sufficient; one fewer dependency |
| IDs | `crypto.randomUUID()` | uuid | Built-in is sufficient; one fewer dependency |
| React version | React 19 | React 18 | 19 is current stable with improved patterns |
| Router | React Router 7 | TanStack Router | React Router 7 is simpler for a 4-page SPA; TanStack Router's type-safe routing is overkill |
| Styling | Tailwind v4 | CSS Modules | Tailwind is faster for dashboard-style UIs, no naming overhead |
| Styling | Tailwind v4 | styled-components | Runtime CSS-in-JS is a dying pattern; Tailwind is zero-runtime |

---

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| **Node.js 18** | End-of-life since April 2025. No security patches. |
| **CommonJS module format** | ESM is the standard in 2026. All modern libraries (execa, ora, etc.) are ESM-only. |
| **Create React App** | Deprecated. Use Vite. |
| **Webpack** | Slower, more complex config. Vite is the standard for React in 2026. |
| **Socket.io** | Bidirectional WebSocket library. The dashboard only needs server-to-client push (SSE). Socket.io adds ~100KB for features not used. |
| **axios** | 430KB bundle for `POST` requests. Native `fetch` handles webhook calls. |
| **Redux** | Massive boilerplate for a simple dashboard with 4 pages and minimal state. |
| **Mongoose/Sequelize/any ORM** | No database. State is JSON/markdown files in `.planning/`. |
| **Electron** | The dashboard is a browser tab, not a desktop app. Express + React SPA is sufficient. |
| **PM2** | Process management is overkill. The CLI runs once and exits. |
| **tsup** | Unmaintained. Maintainer recommends tsdown. |
| **chalk >= 5** | ESM-only AND 14x larger than picocolors for equivalent features. |
| **Winston** | Slower, heavier, and unstructured by default compared to pino. |

---

## Installation

```bash
# Core dependencies
npm install commander@^13 execa@^9 express@^5 better-sse@^0.16 xstate@^5 pino@^10 zod@^4 picocolors@^1 react@^19 react-dom@^19 react-router@^7 zustand@^5

# Optional dependencies (system notifications)
npm install node-notifier@^10  # optional peer dep

# Dev dependencies
npm install -D typescript@~5.9 tsdown@^0.20 vite@^7 vitest@^4 @vitejs/plugin-react tailwindcss@^4 eslint@^9 typescript-eslint@^8 prettier@^3 pino-pretty@latest ora@^8 @types/express @types/node
```

---

## Package.json Key Fields

```json
{
  "name": "gsd-autopilot",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "bin": {
    "gsd-autopilot": "./dist/cli.js"
  },
  "files": [
    "dist/"
  ],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

---

## Sources

- Node.js release schedule: https://nodejs.org/en/about/previous-releases (HIGH confidence)
- Node.js 18 EOL announcement: https://nodejs.org/en/blog/announcements/node-18-eol-support (HIGH confidence)
- Commander.js releases: https://github.com/tj/commander.js/releases (HIGH confidence)
- Commander npm: https://www.npmjs.com/package/commander (HIGH confidence)
- execa GitHub: https://github.com/sindresorhus/execa (HIGH confidence)
- Express 5 release: https://www.infoq.com/news/2025/01/express-5-released/ (HIGH confidence)
- Express npm: https://www.npmjs.com/package/express (HIGH confidence)
- better-sse npm: https://www.npmjs.com/package/better-sse (HIGH confidence)
- better-sse GitHub: https://github.com/MatthewWid/better-sse (HIGH confidence)
- XState docs: https://stately.ai/docs/xstate (HIGH confidence)
- XState npm: https://www.npmjs.com/package/xstate (HIGH confidence)
- node-notifier npm: https://www.npmjs.com/package/node-notifier (MEDIUM confidence -- maintenance concerns)
- Vite releases: https://vite.dev/releases (HIGH confidence)
- tsdown GitHub: https://github.com/rolldown/tsdown (MEDIUM confidence -- pre-1.0)
- tsup deprecation notice: https://github.com/egoist/tsup (HIGH confidence)
- tsdown migration guide: https://tsdown.dev/guide/migrate-from-tsup (MEDIUM confidence)
- React npm: https://www.npmjs.com/package/react (HIGH confidence)
- React Router npm: https://www.npmjs.com/package/react-router (HIGH confidence)
- Zustand npm: https://www.npmjs.com/package/zustand (HIGH confidence)
- Tailwind CSS v4: https://tailwindcss.com/blog/tailwindcss-v4 (HIGH confidence)
- TypeScript npm: https://www.npmjs.com/package/typescript (HIGH confidence)
- TypeScript 6.0 beta: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/ (HIGH confidence)
- Zod npm: https://www.npmjs.com/package/zod (HIGH confidence)
- pino npm: https://www.npmjs.com/package/pino (HIGH confidence)
- Vitest npm: https://www.npmjs.com/package/vitest (HIGH confidence)
- ESLint v10: https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ (HIGH confidence)
- picocolors npm: https://www.npmjs.com/package/picocolors (HIGH confidence)
- 2026 React ecosystem: https://www.felgus.dev/blog/react-stack-2026 (MEDIUM confidence -- blog post)
- 2026 JavaScript ecosystem trends: https://madelinemiller.dev/blog/2025-javascript-ecosystem/ (MEDIUM confidence -- blog post)
- ESM module adoption 2026: https://thelinuxcode.com/import-and-export-in-nodejs-2026-commonjs-esm-and-real-world-module-patterns/ (MEDIUM confidence)
