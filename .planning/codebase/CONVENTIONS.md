# Coding Conventions

**Analysis Date:** 2026-03-11

## Language & File Format

**Language:** JavaScript (CommonJS)

**File Extensions:**
- `.cjs` - CommonJS modules (main codebase in `get-shit-done/bin/lib/`)
- `.test.cjs` - Test files in `tests/`
- `.js` - Build scripts and utilities

**Rationale:** CommonJS chosen for Node.js compatibility and CLI tool requirements. Test files use `.cjs` to match module format.

## Naming Patterns

**Files:**
- Command modules: `<domain>.cjs` (e.g., `commands.cjs`, `phase.cjs`, `verify.cjs`)
- Test files: `<module>.test.cjs` (matches the module being tested)
- Pattern: Descriptive domain/feature names in kebab-case or full words

**Functions:**
- Command handlers: `cmd<Feature>` prefix (e.g., `cmdPhasesList`, `cmdConfigSet`, `cmdGenerateSlug`)
- Internal utilities: lowercase `camelCase` (e.g., `safeReadFile`, `normalizePhaseName`, `escapeRegex`)
- Helper functions: `<action><Subject>` pattern (e.g., `extractFrontmatter`, `loadConfig`, `writeStateMd`)
- Test functions: `test('human readable test name', () => { ... })`

**Variables:**
- Const for immutable values and objects: `const result = { ... }`
- Snake_case for JSON keys in output objects (e.g., `model_profile`, `commit_docs`, `phase_dir`)
- camelCase for internal runtime variables
- Single letter iterator variables acceptable in loops: `for (const file of files)`

**Constants:**
- UPPERCASE_SNAKE_CASE for truly constant values: `const MODEL_PROFILES = { ... }`
- Object keys in output: snake_case (matches JSON/CLI output conventions)

## Code Style

**Formatting:**
- No linter or formatter configured (not detected)
- Manual style applied consistently across codebase
- 2-space indentation (observed in all files)
- Line length: No strict limit observed; pragmatic approach

**Line Wrapping:**
- Long imports broken across multiple lines with proper indentation
- Example from `commands.cjs`:
  ```javascript
  const { safeReadFile, loadConfig, isGitIgnored, execGit, normalizePhaseName,
          comparePhaseNum, getArchivedPhaseDirs, generateSlugInternal, getMilestoneInfo,
          resolveModelInternal, MODEL_PROFILES, toPosixPath, output, error, findPhaseInternal }
          = require('./core.cjs');
  ```

**Semicolons:** Consistently used throughout

**Quotes:** Double quotes for strings (JavaScript standard)

## Import Organization

**Order by source type:**
1. Built-in Node.js modules (`fs`, `path`, `child_process`, `os`)
2. Local module imports from `./core.cjs`, `./frontmatter.cjs`, etc.

**Example from `phase.cjs`:**
```javascript
const fs = require('fs');
const path = require('path');
const { ... } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { writeStateMd } = require('./state.cjs');
```

**Destructuring patterns:**
- Always destructure required exports explicitly: `const { safeReadFile, loadConfig } = require('./core.cjs')`
- Improves readability and makes dependencies clear
- Avoid `const lib = require('./lib')` followed by `lib.func()` — prefer direct destructuring

## Error Handling

**Pattern: Early return with error() call**

Error function from `core.cjs`:
```javascript
function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}
```

**Convention:**
- Parameter validation at function entry: `if (!param) { error('param required'); }`
- Fail fast with descriptive messages
- Example from `cmdConfigSet`:
  ```javascript
  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }
  ```

**Try-catch pattern:**
- Used for file I/O and risky operations
- Some catches are silent (`catch (err) { }`) when graceful degradation is acceptable
- Example graceful fallback from `config.cjs`:
  ```javascript
  try {
    if (fs.existsSync(globalDefaultsPath)) {
      userDefaults = JSON.parse(fs.readFileSync(globalDefaultsPath, 'utf-8'));
    }
  } catch (err) {
    // Ignore malformed global defaults, fall back to hardcoded
  }
  ```

## Output Pattern

**Central output function** (`core.cjs`):
```javascript
function output(result, raw, rawValue) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    const json = JSON.stringify(result, null, 2);
    if (json.length > 50000) {
      const tmpPath = path.join(require('os').tmpdir(), `gsd-${Date.now()}.json`);
      fs.writeFileSync(tmpPath, json, 'utf-8');
      process.stdout.write('@file:' + tmpPath);
    } else {
      process.stdout.write(json);
    }
  }
  process.exit(0);
}
```

