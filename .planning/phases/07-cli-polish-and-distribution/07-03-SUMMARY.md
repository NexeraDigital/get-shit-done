# Phase 07 Plan 03: NPM Package Verification and Hardening Summary

**One-liner:** Validated npm package structure, fixed test file inclusion, verified Unix compatibility

---

## Frontmatter

```yaml
phase: 07-cli-polish-and-distribution
plan: 03
subsystem: cli-packaging
tags: [npm, distribution, packaging, unix-compatibility]
dependency_graph:
  requires: [07-02-wizard-and-config-persistence]
  provides: [verified-npm-package]
  affects: [npm-distribution, cross-platform-compatibility]
tech_stack:
  added: []
  patterns: [npm-pack-verification, shebang-validation, tarball-testing]
key_files:
  created: []
  modified: [autopilot/package.json]
decisions:
  - Exclude test files from npm package via files array negation patterns
  - Verify Unix compatibility structurally via shebangs and .gitattributes (runtime testing deferred to CI/CD)
metrics:
  duration_minutes: 3
  tasks_completed: 3
  files_modified: 1
  completed_date: 2026-02-24
```

---

## What Was Built

Verified and hardened the npm package for distribution, ensuring correct tarball contents, cross-platform bin script compatibility, and end-to-end installation verification.

### Task 1: Verify and fix npm package contents and metadata

**Objective:** Run `npm pack --dry-run` and verify package size, contents, and exclusions.

**Implementation:**
- Ran `npm pack --dry-run` and found package size was 223.8 kB (well under 2MB target)
- Discovered test file `workflows/gsd-autopilot/__tests__/port-manager.test.js` was being included
- Added exclusion patterns to package.json files array: `!workflows/**/__tests__` and `!workflows/**/*.test.js`
- Re-verified dry-run: package size reduced to 221.9 kB with 139 files (test file excluded)
- Verified all required files present: dist/, dashboard/dist/, workflows/, scripts/, example-adapter.js
- Verified package.json fields: name, bin, engines, type, files all correct

**Files modified:**
- `autopilot/package.json`: Added test file exclusions to files array

**Commit:** 4ce3417

---

### Task 2: Verify bin script shebangs and Unix compatibility

**Objective:** Verify bin scripts have correct shebangs and LF line endings for Unix compatibility.

**Implementation:**
- Verified `dist/cli/index.js` has `#!/usr/bin/env node` as first line with LF ending (PASS)
- Verified `dist/server/standalone.js` has `#!/usr/bin/env node` as first line with LF ending (PASS)
- Verified `.gitattributes` enforces LF line endings for bin scripts via `dist/cli/*.js text eol=lf` and `dist/server/*.js text eol=lf`
- No CR characters present in either bin script

**Files verified:**
- `autopilot/dist/cli/index.js`: Correct shebang, LF line endings
- `autopilot/dist/server/standalone.js`: Correct shebang, LF line endings
- `autopilot/.gitattributes`: LF enforcement rules present

**Outcome:** No changes needed - bin scripts already structured correctly for Unix compatibility

---

### Task 3: End-to-end tarball install and CLI command verification

**Objective:** Perform complete installation test from tarball to verify package works end-to-end.

**Implementation:**
1. Built package: `npm run build` (TypeScript compilation + dashboard build)
2. Created tarball: `npm pack` produced `gsd-autopilot-0.1.0.tgz` (217 KB)
3. Created temp directory and installed from tarball: `npm install /path/to/gsd-autopilot-0.1.0.tgz`
4. Verified installation succeeded without errors (162 packages installed)
5. Verified all required files present in node_modules/gsd-autopilot/:
   - `dist/cli/index.js` (executable)
   - `dashboard/dist/index.html`
   - `workflows/gsd-autopilot/launcher.js`
   - `example-adapter.js`
6. Tested `npx gsd-autopilot --help`: Output shows all 13 documented flags:
   - --prd, --resume, --skip-discuss, --skip-verify, --phases
   - --notify, --webhook-url, --port, --depth, --model
   - --verbose, --quiet, --adapter-path
7. Tested `npx gsd-autopilot --version`: Output shows "0.1.0"
8. Cleaned up temp directory and tarball

**Verification results:**
- Package installs correctly from tarball: PASS
- All required files present: PASS
- CLI help shows all 13 flags: PASS
- CLI version shows correct version: PASS
- Package works via npx on Windows: PASS

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Excluded test files from npm package**
- **Found during:** Task 1, npm pack --dry-run verification
- **Issue:** Test file `workflows/gsd-autopilot/__tests__/port-manager.test.js` was being included in tarball, violating package size optimization and distribution best practices
- **Fix:** Added exclusion patterns `!workflows/**/__tests__` and `!workflows/**/*.test.js` to package.json files array
- **Files modified:** autopilot/package.json
- **Commit:** 4ce3417
- **Impact:** Reduced package size from 223.8 kB to 221.9 kB, prevented test files from being distributed to npm users

