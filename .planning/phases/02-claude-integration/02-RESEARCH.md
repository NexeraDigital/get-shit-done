# Phase 2: Claude Integration - Research

**Researched:** 2026-02-14
**Domain:** Claude Agent SDK integration, GSD command execution, question interception, timeout management
**Confidence:** HIGH

## Summary

Phase 2 wraps the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to execute GSD slash commands programmatically, intercept human-in-the-loop questions, parse structured results, enforce timeouts, and expose a clean async interface for the orchestrator. The SDK is the renamed successor to `@anthropic-ai/claude-code` and provides a typed async-generator-based `query()` function with built-in tool execution, permission control via `canUseTool` callbacks, and session management.

The integration layer has three core responsibilities: (1) calling `query()` with appropriate options to execute GSD slash commands (e.g., `/gsd:plan-phase 2`), (2) intercepting `AskUserQuestion` tool calls via the `canUseTool` callback and blocking execution until a human responds through a deferred Promise, and (3) parsing the `SDKResultMessage` to determine success or failure. A timeout wrapper using `AbortController` ensures no single command runs indefinitely.

**Primary recommendation:** Use the V1 `query()` async generator API (not the unstable V2 preview). Each GSD command gets a fresh `query()` call. The `canUseTool` callback intercepts `AskUserQuestion`, creates a deferred Promise (polyfilled for Node 20), and blocks until the orchestrator resolves it. The `AbortController` option handles timeouts. Build the integration as a single `ClaudeService` class with an EventEmitter for question lifecycle events.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 | Execute GSD commands via `query()`, intercept questions, parse results | Official Anthropic SDK; replaces `claude -p` child process spawning; typed message stream |
| `zod` | ^4.0.0 | Already a peer dep of the SDK; validate CommandResult shapes | Required peer dependency of the SDK; already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` | built-in | Generate question IDs via `crypto.randomUUID()` | Every AskUserQuestion interception |
| `node:events` | built-in | EventEmitter for question lifecycle events | ClaudeService emits question:pending, question:answered |
| `node:timers` | built-in | `setTimeout` for AbortController timeout | Every command execution |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| V1 `query()` async generator | V2 `unstable_v2_createSession()` | V2 is unstable preview; lacks some features (session forking); API may change. Use V1 for production. |
| `AbortController` for timeout | `Promise.race` with `setTimeout` | AbortController is cleaner -- directly cancels SDK internals rather than ignoring the result |
| Polyfill `Promise.withResolvers` | Require Node 22+ | Project targets Node >=20; polyfill is 5 lines of code |

**Installation:**
```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Note:** The SDK has `zod ^4.0.0` as a peer dependency, which is already in the project's dependencies.

## Architecture Patterns

### Recommended Project Structure
```
src/
  claude/
    index.ts             # ClaudeService class (public API)
    types.ts             # CommandResult, RunCommandOptions, QuestionEvent types
    result-parser.ts     # Parse SDKMessage stream into CommandResult
    question-handler.ts  # AskUserQuestion interception + deferred Promise
    timeout.ts           # AbortController timeout wrapper
    polyfills.ts         # Promise.withResolvers polyfill for Node 20
    __tests__/
      claude-service.test.ts
      result-parser.test.ts
      question-handler.test.ts
      timeout.test.ts
```

### Pattern 1: ClaudeService as Facade
**What:** A single class that encapsulates all SDK interaction, exposing `runGsdCommand()` as the only public method.
**When to use:** Always -- the orchestrator should never import or interact with `@anthropic-ai/claude-agent-sdk` directly.
**Example:**
```typescript
// Source: Architecture research + SDK official docs
import { EventEmitter } from 'node:events';

export interface CommandResult {
  success: boolean;
  result?: string;
  error?: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  numTurns: number;
}

export interface RunCommandOptions {
  timeoutMs?: number;   // Default: 600_000 (10 minutes)
  cwd?: string;
  phase?: number;
  step?: string;
}

export class ClaudeService extends EventEmitter {
  async runGsdCommand(
    prompt: string,
    options?: RunCommandOptions,
  ): Promise<CommandResult> {
    // Implementation wraps query() with canUseTool, timeout, result parsing
  }

  submitAnswer(questionId: string, answers: Record<string, string>): void {
    // Resolves the deferred promise for the given question
  }

  abortCurrent(): void {
    // Aborts the current running query via AbortController
  }
}
```

