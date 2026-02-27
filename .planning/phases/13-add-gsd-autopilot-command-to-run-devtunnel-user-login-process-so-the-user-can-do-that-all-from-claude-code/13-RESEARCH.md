# Phase 13: Add gsd:autopilot login command - Research

**Researched:** 2026-02-26
**Domain:** Node.js child process management, CLI authentication flows, Windows process spawning
**Confidence:** HIGH

## Summary

Phase 13 adds a `login` subcommand to the existing `/gsd:autopilot` skill to run the devtunnel browser-based authentication flow from within Claude Code. The implementation follows the established launcher.js subcommand routing pattern and leverages the bundled devtunnel.exe already included in the autopilot directory.

The core challenge is spawning an interactive CLI process that opens the user's default browser, waiting for the authentication to complete with a 5-minute timeout, and providing clear feedback throughout. Node.js child_process.spawn with stdio: 'inherit' is the standard approach for interactive CLI tools that handle their own browser launching.

**Primary recommendation:** Use child_process.spawn with stdio: 'inherit' to run `devtunnel user login`, implement a simple readline-based re-login prompt, and trust devtunnel's exit code for success/failure detection.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Add `login` as a subcommand to existing `/gsd:autopilot` (alongside status, stop)
- Login only — no logout or auth-status subcommands
- Pre-check: run `devtunnel user show` first; if already authenticated, offer re-login choice before proceeding
- Devtunnel executable is bundled in the autopilot code directory — no external install check needed
- Spawn `devtunnel user login` and let the OS handle opening the browser
- 5-minute timeout for the user to complete browser authentication
- Support two auth providers: Microsoft account (default) and GitHub via argument (`/gsd:autopilot login github` maps to `-g` flag)
- On auth failure (denied, network error): show the error message and suggest running the command again — no auto-retry
- While waiting: simple static message "Waiting for browser authentication... (Press Ctrl+C to cancel)"
- On success: show account name from devtunnel output + "Dev tunnels are ready" confirmation
- Trust the exit code — no additional token validation after login
- No next-steps hint after success — just the confirmation message
- Only wraps `devtunnel user login` — no guided setup for GITHUB_TOKEN or DEVTUNNEL_TOKEN env vars
- Users who want token-based auth can set env vars manually (existing error messages already guide them)
- No check for running autopilot instances — login is independent
- If devtunnel.exe is missing from expected location: clear error message with reinstall instructions

### Claude's Discretion
- Exact output formatting and color scheme
- How to parse account name from devtunnel login output
- Error message wording details
- How the re-login prompt is presented (could use AskUserQuestion or simple confirmation)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:child_process | Built-in | Spawn devtunnel CLI process | Node.js standard for process spawning |
| node:readline | Built-in | Pre-login confirmation prompt | GSD convention (Phase 08-02 decision) |
| node:util | Built-in | promisify for execFileAsync | Standard async wrapper pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| N/A | - | - | No external dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| stdio: 'inherit' | stdio: 'pipe' + manual output forwarding | Pipe requires manual stream handling; inherit is simpler for interactive CLI |
| Exit code checking | Output parsing for "Logged in as..." | Exit code is more reliable; output parsing is fragile across devtunnel versions |
| readline | @inquirer/prompts | Phase 08-02 decision mandates readline for zero external dependencies |

**Installation:**
No installation needed — all built-in Node.js modules.

## Architecture Patterns

### Recommended Project Structure
```
autopilot/workflows/gsd-autopilot/
├── launcher.js                 # Add 'login' subcommand routing
├── SKILL.md                   # Update usage docs
└── (existing files)           # status, stop handlers already present
```

### Pattern 1: Subcommand Routing in launcher.js
**What:** Route 'login' subcommand to a dedicated handler function
**When to use:** Follows existing pattern for 'status' and 'stop' subcommands
**Example:**
```javascript
// In launcher.js main() function
const subcommandOrArg = process.argv[3];

if (subcommandOrArg === 'status') {
  await handleStatus(branch, projectDir);
} else if (subcommandOrArg === 'stop') {
  await handleStop(branch, projectDir);
} else if (subcommandOrArg === 'login') {
  const provider = process.argv[4]; // 'github' or undefined
  await handleLogin(provider);
} else {
  // Everything else goes to launch
  const remainingArgs = process.argv.slice(3);
  await handleLaunch(branch, projectDir, remainingArgs);
}
```

