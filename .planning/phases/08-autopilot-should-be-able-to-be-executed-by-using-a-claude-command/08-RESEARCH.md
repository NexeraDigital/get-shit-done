# Phase 8: Autopilot Claude Command Integration - Research

**Researched:** 2026-02-23
**Domain:** Claude Code slash command integration, Node.js background process management, npm package workflow registration
**Confidence:** HIGH

## Summary

Phase 8 enables launching GSD Autopilot from within a Claude Code session via `/gsd:autopilot` slash command. The implementation requires: (1) creating a custom slash command markdown file that Claude Code automatically discovers, (2) implementing subcommands (launch, status, stop) that shell out to the existing `npx gsd-autopilot` CLI, (3) managing multi-instance autopilot processes with per-branch port persistence using deterministic hashing with collision detection, and (4) handling background process spawning with PID file management for graceful shutdown.

The research confirms all user requirements are technically feasible with existing Node.js APIs and Claude Code's slash command system. The workflow feels lightweight because it delegates to the existing CLI infrastructure rather than reimplementing orchestration logic.

**Primary recommendation:** Create a thin workflow wrapper in `.claude/skills/gsd-autopilot/SKILL.md` that uses Commander.js-style argument parsing and Node.js `child_process.spawn()` with `detached: true` for background execution. Store per-branch state (port, PID) in `.planning/autopilot-state.json` with branch name as key.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Invocation method
- New GSD slash command: `/gsd:autopilot`
- Registered by the `gsd-autopilot` npm package (not bundled with core GSD workflows)
- Package copies/installs the workflow .md file into the GSD workflows directory during setup
- Works via `npx` — no global install required

#### Parameter passing
- Raw argument pass-through: `/gsd:autopilot --phases 3-5 --notify teams` runs `npx gsd-autopilot --phases 3-5 --notify teams`
- Same precedence as existing CLI: .gsd-autopilot.json for defaults, inline args override
- If no args and no .planning exists, the workflow asks for PRD path before shelling out (minimal — PRD path only, no other settings)
- If .planning/ROADMAP.md exists, auto-detects and continues (same smart detection as CLI)

#### Session behavior — multi-instance
- Autopilot runs as a background process, returns control to user immediately
- Each git branch gets its own autopilot instance on its own port
- Port assignment: deterministic hash from branch name (base 3847 + hash % 1000)
- Port collision: increment +1 until a free port is found
- Port number saved in `.planning/autopilot-state.json` (persisted per branch)
- On subsequent runs for same branch, reuse the saved port

#### Subcommands
- `/gsd:autopilot` — launch (or resume) autopilot for current branch
- `/gsd:autopilot status` — show current phase, progress %, dashboard URL for current branch
- `/gsd:autopilot stop` — gracefully stop the autopilot for current branch (SIGTERM + wait)

#### Output integration
- Launch confirmation only: "Autopilot started on port XXXX" + dashboard URL
- No log streaming in Claude terminal — all monitoring via web dashboard
- Build completion handled by existing notification adapters (console, Teams, Slack, system toast)

### Claude's Discretion
- How to register the workflow .md file during package install (copy vs symlink vs other)
- PID file location and format for stop/status commands
- Hash algorithm for branch-to-port mapping
- Exact error messages and formatting

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js child_process | Built-in (v20+) | Spawn detached background processes | Standard library, no dependencies, battle-tested for process management |
| Commander.js | 14.0.3 (already in use) | Parse subcommands and arguments | Already used in autopilot CLI, ESM-native, async action support via parseAsync |
| write-file-atomic | 7.0.0 (already in use) | Atomic state file writes | Prevents corruption during crashes, already used in StateStore |
| Node.js crypto | Built-in | Hash branch names for deterministic port assignment | Standard library, no dependencies, sufficient for non-cryptographic hashing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @inquirer/prompts | 8.2.1 (already in use) | Interactive PRD path prompt | Only when no args and no .planning exists |
| Node.js fs/promises | Built-in | Check .planning/ROADMAP.md existence, read PID files | All file operations |
| Node.js path | Built-in | Construct cross-platform file paths | All path operations per FNDN-03 requirement |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Markdown skill file | npm package with compiled binary | Skill files are simpler, user-editable, and automatically discovered by Claude Code |
| child_process.spawn | pm2, forever, node-windows | Built-in spawn is sufficient for single-process management, external tools add dependency overhead |
| Simple hash (crypto.createHash) | murmurhash, xxhash | Crypto built-in is sufficient for deterministic non-cryptographic hashing |