### Pattern 2: Deferred Promise for Question Blocking (CLDE-05)
**What:** Use `Promise.withResolvers()` (ES2024) to create a promise whose resolve/reject functions are stored in a Map keyed by question ID. The `canUseTool` callback awaits this promise, blocking SDK execution until the orchestrator calls `submitAnswer()`.
**When to use:** Every `AskUserQuestion` interception.
**Why:** Cleanly separates promise creation (in `canUseTool` callback) from resolution (in `submitAnswer()`, called by the web API handler). No polling, no shared mutable flag.

**Node 20 polyfill (required since project targets >=20):**
```typescript
// Source: MDN + TC39 proposal
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
```

**TypeScript declaration (add to polyfills.ts):**
```typescript
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}
```

### Pattern 3: AbortController Timeout (CLDE-04)
**What:** Create an `AbortController`, pass it to `query()` options, and set a `setTimeout` that calls `controller.abort()` after the configured timeout.
**When to use:** Every `runGsdCommand()` call.
**Example:**
```typescript
// Source: SDK docs (Options.abortController)
function withTimeout(timeoutMs: number): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => clearTimeout(timer);
  return { controller, cleanup };
}

// Usage in runGsdCommand:
const { controller, cleanup } = withTimeout(options?.timeoutMs ?? 600_000);
try {
  for await (const message of query({
    prompt,
    options: { abortController: controller, /* ... */ }
  })) {
    // process messages
  }
} finally {
  cleanup();
}
```

