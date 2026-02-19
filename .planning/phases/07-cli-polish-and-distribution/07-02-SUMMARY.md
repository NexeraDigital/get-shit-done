# Phase 7 Plan 2: Interactive Setup Wizard Summary

**One-liner:** Interactive npm init-style wizard for first-run experience using @inquirer/prompts with file validation and config persistence

---

## Metadata

**Phase:** 07-cli-polish-and-distribution
**Plan:** 02
**Subsystem:** CLI/UX
**Completed:** 2026-02-18
**Duration:** ~4 minutes

---

## Tags

`cli` `wizard` `ux` `first-run` `inquirer` `onboarding`

---

## Dependency Graph

### Requires
- Plan 07-01 (CLI preflight checks and error messaging)
- @inquirer/prompts library
- Commander.js async action support

### Provides
- Interactive wizard for no-args invocation
- First-run onboarding experience
- Config persistence to .gsd-autopilot.json
- Seamless wizard-to-run flow

### Affects
- CLI entry point (autopilot/src/cli/index.ts)
- First-run user experience
- Config management patterns

---

## Tech Stack

### Added
- **@inquirer/prompts** v8.2.1 - Modern ESM-native prompts library (successor to inquirer.js)

### Patterns
- Interactive CLI wizard (npm init-style)
- Async input validation with file existence checks
- Conditional prompting (webhook URL only when needed)
- Graceful Ctrl+C handling via ExitPromptError
- Config persistence without PRD path (session-specific)

---

## What Was Built

### Task 1: Create Interactive Setup Wizard Module
**Commit:** `7d26253`

**Created Files:**
- `autopilot/src/cli/wizard.ts` - Complete wizard implementation with 7-step flow

**Modified Files:**
- `autopilot/package.json` - Added @inquirer/prompts dependency
- `autopilot/package-lock.json` - Locked dependency versions

**Functionality:**
1. Welcome banner for first-run experience
2. PRD path input with file existence validation (default: ./idea.md)
3. Notification channel selection (console, system, teams, slack)
4. Conditional webhook URL collection (only for teams/slack)
5. Model profile selection (quality, balanced, budget) - default: balanced
6. Planning depth selection (quick, standard, comprehensive) - default: standard
7. Config save confirmation - writes to .gsd-autopilot.json (excludes prdPath per session-specific design)

**Key Design Decisions:**
- File validation returns descriptive errors with exact path shown
- Webhook URL validation requires https:// prefix
- Sensible defaults at every step (mirrors npm init UX)
- ExitPromptError name-check for graceful Ctrl+C handling
- Returns resolved absolute prdPath for CLI use

### Task 2: Integrate Wizard into CLI as No-Args Default
**Commit:** `f03a5fd`

**Modified Files:**
- `autopilot/src/cli/index.ts` - Replaced error with wizard launch
- `autopilot/src/orchestrator/__tests__/yolo-config.test.ts` - Bug fix (see Deviations)

**Integration Points:**
1. Import `runSetupWizard` from wizard module
2. Replace no-args error block with wizard invocation
3. Feed wizard results directly into options object (prd, notify, model, depth, webhookUrl)
4. Wizard results flow seamlessly into existing config loading pipeline

**After Wizard Completes:**
- Options object populated with wizard values
- CLI continues normal execution flow
- Autopilot starts immediately - NO re-invocation needed
- User sees "Welcome to GSD Autopilot" → quick questions → build starts

**Bypass Mechanisms:**
- `--prd <path>` - Skips wizard, starts new run
- `--resume` - Skips wizard, continues from checkpoint

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed yolo-config test expecting wrong field name**
- **Found during:** Task 2 test verification
- **Issue:** Test expected `plan_checker: true` but implementation writes `plan_check: true`. Checked actual config.json - uses `plan_check`. Test was incorrect.
- **Fix:** Changed test assertion from `plan_checker` to `plan_check` to match implementation and actual config format
- **Files modified:** `autopilot/src/orchestrator/__tests__/yolo-config.test.ts` (line 34)
- **Commit:** `f03a5fd` (bundled with Task 2 commit)

