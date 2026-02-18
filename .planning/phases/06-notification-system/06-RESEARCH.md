# Phase 6: Notification System - Research

**Researched:** 2026-02-18
**Domain:** Node.js notification dispatching — console output, OS toasts, Teams/Slack webhooks, custom adapters
**Confidence:** HIGH (codebase verified, library APIs verified via official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Notification triggers & frequency
- Two trigger categories only: **questions pending** and **autopilot stopped** (error, shutdown, or build complete)
- Stop notifications include: status, summary (phases completed, time elapsed, error if applicable), and next steps (e.g., "run --resume" or "check verification gaps")
- No phase milestone notifications (start/complete) — keep it quiet
- Question reminders: re-notify if question is unanswered after a configurable timeout (e.g., 5 min default)
- Frequency control: Claude's Discretion (one-per-event is likely sufficient, batching optional)

#### Console output style
- Inline with normal output flow — colored line, not a box/banner
- Question notifications show the full question text and options in the terminal
- Include full clickable URL to the dashboard question page (e.g., `http://localhost:3847/questions/abc123`)
- Terminal bell character (`\a`) for question notifications only — silent for stop/error
- No bell or sound for non-question notifications

#### Chat platform messages (Teams/Slack)
- Link only — no inline action buttons. Message contains question text + dashboard link to answer
- Minimal content: phase name, question/status text, dashboard link. No progress bars or option lists
- Same minimal style for both question and stop notifications — consistent across notification types
- Teams and Slack adapters: identical logical behavior, formatted for each platform's native card format (Adaptive Card vs Block Kit)
- Claude's Discretion: platform-specific formatting differences where it makes sense

#### Custom adapter contract
- Class-based with lifecycle: `init()`, `send(notification)`, `close()` methods
- Fire and forget: `send()` does not return delivery status. Console fallback triggers on thrown errors
- Claude's Discretion: whether to include helper functions (e.g., `toPlainText()`, `toMarkdown()`) alongside the raw Notification object
- Ship an example adapter file (`example-adapter.js`) that users can copy and modify as a starting point

### Claude's Discretion
- Notification frequency control strategy (batching vs one-per-event)
- Whether to include formatting helper functions for custom adapters
- Platform-specific formatting differences between Teams and Slack adapters
- Exact console color scheme for different notification types
- Reminder timeout default value and configurability

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Summary

The notification system is an adapter-dispatching layer that hooks into two existing event sources: the `ClaudeService` (emits `'question:pending'`) and the `Orchestrator` (emits `'build:complete'`, `'error:escalation'`). A `NotificationManager` class receives these events, builds a `Notification` object, and dispatches it to all configured adapters simultaneously using `Promise.allSettled`. The fallback rule (always attempt console if all adapters fail) is implemented by running the console adapter last as a guaranteed fallback.

The four adapter types map neatly to their libraries: the console adapter uses `ansis` (already a project dependency), the system adapter uses `node-notifier` v10.0.1 (CJS-only, requires `createRequire` workaround in the ESM project), and Teams/Slack adapters use Node.js built-in `fetch` (available since Node 18, project requires >=20). No new mandatory dependencies are needed for the core happy path; `node-notifier` is the only opt-in addition.

One critical finding: Microsoft is actively deprecating Office 365 Connectors (the old Teams incoming webhook format). The replacement is a "Workflows" (Power Automate) webhook, which accepts the same `{"type":"message","attachments":[...]}` Adaptive Card JSON envelope. The implementation should use the Adaptive Card format rather than the legacy MessageCard format so it works with both old and new webhook URLs during the transition period.

**Primary recommendation:** Implement `NotificationManager` as a standalone class wired at the CLI layer (alongside StreamRenderer), using the existing `ClaudeService` and `Orchestrator` event emissions as triggers. Use `Promise.allSettled` for parallel dispatch with automatic console fallback.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ansis` | ^4.2.0 | Console adapter ANSI colors | Already in project dependencies; used by StreamRenderer |
| Node.js `fetch` | built-in (Node >=18) | HTTP POST for Teams/Slack/custom webhooks | Zero new dependency; project already requires Node >=20 |
| `node:timers` | built-in | Question reminder setTimeout | Zero new dependency |
| `node:crypto` | built-in | Notification ID generation (randomUUID) | Already used in question-handler.ts |

### Supporting (opt-in)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-notifier` | ^10.0.1 | OS-native toast notifications | Only when `--notify system` flag is set |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-notifier | `@electron/windows-notifications` | Only relevant for Electron apps; overkill for CLI |
| node-notifier | `node-toast` | Less maintained, fewer platform quirks documented |
| built-in fetch | `node-fetch` or `axios` | node-fetch v3 is ESM-only but adds nothing over built-in; axios adds weight |

**Installation (only if system notifications needed):**
```bash
npm install node-notifier
npm install --save-dev @types/node-notifier
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── notifications/
│   ├── index.ts              # Barrel: exports NotificationManager, adapter types
│   ├── manager.ts            # NotificationManager class (dispatch + fallback + reminders)
│   ├── types.ts              # NotificationAdapter interface with lifecycle (supersedes types/notification.ts stub)
│   ├── adapters/
│   │   ├── console.ts        # ConsoleAdapter — uses ansis, StreamRenderer-compatible
│   │   ├── system.ts         # SystemAdapter — node-notifier, opt-in
│   │   ├── teams.ts          # TeamsAdapter — Adaptive Card via fetch
│   │   ├── slack.ts          # SlackAdapter — Block Kit via fetch
│   │   └── webhook.ts        # CustomWebhookAdapter — raw JSON POST via fetch
│   └── __tests__/
│       ├── manager.test.ts
│       ├── console.test.ts
│       ├── teams.test.ts
│       └── slack.test.ts
└── example-adapter.js        # Shipped alongside dist/ for user reference
```

### Pattern 1: NotificationAdapter Lifecycle Interface

The existing `NotificationAdapter` stub in `types/notification.ts` only has `send()`. The user decision requires a full lifecycle contract. The new interface supersedes the stub.

**What:** Three-method lifecycle contract matching how long-lived adapters (OS, webhook clients) need setup/teardown.
**When to use:** All adapters implement this interface.

```typescript
// src/notifications/types.ts
import type { Notification } from '../types/notification.js';

export interface NotificationAdapter {
  readonly name: string;
  /** Called once at startup. Throw to signal the adapter cannot be used. */
  init(): Promise<void>;
  /**
   * Fire-and-forget. MUST NOT return delivery status.
   * Throw on hard failures — NotificationManager will catch and fall back to console.
   */
  send(notification: Notification): Promise<void>;
  /** Called on shutdown for cleanup (close connections, timers). */
  close(): Promise<void>;
}
```

### Pattern 2: NotificationManager — Parallel Dispatch with Console Fallback

**What:** Dispatch to all configured adapters simultaneously; if all fail, guarantee console delivery.
**When to use:** Every notification event.

```typescript
// src/notifications/manager.ts
import type { Notification } from '../types/notification.js';
import type { NotificationAdapter } from './types.js';
import { ConsoleAdapter } from './adapters/console.js';

export class NotificationManager {
  private readonly adapters: NotificationAdapter[];
  private readonly consoleAdapter: ConsoleAdapter;
  private readonly reminderTimers = new Map<string, NodeJS.Timeout>();

  constructor(adapters: NotificationAdapter[], consoleAdapter: ConsoleAdapter) {
    this.adapters = adapters;
    this.consoleAdapter = consoleAdapter;
  }

  async dispatch(notification: Notification): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.send(notification))
    );

    const allFailed = results.every((r) => r.status === 'rejected');

    // NOTF-10: Console fallback when all adapters fail
    // Also: console adapter is ALWAYS in the adapters list when it's the default,
    // so this fallback only triggers when NON-console adapters all fail and console
    // was somehow also excluded (e.g., custom-only mode where console wasn't added).
    if (allFailed && !this.adapters.includes(this.consoleAdapter)) {
      await this.consoleAdapter.send(notification).catch(() => {});
    }
  }

  /**
   * Schedule a reminder for an unanswered question.
   * Cancels any existing reminder for the same question ID.
   */
  scheduleReminder(notification: Notification, delayMs: number): void {
    this.cancelReminder(notification.id);
    const timer = setTimeout(() => {
      this.reminderTimers.delete(notification.id);
      void this.dispatch(notification);
    }, delayMs);
    this.reminderTimers.set(notification.id, timer);
  }

  cancelReminder(notificationId: string): void {
    const timer = this.reminderTimers.get(notificationId);
    if (timer) {
      clearTimeout(timer);
      this.reminderTimers.delete(notificationId);
    }
  }

  async close(): Promise<void> {
    for (const timer of this.reminderTimers.values()) clearTimeout(timer);
    this.reminderTimers.clear();
    await Promise.allSettled(this.adapters.map((a) => a.close()));
  }
}
```

### Pattern 3: Console Adapter — Inline StreamRenderer-Compatible Output

**What:** Write colored notification lines directly to `process.stdout`, compatible with ora spinner lifecycle.
**When to use:** Default adapter; always included.

The critical constraint: the console adapter must stop the `StreamRenderer`'s ora spinner before writing, just as `StreamRenderer.write()` does internally. The cleanest approach is passing a `stopSpinner` callback (or a reference to the StreamRenderer instance) into the ConsoleAdapter.

```typescript
// src/notifications/adapters/console.ts
import ansis from 'ansis';
import type { Notification } from '../../types/notification.js';
import type { NotificationAdapter } from '../types.js';

export interface ConsoleAdapterOptions {
  output?: NodeJS.WriteStream;
  stopSpinner?: () => void;
  port?: number;
}

export class ConsoleAdapter implements NotificationAdapter {
  readonly name = 'console';
  private readonly output: NodeJS.WriteStream;
  private readonly stopSpinner: () => void;
  private readonly port: number;

  constructor(options: ConsoleAdapterOptions = {}) {
    this.output = options.output ?? process.stdout;
    this.stopSpinner = options.stopSpinner ?? (() => {});
    this.port = options.port ?? 3847;
  }

  async init(): Promise<void> {}

  async send(notification: Notification): Promise<void> {
    this.stopSpinner();

    const lines = this.format(notification);
    for (const line of lines) {
      this.output.write(line);
    }

    // Terminal bell for question notifications only (user decision)
    if (notification.type === 'question') {
      this.output.write('\x07'); // BEL character (\a)
    }
  }

  async close(): Promise<void> {}

  private format(notification: Notification): string[] {
    const lines: string[] = ['\n'];

    switch (notification.type) {
      case 'question': {
        lines.push(ansis.bold.yellow(`[?] ${notification.title}\n`));
        lines.push(ansis.yellow(`    ${notification.body}\n`));
        if (notification.options?.length) {
          for (const opt of notification.options) {
            lines.push(ansis.dim(`      • ${opt}\n`));
          }
        }
        if (notification.respondUrl) {
          lines.push(ansis.cyan(`    Answer: ${notification.respondUrl}\n`));
        }
        break;
      }
      case 'error': {
        lines.push(ansis.bold.red(`[!] ${notification.title}\n`));
        lines.push(ansis.red(`    ${notification.body}\n`));
        break;
      }
      case 'complete': {
        lines.push(ansis.bold.green(`[+] ${notification.title}\n`));
        lines.push(ansis.green(`    ${notification.body}\n`));
        break;
      }
      default: {
        lines.push(ansis.dim(`[-] ${notification.title}: ${notification.body}\n`));
      }
    }

    return lines;
  }
}
```

### Pattern 4: Teams Adapter — Adaptive Card via fetch

**What:** POST Adaptive Card JSON to Teams incoming webhook URL.
**When to use:** `--notify teams --webhook-url <url>` is configured.

**Critical finding:** Microsoft is deprecating Office 365 Connectors. The new Workflows-based webhook accepts the same `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{...}}]}` envelope format. Use Adaptive Card format (not MessageCard) to support both old and new URLs.

```typescript
// src/notifications/adapters/teams.ts
import type { Notification } from '../../types/notification.js';
import type { NotificationAdapter } from '../types.js';

export class TeamsAdapter implements NotificationAdapter {
  readonly name = 'teams';
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async init(): Promise<void> {}

  async send(notification: Notification): Promise<void> {
    const body = this.buildAdaptiveCard(notification);

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Teams webhook failed: HTTP ${response.status}`);
    }
  }

  async close(): Promise<void> {}

  private buildAdaptiveCard(notification: Notification): unknown {
    const facts: Array<{ title: string; value: string }> = [
      { title: 'Type', value: notification.type },
    ];
    if (notification.phase != null) {
      facts.push({ title: 'Phase', value: String(notification.phase) });
    }

    const body: unknown[] = [
      { type: 'TextBlock', text: notification.title, weight: 'Bolder', size: 'Medium' },
      { type: 'TextBlock', text: notification.body, wrap: true },
    ];

    if (notification.respondUrl) {
      body.push({
        type: 'TextBlock',
        text: `[Open Dashboard](${notification.respondUrl})`,
        wrap: true,
      });
    }

    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body,
          ...(facts.length > 0 ? { facts } : {}),
        },
      }],
    };
  }
}
```

### Pattern 5: Slack Adapter — Block Kit via fetch

**What:** POST Block Kit message to Slack incoming webhook URL.
**When to use:** `--notify slack --webhook-url <url>` is configured.

```typescript
// src/notifications/adapters/slack.ts
import type { Notification } from '../../types/notification.js';
import type { NotificationAdapter } from '../types.js';

