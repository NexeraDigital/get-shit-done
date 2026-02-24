# Phase 9: Fix Recent Activity Persistence - Research

**Researched:** 2026-02-24
**Domain:** Dashboard activity feed persistence, SSE event capture, JSON storage, relative time formatting
**Confidence:** HIGH

## Summary

Phase 9 requires fixing three interconnected issues with the dashboard's Recent Activity feed: (1) persistence to disk so activities survive restarts, (2) displaying meaningful content instead of raw UUIDs, and (3) accurate server-side timestamps with proper relative time formatting. The codebase already has all the infrastructure needed - event streaming via SSE, file-based persistence patterns (StateStore, EventWriter), and a working activity feed component. The task is to connect these pieces: capture activity events at their source (orchestrator/ClaudeService), persist them to `.planning/autopilot-activity.json`, and enhance the dashboard to display them correctly.

**Key insight:** Activities are currently created client-side in `useSSE.ts` with client-generated timestamps (`new Date().toISOString()`), which explains the time inconsistency. The fix requires moving activity creation server-side where events originate, ensuring timestamps reflect actual event time, and persisting to a cumulative JSON file that survives restarts.

**Primary recommendation:** Create an ActivityStore class following the StateStore pattern (write-file-atomic for atomic writes), wire it into the orchestrator/ClaudeService event handlers to capture activities at source with server timestamps, add a REST endpoint `/api/activities` for initial load, and enhance the dashboard's timeAgo function to switch from relative to absolute format at 24h.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Activity content & display**
- Question-pending activities show truncated question text, not raw UUIDs (e.g. "Question: Which authentication method shou...")
- Truncation length and approach: Claude's discretion
- Phase-change activities use phase name + action format (e.g. "Phase 3: Core Orchestrator — started", "Phase 5: React Dashboard — completed")
- Answered questions show in feed marked as answered (e.g. checkmark indicator) but do NOT display the answer text

**Persistence & retention**
- Activities stored in a single JSON file: `.planning/autopilot-activity.json`
- Keep everything — no pruning, full build history retained
- File is cumulative across all autopilot runs for the project (not reset on fresh start, resume continues existing)
- Dashboard shows last 20 entries with a "Load more" button for older entries

**Time display behavior**
- All activity timestamps are server-side (created when the event actually happens, persisted in JSON)
- Relative time for events < 24h old ("just now", "5 minutes ago", "2 hours ago")
- Switch to absolute date for events >= 24h old ("Feb 24, 2:30 PM")
- Timestamps update live in the browser every 30 seconds
- No tooltip on hover — just the relative/absolute time displayed

**Activity types & severity**
- Events that generate activities: phase started/completed/failed, questions pending/answered, errors, build complete, AND step-level changes (research started, planning started, etc.)
- Visual distinction via colored dots: orange for questions, green for success, red for errors, blue for progress
- Error activities get extra visual weight: bold text + red background tint so they stand out
- No filtering UI needed — feed shows all types

### Claude's Discretion

- Exact truncation length for question text in activity entries
- JSON file structure and schema for activity storage
- How to wire persistence into existing SSE event flow
- Activity deduplication strategy (if needed)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| write-file-atomic | 5.0.1 | Atomic file writes | Already used in StateStore, prevents partial writes on crash |
| zod | 3.24.1 | Schema validation | Already used for state validation, ensures JSON integrity |
| Node.js fs/promises | Built-in | File I/O operations | Standard for async file operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| EventEmitter | Built-in | Event propagation | Already used by orchestrator/ClaudeService for SSE events |
| Express Router | 5.x | REST endpoints | Already used for /api routes, same pattern for /api/activities |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single JSON file | NDJSON append-only log | NDJSON used for events.ndjson (SSE stream), but activities need full history query for "Load more" — JSON better for bounded list operations |
| write-file-atomic | Direct fs.writeFile | Atomic writes prevent corruption on crash/SIGTERM — critical for cumulative history |
| Server timestamps | Client timestamps | Client timestamps cause "just now" → "17s ago" inconsistencies on reload (observed bug) |

**Installation:**
No new dependencies required — all libraries already in project.

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
├── activity/
│   ├── index.ts           # ActivityStore class (persistence + in-memory buffer)
│   └── types.ts           # ActivityEntry type definition
├── server/routes/
│   └── api.ts             # Add GET /api/activities endpoint
└── orchestrator/index.ts  # Wire ActivityStore to event handlers
```

### Pattern 1: ActivityStore with Ring Buffer
**What:** Persistence class that maintains both disk state (full history) and in-memory buffer (recent 50 for SSE initial burst)
**When to use:** When you need durable storage with fast initial state hydration
**Example:**
```typescript
// autopilot/src/activity/index.ts
import writeFileAtomic from 'write-file-atomic';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityEntry } from './types.js';

