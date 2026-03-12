# Codebase Concerns

**Analysis Date:** 2026-03-11

## Tech Debt

**Tunnel Manager Uncaught Exception Handling:**
- Issue: TunnelManager installs process-level `uncaughtException` handler to suppress non-fatal SSH stream errors from the dev-tunnels SDK. These errors leak to process level instead of being contained within the tunnel module.
- Files: `autopilot/src/server/tunnel/manager.ts` (lines 291-313)
- Impact: While suppressed gracefully, this is a fragile workaround that masks underlying SDK limitations. If non-tunnel errors slip through the filter logic, they will crash the process.
- Fix approach: Patch the dev-tunnels SDK to handle stream errors internally, or wrap tunnel operations in an error boundary layer. Add comprehensive error categorization tests to verify the filter logic catches all known error types.

**Type Safety Gaps with 'any':**
- Issue: ClaudeService, CLI, IPC components, and several test files use TypeScript's `any` type to bypass strict type checking for SDK message objects and configuration merging.
- Files: `autopilot/src/cli/index.ts`, `autopilot/src/claude/index.ts`, `autopilot/src/server/routes/sse.ts`, `autopilot/src/ipc/answer-poller.ts`, `autopilot/src/orchestrator/gap-detector.ts`
- Impact: Runtime type errors could surface when the SDK or external APIs change shape. Type-safe message handling would catch these at compile time.
- Fix approach: Create strict TypeScript interfaces for all SDKMessage subtypes following the SDK's actual schema. Use `satisfies` operator to validate messages instead of `as` casts. Gradually tighten type safety across test files.

**CLI Polling with Fixed Interval:**
- Issue: After init, the orchestrator polls for ROADMAP.md creation with a fixed 5-second interval (line 483-510 in `orchestrator/index.ts`). If background tasks complete just after a poll, there's up to 5s of wasted latency.
- Files: `autopilot/src/orchestrator/index.ts` (lines 483-510)
- Impact: User-facing latency in the happy path (fresh PRD > init > phases). Not critical but unnecessary.
- Fix approach: Use file system watchers (fs.watch) instead of polling, or decrease interval to 1s with fallback timeout.

**Manual JSON Parsing Without Validation:**
- Issue: ActivityStore, IPC AnswerPoller, and config loader do JSON.parse() with minimal validation. Corrupted or unexpected JSON fails silently or crashes.
- Files: `autopilot/src/activity/index.ts`, `autopilot/src/ipc/answer-poller.ts`, `autopilot/src/config/index.ts`
- Impact: Silent state loss (ActivityStore), skipped answers (AnswerPoller), or cryptic config errors. Especially risky for persistent files that may be manually edited.
- Fix approach: Add a schema validation layer using Zod for all JSON parse operations. Provide recovery strategies (backups, defaults) for corrupted files.

**Hardcoded Phase Number Formatting:**
- Issue: Phase number formatting logic is duplicated in multiple places (format and parse) and relies on string manipulation (lines 191-195, 305-306 in `orchestrator/index.ts`).
- Files: `autopilot/src/orchestrator/index.ts`
- Impact: Risk of format mismatches when reading/writing phase directories. Fragile to changes in phase numbering conventions (e.g., subphase support).
- Fix approach: Extract phase number formatting into a dedicated PhaseNumberFormatter utility class with bidirectional conversion methods. Add unit tests for all edge cases (whole numbers, subphases with decimals).

## Known Bugs

**Question Reminder Race Condition:**
- Symptoms: If a user answers a question and the dashboard crashes/restarts before the answer is polled, the reminder interval may fire again for the same question.
- Files: `autopilot/src/notifications/manager.ts`, `autopilot/src/ipc/answer-poller.ts`
- Trigger: Answer question > immediately kill dashboard > restart before answer file is deleted > reminder fires for already-answered question
- Workaround: Answer questions again (idempotent operation). Questions are cleared on fresh state creation.

**SSE Client Memory Leak on Disconnect:**
- Symptoms: If an SSE client disconnects without triggering the 'close' event, it remains in the clients Set and continues receiving broadcasts.
- Files: `autopilot/src/server/routes/sse.ts` (lines 94-99)
- Trigger: Network glitch that doesn't fire 'close' event, or client timeout without cleanup
- Workaround: Process restart clears all client references. SSE clients naturally drop after 10-second retry timeout.
- Fix approach: Add periodic cleanup for stale clients that don't respond to test writes.

