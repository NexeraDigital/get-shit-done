# Phase 1: Foundation and Types - Research

**Researched:** 2026-02-13
**Domain:** TypeScript ESM project skeleton, state persistence, structured logging, config loading
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- npm package name: `@gsd/autopilot`
- Config format: JSON only (`.gsd-autopilot.json`)
- Environment variable prefix: `GSD_AUTOPILOT_` (e.g., `GSD_AUTOPILOT_NOTIFY`, `GSD_AUTOPILOT_PORT`)
- Error history: keep error log in state file (last N errors with timestamps, phase, step, truncated output)
- Resume UX: always show resume summary on `--resume` ("Resuming from Phase 3, step: execute. Phases 1-2 complete (12 commits). Continuing...")
- Pending questions survive restart: persist unanswered questions in state, re-send notification on resume
- Log file organization: one file per phase-step (e.g., `phase-1-plan.log`, `phase-1-execute.log`)
- Three terminal verbosity modes: `--quiet` (minimal), default (progress), `--verbose` (streaming)

### Claude's Discretion
- Source code directory structure (single src/ with subdirectories vs flat modules)
- Dashboard source location (root-level dashboard/ vs src/dashboard/)
- CLI entry point pattern (single command + flags vs subcommands)
- Which config keys are persistent defaults vs run-only
- Config file search locations (project root only vs project root + home directory)
- State granularity level (phase+step vs phase+step+sub-step)
- Log file retention strategy (fresh per run vs accumulate with timestamps)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 1 establishes the compilable TypeScript ESM project skeleton that every subsequent phase depends on. The deliverables are: a working build pipeline (TypeScript strict mode, ESM-only, Node.js >= 20), shared type definitions for the entire project, a persistent state store with atomic writes, a structured JSON logger with in-memory ring buffer, and a config loading system with CLI > env > file > defaults precedence.

The standard approach uses TypeScript 5.9 with `"module": "NodeNext"` targeting ES2022, pino for structured logging, Zod 4 for schema validation of config and state, and the write-temp-then-rename pattern for atomic file persistence. The project structure follows a `src/` directory with subdirectory-per-component layout that aligns with the architecture boundaries established in project-level research.

**Primary recommendation:** Build the project skeleton with strict TypeScript ESM first, then layer in state store (with atomic writes), logger (pino with file destinations and ring buffer), and config loader (Zod-validated) as independent modules with clean interfaces.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.9.x | Language / compiler | Current stable. TS 6.0 is in beta -- use 5.9.x for stability. Strict mode required. |
| Node.js | >= 20.0.0 | Runtime | Minimum LTS still in support. Node 18 is EOL. Node 22 is recommended. |
| pino | ^10.3.x | Structured JSON logging | 5x faster than Winston, NDJSON by default, child logger support for per-phase context, async I/O via SonicBoom. |
| Zod | ^4.x | Config/state schema validation | TypeScript-first with static type inference via `z.infer<>`. Define schema once, get runtime validation + types. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| write-file-atomic | ^7.0.0 | Atomic file writes | State store persistence. Write-temp-rename pattern, serialized concurrent writes. CJS but importable from ESM in Node 20+. |
| pino-pretty | latest | Dev-mode human-readable logs | Development only. Transforms pino's JSON to colorized console output. |
| @tsconfig/node20 | latest | Base tsconfig preset | Provides correct `target`, `lib`, and `module` defaults for Node 20. |
| @types/node | ^20.x | Node.js type definitions | TypeScript type support for Node.js built-in modules. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| write-file-atomic | Hand-rolled write-temp-rename (~15 lines) | Simpler, zero dependencies, but loses concurrent write serialization and edge case handling. write-file-atomic is battle-tested (used by npm itself). |
| pino | Custom logger | Loses child loggers, NDJSON format, SonicBoom performance, multistream. The dashboard log viewer needs parseable JSON -- pino provides this natively. |
| Zod | TypeScript types only (no runtime validation) | Loses runtime validation of config files. A malformed `.gsd-autopilot.json` would cause cryptic runtime errors instead of clear validation messages. |
| Zod | Ajv + JSON Schema | More verbose, requires separate type definitions, no type inference from schema. |

