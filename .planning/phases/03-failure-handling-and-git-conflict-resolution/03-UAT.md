---
status: testing
phase: 03-failure-handling-and-git-conflict-resolution
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md]
started: 2026-03-12T15:10:00Z
updated: 2026-03-12T15:10:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running autopilot process. Run `npx tsx autopilot/src/cli/index.ts --help` (or equivalent). The CLI boots without errors and shows help output including the `--continue` and `--parallel` flags.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running autopilot process. Run `npx tsx autopilot/src/cli/index.ts --help` (or equivalent). The CLI boots without errors and shows help output including the `--continue` and `--parallel` flags.
result: [pending]

### 2. --continue Flag Accepted by CLI
expected: Run the CLI with `--continue` flag. The flag is accepted without error (no "unknown option" message). The orchestrator receives `continueOnFailure: true`.
result: [pending]

### 3. Fail-Fast Mode (Default)
expected: When a phase fails during execution without `--continue`, the orchestrator aborts all running workers and shuts down. No subsequent independent phases are started after the failure.
result: [pending]

### 4. --continue Mode Skips Dependents
expected: When a phase fails with `--continue` enabled, the orchestrator marks the failed phase and skips all transitive dependents (downstream phases). Independent phases that don't depend on the failed one continue executing.
result: [pending]

### 5. Double-SIGINT Force Exit
expected: Send Ctrl+C once — the orchestrator begins graceful shutdown (finishes in-flight work). Send Ctrl+C again within 3 seconds — the process force exits immediately with exit code 1.
result: [pending]

### 6. Summary Table at End of Run
expected: After any run completes (success or failure), a summary table is printed showing each phase with its status (PASS/FAIL/SKIP), merge conflict column, and error reason if applicable. Format resembles a test runner output.
result: [pending]

### 7. Merge Conflict Auto-Resolution
expected: When merging a worktree branch back to main causes a git conflict, the system automatically resolves it using --theirs strategy (worktree changes win). A merge report is generated documenting which files had conflicts and how they were resolved.
result: [pending]

### 8. Exit Code 1 on Failure
expected: When any phase fails, the CLI process exits with code 1 (not 0). This enables CI systems to detect failures.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet]