**State File Race on Concurrent Writes:**
- Symptoms: If the orchestrator and dashboard write state simultaneously, one write may be lost (despite atomic writes being used for new data).
- Files: `autopilot/src/state/index.ts`
- Trigger: High-frequency state updates (every step completes) + dashboard polling = potential race window
- Workaround: State updates are idempotent; re-running the same phase is safe. Stale data is transient (next poll corrects it).
- Fix approach: Implement read-modify-write locking with a lock file before state mutations.

## Security Considerations

**Environment Variable Exposure via Logs:**
- Risk: ClaudeService passes process.env to the SDK query (after deleting CLAUDECODE). Other secrets (API keys, tokens) in env vars could leak into SDK logs or result output.
- Files: `autopilot/src/claude/index.ts` (lines 91-95), `autopilot/src/cli/index.ts` (log setup)
- Current mitigation: ANTHROPIC_API_KEY is set as env var; others are assumed not in use. But this is fragile.
- Recommendations: Whitelist only safe env vars (NODE_ENV, PATH, GIT_AUTHOR_*) when calling SDK. Document forbidden env var patterns. Add a pre-flight check that flags suspicious env vars.

**Tunnel URL in State File:**
- Risk: TunnelUrl in state.json is a public URL accessible to anyone. If state file is committed or exposed, dashboard is accessible without authentication.
- Files: `autopilot/src/cli/index.ts` (line 631), `autopilot/src/server/tunnel/manager.ts`
- Current mitigation: Tunnel is configured with anonymous access by design (for Claude Code remote sessions). But users may not expect the URL to be in a persistent file.
- Recommendations: Document the security model clearly (tunnel URLs are transient, expire on process exit). Consider storing tunnel URL only in memory or a short-lived .gitignored file.

**No Input Validation on Webhook URLs:**
- Risk: --webhook-url accepts arbitrary URLs. If user provides a loopback address or internal network URL, notifications could leak to unintended recipients.
- Files: `autopilot/src/cli/index.ts` (lines 251-269), `autopilot/src/config/index.ts`
- Current mitigation: None. Zod schema does not validate URL format.
- Recommendations: Validate webhook URLs are https:// only (except localhost for dev). Warn user if URL is on private network (10.0.0.0/8, etc). Log webhook requests for audit.

**Git Credentials in Phase Commands:**
- Risk: When orchestrator runs `/gsd:execute-phase`, Claude Code may write git commits with author credentials from environment. If logs are captured, commits could expose git config.
- Files: `autopilot/src/orchestrator/index.ts` (line 816), `autopilot/src/claude/index.ts`
- Current mitigation: SDK appends system prompt warning about background tasks, but doesn't sanitize env.
- Recommendations: Filter git config env vars (GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_CREDENTIALS, GIT_PASSWORD) before passing to SDK. Consider prompting user for safe git identity.

## Performance Bottlenecks

**Orchestrator Phase Reconciliation O(n²) Complexity:**
- Problem: After init, orchestrator reconciles phases by checking existence of directories and files for each phase. Directory listing and file existence checks are done sequentially.
- Files: `autopilot/src/orchestrator/index.ts` (lines 295-362)
- Cause: Multiple `readdir()` calls per phase + nested loops for step reconciliation.
- Improvement path: Batch all phase directory reads at once, build a lookup map, then reconcile in single pass. Cache results to avoid re-reading on resume.

**StreamRenderer Message Type Checking:**
- Problem: Every message from the SDK goes through duck-typing checks via string comparisons (`msg.type === 'tool_use_summary'`, etc). Large message volumes (hundreds per minute) incur unnecessary checks.
- Files: `autopilot/src/output/stream-renderer.ts` (lines 48-91)
- Cause: Type-switching on every message; messages are already categorized by SDK.
- Improvement path: Create a message type index on SDK startup, or memoize categorization results. For high-volume streams, batch messages before rendering.

**Activity Append with Full Array Write:**
- Problem: ActivityStore.addActivity() prepends to the array, then persists the entire activities array to disk. With hundreds of activities, each write serializes the full history.
- Files: `autopilot/src/activity/index.ts` (lines 46-56, 75-85)
- Cause: No append-only log; always full JSON file write.
- Improvement path: Implement append-only log format (newline-delimited JSON), or keep in-memory buffer and batch writes every 10 activities. Provide log rotation for long-running sessions.

**Tunnel Reconnection Exponential Backoff Unbounded:**
- Problem: After max reconnection attempts, tunnel is permanently unavailable. No upper bound on reconnection delay (capped at 30s, but still long for transient failures).
- Files: `autopilot/src/server/tunnel/manager.ts` (lines 330-347)
- Cause: Fixed max reconnection attempts (10) with no jitter or circuit breaker.
- Improvement path: Implement circuit breaker pattern: after N failures, stop attempting for a cooldown period, then try again. Add jitter to prevent thundering herd if multiple processes reconnect simultaneously.