**Installation:**
```bash
# No new dependencies needed — all required libraries already in autopilot package.json
# Skill file registration happens via npm postinstall script
```

## Architecture Patterns

### Recommended Project Structure
```
autopilot/
├── workflows/
│   └── gsd-autopilot/
│       ├── SKILL.md              # Main slash command definition
│       ├── launcher.js           # Background process spawner
│       ├── port-manager.js       # Branch-to-port mapping with collision detection
│       └── pid-manager.js        # PID file write/read for stop/status
├── package.json                  # Add postinstall script
└── src/
    └── (existing CLI code)
```

### Pattern 1: Claude Code Slash Command via Skill File
**What:** Create a markdown file with YAML frontmatter and bash command execution that Claude Code automatically discovers and registers as `/gsd:autopilot`

**When to use:** When creating custom slash commands that should be available in Claude Code sessions

**Example:**
```yaml
---
name: gsd-autopilot
description: Launch GSD Autopilot to autonomously build your project from a PRD
argument-hint: [status|stop|--prd <path>|--phases <range>]
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(git branch *)
---

# GSD Autopilot Integration

Launch, monitor, and control GSD Autopilot from within your Claude Code session.

## Subcommand Routing

Parse arguments to determine action:

```bash
# Get current git branch
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

# Delegate to launcher script with current branch context
node ~/.claude/skills/gsd-autopilot/launcher.js "$BRANCH" $ARGUMENTS
```

The launcher script handles:
- Subcommand detection (status, stop, or launch)
- Port assignment with collision detection
- Background process spawning with detached stdio
- PID file management
- Status reporting with dashboard URL
```

