# Phase 3: Failure Handling and Git Conflict Resolution - Research

**Researched:** 2026-03-12
**Domain:** Process lifecycle management, git merge conflict resolution, signal handling
**Confidence:** HIGH

## Summary

Phase 3 extends the existing parallel execution engine (Phase 2) with robust failure handling, merge conflict resolution, and run-summary reporting. The core integration points are well-defined: `ShutdownManager` for signal handling, `WorkerPool.abortAll()` for fail-fast, `DependencyScheduler` for dependent-phase skipping, `mergeWorktree()` for conflict resolution, and `serializedMerge()` for context chaining.

The primary technical challenges are: (1) cross-platform child process termination (Windows has no SIGTERM/SIGKILL -- `taskkill /T /F` is required), (2) per-file merge conflict resolution using git's native `checkout --ours/--theirs` commands rather than hand-rolling conflict marker parsers, and (3) wiring `--continue` mode into the scheduler loop which currently only has `markComplete()` but needs `markFailed()` and `markSkipped()`.

**Primary recommendation:** Extend existing classes in-place rather than creating new abstractions. The architecture from Phase 2 was designed with these extension points. Use git's native conflict resolution commands (`git checkout --theirs`, `git add`, `git merge --continue`) rather than parsing conflict markers directly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Fail-fast (default):** When a phase fails, abort all other workers immediately via `WorkerPool.abortAll()`. No waiting for current steps to finish.
- **`--continue` mode:** Independent phases keep running after a failure. Dependent phases are automatically skipped with a clear message (not queued).
- **`--continue` is CLI-only** -- not persisted to config.json. Consistent with `--parallel` pattern from Phase 2.
- **Summary table at run end:** All phases listed with status (passed/failed/skipped/running). Failed phases show error reason. Similar to test runner output.
- **Worktree cleanup on shutdown:** Successfully completed worktrees are cleaned up. Failed or in-progress worktrees are preserved for debugging (FAIL-04).
- **Child process termination:** SIGTERM first, wait a short timeout (e.g., 5s), then SIGKILL any survivors. Gives Claude Code processes a chance to clean up.
- **Double Ctrl+C = force exit:** First SIGINT starts graceful shutdown. Second SIGINT within a few seconds forces immediate `process.exit(1)` with no cleanup.
- **Exit code:** Non-zero (1) when shutdown was triggered by failure or signal. CI-friendly.
- **Auto-resolution strategy:** Claude's discretion on what conflicts can be auto-resolved vs flagged for manual intervention (based on what git merge supports natively).
- **Resolution report:** Structured markdown file per phase at `.planning/phases/XX-name/merge-report.md` containing: conflicting files, resolution strategy used, and outcome.
- **Merge failure in --continue mode:** Failed-merge phase is marked failed. Other completed phases still attempt their merges (serialized). One bad merge doesn't block unrelated phase merges.
- **In-memory accumulator:** Orchestrator maintains a list of resolution reports during the run. Prior reports passed as context when attempting new merges. Also written to disk.
- **Cross-run continuity:** On `--resume`, load existing `merge-report.md` files from disk and seed the in-memory accumulator.
- **Context content:** Files that conflicted + strategy used (e.g., "took phase 3 changes for src/worker/"). Enough to pattern-match without being overwhelming.
- **Summary visibility:** Summary table includes a "Merge" column showing clean/resolved/conflict for each phase.