## Fragile Areas

**ROADMAP.md Parsing:**
- Files: `autopilot/src/orchestrator/index.ts` (lines 51-168)
- Why fragile: Relies on regex patterns to extract phase numbers and metadata. If user manually edits ROADMAP.md (adds comments, changes formatting), parsing breaks silently.
- Safe modification: Always parse in tests with various ROADMAP formats (comments, extra whitespace, manual edits). Validate phases extracted match intent before proceeding.
- Test coverage: Gaps in edge cases (subphase numbers like 2.5, phase names with special characters, missing Status field). Parser is tested in unit tests but integration with reconciliation is not.

**Phase State Reconciliation:**
- Files: `autopilot/src/orchestrator/index.ts` (lines 295-362)
- Why fragile: Tries to infer phase state from on-disk artifacts (CONTEXT.md, PLAN.md, VERIFICATION.md). If files are deleted or moved, state becomes inconsistent. Multiple reconciliation steps can compound errors.
- Safe modification: Always reconcile in order (verify > plan > discuss), and add defensive checks (file exists before reading). Log reconciliation decisions for audit. Consider storing state markers in files themselves.
- Test coverage: Reconciliation logic has unit tests, but integration with state recovery after crashes is not well-covered. Needs chaos testing (delete random files, restart, verify recovery).

**ClaudeService Concurrency Protection:**
- Files: `autopilot/src/claude/index.ts` (lines 71-74)
- Why fragile: Throws error if concurrent commands are attempted, but this check happens at the wrong layer. Dashboard could submit answers while orchestrator is running, causing rejection.
- Safe modification: Queue concurrent commands instead of rejecting. Or, implement a command lock that prevents dashboard mutations while orchestrator command is active.
- Test coverage: No test for concurrent command scenario. Only single-command happy path is tested.

## Scaling Limits

**Activity Array Unbounded Growth:**
- Current capacity: ActivityStore prepends to array without limit. Default initialization shows 50 recent entries via API.
- Limit: After ~1000 activities (typical for 8-hour run with frequent logging), JSON serialization becomes slow. No log rotation or cleanup.
- Scaling path: Implement rolling log file rotation (e.g., activity-001.json, activity-002.json). Keep only last N files. Provide API to query by date range.

**Event Tailer Memory Usage:**
- Current capacity: Tracks all log entries in memory via RingBuffer (fixed capacity, default unbounded).
- Limit: If RingBuffer is not sized, memory grows indefinitely during long-running sessions. No documented capacity limits.
- Scaling path: Make RingBuffer size configurable via environment variable. Default to 10,000 entries (~10MB). Add metrics for buffer fullness.

**SSE Client Broadcasting O(n):**
- Current capacity: Broadcast writes to all connected clients in a loop. With many concurrent dashboards (unlikely but possible in multi-user setup), this is slow.
- Limit: ~100+ concurrent clients would cause noticeable slowdown per broadcast.
- Scaling path: Use a thread pool or async iterator to write to clients in parallel. Add backpressure handling (drop slow clients).

**Tunnel Connection Pool:**
- Current capacity: Single tunnel instance per CLI process. If multiple dashboard processes need access, they share one tunnel.
- Limit: High traffic through shared tunnel may cause contention. No load balancing.
- Scaling path: For multi-user setups, consider tunnel-per-dashboard or load-balanced tunnel pool. Publish tunnel management as a service.

## Dependencies at Risk

**@anthropic-ai/claude-agent-sdk (^0.2.42):**
- Risk: Pre-release version. API surface may change in minor versions. Orchestrator relies heavily on SDK's query() async generator and result format.
- Impact: SDK API changes break orchestrator. Message type changes break StreamRenderer. Tool availability changes break gap detection.
- Migration plan: Pin exact version once SDK reaches 1.0.0. Create abstraction layer (claudeService) to isolate SDK surface. Monitor SDK releases for breaking changes.

**@microsoft/dev-tunnels-* (^1.3.6):**
- Risk: Complex SDK with stream management and reconnection logic. Recent versions have uncaught exception issues that we work around. Potential for breaking changes in connection protocol.
- Impact: Tunnel unavailability breaks remote session feature and public dashboard access. Workarounds become invalid if SDK changes exception types.
- Migration plan: Evaluate alternative tunneling solutions (ngrok, localtunnel, bore). If staying with dev-tunnels, contribute fixes upstream for uncaught exceptions.

