# Phase 10: Add GSD Milestone support to autopilot and dashboard - Research

**Researched:** 2026-02-24
**Domain:** Markdown parsing, REST API design, React state management, dashboard UI patterns
**Confidence:** HIGH

## Summary

This phase adds milestone lifecycle awareness to the autopilot server and dashboard. The system must parse milestone metadata from three GSD planning files (PROJECT.md, MILESTONES.md, ROADMAP.md), expose it via a new REST endpoint, and surface it in the dashboard UI with special handling for milestone completion states.

The domain is well-understood: reading and parsing markdown files with regex (already used in the codebase), extending Express APIs (established pattern), and updating React components (mature patterns). The primary challenges are designing a coherent data model that merges three markdown sources and implementing the "victory screen" state transition on the Overview page.

**Primary recommendation:** Use regex-based markdown parsing (matches existing codebase patterns), create a dedicated `/api/milestones` endpoint with structured JSON responses, and introduce milestone-aware state in Zustand for conditional rendering of victory screens and milestone progress indicators.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dashboard display:**
- Replace the "Phases" section header with "v1.0 MVP — Phases" format when a milestone is active
- When no milestone exists, fall back to just "Phases" (current behavior)
- Show both phase count AND milestone progress indicator (e.g. "Milestone 1 of 3 — 0/1 phases complete")
- Milestone identity is scoped to the Phases card — not in the header bar or project description card

**Data sourcing:**
- Read from three sources: PROJECT.md (current milestone identity), MILESTONES.md (history/stats), ROADMAP.md (milestone groupings in progress table)
- New dedicated `/api/milestones` endpoint — not bolted onto /api/status
- Return basics + stats per milestone: version, name, status (active/shipped), shipped date, phase count, plan count, key accomplishments

**Milestone lifecycle:**
- Full lifecycle support: display, detect completion, and surface actions
- When a milestone is shipped (via /gsd:complete-milestone), the Overview page transforms into a victory/celebration screen showing milestone stats, accomplishments, and "Start next milestone" prompt
- When all phases are 100% but milestone hasn't been formally shipped: just show 100% progress bar, no special prompt
- When no active milestone exists (between milestones or fresh project): show a "No active milestone" card/message suggesting to run /gsd:new-milestone

**Multi-milestone view:**
- Dashboard shows only the current/active milestone — no history browsing
- Victory screen shows only the just-shipped milestone's stats — no reference to past milestones
- Past milestones remain in .planning/milestones/ files and MILESTONES.md but are not surfaced in the dashboard UI

### Claude's Discretion

- Victory screen visual design and animation
- Exact milestone progress indicator format and placement
- How to parse milestone data from the various .planning/ markdown files (regex, section parsing, etc.)
- API response shape for /api/milestones

### Deferred Ideas (OUT OF SCOPE)

