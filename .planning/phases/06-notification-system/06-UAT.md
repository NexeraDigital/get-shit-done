---
status: complete
phase: 06-notification-system
source: 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md
started: 2026-02-18T21:30:00Z
updated: 2026-02-18T23:35:00Z
---

## Current Test

number: done
name: All tests complete
awaiting: none

## Tests

### 1. TypeScript compilation
expected: Running `cd autopilot && npx tsc --noEmit` completes with zero errors. All notification types, manager, adapters, and CLI wiring compile clean under strict mode.
result: PASS — zero errors

### 2. Notification test suite passes
expected: Running `cd autopilot && npx vitest run src/notifications/` passes all 62 tests across 5 test files (manager, console, teams, slack, adapters). Zero failures.
result: PASS — 62 tests, 5 files, zero failures

### 3. Console notification output format
expected: ConsoleAdapter formats notifications as inline colored lines (not boxes/banners). Question type includes `[?]` prefix with full question text, option list, clickable dashboard URL, and terminal bell (`\x07`). Error type uses `[!]` prefix with summary and next steps. Complete type uses `[v]` prefix. No bell for non-question types.
result: PASS — console.ts:62 format() switch dispatches to formatQuestion (bell + [?] + URL + options), formatError ([!] + summary + nextSteps + errorMessage), formatComplete ([v] + summary + nextSteps), formatProgress ([i]). All inline colored lines via ansis, no boxes/banners.

### 4. Teams adapter Adaptive Card format
expected: TeamsAdapter builds a JSON payload with `type: "message"`, `attachments` array containing `contentType: "application/vnd.microsoft.card.adaptive"`, AdaptiveCard version 1.4, TextBlocks for title and body, and an optional dashboard link. Uses fetch() to POST — throws on non-2xx response.
result: PASS — teams.ts:55 buildCard() returns exact structure: type:"message", attachments with contentType "application/vnd.microsoft.card.adaptive", version "1.4", TextBlocks for title/body, optional respondUrl link. fetch() POST with throw on non-2xx (lines 41-52).

### 5. Slack adapter Block Kit format
expected: SlackAdapter builds a JSON payload with top-level `text` fallback field (required by Slack API) and `blocks` array with header and section blocks. Dashboard link uses mrkdwn `<url|Open Dashboard>` format. Uses fetch() to POST — throws on non-2xx response.
result: PASS — slack.ts:53 buildPayload() returns { text: fallbackText, blocks: [...] }. Header block + section block for body. Dashboard link as `<url|Open Dashboard>` mrkdwn. fetch() POST with throw on non-2xx (lines 39-50).

### 6. Custom adapter loading
expected: `loadCustomAdapter('./path.js')` resolves paths relative to `process.cwd()` via `pathToFileURL()`, dynamically imports the module, validates `init`/`send`/`close` methods exist, and returns the adapter instance. Throws clear errors for missing methods or bad exports.
result: PASS — loader.ts:20 resolve(process.cwd(), adapterPath), pathToFileURL().href, dynamic import(). Validates init/send/close methods at lines 48-56 with descriptive error messages. Returns adapter instance at line 58.

### 7. example-adapter.js ships as starting point
expected: `autopilot/example-adapter.js` exists, contains a default-exported class with `init()`, `send(notification)`, and `close()` methods, and includes JSDoc comments documenting the full Notification object shape (id, type, title, body, severity, respondUrl, options, phase, step, createdAt, summary, nextSteps, errorMessage).
result: PASS — File exists with default export class MyCustomAdapter, all 3 methods present. JSDoc block documents complete Notification shape: id, type, title, body, severity, respondUrl, options, phase, step, createdAt, summary, nextSteps, errorMessage.

### 8. CLI wiring — notification events connected
expected: `autopilot/src/cli/index.ts` creates a NotificationManager, adds ConsoleAdapter as default fallback, selects additional adapter based on `config.notify`, wires `question:pending` to dispatch + startReminder, `question:answered` to cancelReminder, `build:complete` to complete notification, and `error:escalation` to error notification. NotificationManager.close() registered in ShutdownManager.
result: PASS (with gap noted) — cli/index.ts:125 creates NotificationManager, line 130 adds ConsoleAdapter, lines 136-165 switch on config.notify. question:pending (205) -> notify + startReminder, question:answered (228) -> cancelReminder, build:complete (233) -> complete notification, error:escalation (256) -> error notification. close() registered in ShutdownManager at line 311. **Gap**: catch block (line 344) closes notificationManager without dispatching error notification first — see Gaps section.

### 9. Config schema includes notification fields
expected: `AutopilotConfigSchema` in `types/config.ts` has `notify` as `z.enum(['console', 'system', 'teams', 'slack', 'webhook']).default('console')` and `questionReminderMs` as `z.number().int().min(0).default(300_000)`.
result: PASS — config.ts:9 notify z.enum exact match, line 12 questionReminderMs z.number().int().min(0).default(300_000) exact match.

### 10. Package exports and optional dependency
expected: `autopilot/src/index.ts` exports NotificationManager, ConsoleAdapter, TeamsAdapter, SlackAdapter, CustomWebhookAdapter, SystemAdapter, and loadCustomAdapter. `package.json` has `node-notifier` in `optionalDependencies` and `example-adapter.js` in the `files` array.
result: PASS — index.ts exports all 6 classes + loadCustomAdapter (lines 58-64). package.json has node-notifier@^10.0.1 in optionalDependencies (line 49), example-adapter.js in files (line 21).

## Summary

total: 10
passed: 10
issues: 1
pending: 0
skipped: 0

## Gaps

### GAP-1: Catch block doesn't dispatch error notification before closing manager

**Location:** `autopilot/src/cli/index.ts` lines 344-354
**Severity:** Minor (defense-in-depth)
**Found via:** Real-world test — Claude Code crashed with exit code 2147483651, console showed "Autopilot failed: ..." but no `[!]` error notification was printed.

**Issue:** The catch block calls `await notificationManager.close()` (line 346) immediately without first dispatching an error notification. If the orchestrator throws an exception that bypasses the `error:escalation` event (e.g., the Claude process crashes hard), no error notification is sent through any adapter.

**Expected behavior:** The catch block should build and dispatch an error notification (same shape as `error:escalation`) before calling `notificationManager.close()`.

**Code path:**
```
try {
  await orchestrator.run(prdPath, phaseRange);  // throws on crash
} catch (err) {
  streamRenderer.stopSpinner();
  await notificationManager.close();  // <-- closes without notifying
  // ... logs and exits
}
```

**Fix:** Insert a `notificationManager.notify(errorNotification)` call between `stopSpinner()` and `close()` in the catch block.

**Note:** The `error:escalation` event wiring (line 256) correctly handles orchestrator-internal escalations. This gap only affects hard crashes that throw directly from `orchestrator.run()` without emitting the event.
