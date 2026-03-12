# External Integrations

**Analysis Date:** 2026-03-11

## APIs & External Services

**Claude AI (Anthropic):**
- Service: Claude AI LLM via Agent SDK
- What it's used for: Command execution, code generation, planning, analysis via `/gsd:*` commands
- SDK/Client: `@anthropic-ai/claude-agent-sdk` (^0.2.42)
- Implementation: `autopilot/src/claude/index.ts` - ClaudeService wraps SDK's query() async generator
- Auth: Automatic via Claude Code environment (ANTHROPIC_API_KEY implicit)
- Tools enabled: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task, Skill, AskUserQuestion
- System prompt: Preset `claude_code` with custom append for background task polling
- Config: `allowedTools`, `maxTurns`, `includePartialMessages`, `permissionMode: bypassPermissions`

**Microsoft Dev Tunnels (Public Dashboard Access):**
- Service: Dev Tunnels for public URLs to local dashboard
- What it's used for: Enables remote Claude Code sessions to access the dashboard via public HTTPS URL
- SDK/Client:
  - `@microsoft/dev-tunnels-contracts` (^1.3.6)
  - `@microsoft/dev-tunnels-connections` (^1.3.6)
  - `@microsoft/dev-tunnels-management` (^1.3.6)
- Implementation: `autopilot/src/server/tunnel/manager.ts` - TunnelManager handles lifecycle
- Auth: Azure AD token via devtunnel CLI (cached locally) OR environment
- Fallback: Local-only mode if tunnel unavailable (--no-tunnel flag)
- Executable: `devtunnel` binary (bundled in autopilot root, platform-specific)

