# GSD Autopilot

## What This Is

A local Node.js command-line tool that runs the entire Get Shit Done (GSD) workflow autonomously — from PRD to working code — without requiring manual CLI interaction. When the system needs a human decision (like implementation choices during discuss-phase, or failure triage), it sends a notification to Microsoft Teams and waits for the human to respond through a simple local web interface before continuing.

Think of it as a CI/CD pipeline for AI-assisted development that lives on your machine, with Microsoft Teams as the human-in-the-loop channel.

## Core Value

Turn a PRD document into a fully built project by running one command, with human decisions collected asynchronously through Teams notifications instead of synchronous CLI prompts.

## How It Works

### User Experience

1. User runs: `npx gsd-autopilot --prd ./my-idea.md --teams-webhook https://outlook.office.com/webhook/...`
2. The tool initializes a GSD project from the PRD (using `/gsd:new-project --auto`)
3. For each phase in the roadmap, it automatically runs plan → execute → verify
4. When a question needs human input:
   - A Microsoft Teams Adaptive Card appears with the question and options
   - The card includes a link to `http://localhost:3847/respond/[id]`
   - The human clicks the link, sees a clean web page with the options, clicks one
   - The tool receives the response and continues building
5. When all phases complete, it runs milestone completion
6. The human gets a final Teams notification: "Build complete — X phases, Y commits"

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  GSD Autopilot (Node.js)                            │
│                                                     │
│  ┌─────────────┐    ┌───────────────────────────┐  │
│  │ Orchestrator │───>│ Claude Code CLI (claude -p)│  │
│  │ (main loop)  │<───│ Runs GSD slash commands    │  │
│  └──────┬──────┘    └───────────────────────────┘  │
│         │                                           │
│         │ Intercepts questions:                     │
│         │                                           │
│  ┌──────▼──────┐    ┌───────────────────────────┐  │
│  │ Notification │───>│ Teams Incoming Webhook     │  │
│  │ Manager      │    │ (Adaptive Cards)           │  │
│  └──────┬──────┘    └───────────────────────────┘  │
│         │                                           │
│  ┌──────▼──────┐    ┌───────────────────────────┐  │
│  │ Response     │<───│ Local Web UI (Express)     │  │
│  │ Listener     │    │ localhost:3847              │  │
│  └─────────────┘    └───────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Components

### 1. CLI Entry Point

The main command that starts the autopilot process.

```
npx gsd-autopilot --prd <path>         # Required: PRD/idea document
                  --teams-webhook <url> # Required: Teams incoming webhook URL
                  --port 3847           # Optional: local web server port (default 3847)
                  --depth standard      # Optional: planning depth (quick/standard/comprehensive)
                  --model balanced      # Optional: model profile (quality/balanced/budget)
                  --skip-discuss        # Optional: skip discuss-phase, let Claude decide everything
                  --skip-verify         # Optional: skip verify-work phase
                  --phases 1-5          # Optional: only run specific phases
                  --resume              # Optional: resume from where it left off
```

Configuration can also be provided via a `.gsd-autopilot.json` file in the project root or via environment variables (`GSD_TEAMS_WEBHOOK`, `GSD_PORT`).

### 2. Orchestrator

The core state machine that sequences GSD commands. It reads `.planning/STATE.md` and `.planning/ROADMAP.md` to determine what to do next.

**Lifecycle:**

```
Initialize Project (claude -p "/gsd:new-project --auto @prd.md")
  │
  ▼
Read ROADMAP.md → extract phase list
  │
  ▼
For each phase N:
  ├── [Optional] Discuss Phase → may trigger Teams questions
  ├── Plan Phase (claude -p "/gsd:plan-phase N")
  ├── Execute Phase (claude -p "/gsd:execute-phase N")
  ├── Check VERIFICATION.md status
  │   ├── passed → next phase
  │   ├── gaps_found → plan gaps → execute gaps → re-verify
  │   └── human_needed → notify Teams, wait for response
  └── Update progress
  │
  ▼
Complete Milestone (claude -p "/gsd:complete-milestone")
  │
  ▼
Send "Build Complete" notification to Teams
```

**State persistence:** The orchestrator saves its own state to `.planning/autopilot-state.json` after each step so it can resume if interrupted. This file tracks: current phase, current step within phase, pending questions, completed phases, error history.

**Error handling:**
- If a `claude -p` call fails (non-zero exit), the orchestrator retries once
- If retry fails, it sends a Teams notification with the error and waits for human guidance (retry / skip phase / abort)
- All `claude -p` output is logged to `.planning/autopilot-log/phase-N-step.log`

### 3. Teams Notification Module

Sends Adaptive Cards to Microsoft Teams via an Incoming Webhook URL.

**Card types:**

1. **Question Card** — When human input is needed
   - Shows: phase context, question text, available options
   - Includes: clickable link to local web UI for responding
   - Color: blue accent

