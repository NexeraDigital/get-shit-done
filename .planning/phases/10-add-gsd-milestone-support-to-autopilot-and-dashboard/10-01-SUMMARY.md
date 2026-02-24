---
phase: 10-add-gsd-milestone-support-to-autopilot-and-dashboard
plan: 01
subsystem: milestone
tags: [parser, types, tdd, markdown]
dependency_graph:
  requires: []
  provides: [milestone-types, milestone-parser]
  affects: [api-routes, dashboard-types]
tech_stack:
  added: []
  patterns: [regex-markdown-parsing, enoent-handling, tdd-workflow]
key_files:
  created:
    - autopilot/src/milestone/types.ts
    - autopilot/src/milestone/parser.ts
    - autopilot/src/milestone/__tests__/parser.test.ts
  modified:
    - autopilot/src/types/index.ts
decisions:
  - Regex-based parsing for structured GSD markdown (not full markdown library)
  - ENOENT returns empty/null gracefully (missing files are valid state)
  - Cross-reference PROJECT.md and MILESTONES.md to determine active vs shipped
  - Decimal phase numbers supported via parseFloat (handles 3.1, 06.1, etc.)
metrics:
  duration: 4min
  completed: 2026-02-24
---

# Phase 10 Plan 01: Milestone types and parser with TDD Summary

**One-liner:** Regex-based markdown parser extracting milestone data (version, name, status, stats) from PROJECT.md, MILESTONES.md, and ROADMAP.md with comprehensive TDD coverage and graceful ENOENT handling.

## What Was Built

Created the foundational milestone parsing infrastructure that extracts milestone metadata from three GSD planning files. The parser cross-references sources to determine whether a milestone is active (in PROJECT.md but not shipped) or shipped (appears in MILESTONES.md), handles missing files gracefully, and supports decimal phase numbering.

### Milestone Types (`autopilot/src/milestone/types.ts`)

Defined three core types using `export type` (consistent with verbatimModuleSyntax):

- **MilestoneStatus**: `'active' | 'shipped'` literal union
- **MilestoneInfo**: Full milestone metadata including version, name, status, shippedDate (optional), phase/plan counts, phasesCompleted, and accomplishments array
- **MilestoneResponse**: Top-level response shape with `current: MilestoneInfo | null` and `shipped: MilestoneInfo[]`

### Markdown Parser (`autopilot/src/milestone/parser.ts`)

Implemented `parseMilestoneData(planningDir: string): MilestoneResponse` with four key steps:

1. **Read files with ENOENT handling**: `readFile()` helper wraps `fs.readFileSync` and returns empty string on ENOENT (not an error for fresh projects)
2. **Extract current milestone from PROJECT.md**: Regex pattern `/##\s+Current Milestone:\s+(v[\d.]+)\s+(.+)/` extracts version and name
3. **Parse shipped milestones from MILESTONES.md**: Global regex matches headers like `## v1.0 MVP (Shipped: 2026-02-24)`, then extracts content sections (accomplishments, stats, phases completed) from markdown body
4. **Count phases/plans from ROADMAP.md**: Parses progress table, handles decimal phase numbers (3.1, 06.1), counts completed phases, sums total plans

**Cross-referencing logic**: If PROJECT.md has "Current Milestone: v1.0" and v1.0 does NOT appear in MILESTONES.md → status is 'active'. If v1.0 IS in MILESTONES.md → status is 'shipped'.

### TDD Tests (`autopilot/src/milestone/__tests__/parser.test.ts`)

Comprehensive test suite (12 test cases) covering:

- Happy path: All files present with valid content
- Missing files (ENOENT): PROJECT.md, MILESTONES.md, ROADMAP.md all handled gracefully
- No "Current Milestone" section: Returns `current: null`
- Milestone just shipped: Detects when current milestone appears in MILESTONES.md
- Multiple shipped milestones: Parses all entries in order
- Flexible whitespace: Extra spaces in headers still match
- Empty MILESTONES.md: Returns empty shipped array
- Decimal phase numbers: Correctly parses and counts phases like "03.1", "06.1"
- Accomplishments parsing: Extracts bullet list items
- Phase and plan counting: Counts from ROADMAP.md progress table

### Barrel Export

Added milestone type re-exports to `autopilot/src/types/index.ts`:

```typescript
export type {
  MilestoneStatus,
  MilestoneInfo,
  MilestoneResponse,
} from '../milestone/types.js';
```

## Deviations from Plan

None - plan executed exactly as written.

## Technical Decisions

### Regex vs Markdown Library

**Decision:** Use regex-based parsing instead of marked/markdown-it.

**Rationale:** GSD markdown files have known, structured section headers (`## Current Milestone:`, `**Key accomplishments:**`). Full markdown parsers (marked ~500KB) are overkill for extracting specific sections. Regex is lighter, zero dependencies, and sufficient for structured documents.

**Precedent:** Existing codebase already uses regex for PROJECT.md parsing in `api.ts` line 19.

### ENOENT Handling Strategy

**Decision:** Missing files return empty string/null/empty array, not errors.

**Rationale:** Fresh projects won't have MILESTONES.md until first milestone ships. Missing files are valid states, not errors. Parser should degrade gracefully.

**Implementation:** `readFile()` helper catches ENOENT specifically, re-throws unexpected errors.

### Cross-Referencing for Active vs Shipped

**Decision:** A milestone is "active" if it appears in PROJECT.md "Current Milestone" section but NOT in MILESTONES.md. If it appears in both, status is "shipped".

**Rationale:** PROJECT.md declares current work. MILESTONES.md is the historical record of shipped milestones. Cross-referencing prevents ambiguity when a milestone is just shipped but PROJECT.md hasn't been updated yet.

**Edge case:** If milestone just shipped and both files reference it, the shipped status takes precedence (user can see accomplishments from MILESTONES.md).

### Decimal Phase Number Support

**Decision:** Use `parseFloat()` instead of `parseInt()` when extracting phase numbers from ROADMAP.md.

**Rationale:** GSD supports decimal phases (3.1, 03.1, 06.1) for inserted sub-phases. `parseInt("03.1")` returns `3`, losing the decimal. `parseFloat("03.1")` returns `3.1`, preserving accuracy.

**Impact:** Phase counting correctly handles mixed integer and decimal phases in the same milestone.

## Verification

All tests pass:
```
✓ src/milestone/__tests__/parser.test.ts (12 tests) 4ms
  Test Files  1 passed (1)
      Tests  12 passed (12)
```

TypeScript compiles without errors:
```
npx tsc --noEmit
(no output = success)
```

Types are importable from barrel:
```typescript
import type { MilestoneInfo } from './types/index.js'; // ✓ Works
```

Parser handles ENOENT for all three files without throwing (verified in tests).

## Self-Check: PASSED

**Created files:**
- ✓ autopilot/src/milestone/types.ts
- ✓ autopilot/src/milestone/parser.ts
- ✓ autopilot/src/milestone/__tests__/parser.test.ts

**Modified files:**
- ✓ autopilot/src/types/index.ts

**Commits:**
- ✓ 823e82d: test(10-01): add failing test for milestone parser
- ✓ 957dabc: feat(10-01): implement milestone parser

All files exist, all commits present, all tests pass.

## Next Steps

Plan 02 will:
- Create `/api/milestones` REST endpoint
- Wire `MilestoneProvider` interface into `ApiRouteDeps`
- Connect parser to Express routes for dashboard consumption
- Follow established provider pattern from `api.ts`