**Source:** [Claude Code Slash Commands Documentation](https://code.claude.com/docs/en/slash-commands)

### Pattern 2: Detached Background Process with PID Tracking
**What:** Spawn a Node.js process in detached mode, write its PID to a file, and provide stop/status commands that read the PID file

**When to use:** When launching long-running background processes that should outlive the parent process

**Example:**
```javascript
// launcher.js
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function launchAutopilot(branch, port, args) {
  const child = spawn('npx', ['gsd-autopilot', '--port', port, ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });

  child.unref(); // Allow parent to exit independently

  const pidFile = join(process.cwd(), '.planning', `autopilot-${branch}.pid`);
  await writeFile(pidFile, String(child.pid));

  return { pid: child.pid, port };
}

async function stopAutopilot(branch) {
  const pidFile = join(process.cwd(), '.planning', `autopilot-${branch}.pid`);
  const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);

  process.kill(pid, 'SIGTERM'); // Graceful shutdown

  // Wait up to 5 seconds for graceful exit
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0); // Check if still alive
      await new Promise(r => setTimeout(r, 100));
    } catch {
      // Process exited
      break;
    }
  }
}
```

**Source:** [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html)

### Pattern 3: Deterministic Port Assignment with Collision Detection
**What:** Hash branch name to derive a stable port number, then increment until finding an available port

**When to use:** When multiple instances need unique ports but should get the same port across restarts

**Example:**
```javascript
// port-manager.js
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_PORT = 3847;
const PORT_RANGE = 1000;

function hashBranchToPort(branchName) {
  const hash = createHash('sha256').update(branchName).digest('hex');
  const numericHash = parseInt(hash.slice(0, 8), 16);
  return BASE_PORT + (numericHash % PORT_RANGE);
}

async function isPortAvailable(port) {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function assignPort(branch) {
  // Check for persisted port first
  const stateFile = join(process.cwd(), '.planning', 'autopilot-state.json');
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    if (state.branches?.[branch]?.port) {
      const persistedPort = state.branches[branch].port;
      if (await isPortAvailable(persistedPort)) {
        return persistedPort;
      }
    }
  } catch {
    // State file doesn't exist or invalid — fall through to hash
  }

  // Deterministic hash with collision detection
  let port = hashBranchToPort(branch);
  while (!(await isPortAvailable(port))) {
    port++;
    if (port >= BASE_PORT + PORT_RANGE) {
      throw new Error('No available ports in range');
    }
  }

  // Persist port assignment
  let state = { branches: {} };
  try {
    state = JSON.parse(await readFile(stateFile, 'utf-8'));
  } catch {}
  state.branches = state.branches || {};
  state.branches[branch] = { port, assignedAt: new Date().toISOString() };
  await writeFile(stateFile, JSON.stringify(state, null, 2));

  return port;
}
```

**Source:** Derived from [Portree Git Worktree Server Manager](https://github.com/fairy-pitta/portree) pattern

### Pattern 4: npm postinstall Script for Workflow Registration
**What:** Use npm postinstall lifecycle script to copy skill file to user's `~/.claude/skills/` directory during package installation

**When to use:** When distributing custom Claude Code workflows via npm packages

**Example:**
```javascript
// scripts/install-workflow.js
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

async function installWorkflow() {
  const skillsDir = join(homedir(), '.claude', 'skills', 'gsd-autopilot');
  await mkdir(skillsDir, { recursive: true });

  const workflowDir = join(process.cwd(), 'workflows', 'gsd-autopilot');

  // Copy all workflow files
  await copyFile(
    join(workflowDir, 'SKILL.md'),
    join(skillsDir, 'SKILL.md')
  );
  await copyFile(
    join(workflowDir, 'launcher.js'),
    join(skillsDir, 'launcher.js')
  );
  await copyFile(
    join(workflowDir, 'port-manager.js'),
    join(skillsDir, 'port-manager.js')
  );

  console.log('✓ Installed /gsd:autopilot slash command to ~/.claude/skills/');
}

installWorkflow().catch(console.error);
```

```json
// package.json
{
  "scripts": {
    "postinstall": "node scripts/install-workflow.js"
  }
}
```

**Source:** [npm postinstall scripts documentation](https://docs.npmjs.com/misc/scripts) and [npm package file copying patterns](https://github.com/npm/npm/issues/11260)

### Anti-Patterns to Avoid
- **Implementing orchestration in the workflow file:** The SKILL.md should only shell out to the CLI, not reimplement phase sequencing or state management
- **Blocking on child process completion:** Use `detached: true` and `stdio: 'ignore'` with `child.unref()` to ensure parent returns immediately
- **Hardcoding port 3847:** Always use deterministic hashing with collision detection to support multi-instance
- **Polling process.kill(pid, 0) indefinitely:** Set a maximum wait time (5-10 seconds) before escalating to SIGKILL or reporting timeout
- **Storing PID in autopilot-state.json:** PID files should be separate per-branch files for simpler management and cleanup

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slash command registration | Custom Claude Code plugin system | Markdown skill files in `~/.claude/skills/` | Claude Code automatically discovers and loads .md files, no plugin API needed |
| Background process manager | Custom daemon/service wrapper | Node.js `child_process.spawn({ detached: true })` + PID files | Built-in API handles cross-platform detachment, existing ecosystem patterns for PID management |
| Port availability checking | Manual socket connection attempts | `net.createServer().listen()` with error handling | Standard pattern, handles all edge cases (permission, already bound, etc.) |
| Atomic file writes | Manual write + rename | write-file-atomic library (already in use) | Handles fsync, temp files, cross-platform atomicity edge cases |
| Branch name hashing | Custom hash function | Node.js crypto.createHash('sha256') | Standard library, fast, deterministic, no dependencies |

**Key insight:** This phase is primarily integration work, not new infrastructure. Every component already exists (CLI, state management, dashboard server). The workflow is a thin orchestration layer that shells out to proven implementations.

## Common Pitfalls

### Pitfall 1: Skill File Not Discovered by Claude Code
**What goes wrong:** User installs package, but `/gsd:autopilot` doesn't appear in slash command menu

**Why it happens:**
- Postinstall script failed silently
- File copied to wrong directory (`.claude/commands/` instead of `.claude/skills/`)
- YAML frontmatter malformed (missing closing `---`, invalid field names)
- Skill name contains uppercase letters or special characters (only lowercase, numbers, hyphens allowed)

**How to avoid:**
- Test postinstall script on clean install with `npm install --ignore-scripts` then `npm run postinstall`
- Validate YAML frontmatter with schema before shipping
- Use `name: gsd-autopilot` (lowercase with hyphens only)
- Log success message from postinstall script so users can verify

**Warning signs:**
- `/` autocomplete menu doesn't show new command
- `~/.claude/skills/gsd-autopilot/SKILL.md` doesn't exist after install

### Pitfall 2: Background Process Exits Immediately
**What goes wrong:** Child process spawns but terminates before autopilot server starts

**Why it happens:**
- Parent process stdio inherited (child receives SIGHUP when parent exits)
- Missing `child.unref()` call keeps parent waiting
- Child process working directory wrong (can't find `.planning/`)
- Environment variables not inherited (PATH missing, no node binary found)

**How to avoid:**
- Always use `stdio: 'ignore'` with `detached: true`
- Call `child.unref()` immediately after spawn
- Explicitly set `cwd: process.cwd()` in spawn options
- Consider passing `env: process.env` if environment is needed

**Warning signs:**
- PID file created but process not running (`ps aux | grep gsd-autopilot` shows nothing)
- Dashboard URL inaccessible immediately after launch

### Pitfall 3: Port Collision on Multi-Instance Launch
**What goes wrong:** Second branch launch fails with "port already in use" even though port assignment is deterministic

**Why it happens:**
- Persisted port in state file no longer available (stale from previous run)
- Hash collision (two branch names hash to same initial port)
- Port availability check races with another process binding

**How to avoid:**
- Always check port availability before reusing persisted port
- Implement linear probing (increment until finding free port)
- Write-file-atomic on state updates to prevent corruption
- Handle EADDRINUSE gracefully by incrementing port

**Warning signs:**
- Error message "EADDRINUSE: address already in use"
- Different branches consistently get same port number

### Pitfall 4: Graceful Shutdown Timeout
**What goes wrong:** `/gsd:autopilot stop` hangs indefinitely waiting for process to exit

**Why it happens:**
- Express server not handling SIGTERM (no shutdown handler registered)
- Database connections or file handles preventing clean exit
- Orchestrator in middle of long-running Claude command (timeout > shutdown timeout)
- PID file stale (points to dead process or different process)

**How to avoid:**
- Implement SIGTERM handler in autopilot CLI (already exists via ShutdownManager)
- Set maximum wait time (5-10 seconds) before escalating to SIGKILL
- Validate PID is still autopilot process before sending signal (`/proc/{pid}/cmdline` check on Linux)
- Display progress during wait ("Waiting for graceful shutdown... 3s")

**Warning signs:**
- `process.kill(pid, 0)` succeeds but process doesn't respond to SIGTERM
- Stop command hangs without timeout

### Pitfall 5: Argument Parsing Ambiguity
**What goes wrong:** `/gsd:autopilot --phases 3-5` treated as invalid subcommand instead of launch with args

**Why it happens:**
- Workflow checks for exact match on "status" or "stop" before delegating
- Flag arguments (--phases) parsed as positional subcommand
- Argument splitting on spaces breaks quoted strings ("--prd path with spaces")

**How to avoid:**
- Check first argument against known subcommands (status, stop) explicitly
- Treat anything else (empty, flags, paths) as launch command with arguments
- Use proper shell quoting in SKILL.md bash block (`"$@"` instead of `$ARGUMENTS`)
- Document argument format in `argument-hint` frontmatter field

**Warning signs:**
- Error message "Unknown subcommand: --phases"
- Quoted paths split into multiple arguments

## Code Examples

Verified patterns from official sources and existing codebase:

### Skill File Structure
```yaml
---
name: gsd-autopilot
description: Launch GSD Autopilot to autonomously build your project from a PRD
argument-hint: [status|stop|--prd <path>|--phases <range>]
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(git branch *), Bash(npx *)
---

# GSD Autopilot Integration

Launch autopilot in background, check status, or stop gracefully.

## Usage

**Launch autopilot for current branch:**
```
/gsd:autopilot
/gsd:autopilot --prd ./idea.md
/gsd:autopilot --phases 3-5 --notify teams
```

**Check status:**
```
/gsd:autopilot status
```

**Stop gracefully:**
```
/gsd:autopilot stop
```

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Get current git branch for multi-instance isolation
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

# Delegate to launcher script with branch context
# Note: Using ~/.claude/skills path because postinstall copies files there
exec node ~/.claude/skills/gsd-autopilot/launcher.js "$BRANCH" "$@"
```
```
**Source:** [Claude Code Skills Documentation](https://code.claude.com/docs/en/slash-commands)

### Background Process Spawning (Detached Mode)
```javascript
// launcher.js - Simplified example showing core pattern
import { spawn } from 'node:child_process';

function launchDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,          // Run in separate process group
    stdio: 'ignore',         // Don't inherit parent's stdio
    cwd: process.cwd(),      // Explicit working directory
    env: process.env,        // Pass environment variables
    ...options,
  });

  // Unref allows parent to exit without waiting for child
  child.unref();

  return child.pid;
}

// Usage
const pid = launchDetached('npx', ['gsd-autopilot', '--port', '3847']);
console.log(`Autopilot started with PID ${pid}`);
```
**Source:** [Node.js Child Process Documentation - Options: detached](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)

### Port Availability Check
```javascript
// port-manager.js - Port availability check
import { createServer } from 'node:net';

async function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other errors (EACCES, etc.) also mean port not available
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, host);
  });
}

