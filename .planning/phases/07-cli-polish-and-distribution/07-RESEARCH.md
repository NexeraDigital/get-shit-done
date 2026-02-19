# Phase 07: CLI Polish and Distribution - Research

**Researched:** 2026-02-18
**Domain:** npm package distribution, CLI UX patterns, cross-platform Node.js CLIs
**Confidence:** HIGH

## Summary

This phase focuses on hardening the existing CLI implementation with production-ready error handling, interactive first-run experience, and npm distribution. The core CLI infrastructure already exists (Commander v14, config loader, output renderer with verbosity levels), so this phase adds polish rather than building from scratch.

Key findings:
- Commander v14 provides `.configureOutput()` and `.showHelpAfterError()` for customizing error displays
- `@inquirer/prompts` is the modern, ESM-native choice for interactive setup wizards (replaces legacy inquirer)
- `command-exists` package is the standard for cross-platform executable detection in preflight checks
- npm packaging requires careful attention to the `files` field, shebang line endings (LF only), and avoiding postinstall scripts
- Package size target of <2MB is achievable with current stack (dashboard ~400KB, TypeScript dist ~1.4MB, production deps minimal)

**Primary recommendation:** Use `@inquirer/prompts` for interactive wizard, `command-exists` for preflight checks, extend `parsePhaseRange` to support comma-separated lists, configure `.gitattributes` to enforce LF endings on bin scripts, and rely on the `files` field (not .npmignore) for explicit package contents control.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dry-run mode**
- **Dropped from scope** — user decided --dry-run is unnecessary; if something's misconfigured, the real run surfaces it fast enough
- Remove from CLI flags and success criteria

**Flag design**
- All flags from roadmap kept: --prd, --notify, --webhook-url, --port, --depth, --model, --skip-discuss, --skip-verify, --phases, --resume, --verbose, --quiet, --adapter-path
- Long flags only — no short aliases (users can create their own shell aliases)
- --verbose and --quiet affect EVERYTHING: autopilot logging AND Claude SDK output (Phase 3.1 StreamRenderer respects verbosity)

**First-run experience**
- When run without args: interactive setup wizard (PRD path, notification channel, model selection)
- Not just help text — guide the user through their first run

**Error messaging**
- Friendly errors with actionable fix steps (e.g., "Claude CLI not found. Install it: npm i -g @anthropic-ai/claude-code")
- Preflight check on startup: validate claude CLI, GSD installation, PRD file readable, port available — report ALL issues at once, not one-at-a-time
- When --resume used with no previous state: offer to start fresh ("No previous run found. Start a new run with --prd instead?")

**Shutdown behavior**
- Ctrl+C = immediate abort — kill Claude process, persist state, exit
- No graceful timeout — fast and predictable

**npm packaging**
- Package name: `gsd-autopilot`, bin name: `gsd-autopilot`
- Invocation: `npx gsd-autopilot --prd ./idea.md`

### Claude's Discretion

- Default --port value and --phases syntax (ranges, commas, or both)
- Whether dashboard is pre-built in package or built on first run
- Whether to include a postinstall message or check prerequisites at runtime
- Package size optimization approach (target under 2MB)

### Deferred Ideas (OUT OF SCOPE)

- --dry-run flag — dropped from Phase 7 scope by user decision. Could be added in a future iteration if users request build preview capability.

</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | 14.0.3 | CLI argument parsing and help | Industry standard, ESM-native, async parseAsync support. Already installed. |
| @inquirer/prompts | latest (9.x) | Interactive setup wizard | Modern rewrite with minimal deps, ESM-native, replaces legacy inquirer. Fast startup (~4ms). |
| command-exists | 1.2.9+ | Cross-platform executable detection | 1833+ packages depend on it. Handles Windows PATHEXT and Unix permissions correctly. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| which | 5.x | Alternative to command-exists | If you need path resolution (command-exists only checks existence). Less popular but official npm tool. |
| npm-packlist | 9.x | Verify package contents before publish | Test what `npm pack` will include. Use in CI or pre-publish checks. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @inquirer/prompts | enquirer | Enquirer is faster (~4ms) but less actively maintained. Inquirer has better TypeScript types and modern ESM support. |
| commander | yargs | Yargs has more built-in validation but heavier API. Commander is lighter and already installed. |
| command-exists | Manual `which` wrapper | Custom solution requires handling Windows PATHEXT, Unix permissions, and PATH parsing correctly — too error-prone. |

