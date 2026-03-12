---
phase: 3
slug: failure-handling-and-git-conflict-resolution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.0 |
| **Config file** | `autopilot/vitest.config.ts` |
| **Quick run command** | `cd autopilot && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd autopilot && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd autopilot && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd autopilot && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | FAIL-01 | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/failure-handling.test.ts -t "fail-fast" -x` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | FAIL-02 | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/failure-handling.test.ts -t "continue" -x` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | FAIL-03 | unit | `cd autopilot && npx vitest run src/orchestrator/__tests__/shutdown.test.ts -x` | ✅ (extend) | ⬜ pending |
| 03-01-04 | 01 | 1 | FAIL-04 | unit | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -t "preserve" -x` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | GIT-03 | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "resolve" -x` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | GIT-04 | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "report" -x` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | GIT-05 | unit | `cd autopilot && npx vitest run src/worker/__tests__/merge-resolver.test.ts -t "context" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `autopilot/src/orchestrator/__tests__/failure-handling.test.ts` — stubs for FAIL-01, FAIL-02
- [ ] `autopilot/src/worker/__tests__/worker-pool.test.ts` — stubs for FAIL-04
- [ ] `autopilot/src/worker/__tests__/merge-resolver.test.ts` — stubs for GIT-03, GIT-04, GIT-05
- [ ] Extend `autopilot/src/orchestrator/__tests__/shutdown.test.ts` — stubs for FAIL-03 (double-SIGINT, force kill)
- [ ] Extend `autopilot/src/scheduler/__tests__/scheduler.test.ts` — stubs for markFailed/markSkipped

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Double Ctrl+C force exit | FAIL-03 | Requires real terminal signal delivery | 1. Start parallel execution 2. Press Ctrl+C 3. Press Ctrl+C again within 3s 4. Verify immediate exit |
| Worktree preserved on disk after failure | FAIL-04 | Requires real git worktree on filesystem | 1. Trigger phase failure 2. Verify worktree directory still exists 3. Verify git branch preserved |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