export class SlackAdapter implements NotificationAdapter {
  readonly name = 'slack';
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async init(): Promise<void> {}

  async send(notification: Notification): Promise<void> {
    const body = this.buildBlockKit(notification);

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: HTTP ${response.status}`);
    }
  }

  async close(): Promise<void> {}

  private buildBlockKit(notification: Notification): unknown {
    // Top-level "text" is required fallback for notifications/accessibility
    const fallbackText = `${notification.title}: ${notification.body}`;

    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${notification.title}*\n${notification.body}`,
        },
      },
    ];

    if (notification.respondUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${notification.respondUrl}|Open Dashboard>`,
        },
      });
    }

    return { text: fallbackText, blocks };
  }
}
```

### Pattern 6: node-notifier in ESM Project (createRequire)

**What:** node-notifier v10.0.1 is CJS-only (no `exports` field, no `"type":"module"`). In an ESM project (`"type":"module"` in package.json), use `createRequire`.
**When to use:** SystemAdapter only.

```typescript
// src/notifications/adapters/system.ts
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Notification } from '../../types/notification.js';
import type { NotificationAdapter } from '../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifier = require('node-notifier') as typeof import('node-notifier');

export class SystemAdapter implements NotificationAdapter {
  readonly name = 'system';

  async init(): Promise<void> {
    // Verify node-notifier is installed (it's an optional dependency)
    // If createRequire throws above, the module load fails at import time.
  }

  async send(notification: Notification): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      notifier.notify(
        {
          title: notification.title,
          message: notification.body,
          // Sounds on Windows/macOS — only for question type per user decision
          sound: notification.type === 'question',
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async close(): Promise<void> {}
}
```

### Pattern 7: CLI Wiring — NotificationManager at Entry Point

**What:** The NotificationManager is constructed and wired in `cli/index.ts` alongside the StreamRenderer, then registered with the ShutdownManager.
**When to use:** At application startup.

```typescript
// In cli/index.ts — additions to existing setup

import { NotificationManager } from '../notifications/index.js';
import { ConsoleAdapter } from '../notifications/adapters/console.js';
import { buildAdapters } from '../notifications/index.js'; // factory

// After streamRenderer is created:
const consoleAdapter = new ConsoleAdapter({
  stopSpinner: () => streamRenderer.stopSpinner(),
  port: config.port,
});
const adapters = await buildAdapters(config, consoleAdapter);
const notificationManager = new NotificationManager(adapters, consoleAdapter);

// Wire question events from ClaudeService
const REMINDER_MS = 5 * 60 * 1000; // 5 minutes default
claudeService.on('question:pending', (event: QuestionEvent) => {
  const notification = questionEventToNotification(event, config.port);
  void notificationManager.dispatch(notification);
  notificationManager.scheduleReminder(notification, REMINDER_MS);
});
claudeService.on('question:answered', ({ id }: { id: string }) => {
  notificationManager.cancelReminder(id);
});

// Wire stop events from Orchestrator
orchestrator.on('build:complete', () => {
  void notificationManager.dispatch(buildCompleteNotification(stateStore));
});
orchestrator.on('error:escalation', (payload) => {
  void notificationManager.dispatch(errorEscalationNotification(payload));
});

// Register cleanup
shutdown.register(async () => {
  await notificationManager.close();
});
```

### Pattern 8: Custom Adapter Loading

**What:** Dynamically import a user-provided adapter module from disk using `import()`.
**When to use:** `--adapter-path ./my-adapter.js` is configured.

```typescript
// src/notifications/index.ts — buildAdapters factory
export async function buildAdapters(
  config: AutopilotConfig,
  consoleAdapter: ConsoleAdapter,
): Promise<NotificationAdapter[]> {
  const adapters: NotificationAdapter[] = [consoleAdapter];

  const channel = config.notify;

  if (channel === 'system') {
    const { SystemAdapter } = await import('./adapters/system.js');
    adapters.push(new SystemAdapter());
  } else if (channel === 'teams') {
    if (!config.webhookUrl) throw new Error('--webhook-url required for --notify teams');
    const { TeamsAdapter } = await import('./adapters/teams.js');
    adapters.push(new TeamsAdapter(config.webhookUrl));
  } else if (channel === 'slack') {
    if (!config.webhookUrl) throw new Error('--webhook-url required for --notify slack');
    const { SlackAdapter } = await import('./adapters/slack.js');
    adapters.push(new SlackAdapter(config.webhookUrl));
  } else if (channel === 'webhook') {
    if (!config.webhookUrl) throw new Error('--webhook-url required for --notify webhook');
    const { CustomWebhookAdapter } = await import('./adapters/webhook.js');
    adapters.push(new CustomWebhookAdapter(config.webhookUrl));
  }

  if (config.adapterPath) {
    // Dynamic import from absolute path
    const module = await import(config.adapterPath) as { default?: new () => NotificationAdapter };
    const AdapterClass = module.default;
    if (typeof AdapterClass !== 'function') {
      throw new Error(`Custom adapter at ${config.adapterPath} must export a default class`);
    }
    adapters.push(new AdapterClass());
  }

  // Run init() on all non-console adapters
  for (const adapter of adapters) {
    await adapter.init();
  }

  return adapters;
}
```

### Anti-Patterns to Avoid

- **Calling `send()` after uncaught throw without try/catch:** `NotificationManager.dispatch()` uses `Promise.allSettled` — never let a single failed adapter prevent others from running.
- **Writing directly to stdout without stopping the spinner:** The ora spinner in StreamRenderer will produce garbled output. Always call `stopSpinner()` before writing. The ConsoleAdapter must receive a `stopSpinner` callback.
- **Blocking on `send()` from within event handlers:** Orchestrator events are synchronous; use `void notificationManager.dispatch(...)` (fire-and-forget at the call site).
- **Mutating the stub `NotificationAdapter` in `types/notification.ts` in place:** The new lifecycle interface should be defined in `notifications/types.ts`. Update the barrel `types/index.ts` to export from the new location.
- **Using the MessageCard format for Teams:** O365 Connectors are deprecated; use Adaptive Card format.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ANSI terminal colors | Custom color escape codes | `ansis` (already in deps) | Already project-standard; handles color level detection |
| OS-native toast notifications | execFile() calling platform-specific CLI | `node-notifier` | Cross-platform handling of macOS NC, Windows Toaster, Linux notify-send, fallback to Growl |
| HTTP webhook POST | Custom http.request wrapping | `fetch` (Node built-in) | Available globally in Node >=18; no extra dependency |
| Notification ID generation | Math.random() string | `crypto.randomUUID()` | Already used in question-handler.ts; RFC 4122 compliant |
| Adaptive Card JSON schema | Custom validation | Fixed template with version 1.2 | Teams accepts 1.2+; simple TextBlock layout needs no dynamic schema |

**Key insight:** This phase adds zero mandatory new runtime dependencies. `node-notifier` is the only addition and only when `--notify system` is used.

---

## Common Pitfalls

### Pitfall 1: ora Spinner Garbling
**What goes wrong:** Writing to stdout while ora spinner is active produces visual corruption — the spinner line and the notification text interleave.
**Why it happens:** ora uses ANSI cursor control codes to update the current line; a concurrent write interrupts its state.
**How to avoid:** The ConsoleAdapter must call `stopSpinner()` before any `this.output.write()` call. Pass the `streamRenderer.stopSpinner.bind(streamRenderer)` callback into ConsoleAdapter constructor.
**Warning signs:** Tests pass but manual runs show garbled spinner lines.

### Pitfall 2: node-notifier ESM Import Failure
**What goes wrong:** `import notifier from 'node-notifier'` throws `ERR_REQUIRE_ESM` or `package.json "type" is module` errors because node-notifier v10 is CJS-only.
**Why it happens:** The autopilot package is `"type":"module"`. node-notifier has no `exports` field and no ESM entry point.
**How to avoid:** Use `createRequire(import.meta.url)` to load it as a CJS module. See Pattern 6 above. Type it as `typeof import('node-notifier')`.
**Warning signs:** `SystemAdapter` import blows up at module load time with `ERR_REQUIRE_ESM`.

### Pitfall 3: Teams Webhook Deprecation
**What goes wrong:** Using the legacy `@type: "MessageCard"` format fails for users who have already migrated to Workflows-based webhooks (deadline: March 31, 2026).
**Why it happens:** The old format is being retired. New Workflows webhooks only accept Adaptive Cards.
**How to avoid:** Use `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive",...}]}` format. It works with both old O365 Connector webhooks and new Workflows webhooks.
**Warning signs:** Teams webhook POST returns 200 but no message appears in channel.

### Pitfall 4: Question Reminder Leaking After Answer
**What goes wrong:** Reminder timer fires after the question has already been answered, sending a spurious duplicate notification.
**Why it happens:** The `question:answered` event must be wired to `cancelReminder()`. If the wire is missing, the timer fires regardless.
**How to avoid:** Wire `claudeService.on('question:answered', ...)` to call `notificationManager.cancelReminder(id)` in CLI setup. Add a test that verifies the reminder is cancelled on answer.
**Warning signs:** Users see "you have a pending question" after they've already answered it.

### Pitfall 5: Adapter init() Failures Crashing Startup
**What goes wrong:** A misconfigured Teams webhook URL causes `init()` to throw, crashing the entire autopilot before any work begins.
**Why it happens:** `init()` is called eagerly during startup. Network errors or bad URLs surface immediately.
**How to avoid:** Two options: (a) defer init to first `send()` call, or (b) catch init failures, log a warning, and remove the failed adapter from the active list. Option (b) is recommended — the user is notified at startup that adapter X failed, but autopilot continues. Console fallback guarantees visibility.
**Warning signs:** `gsd-autopilot` exits immediately with webhook error before running any phases.

### Pitfall 6: Custom Adapter Path Resolution
**What goes wrong:** `import('./my-adapter.js')` fails when given a relative path like `./my-adapter.js` because the dynamic import resolves relative to the compiled `dist/` directory.
**Why it happens:** In the compiled output, relative paths in dynamic imports resolve relative to the compiled file's location, not the cwd.
**How to avoid:** Resolve the adapter path against `process.cwd()` before passing to `import()`. Use `new URL(config.adapterPath, 'file://' + process.cwd() + '/').href` or `path.resolve(process.cwd(), config.adapterPath)` with `pathToFileURL()`.
**Warning signs:** `Cannot find module './my-adapter.js'` when adapter file clearly exists in cwd.

---

## Code Examples

Verified patterns from official sources:

### Notification Object Shape (existing types/notification.ts)
```typescript
// Source: autopilot/src/types/notification.ts (already in codebase)
export interface Notification {
  id: string;
  type: 'question' | 'progress' | 'error' | 'complete';
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  respondUrl?: string;
  options?: string[];
  phase?: number;
  step?: string;
  createdAt: string;
}
```

### Teams Adaptive Card Envelope (MEDIUM confidence)
```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.2",
        "body": [
          {
            "type": "TextBlock",
            "text": "GSD Autopilot: Question pending",
            "weight": "Bolder"
          },
          {
            "type": "TextBlock",
            "text": "A question requires your input. Click the link below to answer.",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "[Open Dashboard](http://localhost:3847/questions/abc123)",
            "wrap": true
          }
        ]
      }
    }
  ]
}
```
Source: [Microsoft Learn - Create & Send Actionable Messages](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using)

### Slack Block Kit Envelope (HIGH confidence)
```json
{
  "text": "GSD Autopilot: Question pending",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*GSD Autopilot: Question pending*\nA question requires your input."
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "<http://localhost:3847/questions/abc123|Open Dashboard>"
      }
    }
  ]
}
```
Source: [Slack Developer Docs - Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)

### node-notifier via createRequire (MEDIUM confidence)
```typescript
// Source: Node.js ESM docs + node-notifier GitHub README (CJS-only package)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const notifier = require('node-notifier') as typeof import('node-notifier');

notifier.notify({
  title: 'GSD Autopilot',
  message: 'Question pending — open the dashboard to answer',
  sound: true,        // macOS/Windows sound
}, (err, response) => {
  // response is 'activate' (clicked), 'timeout', or undefined
});
```
Source: [node-notifier GitHub README](https://github.com/mikaelbr/node-notifier)

### Custom Webhook Raw POST
```typescript
// Uses Node.js built-in fetch (available since Node 18)
const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(notificationObject),
});
// throw on non-2xx to trigger console fallback
if (!response.ok) {
  throw new Error(`Webhook failed: HTTP ${response.status}`);
}
```

### Example Adapter (shipped as `example-adapter.js`)
```javascript
// example-adapter.js
// Copy this file, modify, and pass with --adapter-path ./my-adapter.js

export default class MyAdapter {
  constructor() {
    this.name = 'my-adapter';
  }

  async init() {
    // Setup: open connections, validate config
  }

  async send(notification) {
    // notification: { id, type, title, body, severity, respondUrl, options, phase, step, createdAt }
    // Fire and forget — do NOT return delivery status
    // Throw on hard failure to trigger console fallback
    console.log(`[my-adapter] ${notification.type}: ${notification.title}`);
  }

  async close() {
    // Teardown: close connections
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Teams MessageCard connector webhook | Teams Workflows Adaptive Card webhook | 2024–2026 transition | Must use Adaptive Card format; MessageCard deprecated |
| `require('node-notifier')` (CJS) | `createRequire(import.meta.url)` (ESM interop) | Node.js ESM adoption | CJS packages need wrapper in `"type":"module"` projects |
| node-fetch / axios for HTTP | `fetch` built-in (Node >=18) | Node.js 18 (2022) | Zero-dependency HTTP calls |

**Deprecated/outdated:**
- Teams MessageCard (`@type: "MessageCard"`): Retire by March 2026, replaced by Adaptive Card in Workflows webhook
- `require()` in ESM projects: Use `createRequire(import.meta.url)` instead

---

## Open Questions

1. **`AutopilotConfig.notify` type widening**
   - What we know: `config.notify` is typed as `z.string().default('console')` (Zod schema in `types/config.ts`), not a union. The CLI handler casts it with `as 'console' | 'system' | 'teams' | 'slack'`.
   - What's unclear: Should the Zod schema be tightened to `z.enum(['console','system','teams','slack','webhook'])` or remain a string to allow custom adapter names?
   - Recommendation: Tighten to `z.enum([...])` with the known channel names, plus `'webhook'` for the raw JSON POST adapter. Custom adapter loading uses `--adapter-path` separately.

2. **Reminder timeout configurability**
   - What we know: User decision says "5 min default" and "configurable timeout." The `AutopilotConfig` schema has no `reminderTimeout` field yet.
   - What's unclear: Should this be a top-level config field or buried under a `notifications` sub-object?
   - Recommendation: Add `questionReminderMs: z.number().int().min(0).default(300_000)` to `AutopilotConfigSchema`. Zero disables reminders.

3. **Multiple `--notify` channels simultaneously**
   - What we know: NOTF-01 says "dispatches to one or more configured adapters simultaneously." The current CLI only accepts a single `--notify <channel>` value.
   - What's unclear: Does the user want `--notify console,teams` or separate flags for each additional adapter? The CLI spec (CLI-02) says `--notify <channel>` (singular).
   - Recommendation: Implement as a single channel value (the primary non-console channel) plus console always included. This matches the CLI spec. Multi-channel expansion can be a future enhancement via config file.

4. **Console adapter and StreamRenderer coupling**
   - What we know: The ConsoleAdapter needs to call `streamRenderer.stopSpinner()` before writing to avoid garbled output. But `StreamRenderer` lives in `output/` and `ConsoleAdapter` lives in `notifications/`.
   - What's unclear: Should ConsoleAdapter receive the full StreamRenderer reference, or a `stopSpinner: () => void` callback?
   - Recommendation: Pass `stopSpinner: () => void` callback. This avoids a circular dependency between `notifications/` and `output/`, keeps ConsoleAdapter testable without constructing a StreamRenderer, and is consistent with the dependency injection pattern used throughout the codebase.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `autopilot/src/types/notification.ts` — existing Notification interface
- Codebase: `autopilot/src/claude/index.ts` — ClaudeService events (`question:pending`, `question:answered`)
- Codebase: `autopilot/src/orchestrator/index.ts` — Orchestrator events (`build:complete`, `error:escalation`, `gap:escalated`)
- Codebase: `autopilot/src/cli/index.ts` — existing wiring pattern, ShutdownManager registration
- Codebase: `autopilot/src/output/colors.ts` — existing `ansis` usage and palette
- Codebase: `autopilot/package.json` — confirmed: `ansis ^4.2.0`, `"type":"module"`, Node >=20
- Codebase: `autopilot/tsconfig.json` — confirmed: `"module":"NodeNext"`, `"verbatimModuleSyntax":true`
- [node-notifier GitHub README](https://github.com/mikaelbr/node-notifier) — version 10.0.1, CJS-only, platform support
- [node-notifier package.json (raw)](https://raw.githubusercontent.com/mikaelbr/node-notifier/master/package.json) — confirmed no `exports` field, no `"type":"module"`
- [Slack Developer Docs - Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) — Block Kit format, `"text"` fallback requirement

### Secondary (MEDIUM confidence)
- [Microsoft Learn - Teams Adaptive Card via Webhook](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using) — Adaptive Card JSON envelope format verified
- [Microsoft 365 Connector Retirement Blog](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/) — migration deadline March 31, 2026

### Tertiary (LOW confidence)
- WebSearch community findings on Teams Workflows webhook payload format — multiple sources agree on same envelope, but no single canonical reference for the Workflows-specific endpoint behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all library choices verified against codebase and official sources
- Architecture: HIGH — patterns derived from existing codebase conventions (EventEmitter, DI, ShutdownManager)
- Console adapter integration: HIGH — StreamRenderer source read directly, spinner pitfall verified
- node-notifier ESM workaround: MEDIUM — createRequire pattern is standard Node.js ESM interop, CJS-only status verified from package.json
- Teams Adaptive Card format: MEDIUM — official docs verified, but Workflows-specific behavior not fully tested
- Slack Block Kit format: HIGH — official Slack docs verified
- Pitfalls: HIGH — derived from direct codebase analysis

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable domain except Teams deprecation timeline — check if deadline changes)