const RING_BUFFER_SIZE = 50; // Match existing log buffer pattern

export class ActivityStore {
  private activities: ActivityEntry[] = [];
  private readonly filePath: string;

  constructor(projectDir: string) {
    this.filePath = join(projectDir, '.planning', 'autopilot-activity.json');
  }

  /** Restore from disk on startup (fails gracefully if file doesn't exist) */
  async restore(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { activities: ActivityEntry[] };
      this.activities = parsed.activities ?? [];
    } catch {
      // File doesn't exist yet (fresh project) or is malformed — start empty
      this.activities = [];
    }
  }

  /** Add activity and persist to disk */
  async addActivity(entry: ActivityEntry): Promise<void> {
    this.activities.unshift(entry); // Newest first
    await this.persist();
  }

  /** Get recent N activities (for SSE initial burst) */
  getRecent(limit = RING_BUFFER_SIZE): ActivityEntry[] {
    return this.activities.slice(0, limit);
  }

  /** Get all activities (for REST endpoint with pagination) */
  getAll(): ActivityEntry[] {
    return this.activities;
  }

  /** Atomic write to disk */
  private async persist(): Promise<void> {
    await writeFileAtomic(
      this.filePath,
      JSON.stringify({ activities: this.activities }, null, 2) + '\n',
    );
  }
}
```

### Pattern 2: Server-Side Activity Creation
**What:** Create ActivityEntry objects at the event source (orchestrator, ClaudeService) with server timestamps
**When to use:** To ensure timestamps reflect actual event time, not client processing time
**Example:**
```typescript
// autopilot/src/orchestrator/index.ts (inside runPhase method)
this.emit('phase:started', { phase: phase.number, name: phase.name });

// NEW: Create activity entry with server timestamp
await this.activityStore.addActivity({
  type: 'phase-started',
  message: `Phase ${phase.number}: ${phase.name} — started`,
  timestamp: new Date().toISOString(),
  metadata: { phase: phase.number },
});
```

### Pattern 3: Enhanced timeAgo with Absolute Date Fallback
**What:** Extend existing timeAgo function to switch to absolute format for events >= 24h
**When to use:** In ActivityFeed component to match user-specified time display behavior
**Example:**
```typescript
// autopilot/dashboard/src/components/ActivityFeed.tsx
function formatTimestamp(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  const diffHours = Math.floor(diffSeconds / 3600);

  // Absolute date for >= 24h
  if (diffHours >= 24) {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }); // "Feb 24, 2:30 PM"
  }

  // Relative time for < 24h
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  return `${diffHours}h ago`;
}
```

### Pattern 4: Load More Pagination
**What:** REST endpoint returns all activities, dashboard component shows first 20 with "Load more" button
**When to use:** When full history is large but most users only need recent entries
**Example:**
```typescript
// Dashboard component state
const [visibleCount, setVisibleCount] = useState(20);
const activities = useDashboardStore(state => state.activities);

// Load more handler
const loadMore = () => setVisibleCount(prev => prev + 20);