### Pattern 2: Interactive CLI Process with stdio: 'inherit'
**What:** Spawn child process with stdio: 'inherit' to pass through terminal interaction
**When to use:** For CLI tools that handle their own user interaction (prompts, browser launching)
**Example:**
```javascript
// Source: Node.js child_process documentation + existing TunnelManager pattern
import { spawn } from 'node:child_process';

function spawnDevTunnelLogin(provider) {
  return new Promise((resolve, reject) => {
    const args = ['user', 'login'];
    if (provider === 'github') {
      args.push('-g');
    }

    const proc = spawn(devtunnelExe, args, {
      stdio: 'inherit', // Pass through stdin/stdout/stderr
      windowsHide: false // Show console on Windows
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Login failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn devtunnel: ${err.message}`));
    });
  });
}
```

### Pattern 3: Pre-check with execFileAsync
**What:** Use promisified execFile to run `devtunnel user show` and check if already logged in
**When to use:** For non-interactive commands that capture output
**Example:**
```javascript
// Source: Existing TunnelManager.getDevTunnelCliToken() pattern
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function isAlreadyLoggedIn(devtunnelExe) {
  try {
    const { stdout } = await execFileAsync(devtunnelExe, ['user', 'show'], {
      timeout: 10_000,
      windowsHide: true
    });
    // Check if output contains login confirmation
    return stdout.includes('Logged in as');
  } catch {
    // Not logged in or command failed
    return false;
  }
}
```

### Pattern 4: Readline Confirmation Prompt
**What:** Simple yes/no prompt using readline.createInterface
**When to use:** For pre-login confirmation when user is already authenticated
**Example:**
```javascript
// Source: Existing launcher.js promptForPrdPath() pattern
import { createInterface } from 'node:readline';

function promptReLogin() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Already logged in. Re-authenticate? (y/N): ', (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      resolve(choice === 'y' || choice === 'yes');
    });
  });
}
```

### Pattern 5: Timeout Wrapper
**What:** Wrap spawn promise with timeout to enforce 5-minute limit
**When to use:** For long-running interactive processes with user-defined time limits
**Example:**
```javascript
// Source: Existing RemoteSessionManager timeout pattern
function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      timer.unref(); // Don't block Node.js exit
    })
  ]);
}