**Known issue:** Aborting immediately after the init message can corrupt session state (GitHub issue #69). Since each GSD command uses a fresh query (no session resume), this is not a concern for our use case.

### Pattern 4: Async Generator Message Processing (CLDE-03)
**What:** Consume the `query()` async generator in a `for await...of` loop, dispatching on message type to extract session IDs, log assistant messages, and capture the final result.
**When to use:** Every command execution.
**Example:**
```typescript
// Source: SDK TypeScript reference
const messages: SDKMessage[] = [];
let sessionId = '';

for await (const message of query({ prompt, options: queryOptions })) {
  messages.push(message);

  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }

  if (message.type === 'assistant') {
    // Log or forward assistant output
    this.logger.log('debug', 'claude', 'assistant message', {
      phase: options?.phase,
      step: options?.step,
    });
  }

  if (message.type === 'result') {
    return this.parseResult(message, sessionId);
  }
}
```

### Pattern 5: canUseTool Callback for Question Interception (CLDE-02)
**What:** Pass a `canUseTool` async function to `query()` options that checks for `AskUserQuestion` and routes to the deferred-promise handler.
**When to use:** Every command execution.
**Example:**
```typescript
// Source: SDK user-input docs
const canUseTool: CanUseTool = async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    return this.handleQuestion(input as AskUserQuestionInput);
  }
  // Allow all other tools (running in bypassPermissions mode)
  return { behavior: 'allow', updatedInput: input };
};
```

**Key detail about the answer format:** The `updatedInput` must include both `questions` (the original array) and `answers` (a `Record<string, string>` mapping question text to selected label). For multi-select, join labels with `", "`.

### Anti-Patterns to Avoid
- **Spawning `claude -p` as a child process:** Known hanging bug, no structured output, no question interception. Use the SDK `query()` instead.
- **Using V2 preview (`unstable_v2_*`) for production:** API marked unstable, may change without notice. Stick with V1 `query()`.
- **Resuming sessions for GSD commands:** Each GSD slash command should be a fresh `query()` call. Session resume adds complexity without benefit since GSD commands are stateless (each reads project files fresh).
- **Streaming partial messages without need:** Don't set `includePartialMessages: true` unless needed for real-time output display. It significantly increases message volume.
- **Loading all setting sources:** Don't use `settingSources: ['user', 'project', 'local']` which loads user-specific settings that may conflict. Use `settingSources: ['project']` to load only CLAUDE.md files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Executing Claude commands | Child process spawn of `claude -p` | `query()` from `@anthropic-ai/claude-agent-sdk` | Structured output, typed messages, no hanging bugs, built-in tool execution |
| Tool permission control | Custom tool filtering logic | `canUseTool` callback + `allowedTools` option | SDK handles the tool loop; callback pauses execution naturally |
| Command cancellation | Process.kill() or signal forwarding | `AbortController` passed to `query()` options | SDK-native cancellation; cleans up internal state properly |
| Message type parsing | Regex on stdout strings | `SDKMessage` union type with discriminated `type` field | TypeScript compiler enforces exhaustive handling |
| Session ID tracking | Custom session management | `session_id` from `SDKSystemMessage` (type: 'system', subtype: 'init') | SDK generates and manages session IDs internally |

**Key insight:** The Claude Agent SDK handles the entire agent loop internally (tool execution, message routing, error recovery). Our integration layer should be thin -- just configuration, question interception, result parsing, and timeout management. Do not re-implement any SDK internals.

## Common Pitfalls

### Pitfall 1: Forgetting `settingSources` for CLAUDE.md
**What goes wrong:** GSD slash commands rely on CLAUDE.md files for project context and slash command definitions. Without `settingSources: ['project']`, the SDK loads no filesystem settings by default (v0.1.0+ breaking change).
**Why it happens:** The migration from claude-code to claude-agent-sdk changed the default from loading all settings to loading none.
**How to avoid:** Always include `settingSources: ['project']` in query options. This loads `.claude/settings.json` and CLAUDE.md files from the project directory.
**Warning signs:** Commands fail with "unknown command" errors or behave as if there are no project instructions.

### Pitfall 2: Missing `systemPrompt` Preset
**What goes wrong:** Without `systemPrompt: { type: 'preset', preset: 'claude_code' }`, the SDK uses a minimal system prompt that does not include Claude Code's tool usage instructions, slash command awareness, or coding patterns.
**Why it happens:** Another v0.1.0+ breaking change -- system prompt is no longer included by default.
**How to avoid:** Set `systemPrompt: { type: 'preset', preset: 'claude_code' }` in query options to get full Claude Code behavior including slash command support.
**Warning signs:** Claude does not recognize slash commands, behaves generically, or does not use tools effectively.

### Pitfall 3: Not Including `AskUserQuestion` in `allowedTools`
**What goes wrong:** If you restrict tools via `allowedTools` but omit `AskUserQuestion`, Claude cannot ask clarifying questions, and the `canUseTool` callback for `AskUserQuestion` will never fire.
**Why it happens:** Developers list tools for file operations but forget the question tool.
**How to avoid:** Always include `'AskUserQuestion'` in the `allowedTools` array when question interception is needed.
**Warning signs:** Claude makes assumptions instead of asking questions; `canUseTool` never fires for `AskUserQuestion`.

### Pitfall 4: Promise.withResolvers Not Available on Node 20
**What goes wrong:** `Promise.withResolvers is not a function` at runtime.
**Why it happens:** `Promise.withResolvers` is ES2024, available natively only in Node.js 22+. The project targets `>=20.0.0`.
**How to avoid:** Import the polyfill module at the top of the entry point. Add `"lib": ["ES2024"]` to tsconfig or declare the type globally.
**Warning signs:** Runtime TypeError on first AskUserQuestion interception.

### Pitfall 5: Timeout Cleanup on Success
**What goes wrong:** `setTimeout` timer is not cleared when the command completes successfully before the timeout, leading to a dangling timer that keeps the Node.js process alive.
**Why it happens:** The `setTimeout` call in the timeout wrapper is not cleared in the success path.
**How to avoid:** Always call `clearTimeout()` in a `finally` block after the `for await` loop completes.
**Warning signs:** Process does not exit cleanly; `vitest` tests hang.

### Pitfall 6: Answer Format for AskUserQuestion
**What goes wrong:** Claude does not receive the answers and re-asks the question or errors.
**Why it happens:** The `updatedInput` must include both `questions` (original array) AND `answers` (Record mapping question text to label). Returning only `answers` or using question ID as key instead of question text causes the SDK to not match answers to questions.
**How to avoid:** Always return `{ behavior: 'allow', updatedInput: { questions: input.questions, answers } }` where keys in `answers` are the full `question` text strings.
**Warning signs:** Claude repeats the same question; result shows "no answer provided".

### Pitfall 7: AbortError Handling
**What goes wrong:** Unhandled rejection or unclear error when timeout fires.
**Why it happens:** When `AbortController.abort()` fires, the SDK throws an `AbortError`. If not caught, it becomes an unhandled rejection.
**How to avoid:** Wrap the `for await` loop in try/catch. Check for `AbortError` specifically and return a timeout-specific `CommandResult` with `success: false` and a clear error message.
**Warning signs:** Unhandled promise rejection warnings in test output.

## Code Examples

Verified patterns from official sources:

### Complete query() Call with All Required Options (CLDE-01)
```typescript
// Source: https://platform.claude.com/docs/en/agent-sdk/typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const canUseTool: CanUseTool = async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    // Handle question interception (see Pattern 2)
    return handleQuestion(input);
  }
  return { behavior: 'allow', updatedInput: input };
};

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 600_000);

try {
  for await (const message of query({
    prompt: '/gsd:plan-phase 2',
    options: {
      cwd: '/path/to/project',
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: [
        'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
        'WebFetch', 'WebSearch', 'Task', 'AskUserQuestion',
      ],
      abortController: controller,
    },
  })) {
    // Process messages...
  }
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    // Timeout occurred
  }
  throw err;
} finally {
  clearTimeout(timer);
}
```

### Parsing SDKResultMessage (CLDE-03)
```typescript
// Source: https://platform.claude.com/docs/en/agent-sdk/typescript#sdkresultmessage
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

function parseResult(message: SDKResultMessage, sessionId: string): CommandResult {
  if (message.subtype === 'success') {
    return {
      success: !message.is_error,
      result: message.result,
      sessionId,
      durationMs: message.duration_ms,
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
    };
  }
  // Error subtypes: error_max_turns, error_during_execution,
  // error_max_budget_usd, error_max_structured_output_retries
  return {
    success: false,
    error: message.errors?.join('; ') ?? `Command failed: ${message.subtype}`,
    sessionId,
    durationMs: message.duration_ms,
    costUsd: message.total_cost_usd,
    numTurns: message.num_turns,
  };
}
```

### AskUserQuestion Interception with Deferred Promise (CLDE-02, CLDE-05)
```typescript
// Source: https://platform.claude.com/docs/en/agent-sdk/user-input
import type { AskUserQuestionInput, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

// Stored in ClaudeService instance
private pendingQuestions = new Map<string, {
  resolve: (answers: Record<string, string>) => void;
  reject: (reason?: unknown) => void;
}>();

private async handleQuestion(input: AskUserQuestionInput): Promise<PermissionResult> {
  const questionId = randomUUID();

  const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();
  this.pendingQuestions.set(questionId, { resolve, reject });

  // Emit event for orchestrator/notification system
  this.emit('question:pending', {
    id: questionId,
    questions: input.questions,
  });

  // Block SDK execution until human responds
  const answers = await promise;

  // Return answers to SDK in the expected format
  return {
    behavior: 'allow',
    updatedInput: {
      questions: input.questions,
      answers,
    },
  };
}

// Called externally when human provides answers
public submitAnswer(questionId: string, answers: Record<string, string>): boolean {
  const pending = this.pendingQuestions.get(questionId);
  if (!pending) return false;

  pending.resolve(answers);
  this.pendingQuestions.delete(questionId);
  this.emit('question:answered', { id: questionId, answers });
  return true;
}
```

### QuestionEvent Type for Orchestrator Communication
```typescript
// Derived from SDK AskUserQuestionInput type + project needs
export interface QuestionEvent {
  id: string;
  phase?: number;
  step?: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
  createdAt: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@anthropic-ai/claude-code` package | `@anthropic-ai/claude-agent-sdk` | v0.1.0 (late 2025) | Package rename; import path change only |
| System prompt loaded by default | Must opt-in with `systemPrompt: { type: 'preset', preset: 'claude_code' }` | v0.1.0 | Breaking change: queries without preset get minimal prompt |
| Settings loaded from filesystem by default | Must opt-in with `settingSources: ['project']` | v0.1.0 | Breaking change: no CLAUDE.md or slash commands loaded without this |
| `ClaudeCodeOptions` (Python only) | `ClaudeAgentOptions` (Python only) | v0.1.0 | Type rename (Python SDK only; TS uses plain `Options` object) |
| `claude -p` child process spawning | `query()` from Agent SDK | 2025 | Eliminates hanging bug, adds structured output, question interception |

**Deprecated/outdated:**
- `@anthropic-ai/claude-code` npm package: Renamed to `@anthropic-ai/claude-agent-sdk`. The old package is deprecated.
- V2 preview (`unstable_v2_*`): Exists but is explicitly marked unstable. Do not use for production.

## Open Questions

1. **GSD Slash Command Invocation Format**
   - What we know: The SDK `query()` takes a `prompt` string. GSD slash commands are defined in `.claude/commands/` and loaded via `settingSources: ['project']`.
   - What's unclear: Whether the prompt should be literally `/gsd:plan-phase 2` or needs additional context/framing. This needs validation during implementation.
   - Recommendation: Start with the literal slash command as the prompt. If that does not work, wrap it in a natural language instruction like "Execute the GSD command: /gsd:plan-phase 2". Test this in the first plan task.

2. **SDK Process Model**
   - What we know: The SDK spawns a Claude Code subprocess internally. The `query()` function returns an async generator of messages from this subprocess.
   - What's unclear: Whether multiple concurrent `query()` calls are safe, and what resources each query consumes (processes, memory).
   - Recommendation: Design for sequential execution (one command at a time). The orchestrator already runs phases sequentially. Add a guard in `ClaudeService` to prevent concurrent calls.

3. **Cost Tracking Granularity**
   - What we know: `SDKResultMessage` includes `total_cost_usd` and per-model `modelUsage` breakdown.
   - What's unclear: Whether cost data is accurate across all API key types and providers (Bedrock, Vertex).
   - Recommendation: Capture `total_cost_usd` in `CommandResult` and let the orchestrator accumulate costs. Don't depend on it for logic decisions.

4. **`bypassPermissions` vs `acceptEdits` for GSD Commands**
   - What we know: `bypassPermissions` skips all permission checks. `acceptEdits` auto-accepts file edits but may still prompt for other operations.
   - What's unclear: Whether GSD commands trigger any tool calls that would be blocked under `acceptEdits` but allowed under `bypassPermissions`.
   - Recommendation: Use `bypassPermissions` with `allowDangerouslySkipPermissions: true` for autonomous operation. GSD commands need full tool access without interactive prompts.

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - SDK capabilities, installation, architecture
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - Complete API reference with all types: `query()`, `Options`, `SDKMessage`, `SDKResultMessage`, `CanUseTool`, `PermissionResult`, `AskUserQuestionInput`
- [Handle Approvals and User Input](https://platform.claude.com/docs/en/agent-sdk/user-input) - AskUserQuestion handling, canUseTool callback, answer format
- [Migration Guide](https://platform.claude.com/docs/en/agent-sdk/migration-guide) - Breaking changes from claude-code to claude-agent-sdk
- [Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions) - Session IDs, resume, forking
- [TypeScript V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) - Unstable V2 interface (noted for avoidance)
- npm registry: `@anthropic-ai/claude-agent-sdk@0.2.42` - Current version, engines: `>=18.0.0`, peer deps: `zod ^4.0.0`

### Secondary (MEDIUM confidence)
- [AbortController session cancellation issue #69](https://github.com/anthropics/claude-agent-sdk-typescript/issues/69) - Known bug with immediate abort after init; not relevant to our use case (we don't resume sessions)
- [Claude Agent SDK TypeScript GitHub](https://github.com/anthropics/claude-agent-sdk-typescript) - Source code, issues, changelog
- [Promise.withResolvers MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers) - ES2024 specification, browser/runtime compatibility
- [Architecture patterns from project research](C:/GitHub/GetShitDone/get-shit-done/.planning/research/ARCHITECTURE.md) - Existing project architecture decisions

### Tertiary (LOW confidence)
- None. All findings verified through official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK is official Anthropic product with comprehensive TypeScript docs and verified npm package
- Architecture: HIGH - Patterns derived from official SDK documentation and verified code examples
- Pitfalls: HIGH - Breaking changes verified via migration guide; Node.js compatibility verified via MDN and runtime testing
- Question interception: HIGH - Complete AskUserQuestion flow documented with TypeScript examples in official docs

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (SDK is actively developed; check for breaking changes monthly)