// Render
{activities.slice(0, visibleCount).map(activity => ...)}
{visibleCount < activities.length && (
  <button onClick={loadMore}>Load more</button>
)}
```

### Anti-Patterns to Avoid

- **Client-side activity creation in useSSE.ts:** Creates activities with `new Date().toISOString()` during SSE event processing, which reflects when the client received/processed the event, not when it actually happened. This causes the "just now" → "17s ago" inconsistency on reload.

- **Storing raw UUID in activity message:** Current code shows `message: "New question pending: ${data.id}"` where `data.id` is a UUID like "2f199945-0dcf-4...". Users can't understand what the question was about without clicking through.

- **Overwriting activity file on each write:** Using `fs.writeFile` without atomicity risks file corruption on crash. StateStore already uses write-file-atomic — follow the same pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes | Custom lock/rename logic | write-file-atomic | Handles all edge cases: partial writes, crash recovery, concurrent access |
| JSON schema validation | Manual property checks | zod | Already used in StateStore, provides type inference + runtime validation |
| Relative time formatting | Custom date math | Inline helper (already exists) | User decision [05-02] explicitly chose inline helper over date-fns dependency |
| Activity deduplication | Hash-based checking | Timestamp + type uniqueness | Activities are event-driven (discrete occurrences) — no need for dedup unless SSE reconnect replays events (already handled by rehydrate logic) |

**Key insight:** The codebase already has established patterns for every piece of this work. Don't introduce new libraries or patterns — follow StateStore for persistence, follow existing useSSE rehydration for initial load, follow existing timeAgo for formatting.

## Common Pitfalls

### Pitfall 1: Race Condition on Activity Persistence
**What goes wrong:** Multiple events fire rapidly (phase start + step start + log entry), causing concurrent writes to autopilot-activity.json. Without proper serialization, writes can interleave and corrupt the JSON.
**Why it happens:** EventEmitter handlers are async but fire concurrently when events happen close together.
**How to avoid:** Use write-file-atomic (serializes writes internally) and ensure ActivityStore.addActivity awaits the persist call before resolving. Don't fire-and-forget the addActivity promise.
**Warning signs:** JSON parse errors on dashboard load, missing activities from rapid event sequences.

### Pitfall 2: Memory Leak from Unbounded Activity Array
**What goes wrong:** Activities array grows indefinitely in memory. A long-running autopilot build could accumulate thousands of entries, exhausting memory.
**Why it happens:** User specified "keep everything" for disk, but didn't specify in-memory strategy.
**How to avoid:** Store full history on disk, but only keep recent N entries in memory (ring buffer pattern). REST endpoint reads from disk on demand for "Load more".
**Warning signs:** Increasing memory usage over time, dashboard lag as activity count grows.

### Pitfall 3: Time Zone Confusion in Absolute Date Display
**What goes wrong:** ISO timestamps are UTC, but user expects local time. Displaying "Feb 24, 8:30 PM" when event happened at 8:30 PM local but stored as "2026-02-25T04:30:00Z" causes confusion.
**Why it happens:** `new Date(isoString).toLocaleDateString()` converts to local time zone automatically, but it's not obvious.
**How to avoid:** Trust browser APIs — toLocaleDateString uses local time zone by default. Document that timestamps are stored as UTC ISO strings but displayed in user's local time.
**Warning signs:** User reports "wrong time" but it's actually correct in their time zone.

### Pitfall 4: SSE Reconnect Replaying Old Activities
**What goes wrong:** When SSE reconnects, it broadcasts all recent activities from the buffer. If these are added to the dashboard store again, they duplicate.
**Why it happens:** useSSE.ts rehydrates full state on reconnect, which should replace activities array, but if rehydration fails or is incomplete, SSE events add to existing state.
**How to avoid:** On SSE 'open' event, the rehydrate() function should fetch the full activity list from /api/activities and replace (not append) the store's activities array. SSE events during the same session only append new activities.
**Warning signs:** Duplicate entries in activity feed after reconnect, feed scrolling strangely.

### Pitfall 5: Question Text Truncation Breaking Mid-Word
**What goes wrong:** Truncating at character N can break mid-word ("Which authentication meth..." looks sloppy).
**Why it happens:** Simple substring logic doesn't account for word boundaries.
**How to avoid:** Truncate at last space before the limit, or use a conservative limit (e.g., 60 chars) where mid-word breaks are tolerable with "..." suffix.
**Warning signs:** User feedback that question previews look "cut off weirdly".

## Code Examples

Verified patterns from codebase inspection:

### ActivityEntry Type Definition
```typescript
// autopilot/src/activity/types.ts
export type ActivityEntry = {
  type:
    | 'phase-started'
    | 'phase-completed'
    | 'phase-failed'
    | 'step-started'
    | 'step-completed'
    | 'question-pending'
    | 'question-answered'
    | 'error'
    | 'build-complete';
  message: string;
  timestamp: string; // ISO 8601
  metadata?: {
    phase?: number;
    step?: string;
    questionId?: string;
    [key: string]: unknown;
  };
};
```

### Wiring ActivityStore into Orchestrator
```typescript
// autopilot/src/orchestrator/index.ts (constructor)
export class Orchestrator extends EventEmitter {
  private readonly activityStore: ActivityStore;

  constructor(options: OrchestratorOptions) {
    super();
    // ... existing init
    this.activityStore = new ActivityStore(this.projectDir);
  }

  async init(): Promise<void> {
    // ... existing init
    await this.activityStore.restore();
  }