**Microsoft Teams (Webhooks):**
- Service: Teams Incoming Webhooks
- What it's used for: Send workflow notifications (phase complete, awaiting input)
- Adapter: `autopilot/src/notifications/adapters/teams.ts` - TeamsAdapter
- Webhook config: URL via `--webhook-url` or `GSD_AUTOPILOT_WEBHOOK_URL` or `.gsd-autopilot.json`
- Format: Adaptive Card JSON (Microsoft's native format, not deprecated MessageCard)
- Content: Title, body, optional dashboard link (no inline action buttons)
- Trigger: Notification manager sends when:
  - Question pending (phase awaiting user input)
  - Workflow complete or errored

**Slack (Webhooks):**
- Service: Slack Incoming Webhooks
- What it's used for: Send workflow notifications (phase complete, awaiting input)
- Adapter: `autopilot/src/notifications/adapters/slack.ts` - SlackAdapter
- Webhook config: URL via `--webhook-url` or `GSD_AUTOPILOT_WEBHOOK_URL` or `.gsd-autopilot.json`
- Format: Slack Block Kit JSON with required `text` fallback field
- Content: Header block (title), section block (body), optional link section (dashboard)
- Trigger: Same as Teams (phase events, questions, completion)

**Custom HTTP Webhooks:**
- Service: Generic HTTP endpoints
- What it's used for: Integrate with any webhook-capable service (custom tooling, middleware)
- Adapter: `autopilot/src/notifications/adapters/webhook.ts` - CustomWebhookAdapter
- Webhook config: URL via `--webhook-url` or `GSD_AUTOPILOT_WEBHOOK_URL` or `.gsd-autopilot.json`
- Format: Raw `Notification` JSON object (no transformation)
- Payload structure:
  ```json
  {
    "type": "question" | "stop",
    "severity": "info" | "warning" | "error",
    "title": string,
    "body": string,
    "respondUrl": string | null,
    "timestamp": number
  }
  ```

## Data Storage

**Databases:**
- Not detected - No traditional database (SQL, NoSQL)
- File-based state storage:
  - Location: `.planning/autopilot/` directory in project root
  - State: `state.json` (JSON serialization of AutopilotState)
  - Events: `events.jsonl` (JSON Lines, one per line)
  - Answers: `answers.jsonl` (user responses to questions)
  - Heartbeat: `heartbeat.json` (activity timestamp)
- Implementation: `autopilot/src/ipc/` - FileStateReader, EventWriter, AnswerWriter use atomic file writes
- Client: write-file-atomic (^7.0.0) ensures multi-process safety

**File Storage:**
- Local filesystem only - No cloud storage integration
- Dashboard assets: `autopilot/dashboard/dist/` (bundled at build time)
- Git repository state: Read-only (derives port from git commit identity)

**Caching:**
- In-memory only via Zustand (dashboard state store)
- No persistent cache layer

## Authentication & Identity

**Auth Provider:**
- Custom auth mechanism:
  - No OAuth2, SAML, or external identity provider
  - Session management via: `sessionId` (UUID) assigned per command
  - State persistence: File-based with atomic writes (`.planning/autopilot/state.json`)

**Token/Key Handling:**
- Anthropic API: Implicit via Claude Code environment (ANTHROPIC_API_KEY)
- Microsoft Dev Tunnels: AAD token extracted from devtunnel CLI cache
- Teams/Slack/Webhook: User provides webhook URLs (no API keys needed)

## Monitoring & Observability

**Error Tracking:**
- Not detected - No external error tracking service (Sentry, etc.)
- Local error logging:
  - File: `autopilot/src/logger/index.ts` - AutopilotLogger
  - Format: JSON via Pino (^10.3.0)
  - Levels: debug, info, warn, error
  - Output: console (human-readable via pino-pretty) or structured JSON

**Logs:**
- Approach: Pino structured logging with JSON output
- Location: Console and/or file via IPC EventWriter
- Consumption: Real-time streaming via SSE (Server-Sent Events) to dashboard
- Implementation: `autopilot/src/server/routes/sse.ts` - EventTailer tails `events.jsonl`

**System Notifications (Optional):**
- Service: node-notifier (^10.0.1)
- What it's used for: Desktop notifications (macOS Notification Center, Windows toast, Linux D-Bus)
- Trigger: Phase completion, errors, pending questions
- Channel: `--notify system` flag

## CI/CD & Deployment

**Hosting:**
- Not detected - No specific hosting platform requirement
- Runs locally as Node.js CLI tool or embedded server
- Optional tunnel: Can expose via Microsoft Dev Tunnels for remote access

**CI Pipeline:**
- Not detected - No CI/CD configuration in codebase
- Manual build/test via npm scripts:
  - `npm run build` (tsc compilation)
  - `npm run test` (vitest)
  - `npm run test:watch` (vitest watch mode)

## Environment Configuration

**Required env vars:**
- No mandatory environment variables at runtime (all config is optional via flags/file)
- Optional environment variables (GSD_AUTOPILOT_* prefix):
  - `GSD_AUTOPILOT_NOTIFY` - Notification channel (console, system, teams, slack, webhook)
  - `GSD_AUTOPILOT_WEBHOOK_URL` - Webhook URL for Teams/Slack/custom
  - `GSD_AUTOPILOT_PORT` - Dashboard server port
  - `GSD_AUTOPILOT_DEPTH` - Planning depth (quick, standard, comprehensive)
  - `GSD_AUTOPILOT_MODEL` - Model profile (quality, balanced, budget)
  - `GSD_AUTOPILOT_SKIP_DISCUSS` - Boolean flag to skip discuss phase
  - `GSD_AUTOPILOT_SKIP_VERIFY` - Boolean flag to skip verification

**Secrets location:**
- Webhook URLs: Command-line flag, config file, or environment variable (user-provided, not application-managed)
- Anthropic API key: Implicit from Claude Code environment
- Microsoft AAD token: Cached via devtunnel CLI (managed by OS credential store)
- No `.env` files tracked in repository

## Webhooks & Callbacks

**Incoming:**
- Dashboard API endpoints (Express routes):
  - `POST /api/state` - Fetch current state
  - `POST /api/events` - Stream events via SSE
  - `POST /api/answer` - Submit question answer
  - `POST /api/subscribe` - Register for Web Push notifications
  - `POST /api/push-send` - Admin endpoint for manual push (test only)

**Outgoing:**
- Teams webhook - POST Adaptive Card when phase event occurs
- Slack webhook - POST Block Kit when phase event occurs
- Custom webhook - POST raw Notification JSON when phase event occurs
- Browser Web Push - Via web-push library when dashboard subscribed
- Remote Claude Code session - Tunnel exposes dashboard to remote agent

## Web Push Notifications (Browser)

**Service:** Web Push Protocol (W3C standard)

**What it's used for:** Browser notifications when dashboard is closed/backgrounded

**Implementation:**
- Library: web-push (^3.6.7)
- VAPID authentication: Subject, public key, private key stored in `.planning/autopilot/`
- Implementation: `autopilot/src/server/push/manager.ts` - PushNotificationManager
- Subscription store: In-memory with optional persistence
- Browser support: Modern browsers (Firefox, Chrome, Edge, Safari)
- Payload: Title, body, tag, requireInteraction flag, URL, icon, custom data
- TTL: 1 hour per notification
- Auto-cleanup: Expired/invalid subscriptions (404/410) removed automatically

---

*Integration audit: 2026-03-11*