---

## Key Decisions

1. **Use @inquirer/prompts over inquirer.js classic** - ESM-native, tree-shakeable, modern API
2. **Validate PRD path during wizard, not in preflight** - Immediate feedback loop, wizard won't proceed without valid file
3. **Exclude prdPath from saved config** - PRD path is project-specific, not a user preference
4. **Wizard feeds options, then normal flow continues** - No separate wizard-specific execution path, DRY principle
5. **Conditional webhook prompt only when needed** - UX polish, don't ask for webhook if console/system selected
6. **Graceful Ctrl+C via ExitPromptError name check** - User can cancel at any step without stack trace

---

## Files Modified

### Created (1)
- `autopilot/src/cli/wizard.ts`

### Modified (3)
- `autopilot/src/cli/index.ts`
- `autopilot/package.json`
- `autopilot/package-lock.json`

### Fixed (1)
- `autopilot/src/orchestrator/__tests__/yolo-config.test.ts`

---

## Testing

**Test Results:**
- All 694 tests passing (60 test files)
- TypeScript compilation clean (no errors)
- Pre-existing test bug fixed during execution

**Test Coverage:**
- Wizard module exports `runSetupWizard` function
- CLI imports and invokes wizard on no-args
- Old "No input specified" error message removed
- @inquirer/prompts in package.json dependencies

---

## Success Criteria Met

- [x] No-args invocation launches interactive wizard, not an error
- [x] Wizard collects PRD path, notification, model, depth with sensible defaults
- [x] Wizard validates PRD path exists before proceeding
- [x] Wizard offers to save config to .gsd-autopilot.json
- [x] After wizard, autopilot starts without requiring re-invocation
- [x] --prd and --resume bypass wizard completely
- [x] All existing tests pass with no regressions

---

## Verification

### Build Verification
```bash
$ cd autopilot && npx tsc --noEmit
# ✓ Clean compilation, no errors

$ npx vitest run
# ✓ Test Files  60 passed (60)
# ✓ Tests       694 passed (694)
```

### Integration Points Verified
- [x] `runSetupWizard` exported from wizard.ts
- [x] `runSetupWizard` imported and invoked in index.ts
- [x] @inquirer/prompts present in dependencies
- [x] No "No input specified" error in CLI code
- [x] Wizard results map to config loader CLI overrides
- [x] yolo-config test fixed (plan_check assertion)

---

## Performance

**Execution Time:** ~4 minutes (236 seconds)

**Breakdown:**
- Task 1 (wizard module): ~2 minutes (implementation + verification)
- Task 2 (CLI integration): ~1 minute (import + replace + verification)
- Bug fix (test assertion): <1 minute (inline fix during test run)
- Final verification: <1 minute (build + test suite)

**Deviation Handling:** 1 auto-fix (Rule 1 bug) - test assertion mismatch resolved inline

---

## Next Steps

Ready for Plan 07-03 (Help system polish and usage examples).

Current wizard provides excellent first-run experience. No follow-up needed.

---

## Self-Check: PASSED

**Created Files Verification:**
```bash
$ [ -f "C:/GitHub/GetShitDone/get-shit-done/autopilot/src/cli/wizard.ts" ] && echo "FOUND" || echo "MISSING"
# FOUND
```

**Commit Verification:**
```bash
$ git log --oneline --all | grep -E "7d26253|f03a5fd"
# f03a5fd feat(07-02): integrate wizard into CLI as no-args default behavior
# 7d26253 feat(07-02): add interactive setup wizard module
```

**Build Artifacts:**
- TypeScript compilation: ✓ PASSED
- Test suite: ✓ PASSED (694/694 tests)
- Dependency installation: ✓ PASSED (@inquirer/prompts installed)

All claims verified successfully.