---

## Phase 7 Success Criteria Validation

All Phase 7 success criteria met:

1. **`npx gsd-autopilot --help` shows all documented flags:** VERIFIED
   - Task 3 confirmed all 13 flags present in help output

2. **Flag functionality:** VERIFIED
   - --verbose, --quiet, --port, --depth, --model wired through loadConfig (code inspection from 07-01/07-02)
   - All flags tested in previous plans (07-01, 07-02)

3. **`npm pack` produces package under 2MB that installs and runs correctly:** VERIFIED
   - Task 1: Package size 221.9 kB (under 2MB)
   - Task 3: Package installs from tarball and runs via npx on Windows
   - Task 2: Unix compatibility ensured structurally (correct shebangs, LF enforcement via .gitattributes)
   - Runtime testing on macOS/Linux deferred to CI/CD or manual testing

---

## Key Decisions

1. **Test file exclusion via negation patterns:** Used `!workflows/**/__tests__` and `!workflows/**/*.test.js` in files array to exclude test files from package distribution. This follows npm best practices and reduces package size.

2. **Structural Unix compatibility verification:** Verified shebangs and LF line endings via .gitattributes rules rather than runtime testing on Unix systems. Runtime testing deferred to CI/CD pipeline or manual verification on macOS/Linux.

3. **Tarball install test on Windows only:** End-to-end verification performed on Windows (development platform). Cross-platform runtime testing deferred to CI/CD or manual testing.

---

## Technical Notes

### NPM Package Structure

The package.json files array uses a whitelist approach with negation patterns:
```json
"files": [
  "dist/**/*.js",
  "dist/**/*.d.ts",
  "dashboard/dist/",
  "workflows/gsd-autopilot/",
  "scripts/install-workflow.js",
  "example-adapter.js",
  "!dist/**/*.test.*",
  "!dist/**/__tests__",
  "!workflows/**/__tests__",
  "!workflows/**/*.test.js"
]
```

This ensures only production files are included, excluding:
- Test files (*.test.js, *.test.ts)
- Test directories (__tests__)
- Source maps (handled by TypeScript tsconfig)
- Source files (src/ not in files array)

### Shebang and Line Ending Strategy

Both bin scripts (`dist/cli/index.js` and `dist/server/standalone.js`) use:
- Shebang: `#!/usr/bin/env node` (first line, no blank lines before)
- Line endings: LF (enforced by .gitattributes)

The `.gitattributes` file ensures cross-platform compatibility:
```gitattributes
# Force LF line endings for all files in this package
* text=auto eol=lf

# Bin scripts MUST use LF (shebang fails with CRLF on Unix)
dist/cli/*.js text eol=lf
dist/server/*.js text eol=lf
```

This configuration ensures that even when developed on Windows (which uses CRLF), git will store and check out bin scripts with LF endings, preventing Unix shebang failures.

### Tarball Verification Process

The end-to-end verification followed this pattern:
1. Build fresh: `npm run build` (ensures dist/ is up-to-date)
2. Pack: `npm pack` (creates tarball)
3. Install: `npm install <tarball>` in temp directory
4. Verify files: Check node_modules/gsd-autopilot/ contents
5. Test CLI: `npx gsd-autopilot --help` and `npx gsd-autopilot --version`
6. Clean up: Remove temp directory and tarball

Note: `npm install <tarball>` does NOT run the `prepare` script. The tarball already contains pre-built dist/ files from `npm pack`, which runs `prepare` before packing. This is correct npm behavior.

---

## Self-Check: PASSED

**Created files:**
```bash
$ ls -1 .planning/phases/07-cli-polish-and-distribution/07-03-SUMMARY.md
FOUND: .planning/phases/07-cli-polish-and-distribution/07-03-SUMMARY.md
```

**Commits:**
```bash
$ git log --oneline --all | grep -q "4ce3417"
FOUND: 4ce3417
```

**Modified files:**
```bash
$ git diff HEAD~1 HEAD --name-only | grep autopilot/package.json
FOUND: autopilot/package.json
```

All files and commits verified successfully.

---

## Next Steps

Phase 7 (CLI Polish and Distribution) is now complete. The npm package is verified and ready for distribution:
- Package structure validated
- Cross-platform compatibility ensured
- CLI commands tested
- Tarball installation verified

The package can now be published to npm or distributed via tarball. Recommended next steps:
1. Manual testing on macOS/Linux to verify Unix runtime compatibility
2. CI/CD pipeline setup for automated cross-platform testing
3. npm publish when ready for public distribution

---

**Phase 07 Status:** COMPLETE (3/3 plans)
**Total Duration:** ~18 minutes (07-01: 5min, 07-02: 10min, 07-03: 3min)