**Installation:**
```bash
npm install @inquirer/prompts command-exists
```

## Architecture Patterns

### Recommended Project Structure

Current structure already correct:
```
autopilot/
├── src/
│   ├── cli/
│   │   └── index.ts          # CLI entry point (currently implemented)
│   ├── config/               # Config loader (already built)
│   ├── output/               # StreamRenderer with verbosity (already built)
│   └── ...
├── dist/                     # TypeScript build output
├── dashboard/
│   └── dist/                 # Pre-built React dashboard (~400KB)
└── package.json
```

### Pattern 1: Interactive Setup Wizard (New)

**What:** When user runs `gsd-autopilot` without arguments, launch an interactive wizard to collect required config

**When to use:** First-run experience or when no PRD/resume flag provided

**Example:**
```typescript
// Source: @inquirer/prompts examples + user requirements
import { input, select, confirm } from '@inquirer/prompts';

async function runSetupWizard(): Promise<{ prdPath: string; notify: string; model: string }> {
  console.log('Welcome to GSD Autopilot! Let\'s get you started.\n');

  const prdPath = await input({
    message: 'Path to your PRD or idea document:',
    default: './idea.md',
    validate: async (value) => {
      try {
        await access(resolve(value));
        return true;
      } catch {
        return `File not found: ${value}`;
      }
    },
  });

  const notify = await select({
    message: 'How should we notify you when questions arise?',
    choices: [
      { name: 'Console output (default)', value: 'console' },
      { name: 'System notifications', value: 'system' },
      { name: 'Microsoft Teams webhook', value: 'teams' },
      { name: 'Slack webhook', value: 'slack' },
    ],
    default: 'console',
  });

  const model = await select({
    message: 'Model profile:',
    choices: [
      { name: 'Balanced (recommended)', value: 'balanced' },
      { name: 'Quality (slower, more thorough)', value: 'quality' },
      { name: 'Budget (faster, less thorough)', value: 'budget' },
    ],
    default: 'balanced',
  });

  const shouldSaveConfig = await confirm({
    message: 'Save these settings to .gsd-autopilot.json?',
    default: true,
  });

  if (shouldSaveConfig) {
    await writeFile(
      join(process.cwd(), '.gsd-autopilot.json'),
      JSON.stringify({ notify, model }, null, 2),
      'utf-8',
    );
  }

  return { prdPath, notify, model };
}
```

### Pattern 2: Preflight Validation (New)

**What:** Check prerequisites before starting orchestrator — report ALL failures at once

**When to use:** After CLI parsing, before orchestrator.run()

**Example:**
```typescript
// Source: command-exists + CLI best practices (clig.dev)
import commandExists from 'command-exists';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';

interface PreflightCheck {
  name: string;
  check: () => Promise<boolean>;
  error: string;
  fix: string;
}

async function runPreflightChecks(config: AutopilotConfig, prdPath?: string): Promise<void> {
  const checks: PreflightCheck[] = [
    {
      name: 'Claude CLI installed',
      check: async () => {
        try {
          await commandExists('claude');
          return true;
        } catch {
          return false;
        }
      },
      error: 'Claude CLI not found',
      fix: 'Install it: npm install -g @anthropic-ai/claude-code',
    },
    {
      name: 'PRD file exists',
      check: async () => {
        if (!prdPath) return true; // Skip if using --resume
        try {
          await access(prdPath);
          return true;
        } catch {
          return false;
        }
      },
      error: `PRD file not found: ${prdPath}`,
      fix: 'Check the path and try again',
    },
    {
      name: 'Port available',
      check: async () => {
        return new Promise((resolve) => {
          const server = createServer();
          server.once('error', () => resolve(false));
          server.once('listening', () => {
            server.close();
            resolve(true);
          });
          server.listen(config.port);
        });
      },
      error: `Port ${config.port} is already in use`,
      fix: `Use --port <number> to specify a different port`,
    },
  ];

  const failures: Array<{ error: string; fix: string }> = [];

  // Run all checks in parallel
  const results = await Promise.all(
    checks.map(async (check) => ({
      passed: await check.check(),
      error: check.error,
      fix: check.fix,
    })),
  );

  for (const result of results) {
    if (!result.passed) {
      failures.push({ error: result.error, fix: result.fix });
    }
  }

  if (failures.length > 0) {
    console.error('\nPreflight checks failed:\n');
    for (const failure of failures) {
      console.error(`❌ ${failure.error}`);
      console.error(`   ${failure.fix}\n`);
    }
    process.exit(1);
  }
}
```