### Claude's Discretion
- Auto-resolution strategy (which conflict types to attempt vs flag)
- Resolution report internal structure and markdown format
- SIGTERM timeout duration before SIGKILL
- Double Ctrl+C detection window
- How skipped-dependent phases are represented in DependencyScheduler

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FAIL-01 | Default fail-fast behavior stops all workers when one phase fails | Extend orchestrator loop at lines 420-428 to call `workerPool.abortAll()` and break. ShutdownManager exit code changes to 1. |
| FAIL-02 | `--continue` flag lets independent phases finish even when one fails | Add `markFailed()` and `markSkipped()` to DependencyScheduler. Orchestrator loop checks `continueOnFailure` flag instead of calling `requestShutdown()`. |
| FAIL-03 | Graceful shutdown on SIGINT/SIGTERM cleans up all child processes and worktrees | Extend ShutdownManager with double-SIGINT detection, SIGTERM-then-kill escalation, and worktree cleanup handlers registered per worker. |
| FAIL-04 | Failed phase worktrees are preserved for debugging (not auto-cleaned) | Conditional cleanup in WorkerPool.executeWorker -- only clean on success. Already partially implemented (cleanup only after merge). |
| GIT-03 | Merge conflicts are auto-resolved where possible | Extend `mergeWorktree()` with conflict detection (`git diff --name-only --diff-filter=U`), per-file resolution via `git checkout --theirs`, and `git merge --continue`. |
| GIT-04 | A merge conflict resolution report is generated documenting what was fixed | Write structured markdown to `.planning/phases/XX-name/merge-report.md` after each merge attempt. |
| GIT-05 | Resolution reports are available as context for reconciling future merge conflicts | In-memory accumulator in orchestrator passed through serializedMerge chain. Disk persistence for `--resume` continuity. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js child_process | Built-in | Git commands via `execFile` | Already used throughout -- `execFile` pattern established |
| vitest | ^4.0.0 | Test framework | Already configured in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tree-kill | ^1.2.2 | Cross-platform process tree termination | Windows compatibility for killing Claude Code child processes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tree-kill | Manual `taskkill` on Windows / `kill -9` on Unix | tree-kill handles platform detection; manual approach avoids a dependency but duplicates logic |
| git-resolve-conflict npm | Native git commands | Native git commands (`checkout --theirs/--ours`, `merge --continue`) are sufficient and avoid a dependency |

**Installation:**
```bash
npm install tree-kill
npm install -D @types/tree-kill  # if types exist, otherwise hand-roll .d.ts
```

**Note:** `tree-kill` is a small, well-maintained package (800K weekly downloads). The alternative is platform-specific `if (process.platform === 'win32') taskkill` code which is what tree-kill does internally. Given the project already uses `execFile` (not `exec`) for Windows safety, either approach works. Claude's discretion on whether to add the dependency or hand-roll ~15 lines of platform detection.

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
├── orchestrator/
│   ├── shutdown.ts         # Extended: double-SIGINT, force kill, exit code
│   ├── index.ts            # Extended: --continue logic, summary table, merge context
│   └── summary.ts          # NEW: run summary table renderer
├── worker/
│   ├── index.ts            # Extended: conditional cleanup, merge report return
│   ├── git-worktree.ts     # Extended: conflict resolution, merge report generation
│   ├── merge-resolver.ts   # NEW: auto-resolution logic + report generation
│   └── types.ts            # Extended: WorkerResult with mergeReport field
├── scheduler/
│   └── index.ts            # Extended: markFailed(), markSkipped(), getDependents()
└── cli/
    └── index.ts            # Extended: --continue flag
