---
phase: 1
slug: scheduler-and-isolation-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.0 |
| **Config file** | `autopilot/vitest.config.ts` |
| **Quick run command** | `cd autopilot && npx vitest run src/scheduler` |
| **Full suite command** | `cd autopilot && npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd autopilot && npx vitest run src/scheduler`
- **After every plan wave:** Run `cd autopilot && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | SCHED-02 | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 0 | SCHED-05 | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 0 | SCHED-06 | unit | `cd autopilot && npx vitest run src/scheduler/__tests__/scheduler.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | EXEC-03 | unit | `cd autopilot && npx vitest run src/state/__tests__/state-store.test.ts` | ✅ extend | ⬜ pending |
| 01-02-02 | 02 | 1 | EXEC-04 | unit | `cd autopilot && npx vitest run src/state/__tests__/state-store.test.ts` | ✅ extend | ⬜ pending |
| 01-02-03 | 02 | 1 | EVNT-01 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/event-writer.test.ts` | ✅ extend | ⬜ pending |
| 01-02-04 | 02 | 1 | EVNT-02 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/event-writer.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `autopilot/src/scheduler/__tests__/scheduler.test.ts` — stubs for SCHED-02, SCHED-05, SCHED-06
- [ ] `autopilot/src/scheduler/__tests__/parse-depends-on.test.ts` — covers dependsOn string parsing
- [ ] Extend `autopilot/src/ipc/__tests__/event-writer.test.ts` — covers EVNT-01, EVNT-02
- [ ] Extend `autopilot/src/state/__tests__/state-store.test.ts` — covers EXEC-03, EXEC-04

*Existing infrastructure covers test framework — vitest already configured.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