**Installation:**
```bash
# Core dependencies
npm install pino@^10 zod@^4 write-file-atomic@^7

# Dev dependencies
npm install -D typescript@~5.9 @tsconfig/node20 @types/node@^20 pino-pretty
```

## Architecture Patterns

### Recommended Project Structure

**Recommendation (Claude's Discretion): src/ with subdirectories per component**

This aligns with the architecture boundaries from project-level research and scales well as components grow. Each subdirectory has an `index.ts` barrel export.

```
@gsd/autopilot/
├── src/
│   ├── types/              # Shared type definitions and Zod schemas
│   │   ├── index.ts        # Re-exports all types
│   │   ├── state.ts        # AutopilotState, PhaseState, ErrorRecord
│   │   ├── config.ts       # AutopilotConfig schema + type
│   │   ├── log.ts          # LogEntry, LogLevel
│   │   └── notification.ts # Notification, NotificationAdapter (interfaces for later phases)
│   ├── state/              # State store with atomic persistence
│   │   └── index.ts        # StateStore class
│   ├── logger/             # Structured logger with ring buffer
│   │   ├── index.ts        # Logger class
│   │   └── ring-buffer.ts  # In-memory ring buffer for SSE
│   ├── config/             # Config loading and validation
│   │   └── index.ts        # loadConfig() function
│   └── index.ts            # Package entry point (re-exports public API)
├── dashboard/              # React SPA (separate Vite project, Phase 5)
│   └── ...
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Dashboard location recommendation (Claude's Discretion):** Root-level `dashboard/` directory. It has its own build pipeline (Vite) and is conceptually separate from the Node.js server code. Placing it under `src/` would confuse the TypeScript compilation since it targets a browser, not Node.js.

**CLI entry point recommendation (Claude's Discretion):** Single command with flags (`npx gsd-autopilot --prd ./idea.md`). The tool has one primary action (start/resume a build) with behavioral flags. This matches Commander's strength. Reserve subcommands for future needs only.

### Pattern 1: ESM Module Setup

**What:** Configure TypeScript to emit pure ESM with Node.js module resolution.
**When to use:** The entire project.

```json
// tsconfig.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "dashboard"]
}
```

```json
// package.json (relevant fields)
{
  "name": "@gsd/autopilot",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Critical ESM rule:** All relative imports MUST include the `.js` extension (e.g., `import { StateStore } from './state/index.js'`), even though the source files are `.ts`. TypeScript with `"module": "NodeNext"` requires this because import paths must resolve to the compiled output.

### Pattern 2: Atomic Write State Store

**What:** In-memory state object with file-backed persistence using atomic writes.
**When to use:** Every state mutation in the orchestrator.

```typescript
// Source: write-file-atomic npm + Node.js fs.rename docs
import writeFileAtomic from 'write-file-atomic';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutopilotState } from '../types/index.js';

export class StateStore {
  private state: AutopilotState;
  private readonly filePath: string;

  constructor(state: AutopilotState, filePath: string) {
    this.state = state;
    this.filePath = filePath;
  }

  getState(): Readonly<AutopilotState> {
    return this.state;
  }

  async setState(patch: Partial<AutopilotState>): Promise<void> {
    this.state = {
      ...this.state,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    // write-file-atomic: writes to temp file, fsyncs, then renames
    // Serializes concurrent writes automatically
    await writeFileAtomic(
      this.filePath,
      JSON.stringify(this.state, null, 2) + '\n'
    );
  }

  static async restore(filePath: string): Promise<StateStore> {
    const data = await readFile(filePath, 'utf-8');
    const state = JSON.parse(data) as AutopilotState;
    // TODO: Validate with Zod schema before trusting
    return new StateStore(state, filePath);
  }

  static createFresh(projectDir: string): StateStore {
    const filePath = join(projectDir, '.planning', 'autopilot-state.json');
    const state: AutopilotState = {
      status: 'idle',
      currentPhase: 0,
      currentStep: 'idle',
      phases: [],
      pendingQuestions: [],
      errorHistory: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    return new StateStore(state, filePath);
  }
}
```

### Pattern 3: Structured Logger with Ring Buffer

**What:** Pino-based logger that writes structured JSON to per-phase-step files and maintains an in-memory ring buffer for future SSE consumption.
**When to use:** All components log through this.

```typescript
import pino from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  phase?: number;
  step?: string;
  meta?: Record<string, unknown>;
}

export class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private count: number = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<T>(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  get size(): number {
    return this.count;
  }
}

export function createLogger(logDir: string, phase?: number, step?: string) {
  // Ensure log directory exists
  mkdirSync(logDir, { recursive: true });

  const fileName = phase != null && step
    ? `phase-${phase}-${step}.log`
    : 'autopilot.log';

  const logger = pino(
    {
      level: 'debug',
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({
      dest: join(logDir, fileName),
      sync: false, // async for performance
    })
  );

  return logger;
}
```

### Pattern 4: Config Loading with Precedence Chain

**What:** Load config from defaults < file < env vars < CLI flags using Zod for validation.
**When to use:** At startup, before any other component initializes.

```typescript
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Define schema once -- get both runtime validation and TypeScript type
const AutopilotConfigSchema = z.object({
  notify: z.string().default('console'),
  webhookUrl: z.string().url().optional(),
  port: z.number().int().min(1024).max(65535).default(3847),
  depth: z.enum(['quick', 'standard', 'comprehensive']).default('standard'),
  model: z.enum(['quality', 'balanced', 'budget']).default('balanced'),
  skipDiscuss: z.boolean().default(false),
  skipVerify: z.boolean().default(false),
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;

export async function loadConfig(
  projectDir: string,
  cliFlags: Partial<AutopilotConfig>,
): Promise<AutopilotConfig> {
  // 1. Start with defaults (defined in schema)
  let fileConfig: Record<string, unknown> = {};

  // 2. Load config file if it exists
  try {
    const configPath = join(projectDir, '.gsd-autopilot.json');
    const raw = await readFile(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch {
    // No config file -- use defaults only
  }

  // 3. Load environment variables
  const envConfig = loadEnvVars();

  // 4. Merge with precedence: CLI > env > file > defaults
  const merged = { ...fileConfig, ...envConfig, ...cliFlags };

  // 5. Validate and return
  return AutopilotConfigSchema.parse(merged);
}

function loadEnvVars(): Record<string, unknown> {
  const prefix = 'GSD_AUTOPILOT_';
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value !== undefined) {
      const configKey = key
        .slice(prefix.length)
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      // Parse booleans and numbers
      if (value === 'true') result[configKey] = true;
      else if (value === 'false') result[configKey] = false;
      else if (/^\d+$/.test(value)) result[configKey] = parseInt(value, 10);
      else result[configKey] = value;
    }
  }
  return result;
}
```

### Anti-Patterns to Avoid

- **Hardcoded path separators:** Never use `/` or `\\` in file paths. Always use `path.join()` or `path.resolve()`. This is a Phase 1 requirement (FNDN-03) and must be enforced from the first file written.
- **Non-atomic state writes:** Never use `fs.writeFile()` or `fs.writeFileSync()` for state persistence. Always use `write-file-atomic` or the write-temp-rename pattern.
- **Mixing CJS and ESM patterns:** Never use `require()` or `module.exports` in source code. Use `import`/`export` exclusively. Set `"verbatimModuleSyntax": true` in tsconfig to enforce `import type` syntax.
- **Skipping `.js` extensions in imports:** With `"module": "NodeNext"`, TypeScript requires explicit `.js` extensions on all relative imports. Omitting them causes runtime failures even though the IDE may not show errors.
- **Logging to stdout in library code:** The logger writes to files. Console output is for the CLI layer only. Components should never `console.log()` directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes | Custom write-temp-rename | `write-file-atomic` | Handles concurrent writes, edge cases with worker threads, cleanup on failure. Used by npm itself. |
| Structured JSON logging | Custom `console.log()` wrapper | `pino` | Child loggers, NDJSON output, async I/O via SonicBoom, multistream support, 5x faster than Winston. The dashboard log viewer needs parseable JSON. |
| Config schema validation | Manual type checking with `typeof` | `Zod` | Single-source-of-truth for types and validation. `z.infer<>` eliminates duplicate type definitions. Clear error messages for malformed config. |
| Ring buffer | Array with manual index tracking | Simple custom class (~30 lines) | This IS simple enough to hand-roll. A 30-line class is clearer than adding a dependency for such a basic data structure. |

**Key insight:** The state store, logger, and config loader look simple but have subtle edge cases (crash-safe persistence, concurrent writes, environment variable parsing, schema validation). Use established libraries for the hard parts; hand-roll only the trivially simple parts (ring buffer, type definitions).

## Common Pitfalls

### Pitfall 1: ESM Import Extensions

**What goes wrong:** TypeScript compiles without errors but Node.js fails at runtime with `ERR_MODULE_NOT_FOUND` because import paths lack `.js` extensions.
**Why it happens:** Developers write `import { Foo } from './foo'` because IDEs auto-complete without extensions. TypeScript's type checker does not enforce extensions unless `"module": "NodeNext"` is set.
**How to avoid:** Set `"module": "NodeNext"` and `"verbatimModuleSyntax": true` in tsconfig. Always write `import { Foo } from './foo.js'`. Add a lint rule or build step to catch missing extensions.
**Warning signs:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` at runtime despite clean tsc build.

### Pitfall 2: State File Corruption on Crash

**What goes wrong:** `fs.writeFile()` is interrupted mid-write (crash, Ctrl+C, power loss). The state file contains truncated JSON. On resume, `JSON.parse()` throws and all progress is lost.
**Why it happens:** `fs.writeFile()` writes directly to the target file. If interrupted, the file is partially written. This is not atomic.
**How to avoid:** Use `write-file-atomic` which writes to a temp file, fsyncs, then renames. The rename is atomic on POSIX systems. On Windows, `write-file-atomic` handles the edge cases.
**Warning signs:** Corrupted JSON in `autopilot-state.json` after an interrupted run.

### Pitfall 3: Windows Path Separators

**What goes wrong:** Hardcoded `/` in file paths works on macOS/Linux but breaks on Windows, or produces incorrect paths.
**Why it happens:** Template literals like `` `${dir}/state.json` `` use forward slashes. While Node.js often handles this on Windows, it is not reliable in all contexts (especially when paths are used in shell commands or compared with other paths).
**How to avoid:** Use `path.join()` for ALL path construction. Never concatenate paths with string operators. Use `path.resolve()` for absolute paths. This is requirement FNDN-03.
**Warning signs:** Tests pass on macOS CI but fail on Windows CI with `ENOENT` errors.

### Pitfall 4: Pino Logger File Destination Creation

**What goes wrong:** Pino's `pino.destination()` does not create parent directories. If `.planning/autopilot-log/` does not exist, the logger crashes at startup.
**Why it happens:** Pino focuses on speed and delegates directory management to the caller.
**How to avoid:** Always call `mkdirSync(logDir, { recursive: true })` before creating the pino destination. Do this in the logger factory function.
**Warning signs:** `ENOENT: no such file or directory` error at logger initialization.

### Pitfall 5: Zod Parse vs SafeParse

**What goes wrong:** Using `schema.parse()` throws a `ZodError` on invalid input, crashing the process if not caught. Using `schema.safeParse()` returns a result object but requires manual error handling.
**Why it happens:** Developers use `parse()` everywhere for convenience, then a malformed config file crashes the tool with an unhelpful stack trace.
**How to avoid:** Use `safeParse()` for config loading (user-facing input that may be malformed) and `parse()` for internal data (where validation failure indicates a bug). Wrap config validation in a try/catch with human-readable error messages.
**Warning signs:** Stack trace showing `ZodError` with path-like error messages instead of a friendly "Invalid config file" message.

### Pitfall 6: Environment Variable Type Coercion

**What goes wrong:** Environment variables are always strings. `GSD_AUTOPILOT_PORT=3847` becomes `"3847"` (string), not `3847` (number). Zod's `.number()` rejects it.
**Why it happens:** `process.env` values are always strings. Developers forget to coerce before validation.
**How to avoid:** Pre-process environment variables before Zod validation: parse `"true"`/`"false"` to booleans, numeric strings to numbers. The `loadEnvVars()` helper in the code example above handles this.
**Warning signs:** Config validation fails with "Expected number, received string" for env var overrides that work fine in the config file.

## Code Examples

### Complete tsconfig.json for Node.js 20 ESM

```json
// Source: TypeScript official docs + @tsconfig/node20 + Total TypeScript cheat sheet
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "dashboard"]
}
```

### Complete package.json Skeleton

```json
{
  "name": "@gsd/autopilot",
  "version": "0.1.0",
  "description": "Autonomous GSD workflow orchestrator",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "bin": {
    "gsd-autopilot": "./dist/cli/index.js"
  },
  "files": [
    "dist/",
    "dashboard/dist/"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pino": "^10.3.0",
    "write-file-atomic": "^7.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "pino-pretty": "^13.0.0",
    "typescript": "~5.9.0",
    "vitest": "^4.0.0"
  }
}
```

### Shared Type Definitions

```typescript
// src/types/state.ts
// Source: Architecture patterns from project research + CONTEXT.md decisions

