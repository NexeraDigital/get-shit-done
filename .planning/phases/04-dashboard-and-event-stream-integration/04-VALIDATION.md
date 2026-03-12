---
phase: 4
slug: dashboard-and-event-stream-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | autopilot/vitest.config.ts (or default) |
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
| 04-01-01 | 01 | 0 | EVNT-03 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 0 | EVNT-03 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 0 | EVNT-03 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/consolidated-event-tailer.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | DASH-01 | unit | `cd autopilot && npx vitest run src/types/__tests__/state.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | DASH-01 | unit | `cd autopilot && npx vitest run src/server/__tests__/sse.test.ts` | ✅ extend | ⬜ pending |
| 04-02-03 | 02 | 1 | DASH-01 | unit | `cd autopilot && npx vitest run src/server/__tests__/api-routes.test.ts` | ✅ extend | ⬜ pending |
| 04-03-01 | 03 | 2 | DASH-02 | unit | `cd autopilot && npx vitest run src/server/__tests__/api-routes.test.ts` | ✅ extend | ⬜ pending |
| 04-03-02 | 03 | 2 | DASH-03 | unit | `cd autopilot && npx vitest run src/ipc/__tests__/answer-roundtrip.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `autopilot/src/ipc/__tests__/consolidated-event-tailer.test.ts` — stubs for EVNT-03 multi-file scanning
- [ ] Extend `autopilot/src/server/__tests__/sse.test.ts` — covers phase-status-changed event (DASH-01)
- [ ] Extend `autopilot/src/server/__tests__/api-routes.test.ts` — covers parallel phase status in /phases (DASH-01)

*Existing infrastructure covers framework installation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard renders per-phase status cards in real-time | DASH-01 | Visual rendering in browser | Start parallel execution, observe dashboard updates in browser |
| SSE stream consolidation under load | EVNT-03 | Requires multiple concurrent workers | Run 3+ phase parallel execution, verify no duplicates in browser console |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