  private async runPhase(phase: PhaseState): Promise<void> {
    this.emit('phase:started', { phase: phase.number, name: phase.name });
    await this.activityStore.addActivity({
      type: 'phase-started',
      message: `Phase ${phase.number}: ${phase.name} — started`,
      timestamp: new Date().toISOString(),
      metadata: { phase: phase.number },
    });
    // ... rest of method
  }
}
```

### REST Endpoint for Activities
```typescript
// autopilot/src/server/routes/api.ts (add to createApiRoutes)
router.get('/activities', (_req: Request, res: Response) => {
  const activities = activityProvider.getAll();
  res.json({ activities });
});
```

### Dashboard Rehydration with Activities
```typescript
// autopilot/dashboard/src/hooks/useSSE.ts (modify rehydrate function)
async function rehydrate(): Promise<void> {
  const store = useDashboardStore.getState();
  try {
    const [statusRes, phasesRes, questionsRes, activitiesRes] = await Promise.all([
      fetchStatus(),
      fetchPhases(),
      fetchQuestions(),
      fetchActivities(), // NEW
    ]);
    store.setStatus({ /* ... */ });
    store.setPhases(phasesRes.phases);
    store.setQuestions(questionsRes.questions);
    store.setActivities(activitiesRes.activities); // NEW: replace, not append
  } catch {
    // Rehydration failure is non-fatal
  }
}
```

### Enhanced Time Display with Live Updates
```typescript
// autopilot/dashboard/src/components/ActivityFeed.tsx
export function ActivityFeed({ activities }: ActivityFeedProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update timestamp display every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="...">
      {activities.slice(0, 20).map((activity) => (
        <div key={activity.timestamp}>
          <span>{formatTimestamp(activity.timestamp, currentTime)}</span>
          <p>{activity.message}</p>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(isoString: string, now: number): string {
  const then = new Date(isoString).getTime();
  const diffHours = Math.floor((now - then) / 3600000);

  if (diffHours >= 24) {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // ... relative time logic
}
```

### Question Text Truncation
```typescript
// Utility function for truncating question text
function truncateQuestion(text: string, maxLength = 60): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

// Usage in activity creation
await this.activityStore.addActivity({
  type: 'question-pending',
  message: `Question: ${truncateQuestion(questionText)}`,
  timestamp: new Date().toISOString(),
  metadata: { questionId: event.id },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side activity creation | Server-side at event origin | Phase 9 (this fix) | Eliminates timestamp drift, ensures consistency |
| Raw UUID display | Truncated question text | Phase 9 (this fix) | Users can understand activity without clicking |
| In-memory only | Persistent to disk | Phase 9 (this fix) | Activities survive restart, full build history |
| Relative time only | Relative < 24h, absolute >= 24h | Phase 9 (this fix) | Long-running builds show stable dates |

**Deprecated/outdated:**
- Current ActivityItem type (dashboard/src/types/index.ts) is minimal and doesn't include metadata field — will need to extend it to support questionId, phase, step for richer activity context.

## Open Questions

1. **Should step-level activities be distinct from phase-level activities?**
   - What we know: User decision says "step-level changes (research started, planning started, etc.)" should generate activities
   - What's unclear: Should they use type 'step-started' or reuse 'phase-started'? Different colored dots or same blue?
   - Recommendation: Use separate 'step-started' and 'step-completed' types with blue dots (progress indicator). This keeps them visually consistent with phase activities while allowing future differentiation if needed.

2. **How to handle activity persistence failures?**
   - What we know: write-file-atomic can fail (disk full, permissions, etc.)
   - What's unclear: Should ActivityStore.addActivity throw on failure, or swallow and log?
   - Recommendation: Log error but don't throw — activity persistence is "nice to have" but shouldn't crash the build. Use try-catch in addActivity and emit error via logger.

3. **Should activities array in JSON be newest-first or oldest-first?**
   - What we know: Dashboard displays newest first, "Load more" loads older entries
   - What's unclear: Disk format order affects read performance for initial load vs. append performance for write
   - Recommendation: Store newest-first (same as display order) to minimize dashboard processing. Append cost is negligible with write-file-atomic (full rewrite anyway).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: autopilot/src/state/index.ts (StateStore pattern)
- Codebase inspection: autopilot/src/ipc/event-writer.ts (NDJSON append pattern)
- Codebase inspection: autopilot/dashboard/src/hooks/useSSE.ts (current activity creation)
- Codebase inspection: autopilot/dashboard/src/components/ActivityFeed.tsx (timeAgo implementation)
- Codebase inspection: autopilot/src/orchestrator/index.ts (event emission points)
- Codebase inspection: autopilot/src/claude/question-handler.ts (question event structure)
- User decision doc: .planning/phases/09-*/CONTEXT.md (locked implementation decisions)
- Prior decisions: [05-02] inline timeAgo helper instead of date-fns
- Prior decisions: [04-02] AutopilotLogger extends EventEmitter for SSE delivery

### Secondary (MEDIUM confidence)
- Node.js documentation: Date.prototype.toLocaleDateString() for locale-aware formatting
- MDN Web Docs: EventSource API for SSE reconnection behavior

### Tertiary (LOW confidence)
None — all findings verified through codebase inspection or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project, verified via package.json and usage
- Architecture: HIGH - Patterns directly observed in existing code (StateStore, EventEmitter, REST endpoints)
- Pitfalls: MEDIUM-HIGH - Race conditions inferred from async event handlers, truncation UX from common sense, memory leak from unbounded array pattern, time zone from browser API behavior

**Research date:** 2026-02-24
**Valid until:** 30 days (stable domain — file I/O patterns, EventEmitter, REST APIs don't change frequently)