**write-file-atomic (^7.0.0):**
- Risk: Small package, but critical for state file atomicity. Few maintainers. Possible security updates may be slow.
- Impact: Non-atomic writes could corrupt state file during crashes.
- Migration plan: Consider using Node.js native atomic write support (fs.promises.writeFile with file locking) if available in Node 20+. Or, use better-atomics package if available.

**web-push (^3.6.7):**
- Risk: Used for browser push notifications. Depends on outdated OpenSSL bindings. May have security vulnerabilities.
- Impact: Dashboard push notifications may fail or be exploitable.
- Migration plan: Monitor web-push releases. Consider migrating to native Service Worker push if browser support is available. Provide fallback to SSE polling if web-push unavailable.

## Missing Critical Features

**Error Recovery UI:**
- Problem: When a phase fails (escalated error), the CLI shows a message but no guidance on next steps beyond "retry" / "skip" / "abort". No web UI to inspect error details or logs.
- Blocks: Users can't easily recover from errors without manual investigation.
- Recommendation: Add web UI dashboard for error inspection. Show failed command, error output, and recovery options. Let users re-run failed steps with tweaks (e.g., fewer maxTurns).

**Dashboard Authentication:**
- Problem: Tunnel URL is publicly accessible (by design for Claude remote sessions). But if shared, anyone can view state, logs, and trigger operations.
- Blocks: Multi-user or shared environments. Sensitive project data exposed.
- Recommendation: Add optional auth layer (basic auth or API token). Require password for triggering operations. Log all dashboard access.

**Audit Trail for Phase Changes:**
- Problem: No record of who made changes to phases, when, or why (skip vs. complete manually, etc). Hard to trace state decisions.
- Blocks: Compliance, debugging, accountability.
- Recommendation: Log all phase state mutations with timestamp, user (if applicable), and reason. Provide audit log API endpoint.

**Graceful Degradation for Failed Services:**
- Problem: If tunnel fails, notification adapters fail, or logger crashes, the orchestrator aborts. No fallback modes.
- Blocks: Resilience. A single failing notification shouldn't stop the build.
- Recommendation: Wrap all non-critical services (tunnel, notifications, logging) in try-catch. Log failures but continue. Provide --offline mode that skips tunnel/webhooks.

## Test Coverage Gaps

**Tunnel Reconnection Logic:**
- What's not tested: Full reconnection cycle (disconnect > exponential backoff > reconnect with new URL). Error type filtering logic for uncaught exceptions.
- Files: `autopilot/src/server/tunnel/manager.ts`
- Risk: Tunnel recovery could be broken and not caught by tests. Exception filtering could silently suppress real errors.
- Priority: High - tunnel is critical for remote sessions.

**Orchestrator State Reconciliation After Crash:**
- What's not tested: Recovery from partial state (some phases on disk, others in state file). Recovery from corrupted files (missing VERIFICATION.md). All reconciliation branches together.
- Files: `autopilot/src/orchestrator/index.ts` (lines 295-362)
- Risk: State corruption could accumulate over multiple crashes. Reconciliation could mark phases complete when they're not.
- Priority: High - state consistency is critical.

**ClaudeService Concurrent Command Rejection:**
- What's not tested: Actual concurrent command attempt (e.g., dashboard submits answer while orchestrator is running). Error propagation to caller.
- Files: `autopilot/src/claude/index.ts`
- Risk: Concurrent commands could partially execute, leaving inconsistent state. Error messages may be unclear.
- Priority: Medium - orchestrator runs single commands, but dashboard could trigger concurrent operations.

**SSE Backpressure and Client Disconnection:**
- What's not tested: SSE broadcast when client write fails. Client cleanup when connection is lost without 'close' event. Behavior with many concurrent clients (>100).
- Files: `autopilot/src/server/routes/sse.ts`
- Risk: Memory leak or crash under high client load. Failed broadcasts silently drop data.
- Priority: Medium - unlikely in typical single-user setup, but possible in shared environments.

**Question Reminder Cancellation Edge Cases:**
- What's not tested: Reminder fires after answer is submitted but before poller processes answer file. Multiple reminders for same question. Reminders after orchestrator crash.
- Files: `autopilot/src/notifications/manager.ts`, `autopilot/src/ipc/answer-poller.ts`
- Risk: Duplicate reminders, missed answers, memory leaks from abandoned timers.
- Priority: Medium - affects UX but not critical path.

---

*Concerns audit: 2026-03-11*
