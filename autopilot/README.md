# @nexeradigital/gsd-autopilot

Autonomous GSD workflow orchestrator — turns a PRD into a built project. Runs the full GSD lifecycle (discuss, plan, execute, verify) hands-free, with a live dashboard and multi-channel notifications.

## Prerequisites

- **Node.js** >= 20.0.0
- **GSD workflows** installed (`npx get-shit-done-cc@latest`)
- **Git** initialized in your project directory

## Installation

### One-liner

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/NexeraDigital/get-shit-done/main/autopilot/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/NexeraDigital/get-shit-done/main/autopilot/install.ps1 | iex
```

### Manual install

```bash
npm install -g @nexeradigital/gsd-autopilot
```

The postinstall script automatically registers the `/gsd:autopilot` slash command in Claude Code. Restart your Claude Code session to pick it up.

## Quick Start

From within Claude Code:

```
/gsd:autopilot --prd ./idea.md    # New project from a PRD
/gsd:autopilot                     # Existing GSD project
/gsd:autopilot show                # Open dashboard (no autopilot launch)
/gsd:autopilot status              # Check if running
/gsd:autopilot stop                # Graceful shutdown
/gsd:autopilot login               # Authenticate for dev tunnels
/gsd:autopilot login github        # Authenticate via GitHub
```

If you run `/gsd:autopilot` in a directory with an existing GSD project (`.planning/ROADMAP.md`), it picks up where the project left off — no flags needed. If no roadmap exists and no `--prd` is provided, an interactive setup wizard will walk you through configuration.

The skill spawns the autopilot as a detached process (visible console window on Windows), auto-opens the dashboard in your browser, and reports back with the URL. Each git branch gets its own isolated autopilot instance with a deterministic port.

### Commands

#### `show` — Open the dashboard

```
/gsd:autopilot show
```

Starts the standalone dashboard server (if not already running) and opens it in your browser. Does **not** launch the autopilot orchestrator — this is view-only. Useful for checking progress from a separate Claude Code session or after the autopilot has finished.

#### `status` — Check progress

```
/gsd:autopilot status
```

Reports whether the autopilot is running for the current branch, along with the current phase, overall progress percentage, dashboard URL, and process ID.

#### `stop` — Graceful shutdown

```
/gsd:autopilot stop
```

Sends a shutdown signal to the running autopilot. The current step finishes before the process exits — work is never interrupted mid-operation. Also stops the dashboard server and cleans up the process.

#### `login` — Authenticate for dev tunnels

```
/gsd:autopilot login           # Microsoft account (default)
/gsd:autopilot login github    # GitHub account
```

Runs the `devtunnel` browser-based authentication flow. Once authenticated, the autopilot creates a public tunnel to your dashboard automatically, so you can monitor progress from any device. Authentication persists across sessions.

## How It Works

The autopilot runs the complete GSD lifecycle for every phase in your roadmap:

```
Project Init (/gsd:new-project)
    |
    v
For each phase:
    discuss  ->  plan  ->  execute  ->  verify
                                          |
                                     Gap detected?
                                      yes -> re-plan -> re-execute -> re-verify (up to 3x)
                                      no  -> next phase
    |
    v
Build Complete
```

1. **Initialize** — Reads your PRD, runs `/gsd:new-project --auto` to generate `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md`
2. **Discuss** — Runs `/gsd:discuss-phase` to capture your implementation preferences (skippable with `--skip-discuss`)
3. **Plan** — Runs `/gsd:plan-phase` to research and create atomic execution plans
4. **Execute** — Runs `/gsd:execute-phase` with fresh context per plan, parallel where possible
5. **Verify** — Runs `/gsd:verify-work` with automatic gap detection and re-planning (up to 3 iterations)

Each step produces atomic git commits. If something fails, it retries once then escalates for human input.

## Dashboard

The autopilot includes a live web dashboard (React SPA) that launches automatically. The port is auto-derived from your git repo identity (stable per repo+branch), or override with `--port`.

**Features:**
- Real-time phase and step progress via Server-Sent Events
- Answer pending questions through the web UI
- Activity feed with log entries
- Milestone lifecycle view
- Browser push notifications (auto-prompted on first visit)
- PWA support — install as a desktop app

## Configuration

Configuration is loaded with this precedence: **CLI flags > environment variables > config file > defaults**.

### Config file

Create `.gsd-autopilot.json` in your project root:

```json
{
  "notify": "teams",
  "webhookUrl": "https://your-teams-webhook-url",
  "model": "quality",
  "depth": "comprehensive",
  "skipDiscuss": false,
  "skipVerify": false,
  "port": 3847,
  "questionReminderMs": 300000
}
```

The interactive wizard (`gsd-autopilot` with no args) offers to create this file for you.

### Environment variables

Prefix with `GSD_AUTOPILOT_` and use `UPPER_SNAKE_CASE`:

```bash
export GSD_AUTOPILOT_NOTIFY=slack
export GSD_AUTOPILOT_WEBHOOK_URL=https://hooks.slack.com/...
export GSD_AUTOPILOT_MODEL=budget
export GSD_AUTOPILOT_PORT=4000
export GSD_AUTOPILOT_SKIP_DISCUSS=true
```

### All options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `notify` | string | `console` | `console`, `system` |
| `model` | string | `balanced` | `quality`, `balanced`, `budget` |
| `depth` | string | `standard` | `quick`, `standard`, `comprehensive` |
| `skipDiscuss` | boolean | `false` | Skip the discuss phase step |
| `skipVerify` | boolean | `false` | Skip the verify phase step |
| `port` | number | auto | Dashboard port (1024-65535, auto-derived from git repo) |
| `questionReminderMs` | number | `300000` | Reminder interval for unanswered questions (ms) |
| `verbose` | boolean | `false` | Verbose output |
| `quiet` | boolean | `false` | Suppress non-error output |

## License

MIT License. See [LICENSE](./LICENSE) for details.

Base GSD framework by TACHES. Autopilot by NexeraDigital.