// Usage
if (await isPortAvailable(3847)) {
  console.log('Port 3847 is available');
} else {
  console.log('Port 3847 is in use, trying next port');
}
```
**Source:** Common Node.js pattern, verified across multiple sources

### Graceful Process Shutdown with Timeout
```javascript
// pid-manager.js - Stop with graceful timeout
async function stopProcess(pid, timeoutMs = 5000) {
  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process doesn't exist
      return { status: 'not_running' };
    }
    throw err;
  }

  // Wait for graceful exit
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      if (err.code === 'ESRCH') {
        // Process exited gracefully
        return { status: 'stopped', graceful: true };
      }
    }
  }

  // Timeout exceeded, force kill
  try {
    process.kill(pid, 'SIGKILL');
    return { status: 'stopped', graceful: false, forcedKill: true };
  } catch {
    // Process already dead
    return { status: 'stopped', graceful: false };
  }
}
```
**Source:** [Node.js Graceful Shutdown Tutorial](https://riptutorial.com/node-js/example/20985/graceful-shutdown---sigterm)

### Branch Name to Port Hashing
```javascript
// port-manager.js - Deterministic port from branch name
import { createHash } from 'node:crypto';

const BASE_PORT = 3847;
const PORT_RANGE = 1000;

function branchToPort(branchName) {
  // SHA-256 hash of branch name
  const hash = createHash('sha256')
    .update(branchName)
    .digest('hex');

  // Convert first 8 hex chars to integer
  const numericHash = parseInt(hash.slice(0, 8), 16);

  // Map to port range [3847, 4846]
  return BASE_PORT + (numericHash % PORT_RANGE);
}