```

### Pattern 1: Fail-Fast via Orchestrator Loop Extension
**What:** When a phase fails, the orchestrator calls `workerPool.abortAll()` and breaks the scheduler loop. Exit code is 1.
**When to use:** Default behavior (no `--continue` flag).
**Example:**
```typescript
// In orchestrator loop (lines 420-428 of orchestrator/index.ts)
if (!result.success) {
  this.logger.log('error', 'orchestrator',
    `Phase ${result.phaseNumber} failed: ${result.error}`);

  if (this.continueOnFailure) {
    // Mark failed + skip dependents
    const skipped = scheduler.markFailed(result.phaseNumber);
    for (const s of skipped) {
      this.logger.log('warn', 'orchestrator',
        `Phase ${s.number} skipped (depends on failed phase ${result.phaseNumber})`);
    }
    failedPhases.push(result);
  } else {
    // Fail-fast: abort all and exit
    workerPool.abortAll();
    this.requestShutdown();
  }
}
```

### Pattern 2: DependencyScheduler Extension for Failed/Skipped
**What:** Add `markFailed()` that marks a phase failed and transitively marks all dependents as skipped.
**When to use:** `--continue` mode when a phase fails.
**Example:**
```typescript
// In DependencyScheduler
markFailed(phaseNumber: number): SchedulerPhase[] {
  this.failed.add(phaseNumber);
  this.inProgress.delete(phaseNumber);
  // Transitively skip all phases that depend on this one
  const skipped: SchedulerPhase[] = [];
  const toCheck = [phaseNumber];
  while (toCheck.length > 0) {
    const current = toCheck.shift()!;
    for (const phase of this.phases.values()) {
      if (phase.dependencies.includes(current) && !this.skipped.has(phase.number)) {
        this.skipped.add(phase.number);
        skipped.push(phase);
        toCheck.push(phase.number); // Transitive
      }
    }
  }
  return skipped;
}
```

### Pattern 3: Merge Conflict Resolution Pipeline
**What:** After a failed `git merge`, detect conflicting files, attempt per-file resolution using `--theirs` (prefer phase branch changes), generate a report, and complete the merge.
**When to use:** When `mergeWorktree()` returns false (conflict detected).
**Example:**
```typescript
// In merge-resolver.ts
async function resolveConflicts(
  projectDir: string,
  phaseNumber: number,
  priorReports: MergeReport[],
): Promise<MergeReport> {
  // 1. Get list of conflicting files
  const conflictFiles = await execGit(projectDir,
    ['diff', '--name-only', '--diff-filter=U']);
  const files = conflictFiles.split('\n').filter(Boolean);

  // 2. Categorize and resolve each file
  const resolutions: FileResolution[] = [];
  for (const file of files) {
    // Default strategy: take phase branch changes (--theirs)
    // because the phase branch contains the new work
    await execGit(projectDir, ['checkout', '--theirs', '--', file]);
    await execGit(projectDir, ['add', file]);
    resolutions.push({ file, strategy: 'theirs', outcome: 'resolved' });
  }

  // 3. Complete the merge
  await execGit(projectDir, ['merge', '--continue', '--no-edit']);

  // 4. Generate report
  return { phaseNumber, files: resolutions, timestamp: new Date().toISOString() };
}
```

### Pattern 4: Double-SIGINT Detection
**What:** First SIGINT starts graceful shutdown. Second SIGINT within a window forces immediate exit.
**When to use:** ShutdownManager signal handling.
**Example:**
```typescript
// In ShutdownManager.install()
let firstSignalTime: number | null = null;
const FORCE_EXIT_WINDOW_MS = 3000; // 3 seconds