export type AutopilotStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_human'
  | 'error'
  | 'complete';

export type PhaseStep =
  | 'idle'
  | 'discuss'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'done';

export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ErrorRecord {
  timestamp: string;
  phase: number;
  step: PhaseStep;
  message: string;
  truncatedOutput?: string;
}

export interface PendingQuestion {
  id: string;
  phase: number;
  step: PhaseStep;
  questions: string[];
  createdAt: string;
  answeredAt?: string;
  answers?: Record<string, string>;
}

export interface PhaseState {
  number: number;
  name: string;
  status: PhaseStatus;
  steps: {
    discuss: PhaseStep;
    plan: PhaseStep;
    execute: PhaseStep;
    verify: PhaseStep;
  };
  startedAt?: string;
  completedAt?: string;
  commits: string[];
  gapIterations: number;
}

export interface AutopilotState {
  status: AutopilotStatus;
  currentPhase: number;
  currentStep: PhaseStep;
  phases: PhaseState[];
  pendingQuestions: PendingQuestion[];
  errorHistory: ErrorRecord[];
  startedAt: string;
  lastUpdatedAt: string;
}
```

```typescript
// src/types/config.ts
import { z } from 'zod';

export const AutopilotConfigSchema = z.object({
  // Notification
  notify: z.string().default('console'),
  webhookUrl: z.string().url().optional(),
  adapterPath: z.string().optional(),

  // Server
  port: z.number().int().min(1024).max(65535).default(3847),

  // Execution
  depth: z.enum(['quick', 'standard', 'comprehensive']).default('standard'),
  model: z.enum(['quality', 'balanced', 'budget']).default('balanced'),
  skipDiscuss: z.boolean().default(false),
  skipVerify: z.boolean().default(false),

  // Verbosity
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;
```

```typescript
// src/types/log.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  phase?: number;
  step?: string;
  meta?: Record<string, unknown>;
}
```

### Pino Logger with File Destination and Ring Buffer

```typescript
// src/logger/index.ts
import pino, { type Logger } from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RingBuffer } from './ring-buffer.js';
import type { LogEntry } from '../types/log.js';