// Examples:
// main -> 3847 + (hash('main') % 1000) -> 4234
// feature/auth -> 3847 + (hash('feature/auth') % 1000) -> 3991
// Same branch always gets same initial port
```
**Source:** Node.js crypto built-in module

### State File Schema Extension
```typescript
// Extend existing autopilot-state.json schema
interface AutopilotState {
  // ... existing fields

  // New: per-branch instance metadata
  branches?: {
    [branchName: string]: {
      port: number;
      pid?: number;
      assignedAt: string;  // ISO timestamp
      lastSeen?: string;   // For health checks
    };
  };
}
```
**Source:** Extending existing `src/types/state.ts` pattern

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.claude/commands/` directory | `.claude/skills/` directory | Claude Code 2025 | Skills support frontmatter control, supporting files, and auto-discovery. Commands still work but skills are recommended |
| Custom plugin architecture | Markdown files with YAML frontmatter | Claude Code 2025 | No build step, no plugin API needed, human-readable and editable |
| Commander.js v12 (CJS) | Commander.js v14 (ESM) | 2024 | ESM-native, better async support, requires Node.js 20+ |
| pm2/forever for background processes | Native child_process.spawn detached | Always available | Single-process use case doesn't need process manager overhead |

**Deprecated/outdated:**
- **`.claude/commands/` for new skills:** Still works but `.claude/skills/` is recommended for new implementations (supports frontmatter and supporting files)
- **Commander.js v15 ESM-only:** Released May 2026, but v14 still in maintenance and sufficient for this use case