const handler = async () => {
  if (this._shuttingDown) {
    // Already shutting down -- check for force exit
    if (firstSignalTime && Date.now() - firstSignalTime < FORCE_EXIT_WINDOW_MS) {
      exitFn(1); // Immediate force exit
      return;
    }
    return;
  }

  this._shuttingDown = true;
  firstSignalTime = Date.now();
  onShutdownRequested();

  // Run cleanup handlers...
  for (const handler of [...this.handlers].reverse()) {
    try { await handler(); } catch { /* best-effort */ }
  }

  exitFn(1); // Non-zero exit on signal-triggered shutdown
};
```

### Anti-Patterns to Avoid
- **Parsing conflict markers directly:** Don't regex-parse `<<<<<<<`/`=======`/`>>>>>>>` markers. Use git's native `checkout --ours/--theirs` and `merge --continue` commands instead. Git handles edge cases (binary files, encoding, nested markers) that a regex parser cannot.
- **Killing processes with `process.kill(pid, 'SIGKILL')` on Windows:** This does not work on Windows. Use `taskkill /T /F /PID` or `tree-kill` package for cross-platform process tree termination.
- **Blocking cleanup on slow handlers:** ShutdownManager cleanup handlers should have individual timeouts. A hung handler should not prevent other cleanup from running.
- **Modifying DependencyScheduler.isComplete() without accounting for failed/skipped:** The loop termination condition `scheduler.isComplete()` currently checks `completed.size === phases.size`. It must also count failed and skipped phases.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conflict marker parsing | Custom `<<<<<<<` parser | `git checkout --theirs/--ours` + `git merge --continue` | Binary files, encoding edge cases, nested markers |
| Cross-platform process kill | Platform detection + manual kill | `tree-kill` npm or `execFile('taskkill', ...)` on Windows | Windows has no POSIX signals; process groups differ |
| Summary table formatting | Custom column alignment | Simple template with `padEnd()` | Keep it minimal -- test-runner-style output is a few lines of code |

**Key insight:** Git already has robust conflict resolution built in. The auto-resolution strategy should use git's native per-file resolution commands rather than trying to parse and reconstruct conflicted files.

## Common Pitfalls

### Pitfall 1: Windows Signal Handling
**What goes wrong:** `process.kill(pid, 'SIGTERM')` does nothing on Windows. Child processes are not terminated.
**Why it happens:** Windows has no POSIX signal model. Node.js `process.kill()` on Windows only works for `SIGINT` (which terminates the process unconditionally) and ignores `SIGTERM`.
**How to avoid:** Use `taskkill /T /F /PID <pid>` on Windows via `execFile`. The `/T` flag kills the process tree, `/F` forces termination. Or use `tree-kill` which handles this.
**Warning signs:** Tests pass on macOS/Linux but Claude Code processes become orphaned on Windows.

### Pitfall 2: git merge --continue Requires Staged Files
**What goes wrong:** Running `git merge --continue` without first staging resolved files fails with "you need to resolve all merge conflicts first."
**Why it happens:** Git requires all conflicting files to be resolved (via `checkout --ours/--theirs` or manual edit) AND staged (`git add`) before `--continue` works.
**How to avoid:** Always run `git add <file>` after each per-file resolution, then `git merge --continue --no-edit`.
**Warning signs:** Resolution appears to work but the merge commit is never created.

### Pitfall 3: Merge Abort State Left Behind
**What goes wrong:** If auto-resolution fails partway through, the repo is left in a "merging" state (`.git/MERGE_HEAD` exists). Subsequent merges fail.
**Why it happens:** `git merge` modifies working tree state. If resolution is abandoned, `git merge --abort` must be called to clean up.
**How to avoid:** Wrap resolution in try/catch. On failure, always call `git merge --abort` before returning/throwing.
**Warning signs:** "You have not concluded your merge" errors on next merge attempt.

### Pitfall 4: DependencyScheduler Loop Termination with Failed Phases
**What goes wrong:** In `--continue` mode, `scheduler.isComplete()` never returns true because failed phases aren't counted as "completed."
**Why it happens:** `isComplete()` checks `completed.size === phases.size` but failed/skipped phases are not in the `completed` set.
**How to avoid:** Update `isComplete()` to check `completed.size + failed.size + skipped.size === phases.size`.
**Warning signs:** Orchestrator loop hangs after all runnable phases finish but some failed.

### Pitfall 5: Race Condition in abortAll() During Merge
**What goes wrong:** `abortAll()` aborts ClaudeService commands, but a phase might be in the `serializedMerge()` step (post-Claude, in git operations). Aborting ClaudeService does nothing here.
**Why it happens:** The merge happens after `runPhaseFn()` completes. `abortCurrent()` on ClaudeService has no effect on git operations.
**How to avoid:** Add an `aborted` flag checked before merge and cleanup steps in `executeWorker()`. When `abortAll()` is called, set the flag on each handle.
**Warning signs:** Fail-fast mode still waits for merges to complete before shutting down.

### Pitfall 6: Worktree Cleanup After Force Kill
**What goes wrong:** After `SIGKILL` or force exit, worktrees are left on disk with lock files, preventing next run from creating fresh ones.
**Why it happens:** `cleanupWorktree()` never ran because the process was killed.
**How to avoid:** `ensureCleanWorktree()` already handles this (it force-removes stale worktrees). This is called at the start of each dispatch. No additional work needed.
**Warning signs:** "fatal: worktree already exists" errors on restart.

## Code Examples

### Detecting Conflicting Files After Failed Merge
```typescript
// After mergeWorktree() returns false, the repo is in "merging" state
async function getConflictingFiles(projectDir: string): Promise<string[]> {
  const output = await execGit(projectDir, ['diff', '--name-only', '--diff-filter=U']);
  return output.split('\n').filter(Boolean);
}
```

### Per-File Resolution with Theirs Strategy
```typescript
// Prefer phase branch changes (theirs) for conflicting files
async function resolveFile(projectDir: string, file: string, strategy: 'ours' | 'theirs'): Promise<void> {
  await execGit(projectDir, ['checkout', `--${strategy}`, '--', file]);
  await execGit(projectDir, ['add', file]);
}
```

### Aborting a Failed Resolution
```typescript
// If auto-resolution fails, clean up merge state
async function abortMerge(projectDir: string): Promise<void> {
  try {
    await execGit(projectDir, ['merge', '--abort']);
  } catch {
    // Not in merge state -- OK
  }
}
```

### Summary Table Output
```typescript
// Test-runner-style summary table
function renderSummary(results: PhaseResult[]): string {
  const lines = [
    '',
    ' Phase Results',
    ' ' + '-'.repeat(70),
  ];
  for (const r of results) {
    const status = r.success ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL';
    const icon = r.success ? '+' : r.skipped ? '-' : 'x';
    const merge = r.mergeStatus ?? '';
    const error = r.error ? ` -- ${r.error}` : '';
    lines.push(` ${icon} Phase ${r.phaseNumber}: ${r.name}  [${status}]  ${merge}${error}`);
  }
  lines.push(' ' + '-'.repeat(70));
  return lines.join('\n');
}
```

### Cross-Platform Process Kill
```typescript
// Using tree-kill (if added as dependency)
import treeKill from 'tree-kill';

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, 'SIGKILL', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// OR: manual platform detection (no dependency)
async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  } else {
    process.kill(-pid, 'SIGKILL'); // Negative PID kills process group on Unix
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `process.kill(pid, 'SIGTERM')` | `tree-kill` or platform-specific kill | Always been necessary on Windows | Cross-platform reliability |
| Parse conflict markers | `git checkout --ours/--theirs` per file | Git has always supported this | Simpler, handles binary files |
| Manual conflict resolution | `git merge -Xtheirs` (strategy option) | Available since Git 1.7+ | Resolves all conflicts in one command, but loses ours-side non-conflicting changes |

**Note on `-Xtheirs` vs per-file resolution:** Using `git merge -Xtheirs <branch>` resolves ALL conflicts by preferring theirs in a single command. This is the simplest approach but may be too aggressive. Per-file resolution with `git checkout --theirs` gives more control and better reporting. Recommendation: Start with per-file resolution for better reporting, but if auto-resolution proves reliable, consider `-Xtheirs` as a simpler option in the merge command itself (replacing the current `mergeWorktree` call with `git merge -Xtheirs branch --no-edit`).

## Open Questions

1. **Should auto-resolution prefer `--theirs` (phase branch) for all files?**
   - What we know: Phase branches contain the new work. The main branch contains prior merged work. In most cases, taking phase branch changes is correct.
   - What's unclear: Are there cases where main branch changes should win? (e.g., if two phases both modify `.planning/STATE.md`)
   - Recommendation: Default to `--theirs` (prefer phase work). For known shared files like state files, use `--ours` (keep what's already merged). Document strategy in merge report.

2. **Should we use `git merge -Xtheirs` instead of per-file resolution?**
   - What we know: `-Xtheirs` resolves all conflicts in one command. Per-file gives granular control and reporting.
   - What's unclear: Whether the extra granularity is worth the complexity.
   - Recommendation: Use `-Xtheirs` in the merge command itself as the initial approach. If a conflict still can't be auto-resolved (which is rare with `-Xtheirs`), fall back to per-file resolution. This gives the best of both worlds.

3. **How does ClaudeService.abortCurrent() interact with the Claude Agent SDK process?**
   - What we know: `abortCurrent()` calls `this.currentAbort.abort()` which signals an AbortController. The SDK likely terminates the subprocess.
   - What's unclear: Whether the SDK cleanly terminates the underlying Claude Code process or leaves orphans.
   - Recommendation: After `abortAll()`, add a timeout-based kill for any remaining child processes. The ShutdownManager's SIGTERM-then-SIGKILL escalation covers this.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.0 |
| Config file | `autopilot/vitest.config.ts` |
| Quick run command | `cd autopilot && npx vitest run --reporter=verbose` |
| Full suite command | `cd autopilot && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FAIL-01 | Fail-fast stops all workers on phase failure | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/failure-handling.test.ts -t "fail-fast" -x` | Wave 0 |
| FAIL-02 | --continue mode lets independent phases continue | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/failure-handling.test.ts -t "continue" -x` | Wave 0 |
| FAIL-03 | Graceful shutdown cleans up processes and worktrees | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/shutdown.test.ts -x` | Exists (extend) |
| FAIL-04 | Failed worktrees preserved for debugging | unit | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -t "preserve" -x` | Wave 0 |
| GIT-03 | Merge conflicts auto-resolved | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "resolve" -x` | Wave 0 |
| GIT-04 | Merge report generated | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "report" -x` | Wave 0 |
| GIT-05 | Resolution reports as context for future merges | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "context" -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd autopilot && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd autopilot && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `autopilot/src/orchestrator/__tests__/failure-handling.test.ts` -- covers FAIL-01, FAIL-02
- [ ] `autopilot/src/worker/__tests__/worker-pool.test.ts` -- covers FAIL-04
- [ ] `autopilot/src/worker/__tests__/merge-resolver.test.ts` -- covers GIT-03, GIT-04, GIT-05
- [ ] Extend `autopilot/src/orchestrator/__tests__/shutdown.test.ts` -- covers FAIL-03 (double-SIGINT, force kill)
- [ ] Extend `autopilot/src/scheduler/__tests__/scheduler.test.ts` -- covers markFailed/markSkipped

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `orchestrator/index.ts`, `worker/index.ts`, `worker/git-worktree.ts`, `scheduler/index.ts`, `orchestrator/shutdown.ts` -- direct inspection of extension points
- [Git merge documentation](https://git-scm.com/docs/git-merge) -- merge strategies, `-Xtheirs`/`-Xours` options
- [Git checkout documentation](https://git-scm.com/docs/git-checkout/2.27.0) -- `--ours`/`--theirs` per-file resolution
- [Node.js process documentation](https://nodejs.org/api/process.html) -- signal handling, platform differences

### Secondary (MEDIUM confidence)
- [tree-kill npm](https://github.com/pkrumins/node-tree-kill) -- cross-platform process tree killing, verified via npm registry
- [Node.js Windows signal issues](https://github.com/nodejs/node/issues/12378) -- confirmed SIGTERM limitations on Windows

### Tertiary (LOW confidence)
- [git-resolve-conflict npm](https://www.npmjs.com/package/git-resolve-conflict) -- not recommended (native git commands are sufficient), listed for completeness

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - extending existing codebase with well-understood patterns
- Architecture: HIGH - extension points explicitly designed in Phase 2 (comments reference Phase 3)
- Pitfalls: HIGH - Windows signal handling and git merge state are well-documented issues
- Conflict resolution: MEDIUM - the "right" default strategy (theirs vs ours vs per-file) needs empirical validation

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain, no rapidly changing dependencies)