**Convention:**
- Every command returns via `output(resultObject, raw, rawValue)`
- Always provide both JSON output (`resultObject`) and raw text (`rawValue`)
- Return structure: consistent shape for related commands
  - List commands: `{ count, items[] }`
  - Boolean checks: `{ success, message }`
  - Lookups: `{ found, value }`

## Comments

**Style:**
- Block comments for module/function purpose at the top
- Example from `core.cjs`:
  ```javascript
  /**
   * Core — Shared utilities, constants, and internal helpers
   */
  ```

**Section markers:**
- Horizontal dividers used to organize related functions:
  ```javascript
  // ─── Path helpers ────────────────────────────────────────────────────────────

  // ─── Model Profile Table ─────────────────────────────────────────────────────
  ```

**When to comment:**
- Complex regex or parsing logic
- Non-obvious business rules (e.g., depth → granularity migration in `loadConfig`)
- Bug references: `// Bug: loadConfig previously omitted model_overrides`

**When NOT to comment:**
- Self-documenting code (good function names eliminate need)
- Temporary workarounds marked with `// TODO` or `// FIXME`

## Function Design

**Size:** Functions typically 20-100 lines; longer functions OK if they represent complete command workflows

**Parameters:**
- Primary parameters always first: `cwd`, then business parameters, then optional params
- Signature pattern: `cmd<Name>(cwd, param1, param2, raw)`
- `raw` flag always final parameter for CLI output mode control

**Return Values:**
- Exit via `output()` or `error()` (never throw in CLI commands)
- Internal utilities return values; command handlers exit with `output()`
- Graceful failures: return null/empty structures, not error objects

**Example from `phase.cjs`:**
```javascript
function cmdPhasesList(cwd, options, raw) {
  const phasesDir = path.join(cwd, '.planning', 'phases');
  const { type, phase, includeArchived } = options;

  if (!fs.existsSync(phasesDir)) {
    if (type) {
      output({ files: [], count: 0 }, raw, '');
    } else {
      output({ directories: [], count: 0 }, raw, '');
    }
    return;
  }
  // ... implementation
}
```

## Module Design

**Exports:**
- Each module exports only its public functions as explicit named exports
- Example from `commands.cjs`:
  ```javascript
  module.exports = {
    cmdGenerateSlug,
    cmdCurrentTimestamp,
    cmdListTodos,
    cmdVerifyPathExists,
    // ... more functions
  };
  ```

**No barrel files:** Each module self-contained, imported directly where needed

**Cross-module imports:**
- `core.cjs` imported by nearly all modules (provides `output`, `error`, helpers)
- Specialized modules import only what they need: `phase.cjs` imports `frontmatter.cjs` for frontmatter extraction
- Minimize circular dependencies (none observed)

## Async & Promises

**Pattern:** Mostly synchronous (blocking) operations

**Notable exception:**
- `cmdWebsearch` in `commands.cjs` is `async function`
- Uses `fetch()` for HTTP requests
- Test file shows callback handling with `async/await` in test functions

## JSON & Configuration

**Config files:**
- Located: `.planning/config.json`
- Format: Pretty-printed JSON (2-space indentation via `JSON.stringify(..., null, 2)`)
- Keys: snake_case (consistency with CLI conventions)
- Example structure:
  ```json
  {
    "model_profile": "balanced",
    "commit_docs": true,
    "workflow": {
      "research": true,
      "plan_check": true
    }
  }
  ```

**Frontmatter:**
- YAML frontmatter in Markdown files (parsed by `extractFrontmatter` from `frontmatter.cjs`)
- Fields: snake_case in YAML

## Platform Considerations

**Cross-platform paths:**
- `toPosixPath()` used to normalize paths: converts backslashes to forward slashes
- Applied to all user-facing relative paths and output
- Example from `commands.cjs`: `output({ path: toPosixPath(path.relative(cwd, filePath)) }, ...)`

**Stdio handling:**
- Consistent use of `stdio: 'pipe'` in child process calls
- Explicit encoding: `encoding: 'utf-8'` always specified
- Error capture via `stderr` in addition to exception handling

---

*Convention analysis: 2026-03-11*