- Historical milestone browsing/switcher on the dashboard — keep it current-only for now
- Dashboard-triggered milestone completion (button to run /gsd:complete-milestone from the UI) — complex, defer to future phase

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js fs | Built-in | Reading markdown files | Native, zero-dependency, synchronous reads sufficient for small files |
| JavaScript RegExp | Built-in | Parsing markdown sections | Already used in api.ts, lightweight, sufficient for structured GSD markdown |
| Express 5 | 5.2.1 | REST endpoint `/api/milestones` | Already in use, established routing pattern |
| Zustand 5 | Latest | Dashboard milestone state | Already in use with curried create pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 4.0.0 | Runtime validation of parsed milestone data | Already in dependencies, type-safe parsing guarantees |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RegExp parsing | marked or markdown-it | Overkill for structured GSD files with known section headers. Marked (32k stars) and markdown-it (17k stars) are excellent for full AST parsing but add ~500KB dependency for simple regex needs. Stick with regex unless parsing becomes brittle. |
| Dedicated parser | gray-matter | gray-matter extracts YAML frontmatter but GSD markdown uses section headers (## v1.0, ## Progress), not frontmatter. Not applicable. |
| `/api/milestones` | Extend `/api/status` | User specified dedicated endpoint to keep concerns separated. Status is autopilot state; milestones are project metadata. |

**Installation:**
```bash
# No new dependencies required — use existing stack
# Already have: express, zod, zustand in autopilot/package.json
```

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
├── milestone/                # NEW: Milestone-specific logic
│   ├── parser.ts            # Parse markdown files → MilestoneData[]
│   ├── types.ts             # MilestoneInfo, MilestoneStatus types
│   └── __tests__/           # TDD: parser.test.ts
├── server/routes/
│   └── api.ts               # ADD: GET /api/milestones route
└── types/
    └── index.ts             # Export milestone types

dashboard/src/
├── types/
│   └── index.ts             # Mirror milestone types
├── store/
│   └── index.ts             # ADD: milestone state slice
├── api/
│   └── client.ts            # ADD: fetchMilestones()
├── components/
│   ├── PhaseCard.tsx        # MODIFY: "v1.0 MVP — Phases" header
│   └── VictoryScreen.tsx    # NEW: Milestone completion celebration
└── pages/
    └── Overview.tsx         # MODIFY: Conditional victory screen
```

### Pattern 1: Markdown Section Extraction
**What:** Extract structured data from GSD markdown files using regex.
**When to use:** Parsing PROJECT.md, MILESTONES.md, ROADMAP.md sections with known headers.
**Example:**
```typescript
// Pattern already established in api.ts line 19:
const projectMd = readFileSync(join(process.cwd(), '.planning', 'PROJECT.md'), 'utf-8');
const match = projectMd.match(/## What This Is\n\n([\s\S]*?)(?:\n## |\n---|\n$)/);

// Extend for milestone parsing:
function extractCurrentMilestone(projectMd: string): string | null {
  const match = projectMd.match(/## Current Milestone: (v[\d.]+) (.+)/);
  return match ? match[1] : null; // Returns "v1.0"
}

function extractMilestoneEntries(milestonesMd: string): MilestoneEntry[] {
  // Match "## v1.0 MVP (Shipped: YYYY-MM-DD)" pattern
  const pattern = /## (v[\d.]+) (.+?) \(Shipped: ([\d-]+)\)\n\n\*\*Delivered:\*\* (.+?)\n\n\*\*Phases completed:\*\* (.+?)\n\n\*\*Key accomplishments:\*\*\n((?:- .+\n)+)/g;
  const entries: MilestoneEntry[] = [];
  let match;
  while ((match = pattern.exec(milestonesMd)) !== null) {
    entries.push({
      version: match[1],
      name: match[2],
      shippedDate: match[3],
      delivered: match[4],
      phasesCompleted: match[5],
      accomplishments: match[6].split('\n').filter(line => line.startsWith('-')).map(line => line.slice(2))
    });
  }
  return entries;
}
```

### Pattern 2: Dedicated API Route with Provider Pattern
**What:** New `/api/milestones` route following existing api.ts provider pattern.
**When to use:** When adding new data sources that aren't part of autopilot state.
**Example:**
```typescript
// In api.ts, add:
export interface MilestoneProvider {
  getMilestones(): MilestoneInfo[];
}

export interface ApiRouteDeps {
  stateProvider: StateProvider;
  questionProvider: QuestionProvider;
  livenessProvider?: LivenessProvider;
  activityProvider?: ActivityProvider;
  milestoneProvider?: MilestoneProvider; // NEW
}

// In createApiRoutes():
router.get('/milestones', (_req: Request, res: Response) => {
  if (!milestoneProvider) {
    res.json({ milestones: [] });
    return;
  }
  const milestones = milestoneProvider.getMilestones();
  res.json({ milestones });
});
```

### Pattern 3: Zustand State Slice for Milestones
**What:** Add milestone state to existing Zustand store with curried create pattern.
**When to use:** When adding new global state consumed by multiple components.
**Example:**
```typescript
// In dashboard/src/store/index.ts:
export interface DashboardState {
  // Existing state...
  status: AutopilotStatus;
  phases: PhaseState[];

  // NEW: Milestone state
  currentMilestone: MilestoneInfo | null;
  milestones: MilestoneInfo[];

  // NEW: Milestone actions
  setMilestones: (milestones: MilestoneInfo[]) => void;
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Existing state...
  currentMilestone: null,
  milestones: [],

  setMilestones: (milestones) => {
    const active = milestones.find(m => m.status === 'active');
    set({ milestones, currentMilestone: active ?? null });
  },
}));
```

### Pattern 4: Conditional Page Rendering
**What:** Transform Overview page into VictoryScreen when milestone is shipped.
**When to use:** State-dependent full-page replacements.
**Example:**
```typescript
// In Overview.tsx:
export function Overview() {
  const currentMilestone = useDashboardStore((s) => s.currentMilestone);
  const progress = useDashboardStore((s) => s.progress);

  // Victory screen: milestone shipped AND progress is 100%
  if (currentMilestone?.status === 'shipped' && progress === 100) {
    return <VictoryScreen milestone={currentMilestone} />;
  }

  // Normal overview
  return (
    <div className="flex flex-col gap-6">
      {/* Existing overview components */}
    </div>
  );
}
```

### Anti-Patterns to Avoid
- **Parsing markdown with string.split():** Fragile, breaks on edge cases. Use regex with named groups for structured extraction.
- **Bolting milestones onto /api/status:** User specified dedicated endpoint. Status is autopilot state (running/complete), milestones are project metadata (version history).
- **Fetching milestones on every SSE event:** Milestone data changes rarely (only when shipped). Fetch once on mount, refresh only on "milestone-shipped" SSE event.
- **Storing milestone state in localStorage:** Dashboard is ephemeral per-session. Milestone source of truth is .planning/ markdown files. Always fetch fresh on mount.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown parsing | Custom tokenizer/lexer | Node.js built-in RegExp | GSD markdown has known section structure. Regex is sufficient, zero dependencies, matches existing codebase pattern (api.ts line 19). |
| Date parsing/formatting | Custom date formatter | JavaScript Date + Intl.DateTimeFormat | Built-in, handles locales, time zones, edge cases (leap years, DST). |
| API response validation | Manual type checking | Zod schemas | Already in dependencies. Runtime validation prevents bad data reaching UI. Type-safe parsing from unknown. |
| Milestone progress calculation | Manual phase counting | Reuse `computeProgress()` from api.ts | Already tested, handles 4-step phase lifecycle (discuss/plan/execute/verify). Don't duplicate logic. |

**Key insight:** The codebase already has established patterns for markdown parsing (regex in api.ts), REST routes (provider pattern), and state management (Zustand curried create). Milestone support should follow these patterns exactly to maintain consistency.

## Common Pitfalls

### Pitfall 1: Milestone File Not Found Errors
**What goes wrong:** Dashboard crashes when .planning/MILESTONES.md doesn't exist yet (fresh projects, pre-v1.0).
**Why it happens:** GSD creates MILESTONES.md only when first milestone ships via /gsd:complete-milestone. New projects won't have it.
**How to avoid:** Wrap file reads in try-catch, return empty arrays. Treat missing files as "no milestones yet" state, not error.
**Warning signs:** Error logs "ENOENT: no such file or directory, open '.planning/MILESTONES.md'" in fresh autopilot runs.

**Prevention example:**
```typescript
function readMilestonesFile(): string {
  try {
    return readFileSync(join(process.cwd(), '.planning', 'MILESTONES.md'), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // No milestones yet
    }
    throw err; // Re-throw unexpected errors
  }
}
```

### Pitfall 2: Regex Matching Fails on Edge Cases
**What goes wrong:** Milestone regex doesn't match entries with unexpected formatting (extra whitespace, different date formats, missing sections).
**Why it happens:** GSD workflows enforce structure, but historical files or manual edits can introduce variance.
**How to avoid:** Make regex patterns flexible (optional whitespace `\s*`, non-greedy matches `.*?`). Validate matches with Zod schemas. Log parse failures for debugging.
**Warning signs:** MILESTONES.md has entries but `/api/milestones` returns empty array. Check regex with sample data in tests.

**Prevention example:**
```typescript
// Bad: Strict whitespace
const pattern = /## (v[\d.]+) (.+) \(Shipped: ([\d-]+)\)/; // Breaks if extra space

// Good: Flexible whitespace
const pattern = /##\s+(v[\d.]+)\s+(.+?)\s+\(Shipped:\s+([\d-]+)\)/;

// Validate with Zod:
const MilestoneEntrySchema = z.object({
  version: z.string().regex(/^v\d+\.\d+$/),
  name: z.string().min(1),
  shippedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

### Pitfall 3: Victory Screen Stuck When Milestone State Stale
**What goes wrong:** User completes milestone, victory screen shows, starts new milestone, but victory screen persists.
**Why it happens:** Dashboard doesn't refresh milestone state after `/gsd:new-milestone` runs. Victory condition (`status === 'shipped'`) still true.
**How to avoid:** Listen for SSE "milestone-started" event. Refetch `/api/milestones` on that event. Clear `currentMilestone` from state when new milestone begins.
**Warning signs:** Victory screen doesn't disappear after new milestone starts. Requires manual refresh.

**Prevention example:**
```typescript
// In useSSE hook, add event handler:
eventSource.addEventListener('milestone-started', () => {
  // Refetch milestones when new milestone begins
  fetchMilestones().then((data) => {
    useDashboardStore.getState().setMilestones(data.milestones);
  });
});
```

### Pitfall 4: Current Milestone Detection Ambiguity
**What goes wrong:** Multiple milestones marked as "active" in parsed data, or none marked active when one should be.
**Why it happens:** PROJECT.md has "Current Milestone: v1.1" but MILESTONES.md doesn't have v1.1 entry yet (still in progress). Parser returns no active milestone.
**How to avoid:** Define "active" as: version in PROJECT.md "Current Milestone" section that does NOT appear in MILESTONES.md (shipped). If PROJECT.md has no "Current Milestone" section, treat as "no active milestone" state.
**Warning signs:** Dashboard shows "No active milestone" when user is actively working on phases.

**Prevention example:**
```typescript
function determineActiveMilestone(
  currentMilestoneVersion: string | null,
  shippedMilestones: MilestoneEntry[]
): MilestoneInfo | null {
  if (!currentMilestoneVersion) return null;

  // If version appears in MILESTONES.md, it's shipped, not active
  const isShipped = shippedMilestones.some(m => m.version === currentMilestoneVersion);
  if (isShipped) return null;

  // Otherwise, it's the active milestone
  return {
    version: currentMilestoneVersion,
    status: 'active',
    // ... other fields from ROADMAP.md progress table
  };
}
```

### Pitfall 5: Phase Count Mismatch Between Sources
**What goes wrong:** ROADMAP.md progress table shows "Phase 1-10" but milestone parser counts 8 phases. Dashboard displays wrong milestone progress.
**Why it happens:** ROADMAP.md may have skipped phase numbers (Phase 2 deleted, 2.1 remains) or decimal phases (3.1, 3.2). Simple regex counting `Phase \d+` misses decimals.
**How to avoid:** Parse phase numbers as floats, not integers. Extract actual phase numbers from ROADMAP.md progress table, don't count rows. Match phase numbers to milestone column.
**Warning signs:** "Milestone 1 of 3 — 0/1 phases complete" but 10 phases exist.

**Prevention example:**
```typescript
// Bad: Count phase rows
const phaseCount = (roadmapMd.match(/\| \d+\./g) || []).length;

// Good: Extract phase numbers from progress table, filter by milestone
function extractMilestonePhases(roadmapMd: string, milestoneVersion: string): number[] {
  const tablePattern = /## Progress[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|([\s\S]*?)(?=\n##|$)/;
  const tableMatch = roadmapMd.match(tablePattern);
  if (!tableMatch) return [];

  const rows = tableMatch[1].split('\n').filter(line => line.includes('|'));
  const phases: number[] = [];

  for (const row of rows) {
    const cols = row.split('|').map(c => c.trim());
    if (cols[2] === milestoneVersion) { // Milestone column
      const phaseNum = parseFloat(cols[0]); // Handles "3.1", "10"
      if (!isNaN(phaseNum)) phases.push(phaseNum);
    }
  }

  return phases;
}
```

## Code Examples

Verified patterns from existing codebase:

### Reading PROJECT.md Section
```typescript
// Source: autopilot/src/server/routes/api.ts (lines 16-23)
// Already used for project description — extend for milestone
function readProjectDescription(): string {
  try {
    const projectMd = readFileSync(join(process.cwd(), '.planning', 'PROJECT.md'), 'utf-8');
    const match = projectMd.match(/## What This Is\n\n([\s\S]*?)(?:\n## |\n---|\n$)/);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

// NEW: Extract current milestone version
function readCurrentMilestone(): string | null {
  try {
    const projectMd = readFileSync(join(process.cwd(), '.planning', 'PROJECT.md'), 'utf-8');
    const match = projectMd.match(/## Current Milestone:\s+(v[\d.]+)\s+(.+)/);
    return match?.[1] ?? null; // Returns "v1.0"
  } catch {
    return null;
  }
}
```

### Express Route with Provider Pattern
```typescript
// Source: autopilot/src/server/routes/api.ts (lines 78-165)
// Extend deps interface and router
export interface ApiRouteDeps {
  stateProvider: StateProvider;
  questionProvider: QuestionProvider;
  livenessProvider?: LivenessProvider;
  activityProvider?: ActivityProvider;
  milestoneProvider?: MilestoneProvider; // NEW
}

export function createApiRoutes(deps: ApiRouteDeps): Router {
  const { milestoneProvider } = deps;
  const router = Router();

  // NEW: Milestones endpoint
  router.get('/milestones', (_req: Request, res: Response) => {
    if (!milestoneProvider) {
      res.json({ milestones: [] });
      return;
    }
    const milestones = milestoneProvider.getMilestones();
    res.json({ milestones });
  });

  return router;
}
```

### Dashboard Type Mirroring
```typescript
// Source: autopilot/dashboard/src/types/index.ts
// Mirrors server types — do NOT import from server codebase

// Server type (NEW in autopilot/src/milestone/types.ts):
export type MilestoneStatus = 'active' | 'shipped' | 'none';

export type MilestoneInfo = {
  version: string;
  name: string;
  status: MilestoneStatus;
  shippedDate?: string;
  phaseCount: number;
  planCount: number;
  accomplishments: string[];
};

// Dashboard mirror (NEW in dashboard/src/types/index.ts):
export type MilestoneStatus = 'active' | 'shipped' | 'none';

export type MilestoneInfo = {
  version: string;
  name: string;
  status: MilestoneStatus;
  shippedDate?: string;
  phaseCount: number;
  planCount: number;
  accomplishments: string[];
};
```

### Zustand Curried Create Pattern
```typescript
// Source: autopilot/dashboard/src/store/index.ts (lines 44-88)
// Extend state and actions
export interface DashboardState {
  // Existing...
  status: AutopilotStatus;
  phases: PhaseState[];

  // NEW:
  currentMilestone: MilestoneInfo | null;
  milestones: MilestoneInfo[];
  setMilestones: (milestones: MilestoneInfo[]) => void;
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Existing state...
  status: 'idle',
  phases: [],

  // NEW state:
  currentMilestone: null,
  milestones: [],

  // NEW action:
  setMilestones: (milestones) => {
    const active = milestones.find(m => m.status === 'active');
    set({ milestones, currentMilestone: active ?? null });
  },
}));
```

### Conditional Page Rendering
```typescript
// Source: autopilot/dashboard/src/pages/Overview.tsx (modified)
import { VictoryScreen } from '../components/VictoryScreen.js';

export function Overview() {
  const currentMilestone = useDashboardStore((s) => s.currentMilestone);
  const progress = useDashboardStore((s) => s.progress);

  // Victory screen when milestone shipped AND all phases complete
  if (currentMilestone?.status === 'shipped' && progress === 100) {
    return <VictoryScreen milestone={currentMilestone} />;
  }

  // Normal overview
  return (
    <div className="flex flex-col gap-6">
      {/* Existing components */}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline markdown parsing with string methods | Regex with named groups + Zod validation | 2024-2025 | Type-safe parsing, runtime validation catches bad data before UI. |
| Single /api/status endpoint for all data | Dedicated endpoints per concern (/api/status, /api/activities, /api/milestones) | 2026 (this phase) | Cleaner separation, easier to test, avoids over-fetching. |
| LocalStorage for dashboard state | SSE-driven state + REST fetch on mount | Phase 5-6 | Real-time updates, server is source of truth. |
| Manual type duplication | Explicit type mirroring (comment "duplicated from server") | Phase 5 | Intentional separation, Vite project can't import server types. |

**Deprecated/outdated:**
- **Markdown libraries for simple parsing:** marked/markdown-it were considered industry standard, but for structured files with known section headers, regex is lighter and sufficient. Only use full markdown parsers if generating HTML or need AST.
- **WebSockets over SSE:** Early dashboard research considered WebSockets, but SSE chosen for simplicity (Phase 4-5). Milestone support follows SSE pattern for consistency.

## Open Questions

1. **Milestone completion detection**
   - What we know: User runs `/gsd:complete-milestone` which updates MILESTONES.md and STATE.md. Dashboard must detect this.
   - What's unclear: Does autopilot emit an SSE event when milestone completes? Or does dashboard poll `/api/milestones`?
   - Recommendation: Add "milestone-shipped" SSE event in orchestrator when detecting STATE.md change. Dashboard listens for this event and refetches milestones. Avoids polling.

2. **Victory screen persistence**
   - What we know: Victory screen shows when `currentMilestone.status === 'shipped'` and `progress === 100`.
   - What's unclear: How does user dismiss victory screen? Auto-dismiss after delay? Explicit "Start next milestone" button?
   - Recommendation: "Start next milestone" button runs `/gsd:new-milestone` command. On success, refetch milestones (new milestone now active), victory screen disappears. No auto-dismiss — let user celebrate.

3. **Milestone-less projects**
   - What we know: Fresh projects have no milestones until first ship.
   - What's unclear: Should dashboard show "No active milestone" message, or hide milestone UI entirely?
   - Recommendation: Show "No active milestone" empty state in PhaseCard header area. Suggests `/gsd:new-milestone` command. Helps users discover milestone workflow.

4. **Decimal phase numbering in milestones**
   - What we know: Phases can be integers (1, 2, 3) or decimals (3.1, 3.2) for insertions.
   - What's unclear: How to parse milestone column from ROADMAP.md progress table when phases are decimals?
   - Recommendation: Parse phase numbers as floats (`parseFloat("3.1")` works). Extract milestone version from "Milestone" column in progress table. Match phases to milestone by column value.

5. **Milestone name vs version display**
   - What we know: Milestones have version (v1.0) and name (MVP).
   - What's unclear: Display "v1.0" or "v1.0 MVP" or "MVP (v1.0)" in PhaseCard header?
   - Recommendation: "v1.0 MVP" format (version first, name second). Matches user decision: "v1.0 MVP — Phases". Clear, concise, version is primary identifier.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `autopilot/src/server/routes/api.ts` — Established markdown parsing and REST route patterns
- Existing codebase: `autopilot/dashboard/src/store/index.ts` — Zustand curried create pattern
- Existing codebase: `autopilot/dashboard/src/types/index.ts` — Type mirroring pattern
- GSD templates: `~/.claude/get-shit-done/templates/milestone.md` — Milestone markdown structure
- GSD workflows: `~/.claude/get-shit-done/workflows/complete-milestone.md` — Milestone lifecycle
- GSD workflows: `~/.claude/get-shit-done/workflows/new-milestone.md` — Milestone initialization

### Secondary (MEDIUM confidence)
- [Marked Documentation](https://marked.js.org/) — Markdown parsing library (not needed for this phase)
- [GitHub - markdown-it/markdown-it](https://github.com/markdown-it/markdown-it) — Alternative parser (not needed)
- [Top 12 JavaScript Markdown Libraries](https://byby.dev/js-markdown-libs) — Ecosystem comparison

### Tertiary (LOW confidence)
- None — all findings verified against existing codebase or official GSD templates

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Uses existing patterns (regex, Express, Zustand) from codebase
- Architecture: HIGH — Provider pattern, type mirroring, curried create all established in phases 4-5
- Pitfalls: MEDIUM — File-not-found and regex edge cases verified from experience, but victory screen state transitions need validation during implementation

**Research date:** 2026-02-24
**Valid until:** 60 days (stable domain — markdown parsing, REST APIs, React patterns)