// Usage
await withTimeout(
  spawnDevTunnelLogin(provider),
  5 * 60 * 1000, // 5 minutes
  'Login timeout: authentication not completed within 5 minutes'
);
```

### Anti-Patterns to Avoid
- **Parsing output for success detection:** devtunnel's output format can change between versions. Trust exit code (0 = success) instead.
- **Using stdio: 'pipe' for interactive CLI:** Requires manual stream forwarding and breaks interactive prompts. Use 'inherit' for tools that manage their own UI.
- **Validating token after login:** devtunnel caches credentials securely. If exit code is 0, trust it worked.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser launching | Custom OS detection + command construction | Let devtunnel handle it | devtunnel already detects OS and launches default browser correctly |
| Token caching | Custom token storage in filesystem | devtunnel's built-in cache | devtunnel stores tokens in OS keychain/credential manager securely |
| OAuth flow | Custom OAuth redirect server | devtunnel's auth flow | devtunnel handles OAuth callback, token exchange, and refresh |
| Process timeout | Custom timer + kill logic | Promise.race with setTimeout | Standard Node.js pattern, simpler and more reliable |

**Key insight:** devtunnel CLI is a complete auth solution. The wrapper should be minimal — just spawn, wait, and report results.

## Common Pitfalls

### Pitfall 1: Using stdio: 'pipe' for Interactive CLI
**What goes wrong:** Browser launches but user never sees prompts, authentication appears to hang
**Why it happens:** With stdio: 'pipe', child process stdout/stderr are captured as streams. Interactive prompts (if any) don't reach the terminal.
**How to avoid:** Use stdio: 'inherit' to pass through all stdio streams to parent process terminal
**Warning signs:** Terminal appears frozen after "Starting login..." message

### Pitfall 2: Not Handling Process Spawn Errors
**What goes wrong:** If devtunnel.exe is missing or inaccessible, process crashes with unhandled error
**Why it happens:** spawn emits 'error' event for ENOENT (file not found), permission errors, etc.
**How to avoid:** Always attach 'error' event listener before calling spawn
**Warning signs:** Uncaught exception: spawn ENOENT

### Pitfall 3: Forgetting windowsHide: false
**What goes wrong:** On Windows, devtunnel process runs in hidden console, browser opens but user sees no feedback
**Why it happens:** Node.js defaults to windowsHide: true for child processes on Windows
**How to avoid:** Explicitly set windowsHide: false in spawn options for interactive CLI
**Warning signs:** Windows users report "nothing happens" after login starts

### Pitfall 4: Not Timing Out Long Operations
**What goes wrong:** If user closes browser without completing auth, process hangs indefinitely
**Why it happens:** devtunnel waits for browser callback, which may never come
**How to avoid:** Wrap spawn promise with Promise.race + setTimeout (5-minute timeout per requirements)
**Warning signs:** Process hangs after browser closes, requires Ctrl+C to exit

### Pitfall 5: Parsing Account Name from Verbose Output
**What goes wrong:** Verbose output (`-v` flag) contains debug logs, MSAL cache messages, etc. Hard to extract clean account name.
**Why it happens:** `devtunnel user show -v` is designed for debugging, not structured output
**How to avoid:** Run `devtunnel user show` (no `-v`) for cleaner output. Last line is typically "Logged in as <email> using <provider>."
**Warning signs:** Account name parsing breaks with devtunnel version updates

### Pitfall 6: Not Handling Ctrl+C Gracefully
**What goes wrong:** User presses Ctrl+C during login, but child process keeps running in background
**Why it happens:** Ctrl+C sends SIGINT to parent, but doesn't automatically propagate to children
**How to avoid:** For stdio: 'inherit', SIGINT naturally propagates. No special handling needed for this use case.
**Warning signs:** Orphaned devtunnel processes after Ctrl+C

## Code Examples

Verified patterns from official sources:

### Checking If Already Logged In
```javascript
// Source: Existing TunnelManager pattern (manager.ts:37-53)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

function resolveDevTunnelExe() {
  const __filename = fileURLToPath(import.meta.url);
  // From dist/server/tunnel/manager.js -> autopilot root
  const packageRoot = resolve(dirname(__filename), '..', '..', '..');
  const ext = process.platform === 'win32' ? '.exe' : '';
  return resolve(packageRoot, `devtunnel${ext}`);
}

async function checkAuthStatus() {
  const exe = resolveDevTunnelExe();
  try {
    const { stdout } = await execFileAsync(exe, ['user', 'show'], {
      timeout: 10_000,
      windowsHide: true
    });
    // Output format: "Logged in as <email> using <provider>."
    const match = stdout.match(/Logged in as (.+?) using (.+?)\./);
    if (match) {
      return { loggedIn: true, account: match[1], provider: match[2] };
    }
    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}
```

### Spawning Interactive devtunnel Login
```javascript
// Source: Node.js child_process docs + RemoteSessionManager spawn pattern
import { spawn } from 'node:child_process';

async function runDevTunnelLogin(exe, provider) {
  return new Promise((resolve, reject) => {
    const args = ['user', 'login'];
    if (provider === 'github') {
      args.push('-g');
    }

    console.log('Waiting for browser authentication... (Press Ctrl+C to cancel)');

    const proc = spawn(exe, args, {
      stdio: 'inherit', // Pass through all streams
      windowsHide: false // Show console on Windows
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Login failed (exit code ${code})`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn devtunnel: ${err.message}`));
    });
  });
}
```

### Re-Login Confirmation Prompt
```javascript
// Source: Existing launcher.js promptForPrdPath() pattern (launcher.js:271-283)
import { createInterface } from 'node:readline';