### Pattern 3: Actionable Error Messages (Enhancement)

**What:** Replace generic errors with specific, actionable guidance

**When to use:** All error paths in CLI

**Example:**
```typescript
// Source: clig.dev + Commander v14 configureOutput
import { Command } from 'commander';

const program = new Command();

program
  .configureOutput({
    writeErr: (str) => {
      // Custom error formatting
      const formatted = str
        .replace(/^error: /, '❌ Error: ')
        .replace(/^usage: /, '💡 Usage: ');
      process.stderr.write(formatted);
    },
    outputError: (str, write) => {
      // Add helpful context to errors
      write(str);
      if (str.includes('required option')) {
        write('\n💡 Tip: Run with --help to see all available options\n');
      }
    },
  })
  .showHelpAfterError('(add --help for additional information)');

// Custom validation with actionable errors
program
  .option('--prd <path>', 'Path to PRD/idea document')
  .option('--resume', 'Resume from last checkpoint')
  .action(async (options) => {
    if (!options.prd && !options.resume) {
      console.error('❌ Error: No input specified\n');
      console.error('You must provide either:');
      console.error('  --prd <path>   Start a new run with a PRD document');
      console.error('  --resume       Continue from last checkpoint\n');
      console.error('💡 Run gsd-autopilot --help for more information');
      process.exit(1);
    }
  });
```

### Pattern 4: Enhanced Phase Range Parser (Enhancement)

**What:** Extend existing `parsePhaseRange` to support comma-separated ranges

**When to use:** Parsing --phases flag

**Example:**
```typescript
// Source: multi-integer-range patterns + existing parsePhaseRange
// Extends autopilot/src/orchestrator/gap-detector.ts

export function parsePhaseRanges(input: string): number[] {
  const segments = input.split(',').map(s => s.trim());
  const phases = new Set<number>(); // Deduplicate and auto-sort

  for (const segment of segments) {
    const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      // Range: "2-5"
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      if (start > end) {
        throw new Error(`Invalid range "${segment}": start (${start}) > end (${end})`);
      }
      for (let i = start; i <= end; i++) {
        phases.add(i);
      }
    } else if (/^\d+$/.test(segment)) {
      // Single: "3"
      phases.add(parseInt(segment, 10));
    } else {
      throw new Error(
        `Invalid phase specifier: "${segment}". Expected format: "N", "N-M", or comma-separated list (e.g., "1-3,5,7-9")`
      );
    }
  }

  return Array.from(phases).sort((a, b) => a - b);
}

// Usage: --phases "1-3,5,7-9" → [1, 2, 3, 5, 7, 8, 9]
```

### Anti-Patterns to Avoid

- **Postinstall scripts for messages:** Don't use postinstall to print setup instructions — output is hidden by default and triggers security warnings. Use runtime checks instead.
- **Synchronous preflight checks:** Don't run checks sequentially (slow). Run all in parallel and collect failures.
- **--dry-run for validation:** User explicitly rejected this. If config is wrong, real run fails fast enough.
- **Short flag aliases:** User wants long flags only. Don't add `-p`, `-v`, etc.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Checking if CLI tool exists | Custom PATH parsing + spawn checks | `command-exists` package | Handles Windows PATHEXT (.COM, .EXE, .BAT), Unix executable bit, and PATH parsing correctly. 1833+ packages depend on it. |
| Interactive prompts | Custom readline wrappers | `@inquirer/prompts` | Handles TTY detection, signal handling, input validation, and cursor management. Heavily battle-tested. |
| Parsing number ranges | Regex + manual expansion | Extend existing `parsePhaseRange` with comma support | Already have single range parser. Just add comma splitting and deduplication. |
| Verifying package contents | Manual file listing | `npm-packlist` or `npm pack --dry-run` | Uses same logic as npm publish. Accounts for .gitignore, .npmignore, files field, and always-included files. |
| Cross-platform command execution | spawn() with platform checks | Already using spawn() correctly in cli.ts | Existing implementation is correct. Don't "fix" what works. |

**Key insight:** CLI tools have many cross-platform edge cases (line endings, PATH handling, TTY detection). Use battle-tested libraries rather than implementing from scratch.

## Common Pitfalls

### Pitfall 1: Line Endings in Bin Scripts

**What goes wrong:** Publishing from Windows with Git autocrlf=true results in CRLF line endings in dist/cli/index.js. The shebang `#!/usr/bin/env node\r` causes "env: 'node\\r': No such file or directory" on Unix systems.