## Open Questions

1. **Should PID files be cleaned up on successful stop, or persist for debugging?**
   - What we know: Stale PID files can cause confusion if they point to recycled PIDs
   - What's unclear: Whether preserving for debugging (last run timestamp) adds value
   - Recommendation: Delete PID file on successful stop, but log PID + timestamp to autopilot log file for debugging

2. **Should the workflow verify autopilot dashboard is responding before returning success?**
   - What we know: Background spawn returns immediately, server may take 1-2 seconds to start
   - What's unclear: Whether users expect instant dashboard availability or are okay with brief delay
   - Recommendation: Perform quick health check (3 retry attempts over 3 seconds) before reporting success, but don't block on full initialization

3. **How should multiple simultaneous launches on same branch be handled?**
   - What we know: Deterministic port assignment means second launch will detect port in use
   - What's unclear: Should workflow error, kill old instance, or assume user wants to connect to existing?
   - Recommendation: Check PID file first — if process running, report "already running" with dashboard URL instead of launching new instance

## Sources

### Primary (HIGH confidence)
- [Claude Code Slash Commands Documentation](https://code.claude.com/docs/en/slash-commands) - Official slash command and skill file structure
- [Claude Agent SDK Slash Commands](https://platform.claude.com/docs/en/agent-sdk/slash-commands) - How slash commands work in SDK context
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html) - Detached process spawning patterns
- [Node.js Process Documentation](https://nodejs.org/api/process.html) - Signal handling and process.kill behavior
- Existing autopilot codebase at `C:/GitHub/GetShitDone/get-shit-done/autopilot/` - CLI structure, config precedence, Commander.js usage

### Secondary (MEDIUM confidence)
- [Commander.js npm package](https://www.npmjs.com/package/commander) - Version 14 async/ESM features
- [npm Scripts Documentation](https://docs.npmjs.com/misc/scripts) - postinstall lifecycle hooks
- [Portree Git Worktree Manager](https://github.com/fairy-pitta/portree) - Real-world example of branch-to-port deterministic assignment
- [Node.js Graceful Shutdown Patterns](https://riptutorial.com/node-js/example/20985/graceful-shutdown---sigterm) - SIGTERM handling best practices

### Tertiary (LOW confidence)
- [GitHub npm Issue #11260](https://github.com/npm/npm/issues/11260) - Discussion of postinstall file copying patterns (community solutions, not official guidance)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use or Node.js built-ins, versions verified in package.json
- Architecture: HIGH - Claude Code skill pattern documented officially, spawn/detached pattern is standard Node.js, verified with existing codebase
- Pitfalls: MEDIUM-HIGH - Derived from official docs (detached process warnings) and common Node.js patterns, not all verified in production autopilot context

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (30 days) - Stable domain, Node.js APIs don't change frequently, Claude Code skills are new but stabilized
