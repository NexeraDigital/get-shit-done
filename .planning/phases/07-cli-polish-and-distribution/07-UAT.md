---
status: testing
phase: 07-cli-polish-and-distribution
source: 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md
started: 2026-02-24T23:30:00Z
updated: 2026-02-24T23:30:00Z
---

## Current Test

number: 1
name: Help Output Shows All Flags
expected: |
  Run `npx gsd-autopilot --help` from the autopilot directory. Output should list all 13 flags: --prd, --resume, --skip-discuss, --skip-verify, --phases, --notify, --webhook-url, --port, --depth, --model, --verbose, --quiet, --adapter-path. Should also show usage examples at the bottom.
awaiting: user response

## Tests

### 1. Help Output Shows All Flags
expected: Run `npx gsd-autopilot --help` from the autopilot directory. Output should list all 13 flags: --prd, --resume, --skip-discuss, --skip-verify, --phases, --notify, --webhook-url, --port, --depth, --model, --verbose, --quiet, --adapter-path. Should also show usage examples at the bottom.
result: [pending]

### 2. Version Output
expected: Run `npx gsd-autopilot --version`. Should display "0.1.0".
result: [pending]

### 3. No-Args Launches Setup Wizard
expected: Run `npx gsd-autopilot` with no arguments. Instead of an error, an interactive setup wizard should start, asking for PRD path first with a "Welcome to GSD Autopilot" banner.
result: [pending]

### 4. Wizard PRD Path Validation
expected: In the setup wizard, enter a path to a file that doesn't exist (e.g., "nonexistent.md"). The wizard should show an error like "File not found" and re-prompt for a valid path. Enter a valid file path and it should accept it.
result: [pending]

### 5. Wizard Config Save
expected: Complete the wizard (PRD path, notification channel, model, depth). When asked to save config, say yes. A `.gsd-autopilot.json` file should be created in the project root with the selected options (but NOT the PRD path).
result: [pending]

### 6. Phase Range Parsing
expected: Run `npx gsd-autopilot --prd ./idea.md --phases 1-3,5,7-9`. The CLI should accept this format without errors (it will fail at preflight checks since there's no real PRD, but the phase range should parse successfully — look for preflight errors, not phase format errors).
result: [pending]

### 7. Preflight Error Messages
expected: Run `npx gsd-autopilot --prd nonexistent.md`. Should show a preflight error with actionable guidance: the error tells you what went wrong AND what to do about it (e.g., "PRD file not found" with the path shown).
result: [pending]

### 8. NPM Package Size
expected: From the autopilot directory, run `npm pack --dry-run`. Package size should be under 2MB (reported as ~222 kB). Test files (*.test.js, __tests__/) should NOT appear in the file list.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet]
