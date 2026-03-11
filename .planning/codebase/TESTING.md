# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

**Runner:**
- Node.js built-in test module (`node:test`)
- Version: Node.js 16.7.0+ (from package.json engines)
- Config: `scripts/run-tests.cjs` (custom test runner)

**Assertion Library:**
- `node:assert` with `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.ok()`

**Test Script Locations:**
- Test files: `tests/` directory
- Helpers: `tests/helpers.cjs`
- Configuration/execution: `scripts/run-tests.cjs`

**Run Commands:**
```bash
npm test                  # Run all tests
npm run test:coverage    # Run with coverage (c8 reporter, 70% lines threshold)
```

## Test Organization

**Location:** Co-located in `/tests` directory separate from source
- Source: `/get-shit-done/bin/lib/*.cjs`
- Tests: `/tests/*.test.cjs`

**Naming Convention:**
- One test file per module: `core.cjs` → `core.test.cjs`, `phase.cjs` → `phase.test.cjs`
- Descriptive test names using `test()` function with human-readable strings
- Example: `test('returns defaults when config.json is missing', () => { ... })`

**File Structure:**
```
tests/
├── helpers.cjs                    # Shared test utilities
├── agent-frontmatter.test.cjs     # Tests for agent frontmatter module
├── commands.test.cjs              # Tests for commands module
├── config.test.cjs                # Tests for config module
├── core.test.cjs                  # Tests for core module
├── phase.test.cjs                 # Tests for phase module
├── state.test.cjs                 # Tests for state module
├── verify.test.cjs                # Tests for verify module
└── [more test files...]
```

## Test Structure

**Suite Organization:**
```javascript
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('feature group name', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('test name describes expected behavior', () => {
    // Arrange
    const input = createTestData();

    // Act
    const result = functionUnderTest(input);

    // Assert
    assert.strictEqual(result.property, expectedValue);
  });
});
```

**Patterns Observed:**

1. **Describe blocks:** Group related tests by feature/function
   - Example from `core.test.cjs`: `describe('loadConfig', () => { ... })`

2. **Before/After hooks:**
   - `beforeEach`: Set up temp directories, initialize test state
   - `afterEach`: Cleanup temp files, restore working directory
   - Prevents test pollution across test runs

3. **Assertion style:** Direct assertions with `assert.strictEqual()` and `assert.deepStrictEqual()`
   - NOT using fluent assertion libraries (chai, jest)
   - Clear error messages via second parameter when assertion fails

## Test Patterns

### Pattern 1: File I/O Setup

Used extensively for testing file operations. Example from `phase.test.cjs`:
```javascript
beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

test('lists phase directories sorted numerically', () => {
  // Create out-of-order directories
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '10-final'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

  const result = runGsdTools('phases list', tmpDir);
  assert.ok(result.success, `Command failed: ${result.error}`);

  const output = JSON.parse(result.output);
  assert.deepStrictEqual(output.directories, ['01-foundation', '02-api', '10-final']);
});
```

### Pattern 2: Git Repository Setup

From `helpers.cjs`:
```javascript
function createTempGitProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });

  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });

  fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n\nTest project.\n');
  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'pipe' });

  return tmpDir;
}
```

### Pattern 3: Command Execution Testing

Tests invoke actual CLI tools via helper function. From `commands.test.cjs`:
```javascript
const result = runGsdTools('history-digest', tmpDir);
assert.ok(result.success, `Command failed: ${result.error}`);

const digest = JSON.parse(result.output);
assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');
```

The `runGsdTools()` helper:
```javascript
function runGsdTools(args, cwd = process.cwd()) {
  try {
    let result;
    if (Array.isArray(args)) {
      result = execFileSync(process.execPath, [TOOLS_PATH, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      result = execSync(`node "${TOOLS_PATH}" ${args}`, { cwd, encoding: 'utf-8' });
    }
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}
```

### Pattern 4: Options & Configuration Testing

From `core.test.cjs`:
```javascript
function writeConfig(obj) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify(obj, null, 2)
  );
}

test('reads model_profile from config.json', () => {
  writeConfig({ model_profile: 'quality' });
  const config = loadConfig(tmpDir);
  assert.strictEqual(config.model_profile, 'quality');
});
```

### Pattern 5: Regression Tests

Named with reference to bugs. From `core.test.cjs`:
```javascript
// Bug: loadConfig previously omitted model_overrides from return value
test('returns model_overrides when present (REG-01)', () => {
  writeConfig({ model_overrides: { 'gsd-executor': 'opus' } });
  const config = loadConfig(tmpDir);
  assert.deepStrictEqual(config.model_overrides, { 'gsd-executor': 'opus' });
});
```

## Mocking

**Framework:** No dedicated mocking library detected

**Approach:** Dependency injection via function parameters and test utilities
- Example: Tests create real temp directories instead of mocking filesystem
- `runGsdTools()` spawns actual Node.js process instead of mocking CLI