function confirmReLogin(account) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`Already logged in as: ${account}`);
    rl.question('Re-authenticate? (y/N): ', (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      resolve(choice === 'y' || choice === 'yes');
    });
  });
}
```

### Complete Login Handler
```javascript
// Complete handleLogin() for launcher.js
async function handleLogin(provider) {
  const exe = resolveDevTunnelExe();

  // Check if devtunnel.exe exists
  if (!fs.existsSync(exe)) {
    console.error('Error: devtunnel.exe not found');
    console.error('Expected location:', exe);
    console.error('Reinstall GSD to restore devtunnel: npx get-shit-done-cc --global');
    process.exit(1);
  }

  // Pre-check: is user already logged in?
  const status = await checkAuthStatus();
  if (status.loggedIn) {
    const shouldReLogin = await confirmReLogin(status.account);
    if (!shouldReLogin) {
      console.log('Login cancelled.');
      return;
    }
  }

  // Run login with timeout
  try {
    await withTimeout(
      runDevTunnelLogin(exe, provider),
      5 * 60 * 1000,
      'Login timeout: authentication not completed within 5 minutes'
    );

    // Get account info after successful login
    const newStatus = await checkAuthStatus();
    if (newStatus.loggedIn) {
      console.log(`\nLogged in as: ${newStatus.account}`);
      console.log('Dev tunnels are ready.');
    } else {
      console.log('\nLogin completed.');
    }
  } catch (err) {
    console.error(`\nLogin failed: ${err.message}`);
    console.error('Please try running /gsd:autopilot login again.');
    process.exit(1);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual devtunnel install | Bundled devtunnel.exe | Phase 11 (Nov 2024) | Users don't need to install devtunnel separately |
| Environment variable tokens | Browser-based login | Current standard | More user-friendly, supports both Microsoft and GitHub accounts |
| `-d` device code flow | `-b` browser flow (default) | devtunnel v1.0+ | Browser flow is faster and more intuitive |

**Deprecated/outdated:**
- `--aad` flag: Microsoft renamed AAD to Entra ID. Use `--entra` or omit (Entra is default).
- Device code login (`-d`): Still supported but browser flow is now default and preferred.

## Open Questions

1. **Should we show devtunnel's verbose output during login?**
   - What we know: `devtunnel user login` shows progress messages during auth
   - What's unclear: Whether verbose debug output (`-v`) adds value or just noise
   - Recommendation: Skip `-v` flag. Default output is sufficient, verbose mode clutters terminal with MSAL cache logs

2. **How to handle network errors gracefully?**
   - What we know: devtunnel exits with non-zero code on network failures
   - What's unclear: Whether to show devtunnel's error message or wrap it
   - Recommendation: Let devtunnel's error message show (stdio: 'inherit'), then add simple "try again" hint

3. **Should we validate that tunnel creation will work after login?**
   - What we know: Login doesn't guarantee tunnel creation will succeed (quota limits, service issues)
   - What's unclear: Whether to test tunnel creation after login
   - Recommendation: Don't test. Let the autopilot launch process handle tunnel creation errors naturally

## Sources

### Primary (HIGH confidence)
- [Node.js child_process Documentation](https://nodejs.org/api/child_process.html) - spawn options, stdio modes
- [Microsoft Learn: Dev tunnels CLI commands](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands) - devtunnel user login syntax and options
- [Microsoft Learn: Dev tunnels Getting Started](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started) - authentication flow and usage
- Existing codebase patterns:
  - `autopilot/src/server/tunnel/manager.ts` (lines 37-53) - getDevTunnelCliToken pre-check pattern
  - `autopilot/workflows/gsd-autopilot/launcher.js` (lines 19-41) - subcommand routing pattern
  - `autopilot/workflows/gsd-autopilot/launcher.js` (lines 271-283) - readline prompt pattern
  - `autopilot/src/server/remote-session/manager.ts` (lines 40-127) - spawn with timeout pattern

### Secondary (MEDIUM confidence)
- [How To Launch Child Processes in Node.js | DigitalOcean](https://www.digitalocean.com/community/tutorials/how-to-launch-child-processes-in-node-js) - spawn vs exec usage
- [Node.js Child Process Module | W3Schools](https://www.w3schools.com/nodejs/nodejs_child_process.asp) - stdio: 'inherit' behavior

### Tertiary (LOW confidence)
- WebSearch results about Windows spawn behavior - not directly verified but aligns with Node.js docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All built-in Node.js modules with existing codebase precedent
- Architecture: HIGH - Clear patterns from existing subcommand handlers (status, stop) and spawn usage (RemoteSessionManager)
- Pitfalls: HIGH - Based on Node.js docs, existing code review, and devtunnel CLI testing

**Research date:** 2026-02-26
**Valid until:** 60 days (stable APIs: Node.js built-ins, mature devtunnel CLI)