**Why it happens:** Git converts LF to CRLF on checkout when autocrlf=true. TypeScript preserves input line endings during compilation. npm pack bundles whatever is in dist/.

**How to avoid:**
1. Add `.gitattributes` in autopilot root:
   ```
   # Force LF for all text files
   * text=auto eol=lf

   # Bin scripts MUST use LF
   dist/cli/*.js text eol=lf
   dist/server/*.js text eol=lf
   ```
2. Verify before publish: `git ls-files --eol dist/cli/index.js` should show `i/lf w/lf`

**Warning signs:**
- `npm pack` on Windows followed by installation on Linux fails with "bad interpreter"
- File shows `^M` characters when opened in vi

**References:**
- [GitHub Issue #12371: bin scripts should always have Unix line endings](https://github.com/npm/npm/issues/12371)
- [.gitattributes Best Practices](https://rehansaeed.com/gitattributes-best-practices/)

### Pitfall 2: Dashboard Not Pre-built in Package

**What goes wrong:** If dashboard/dist/ isn't built before `npm pack`, the published package will fail to serve the dashboard UI. Users see 404 errors when visiting localhost:3847.

**Why it happens:** The `files` field in package.json includes `dashboard/dist/` but the build script isn't run before packing. CI builds may succeed (they run build) while local `npm publish` fails.

**How to avoid:**
1. Use npm `prepare` lifecycle script (runs on `npm publish` and `npm pack`):
   ```json
   {
     "scripts": {
       "build": "tsc && cd dashboard && npm install && npm run build",
       "prepare": "npm run build"
     }
   }
   ```
2. Add check in preflight: ensure dashboard/dist/index.html exists before CLI starts server

**Warning signs:**
- Dashboard shows 404 or "Cannot GET /" after installing from tarball
- `npm pack` produces <1MB tarball (missing dashboard assets)

**References:**
- [npm scripts documentation: prepare](https://docs.npmjs.com/cli/v8/using-npm/scripts/)

### Pitfall 3: Missing Postinstall Prerequisites Check

**What goes wrong:** Package installs successfully but fails at runtime with "claude: command not found" error. User doesn't know what went wrong or how to fix it.

**Why it happens:** npm can't install global dependencies (like @anthropic-ai/claude-code) as part of package installation. User must install separately but may not know this is required.

**How to avoid:**
1. **Don't use postinstall script** (output hidden, security warnings)
2. Instead: runtime preflight check on first CLI invocation
3. Store check result in ~/.gsd-autopilot/preflight-passed flag to avoid repeated checks
4. Clear error message with installation command:
   ```
   ❌ Error: Claude CLI not found
      Install it: npm install -g @anthropic-ai/claude-code
      Then run gsd-autopilot again
   ```

**Warning signs:**
- Users report "command not found" errors on first run
- GitHub issues asking "how do I install this?"

**References:**
- [npm ignore-scripts security](https://www.nodejs-security.com/blog/npm-ignore-scripts-best-practices-as-security-mitigation-for-malicious-packages)
- [Yarn lifecycle scripts: avoid postinstall](https://yarnpkg.com/advanced/lifecycle-scripts)

### Pitfall 4: Bloated Package Size

**What goes wrong:** Package exceeds 2MB target due to unnecessary files, source maps, or test fixtures bundled in dist/. Slows down `npx gsd-autopilot` first-run experience.

**Why it happens:** Default npm packaging includes everything in dist/ unless explicitly excluded. Source maps, .test.js files, and __tests__ directories add significant size.

**How to avoid:**
1. Use explicit `files` field in package.json (whitelist, not blacklist):
   ```json
   {
     "files": [
       "dist/**/*.js",
       "dist/**/*.d.ts",
       "dashboard/dist/",
       "!dist/**/*.test.*",
       "!dist/**/__tests__"
     ]
   }
   ```
2. Disable source maps for production build:
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "sourceMap": false,  // Only during development
       "declarationMap": false
     }
   }
   ```
3. Verify before publish:
   ```bash
   npm pack --dry-run  # Shows what will be included
   npx npm-packlist    # Lists all files
   ```

**Warning signs:**
- `npm pack` produces >2MB tarball
- Tarball contains node_modules/, .test.js, or .map files
- First `npx` invocation takes >10 seconds to download

**References:**
- [npm files field documentation](https://docs.npmjs.com/cli/v7/configuring-npm/package-json/)
- [Control what you publish inside npm packages](https://medium.com/trabe/control-what-you-publish-inside-your-npm-packages-e3ec911638b8)

### Pitfall 5: Missing Executable Permission

**What goes wrong:** After `npm install`, bin script exists but isn't executable. Running `gsd-autopilot` fails with "Permission denied" on Unix systems.

**Why it happens:** npm sets executable bit automatically for files in `bin` field, but only if they have the shebang line. If shebang is missing or malformed, npm skips chmod +x.

**How to avoid:**
1. Ensure shebang is FIRST line (no blank lines before):
   ```javascript
   #!/usr/bin/env node
   // CLI entry point
   ```
2. Build script preserves shebang:
   - TypeScript: shebang in source → preserved in output
   - Bundlers: configure to preserve shebang comments
3. Test locally with `npm link` before publishing

**Warning signs:**
- `./dist/cli/index.js` runs but `gsd-autopilot` doesn't after install
- `ls -la node_modules/.bin/gsd-autopilot` shows `-rw-` instead of `-rwx`

**References:**
- [Make a Node.js script globally executable with shebang](https://egghead.io/lessons/node-js-make-a-node-js-script-globally-executable-with-a-shebang-and-a-symbolic-link)
- [Node.js shebang best practices](https://alexewerlof.medium.com/node-shebang-e1d4b02f731d)

## Code Examples

Verified patterns from official sources:

### Commander v14 Help Text Customization

```typescript
// Source: Commander.js v14 documentation
import { Command } from 'commander';

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous GSD workflow orchestrator -- turns a PRD into a built project')
  .version('0.1.0')
  .addHelpText('after', `
Example:
  $ gsd-autopilot --prd ./idea.md
  $ gsd-autopilot --resume
  $ gsd-autopilot --prd ./spec.md --notify teams --webhook-url https://...

Dashboard:
  http://localhost:3847 (configurable with --port)
  `)
  .showHelpAfterError('(add --help for additional information)');
```

### Interactive Setup with @inquirer/prompts

```typescript
// Source: @inquirer/prompts README
import { input, select, confirm } from '@inquirer/prompts';

// Input with validation
const prdPath = await input({
  message: 'Path to PRD document:',
  default: './idea.md',
  validate: (value) => {
    if (!value) return 'Path is required';
    return true;
  },
});

// Single choice selection
const notify = await select({
  message: 'Notification channel:',
  choices: [
    { name: 'Console (default)', value: 'console' },
    { name: 'System notifications', value: 'system' },
    { name: 'Microsoft Teams', value: 'teams' },
    { name: 'Slack', value: 'slack' },
  ],
});

// Yes/no confirmation
const save = await confirm({
  message: 'Save configuration?',
  default: true,
});
```

### Cross-Platform Executable Detection

```typescript
// Source: command-exists package examples
import commandExists from 'command-exists';

// Async version (preferred)
try {
  await commandExists('claude');
  console.log('Claude CLI is installed');
} catch {
  console.error('Claude CLI not found');
}

// Synchronous version (for startup checks)
try {
  commandExists.sync('claude');
} catch {
  console.error('Claude CLI not found');
  process.exit(1);
}
```

### Package Contents Verification

```bash
# Source: npm documentation and npm-packlist
# Verify what will be published
npm pack --dry-run

# List all files that will be included
npx npm-packlist

# Create tarball and inspect
npm pack
tar -tzf gsd-autopilot-0.1.0.tgz

# Test installation from local tarball
npm install ./gsd-autopilot-0.1.0.tgz
```

### Testing CLI with Vitest

```typescript
// Source: Testing Commander.js applications (CircleCI)
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(require('node:child_process').execFile);

describe('gsd-autopilot CLI', () => {
  it('shows help when no arguments provided', async () => {
    const { stdout } = await execFile('node', ['./dist/cli/index.js', '--help']);
    expect(stdout).toContain('gsd-autopilot');
    expect(stdout).toContain('--prd');
    expect(stdout).toContain('--resume');
  });

  it('shows error for missing required arguments', async () => {
    try {
      await execFile('node', ['./dist/cli/index.js']);
    } catch (error) {
      expect(error.stderr).toContain('Either --prd <path> or --resume is required');
    }
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| inquirer (legacy) | @inquirer/prompts | 2023 | Modular, ESM-native, 90% smaller. Old version still works but deprecated. |
| Manual PATH checking | command-exists package | Always standard | Cross-platform compatibility without custom Windows/Unix logic. |
| .npmignore for exclusions | `files` field (whitelist) | npm 5+ (2017) | Explicit control, no surprises. files field takes precedence over .npmignore. |
| postinstall for messages | Runtime checks | 2020+ security concerns | Postinstall triggers security warnings, output hidden. Check at runtime instead. |
| npm link for testing | npm pack + local install | Always available | Mimics real publish process. npm link has symlink-related edge cases. |

**Deprecated/outdated:**
- **inquirer (non-scoped)**: Use `@inquirer/prompts` instead. Legacy version is CJS, heavier, and in maintenance mode.
- **Postinstall scripts for setup**: Security scanners flag these. Use runtime checks and clear error messages instead.
- **Short CLI flags (-p, -v)**: User explicitly wants long flags only. Don't add aliases.

## Open Questions

1. **Default --port value**
   - What we know: Current implementation uses string default '3847' in CLI, parsed to number
   - What's unclear: Whether to change default (unlikely conflict) or allow env var override
   - Recommendation: Keep 3847 (chosen in Phase 6), add to config file schema

2. **Dashboard pre-build vs. build-on-first-run**
   - What we know: Dashboard currently ~400KB built, adds to package size but ensures instant startup
   - What's unclear: Whether users prefer smaller package (requires build on first run) or faster startup
   - Recommendation: Pre-build and bundle (user priority is immediate functionality, 400KB acceptable)

3. **Preflight check persistence**
   - What we know: Preflight checks should run before orchestrator, catch issues early
   - What's unclear: Should checks run every time (slow but reliable) or cache results (fast but might miss changes)
   - Recommendation: Run every time (orchestrator startup is infrequent, <1s overhead acceptable)

## Sources

### Primary (HIGH confidence)

- Commander.js GitHub repository - v14 features, help customization, error handling
  - https://github.com/tj/commander.js/
- @inquirer/prompts npm package and GitHub - Modern inquirer rewrite, ESM support
  - https://www.npmjs.com/package/@inquirer/prompts
  - https://github.com/SBoudrias/Inquirer.js
- command-exists npm package - Cross-platform executable detection
  - https://www.npmjs.com/package/command-exists
  - https://github.com/mathisonian/command-exists
- CLI Guidelines (clig.dev) - Error messages, help text, UX best practices
  - https://clig.dev/
- Node.js CLI Apps Best Practices (GitHub) - Error handling, distribution, testing
  - https://github.com/lirantal/nodejs-cli-apps-best-practices
- npm documentation - package.json fields, lifecycle scripts, publishing
  - https://docs.npmjs.com/cli/v7/configuring-npm/package-json/
- GitHub Issues:
  - npm #12371: bin scripts line endings
  - npm/npm #4607: CRLF breaks Unix usage
  - nodejs/node #43860: Windows npm installs with CRLF

### Secondary (MEDIUM confidence)

- npm pack testing strategies (verified with official docs)
  - https://jasonwatmore.com/npm-pack-for-local-package-dependency-testing
- .gitattributes patterns for LF enforcement (verified with Git docs)
  - https://www.aleksandrhovhannisyan.com/blog/crlf-vs-lf-normalizing-line-endings-in-git/
- Commander.js testing approaches (verified with CircleCI)
  - https://circleci.com/blog/testing-command-line-applications/

### Tertiary (LOW confidence - needs validation)

- Package size optimization techniques (general advice, not CLI-specific)
  - https://www.frontendtools.tech/blog/reduce-javascript-bundle-size-2025
- npm postinstall alternatives (community recommendations)
  - https://medium.com/trabe/control-what-you-publish-inside-your-npm-packages-e3ec911638b8

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages verified via npm registry, GitHub stars/dependents, official docs
- Architecture: HIGH - Patterns drawn from official docs (Commander, Inquirer), CLI guidelines, and existing codebase
- Pitfalls: HIGH - All backed by GitHub issues, official documentation, or community-verified solutions

**Research date:** 2026-02-18
**Valid until:** 60 days (stable ecosystem — Commander, npm packaging practices change slowly)

**Notes:**
- Existing implementation already solid: Commander v14, config precedence chain, verbosity levels, shutdown manager
- This phase is polish, not rebuild: add interactive wizard, preflight checks, improve error messages, package correctly
- Key risk areas: line endings (Windows), package contents (missing dashboard), preflight checks (claude CLI detection)
