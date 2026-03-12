---
phase: 2
slug: parallel-execution-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
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
| 02-01-01 | 01 | 0 | SCHED-01 | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | SCHED-03 | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | SCHED-04 | unit | `cd autopilot && npx vitest run src/cli/__tests__/cli-flags.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 0 | GIT-01 | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 0 | GIT-02 | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 0 | GIT-06 | unit | `cd autopilot && npx vitest run src/worker/__tests__/git-worktree.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 0 | EXEC-01 | unit | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 0 | EXEC-02 | integration | `cd autopilot && npx vitest run src/worker/__tests__/worker-pool.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `autopilot/src/cli/__tests__/cli-flags.test.ts` — stubs for SCHED-01, SCHED-03, SCHED-04
- [ ] `autopilot/src/worker/__tests__/git-worktree.test.ts` — stubs for GIT-01, GIT-02, GIT-06
- [ ] `autopilot/src/worker/__tests__/worker-pool.test.ts` — stubs for EXEC-01, EXEC-02
- [ ] `autopilot/src/orchestrator/__tests__/unified-loop.test.ts` — stubs for scheduler-driven loop

*No new framework config needed — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full parallel run with real Claude sessions | EXEC-02 | Requires live Claude API access | Run `npx tsx autopilot/src/cli/index.ts --parallel --concurrency 2` on a test project with 2+ independent phases |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