2. **Progress Card** — Phase completed successfully
   - Shows: phase name, what was built, commits made
   - No response needed
   - Color: green accent

3. **Error Card** — Something failed
   - Shows: phase name, error summary, suggested actions
   - Includes: link to respond (retry / skip / abort)
   - Color: red accent

4. **Complete Card** — Build finished
   - Shows: total phases, total commits, files created
   - Color: green accent

**Adaptive Card format (JSON payload via HTTP POST to webhook URL):**

The module sends standard Microsoft Teams Adaptive Card payloads. Each card includes the question/status, context about which phase is running, and a prominent link to the local response web UI.

### 4. Local Response Web Server

A minimal Express.js web server that runs on localhost during the autopilot session. It serves a clean, simple web page where humans respond to questions.

**Routes:**

- `GET /` — Dashboard showing current autopilot status (phase, progress, pending questions)
- `GET /respond/:questionId` — Shows a question with clickable option buttons
- `POST /respond/:questionId` — Receives the selected option, unblocks the orchestrator
- `GET /log` — Shows recent autopilot log output
- `GET /health` — Health check endpoint

**Web UI design:**

The response page is a single, clean HTML page (no framework needed):
- Shows the question context (which phase, what's being decided)
- Displays options as large, clickable buttons
- Has a text input for freeform "Other" responses
- Shows a confirmation after selection
- Auto-closes or redirects to dashboard after response

The server shuts down automatically when the autopilot completes.

### 5. Claude Code Integration

The module that executes GSD commands via Claude Code's pipe mode.

**Execution pattern:**

```javascript
// Each GSD command runs in a fresh context (equivalent to /clear)
function runGsdCommand(command, projectDir) {
  // claude -p sends a prompt in non-interactive pipe mode
  // --project-dir ensures GSD reads the right .planning/ files
  const result = spawnSync('claude', ['-p', command], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 600000 // 10 minute timeout per command
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
}
```

**Output parsing:** The module parses `claude -p` stdout for key patterns:
- `"PROJECT INITIALIZED"` — new-project succeeded
- `"PHASE X PLANNED"` — plan-phase succeeded
- `"Phase X: Complete"` — execute-phase succeeded
- `"GAPS_FOUND"` or `"gaps_found"` — verification found issues
- `"VERIFICATION PASSED"` or `"passed"` — verification succeeded

**GSD config setup:** Before running commands, the integration module writes a `.planning/config.json` with all gates disabled and YOLO mode enabled, so GSD commands run without interactive prompts:

```json
{
  "mode": "yolo",
  "depth": "standard",
  "workflow": { "research": true, "plan_check": true, "verifier": true },
  "parallelization": { "enabled": true, "plan_level": true, "skip_checkpoints": true },
  "gates": {
    "confirm_project": false,
    "confirm_phases": false,
    "confirm_roadmap": false,
    "confirm_breakdown": false,
    "confirm_plan": false,
    "execute_next_plan": false,
    "issues_review": false,
    "confirm_transition": false
  }
}
```

### 6. Discuss-Phase Handler

The discuss-phase is the one workflow that is inherently conversational and produces the highest-value human decisions. The autopilot handles it specially:

**When `--skip-discuss` is NOT set:**
1. Orchestrator reads the phase description from ROADMAP.md
2. Identifies the gray areas Claude would ask about (by running a lightweight analysis prompt via `claude -p`)
3. For each gray area, creates a Teams question card with the options
4. Batches related questions together (sends 2-3 at a time, not one by one)
5. Collects all responses via the local web UI
6. Writes a CONTEXT.md file with the human's decisions in the standard GSD format
7. Proceeds to plan-phase with the context locked

**When `--skip-discuss` IS set:**
- Generates a CONTEXT.md marking all areas as "Claude's Discretion"
- No Teams notification, no human input needed

## Technical Constraints

- **Node.js >= 18** (for native fetch, stable async patterns)
- **Claude Code CLI** must be installed and authenticated (`claude` command available in PATH)
- **GSD** must be installed globally (`~/.claude/get-shit-done/` exists)
- **Microsoft Teams** incoming webhook URL must be configured (standard Office 365 connector)
- **No external database** — all state lives in `.planning/` files (JSON + markdown)
- **No cloud services** — everything runs locally except the Teams webhook POST
- **Single project at a time** — the orchestrator manages one GSD project per invocation

## Out of Scope

- Building a web dashboard beyond the minimal response UI (no React, no SPA)
- Supporting notification channels other than Microsoft Teams (Slack, Discord, email) — can be added later
- Running in CI/CD (GitHub Actions) — designed for local execution only
- Modifying GSD's core workflows or agents — the autopilot wraps GSD, it does not fork it
- Authentication on the local web server — it runs on localhost, accessible only to the local machine
- Mobile-optimized Teams cards — desktop Teams is sufficient