const DEFAULT_RING_BUFFER_SIZE = 1000;

export class AutopilotLogger {
  private logger: Logger;
  private ringBuffer: RingBuffer<LogEntry>;
  private logDir: string;

  constructor(logDir: string, ringBufferSize = DEFAULT_RING_BUFFER_SIZE) {
    this.logDir = logDir;
    this.ringBuffer = new RingBuffer<LogEntry>(ringBufferSize);

    // Ensure log directory exists
    mkdirSync(logDir, { recursive: true });

    // Default logger writes to a general log file
    this.logger = pino(
      {
        level: 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination({
        dest: join(logDir, 'autopilot.log'),
        sync: false,
      })
    );
  }

  createPhaseLogger(phase: number, step: string): Logger {
    const dest = pino.destination({
      dest: join(this.logDir, `phase-${phase}-${step}.log`),
      sync: false,
    });
    return pino(
      {
        level: 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      dest
    );
  }

  log(level: LogEntry['level'], component: string, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...meta,
    };
    this.ringBuffer.push(entry);
    this.logger[level]({ component, ...meta }, message);
  }

  getRecentEntries(): LogEntry[] {
    return this.ringBuffer.toArray();
  }

  getRingBuffer(): RingBuffer<LogEntry> {
    return this.ringBuffer;
  }

  async flush(): Promise<void> {
    // SonicBoom flush
    const dest = this.logger[pino.symbols.streamSym];
    if (dest && typeof (dest as any).flushSync === 'function') {
      (dest as any).flushSync();
    }
  }
}
```

## Discretion Recommendations

These are Claude's recommendations for areas marked as "Claude's Discretion":

### Config File Search Locations

**Recommendation: Project root only (`.gsd-autopilot.json` in cwd)**

Rationale: The tool operates on a single project at a time. Searching the home directory introduces confusion about which config applies. Users can set persistent preferences via environment variables. Keep it simple -- one file, one location, documented clearly.

### State Granularity

**Recommendation: Phase + Step (not sub-step)**

Rationale: The state tracks `currentPhase` and `currentStep` (discuss/plan/execute/verify). Sub-step tracking (e.g., "executing task 3 of 7 in plan 01-02") adds complexity without clear resume value -- GSD commands are atomic at the step level. The `errorHistory` array provides debugging granularity without complicating the state machine.

### Config Keys: Persistent Defaults vs Run-Only

**Recommendation:** All config keys in `.gsd-autopilot.json` are persistent defaults. CLI flags override for the current run. No "run-only" keys.

| Config Key | In File | In Env | In CLI | Notes |
|------------|---------|--------|--------|-------|
| notify | Yes | Yes | Yes | Persistent default makes sense (always prefer Teams, etc.) |
| webhookUrl | Yes | Yes | Yes | Persistent -- webhook URL rarely changes |
| port | Yes | Yes | Yes | Persistent -- avoid port conflicts |
| depth | Yes | Yes | Yes | Persistent -- project-level preference |
| model | Yes | Yes | Yes | Persistent -- cost preference |
| skipDiscuss | Yes | Yes | Yes | Persistent -- some teams always skip |
| skipVerify | Yes | Yes | Yes | Persistent -- rare but valid |
| verbose/quiet | No | Yes | Yes | Run-only -- these are session-specific |

Actually, for simplicity: all keys are valid in all locations. The precedence chain handles it. `verbose`/`quiet` in a config file simply means "default to verbose mode" which is a valid use case.

### Log File Retention Strategy

**Recommendation: Fresh per run with ISO timestamp prefix**

Each run creates log files like `2026-02-13T14-30-00_phase-1-plan.log`. This avoids overwriting previous run logs while keeping them browsable. Old logs accumulate in `.planning/autopilot-log/` and the user can delete them manually. No automatic rotation -- the tool runs episodically, not continuously.

Alternative: A `--clean-logs` flag could wipe old logs before starting. But this is a Phase 7 concern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `"module": "CommonJS"` | `"module": "NodeNext"` with `"type": "module"` | 2024-2025 | ESM is the default for new Node.js projects. All modern libraries (pino, zod, etc.) support ESM. |
| `tsconfig` manual setup | `@tsconfig/node20` base presets | 2024 | Provides correct defaults, reduces configuration errors |
| Winston for logging | pino for structured JSON logging | 2022+ | 5x faster, NDJSON by default, better TypeScript support |
| Joi/Ajv for validation | Zod for TypeScript-first validation | 2023+ | Single source of truth for types and runtime validation via `z.infer<>` |
| `fs.writeFileSync` | `write-file-atomic` or write-temp-rename | Always (but often ignored) | Prevents state corruption on crash |
| TypeScript 5.x `--moduleResolution node` | TypeScript 5.9 `--moduleResolution nodenext` | 2024 | Proper ESM resolution, enforces `.js` extensions |

**Deprecated/outdated:**
- `ts-node`: Use `tsx` for development (faster, simpler ESM support). Or just `tsc --watch` + `node dist/`.
- `@types/write-file-atomic`: Not needed if using `write-file-atomic` v7+ (ships its own types, or use `any` for the simple API).
- Winston: Still works but pino is the modern standard for structured JSON logging in Node.js.

## Open Questions

1. **write-file-atomic on Windows NTFS atomicity**
   - What we know: `fs.rename()` is atomic on POSIX (ext4, APFS). On Windows NTFS, rename-overwrite may not be fully atomic. `write-file-atomic` handles Windows-specific edge cases.
   - What's unclear: Whether `write-file-atomic` v7's Windows implementation covers all crash scenarios.
   - Recommendation: Use `write-file-atomic` (battle-tested by npm itself). If Windows issues arise, add a backup state file (`autopilot-state.json.bak`) written before the primary.

2. **Pino multistream performance for dual output**
   - What we know: The logger needs to write to files AND populate the ring buffer. Using `pino.multistream()` works but the docs warn about performance with many streams.
   - What's unclear: Whether the ring buffer population should happen in the pino pipeline or as a separate concern (event listener on log entries).
   - Recommendation: Keep ring buffer separate from pino's stream pipeline. Have the logger class intercept each log call, push to the ring buffer, then forward to pino. This avoids multistream performance concerns and keeps the ring buffer synchronous (no worker thread boundary).

3. **Zod v4 API stability**
   - What we know: Zod 4 is announced as stable on zod.dev.
   - What's unclear: Whether breaking changes from Zod 3 affect patterns documented in guides. Zod 4 introduced new features (metadata, registries, codecs) but the core `z.object()`/`z.infer<>` API should be stable.
   - Recommendation: Use Zod 4. The core validation API used for config and state schemas is stable. Test with `zod@^4` to catch any issues.

## Sources

### Primary (HIGH confidence)
- [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig/) - Module, moduleResolution, strict settings
- [Total TypeScript TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet) - Recommended settings for Node.js ESM
- [Pino GitHub API Docs](https://github.com/pinojs/pino/blob/main/docs/api.md) - pino.destination, child loggers, multistream
- [write-file-atomic GitHub](https://github.com/npm/write-file-atomic) - Atomic write implementation, v7.0.0
- [Zod Documentation](https://zod.dev/) - Zod 4 stable, schema definition, type inference
- [Node.js ESM Documentation](https://nodejs.org/api/esm.html) - ESM module resolution, CJS interop
- [Node.js fs Documentation](https://nodejs.org/api/fs.html) - fs.rename atomicity, fs.writeFile behavior

### Secondary (MEDIUM confidence)
- [2ality: TypeScript ESM npm packages](https://2ality.com/2025/02/typescript-esm-packages.html) - ESM publishing patterns
- [SigNoz: Pino Logger Guide 2026](https://signoz.io/guides/pino-logger/) - Pino usage patterns
- [TheLinuxCode: TypeScript Project Setup 2026](https://thelinuxcode.com/set-up-a-typescript-project-in-2026-node-tsconfig-and-a-clean-build-pipeline/) - Modern project structure

### Tertiary (LOW confidence)
- Ring buffer implementations from various npm packages (ring-buffer-ts, circular-buffer) - Consulted for API design but hand-rolling is simpler

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified against official docs and npm. TypeScript, pino, Zod, write-file-atomic are mature and well-documented.
- Architecture: HIGH - ESM project structure, state store pattern, logger with ring buffer are standard patterns with extensive documentation.
- Pitfalls: HIGH - ESM import extensions, atomic writes, Windows paths are well-documented failure modes with clear prevention strategies.

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (30 days -- stable domain, no fast-moving dependencies)