**What to Mock:**
- Environment variables: Set via `process.env.KEY = value` before test
- Command execution: Use `execFileSync` with test-controlled arguments and cwd
- External APIs: From `commands.test.cjs`, websearch tests conditionally disable when API key absent

**What NOT to Mock:**
- Filesystem operations: Tests use real temp directories
- Module exports: Tests require actual modules and call real functions
- Data structures: Tests assert on real output objects

## Fixtures and Factories

**Test Data Creation:**

Helper functions in `tests/helpers.cjs`:
```javascript
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function createTempGitProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-'));
  // ... git initialization
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
```

**Local fixture creation:** Tests often create specific structures inline
```javascript
test('nested frontmatter fields extracted correctly', () => {
  const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
  fs.mkdirSync(phaseDir, { recursive: true });

  const summaryContent = `---
phase: "01"
name: "Foundation Setup"
---
# Content`;

  fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), summaryContent);
  // ... assertion
});
```

## Coverage

**Requirements:** 70% line coverage threshold
- Config: `--check-coverage --lines 70` in `npm run test:coverage`
- Tool: `c8` coverage reporter

**View Coverage:**
```bash
npm run test:coverage
```

**Coverage scope:**
- Includes: `get-shit-done/bin/lib/*.cjs`
- Excludes: `tests/**` directory itself

## Test Types

### Unit Tests
**Scope:** Individual functions in isolation
**Approach:** Call function with controlled inputs, assert outputs
**Location:** Tests in `*.test.cjs` files calling module functions

**Example from `commands.test.cjs` — slug generation:**
```javascript
test('converts normal text to slug', () => {
  const result = runGsdTools('generate-slug "Hello World"', tmpDir);
  assert.ok(result.success);
  const output = JSON.parse(result.output);
  assert.strictEqual(output.slug, 'hello-world');
});
```

### Integration Tests
**Scope:** Multiple modules working together, file I/O, git operations
**Approach:** Create realistic test scenarios with real filesystem and git repos
**Location:** Most tests in codebase are integration level

**Example from `commands.test.cjs` — commit with git:**
```javascript
test('creates real commit with correct hash', () => {
  const gitProject = createTempGitProject();
  const phaseDir = path.join(gitProject, '.planning', 'phases', '01-foundation');
  fs.mkdirSync(phaseDir, { recursive: true });

  fs.writeFileSync(path.join(phaseDir, 'PLAN.md'), '# Plan');

  const result = runGsdTools(['commit', 'Test commit', '.planning'], gitProject);
  assert.ok(result.success);

  const output = JSON.parse(result.output);
  assert.ok(output.hash, 'Should have commit hash');
});
```

### E2E Tests
**Framework:** Not used
**Rationale:** Integration tests sufficient given CLI tool nature

## Common Patterns

### Async Testing

From `commands.test.cjs` — websearch with async/await:
```javascript
test('returns available=false when BRAVE_API_KEY is unset', async () => {
  delete process.env.BRAVE_API_KEY;

  const result = runGsdTools('websearch "test query"', tmpDir);
  assert.ok(result.success);

  const output = JSON.parse(result.output);
  assert.strictEqual(output.available, false);
});
```

**Pattern:** Test function itself can be `async`, but most tests remain synchronous since CLI invocation is sync-wrapped.

### Error Testing

From `commands.test.cjs`:
```javascript
test('fails when no agent-type provided', () => {
  const result = runGsdTools('resolve-model', tmpDir);
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('agent-type required'));
});
```

**Pattern:** Test both `success: false` and error message presence

### Boundary Conditions

From `phase.test.cjs` — decimal phase sorting:
```javascript
test('handles decimal phases in sort order', () => {
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.2-patch'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-ui'), { recursive: true });

  const result = runGsdTools('phases list', tmpDir);
  assert.deepStrictEqual(
    output.directories,
    ['02-api', '02.1-hotfix', '02.2-patch', '03-ui'],
    'decimal phases should sort correctly between whole numbers'
  );
});
```

### Empty State Testing

From `commands.test.cjs`:
```javascript
test('empty phases directory returns valid schema', () => {
  const result = runGsdTools('history-digest', tmpDir);
  assert.ok(result.success);

  const digest = JSON.parse(result.output);
  assert.deepStrictEqual(digest.phases, {});
  assert.deepStrictEqual(digest.decisions, []);
});
```

## Test Coverage Analysis

**Well-tested:**
- Command parsing and validation (all cmd* functions)
- File I/O operations and path handling
- Config loading and merging logic
- Phase numbering and sorting
- Frontmatter extraction

**Notable coverage:**
- 16 test files with 200+ tests total (estimated from file listing)
- Git integration tests for commit operations
- Cross-platform path handling

**Execution Model:**
- Tests run sequentially via Node.js test runner
- Each test isolated with temp directory cleanup
- Windows-compatible via Unix-style path handling and explicit encoding

---

*Testing analysis: 2026-03-11*
