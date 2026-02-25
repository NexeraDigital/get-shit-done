---
phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access
plan: "03"
subsystem: dashboard/ui
tags: [ui, notifications, remote-access]
dependency_graph:
  requires:
    - phase: 11-01
      provides: TunnelManager class
    - phase: 11-02
      provides: tunnelUrl in AutopilotState
  provides:
    - TunnelBanner component for dashboard UI
    - Tunnel URL in all console notifications
    - Copy-to-clipboard functionality
  affects: [dashboard-ui, notifications, user-experience]
tech_stack:
  added: []
  patterns:
    - "Zustand selector pattern for reactive UI"
    - "Clipboard API with temporary feedback state"
    - "Callback-based dependency injection for getTunnelUrl"
    - "Tailwind CSS responsive design (mobile/desktop)"
key_files:
  created:
    - path: autopilot/dashboard/src/components/TunnelBanner.tsx
      loc: 60
      exports: [TunnelBanner]
      purpose: "Display tunnel URL with copy button, hide when tunnel disabled"
  modified:
    - path: autopilot/dashboard/src/store/index.ts
      change: "Added tunnelUrl field and setTunnelUrl action to Zustand store"
    - path: autopilot/dashboard/src/api/client.ts
      change: "Added tunnelUrl to StatusResponse interface"
    - path: autopilot/dashboard/src/hooks/useSSE.ts
      change: "Extract tunnelUrl from /api/status and set in store"
    - path: autopilot/dashboard/src/pages/Overview.tsx
      change: "Integrated TunnelBanner at top of page"
    - path: autopilot/src/notifications/adapters/console.ts
      change: "Added getTunnelUrl callback and appended dashboard URL to all notifications"
    - path: autopilot/src/cli/index.ts
      change: "Wired getTunnelUrl callback to ConsoleAdapter using tunnelManager.url"
decisions:
  - id: TUNNEL-UI-01
    summary: "Tunnel URL displayed at top of Overview page (before all content)"
    rationale: "Maximum visibility for remote access link, user can immediately see and copy URL"
    alternatives: ["Footer banner", "Header bar", "Settings page"]
  - id: TUNNEL-UI-02
    summary: "Copy button shows temporary 'Copied!' feedback for 2 seconds"
    rationale: "Clear user feedback that action succeeded, auto-resets for repeated use"
    alternatives: ["Permanent checkmark", "Toast notification"]
  - id: TUNNEL-UI-03
    summary: "Purple color scheme (bg-purple-50, border-purple-200) for tunnel banner"
    rationale: "Visually distinct from other dashboard elements (gray/blue), suggests 'special' feature"
    alternatives: ["Blue (consistent with existing)", "Green (success/active)"]
  - id: TUNNEL-NOTIFY-01
    summary: "Dashboard URL appended to every notification type (question, error, complete, progress)"
    rationale: "User decision: 'Every notification includes tunnel URL for remote access from phone notifications'"
    alternatives: ["One-time startup message only"]
  - id: TUNNEL-NOTIFY-02
    summary: "getTunnelUrl callback injected via constructor options"
    rationale: "ConsoleAdapter created before TunnelManager, callback pattern allows late binding"
    alternatives: ["Pass tunnelUrl as parameter to send()", "Global state access"]
metrics:
  duration: 5min
  tasks_completed: 3
  files_created: 1
  files_modified: 6
  tests_added: 0
  completed: 2026-02-25
---

# Phase 11 Plan 03: Surface Tunnel URL in Dashboard UI and Notifications Summary

**Tunnel URL discoverable in dashboard banner with copy button, included in all console notifications for remote access from any device**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T17:57:38Z
- **Completed:** 2026-02-25T18:02:59Z
- **Tasks:** 3
- **Files created:** 1
- **Files modified:** 6

## Accomplishments

- Added tunnelUrl field to dashboard Zustand store with setter action
- Created TunnelBanner component with copy-to-clipboard functionality
- Integrated TunnelBanner at top of Overview page for maximum visibility
- Updated StatusResponse interface to include tunnelUrl from server
- Wired tunnelUrl extraction in useSSE hook (initial rehydration and polling)
- Added getTunnelUrl callback to ConsoleAdapter constructor options
- Appended dashboard URL to all console notification types (question, error, complete, progress)
- Wired getTunnelUrl in CLI using tunnelManager.url getter
- Graceful fallback to localhost URL when tunnel is disabled or unavailable

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tunnelUrl to dashboard state and API client** - `9f9da2d` (feat)
2. **Task 2: Create TunnelBanner component and integrate into Overview page** - `898331c` (feat)
3. **Task 3: Update ConsoleAdapter to include tunnel URL in all notifications** - `b96d66c` (feat)

**Plan metadata:** (committed separately after SUMMARY creation)

## Files Created/Modified

### Created
- `autopilot/dashboard/src/components/TunnelBanner.tsx` - Banner component with globe icon, URL display, and copy button; uses purple color scheme; hides when tunnelUrl is null

### Modified
- `autopilot/dashboard/src/store/index.ts` - Added tunnelUrl: string | null field and setTunnelUrl(url) action
- `autopilot/dashboard/src/api/client.ts` - Added tunnelUrl?: string to StatusResponse interface
- `autopilot/dashboard/src/hooks/useSSE.ts` - Extract tunnelUrl from status response in rehydrate() and polling timer
- `autopilot/dashboard/src/pages/Overview.tsx` - Import and render TunnelBanner at top of page (line 44)
- `autopilot/src/notifications/adapters/console.ts` - Added getTunnelUrl callback option, append dashboard URL to all notification formats
- `autopilot/src/cli/index.ts` - Wire getTunnelUrl callback to ConsoleAdapter, populate after TunnelManager creation

## Implementation Details

### TunnelBanner Component

**Structure:**
- Reads tunnelUrl from Zustand store via selector: `useDashboardStore((s) => s.tunnelUrl)`
- Returns null if tunnelUrl is null (no banner rendered)
- If tunnelUrl present:
  - Purple banner (bg-purple-50, border-purple-200)
  - Globe emoji icon (🌐)
  - "Remote access enabled" heading
  - Clickable URL link (opens in new tab)
  - Copy button with temporary "✓ Copied!" feedback
  - Responsive layout: side-by-side on desktop, stacked on mobile

**Copy functionality:**
```typescript
const handleCopy = async () => {
  await navigator.clipboard.writeText(tunnelUrl);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};
```

**Integration:**
- Placed at top of Overview page (line 44), before project description
- Full-width banner above all content for maximum visibility

### Dashboard State Management

**Store additions:**
```typescript
export interface DashboardState {
  tunnelUrl: string | null; // Public dev-tunnel URL, null if disabled or failed
  setTunnelUrl: (url: string | null) => void;
}
```

**Initial value:** `tunnelUrl: null`

**API response:** StatusResponse includes `tunnelUrl?: string`

**Extraction points:**
1. Initial rehydration in useSSE.rehydrate()
2. Event handlers (phase-started, phase-completed, step-completed, build-complete)
3. Polling timer (every 3s)

All extraction points call: `store.setTunnelUrl(statusRes.tunnelUrl ?? null)`

### Console Notification Integration

**ConsoleAdapter changes:**
```typescript
export interface ConsoleAdapterOptions {
  getTunnelUrl?: () => string | null; // NEW: callback to get current tunnel URL
}
```

**Pattern:**
```typescript
const tunnelUrl = this.getTunnelUrl?.() || null;
const baseUrl = tunnelUrl || `http://localhost:${this.port}`;
// Append to notification body:
lines.push(`\n${ansis.dim('Dashboard:')} ${baseUrl}`);
```

**Applied to all notification types:**
- formatQuestion() - Includes dashboard URL after options
- formatError() - Includes dashboard URL after error details
- formatComplete() - Includes dashboard URL after summary
- formatProgress() - Includes dashboard URL after title

**CLI wiring:**
```typescript
// Declare closure variable for late binding
let tunnelUrlGetter: (() => string | null) | undefined;

// Pass to ConsoleAdapter before TunnelManager exists
new ConsoleAdapter({
  getTunnelUrl: () => tunnelUrlGetter?.() ?? null,
});

// Populate after TunnelManager creation
if (enableTunnel) {
  tunnelManager = new TunnelManager({ ... });
  tunnelUrlGetter = () => tunnelManager?.url || null;
}
```

This callback pattern allows ConsoleAdapter to be created before TunnelManager (order preserved for adapter initialization), while still accessing tunnel URL dynamically when notifications are sent.

## User Experience

**Remote access workflow:**
1. User runs `gsd-autopilot` with tunnel enabled (default)
2. TunnelManager creates public HTTPS URL
3. Dashboard shows purple banner at top with tunnel URL
4. User clicks "Copy URL" button to copy to clipboard
5. User pastes URL on phone/tablet browser
6. Dashboard accessible from any device on any network

**Notification workflow:**
1. Autopilot asks a question or reports progress
2. Console notification includes: `Dashboard: https://{tunnel-id}.devtunnels.ms`
3. User receives phone notification (via Slack/Teams/system adapter)
4. User taps URL link in notification
5. Dashboard opens on phone to answer question or view progress

**Graceful degradation:**
- Tunnel disabled (`--no-tunnel`): Banner hidden, notifications show localhost URL
- Tunnel creation fails: Banner hidden, notifications show localhost URL
- Tunnel reconnects: Banner updates with new URL, notifications use new URL

## Decisions Made

**Banner placement:** Top of Overview page, before all content, for maximum visibility. User immediately sees remote access link without scrolling.

**Copy feedback:** Button text changes to "✓ Copied!" for 2 seconds, providing clear confirmation without modal/toast overhead.

**Color scheme:** Purple (bg-purple-50, border-purple-200) to visually distinguish from other dashboard elements (gray phase cards, blue progress bars).

**Notification frequency:** Dashboard URL appended to every notification (not just startup message), per user decision in CONTEXT.md. Ensures every phone notification is a clickable entry point to dashboard.

**Callback pattern:** getTunnelUrl injected as callback (not direct value) because ConsoleAdapter is created before TunnelManager exists. Callback allows late binding with zero refactoring.

**Fallback behavior:** When tunnel is null (disabled or failed), show nothing in UI and use localhost URL in notifications. Dashboard remains accessible locally.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled cleanly, all verification checks passed, dashboard built successfully.

## Verification Results

### TypeScript Compilation
```bash
$ cd autopilot && npx tsc --noEmit
(no errors)

$ cd autopilot/dashboard && npx tsc --noEmit
(no errors)
```

### Dashboard Build
```bash
$ cd autopilot/dashboard && npm run build
✓ 223 modules transformed
✓ built in 1.02s
```

### Component Integration
```bash
$ grep -n "TunnelBanner" autopilot/dashboard/src/pages/Overview.tsx
5:import { TunnelBanner } from '../components/TunnelBanner.js';
44:      <TunnelBanner />
```

### Store Integration
```bash
$ grep -n "tunnelUrl" autopilot/dashboard/src/store/index.ts
28:  tunnelUrl: string | null;
68:  tunnelUrl: null,
102:  setTunnelUrl: (url) => set({ tunnelUrl: url }),
```

### Notification Integration
```bash
$ grep -n "getTunnelUrl" autopilot/src/notifications/adapters/console.ts
23:  getTunnelUrl?: () => string | null;
32:  private readonly getTunnelUrl?: () => string | null;
38:    this.getTunnelUrl = options.getTunnelUrl;
80:    const tunnelUrl = this.getTunnelUrl?.() || null;
107:    const tunnelUrl = this.getTunnelUrl?.() || null;
133:    const tunnelUrl = this.getTunnelUrl?.() || null;
155:    const tunnelUrl = this.getTunnelUrl?.() || null;
```

## Next Phase Readiness

Plan 11-03 complete. Phase 11 is fully implemented:
- Plan 11-01: TunnelManager class with dev-tunnels SDK integration
- Plan 11-02: Tunnel lifecycle wired into CLI and standalone server
- Plan 11-03: Tunnel URL surfaced in dashboard UI and all notifications

Ready for phase completion and transition to next phase.

## Self-Check: PASSED

All files verified:

### Created Files Exist
```bash
$ [ -f "autopilot/dashboard/src/components/TunnelBanner.tsx" ] && echo "FOUND"
FOUND
```

### Modified Files Exist
```bash
$ [ -f "autopilot/dashboard/src/store/index.ts" ] && echo "FOUND"
FOUND
$ [ -f "autopilot/dashboard/src/api/client.ts" ] && echo "FOUND"
FOUND
$ [ -f "autopilot/dashboard/src/hooks/useSSE.ts" ] && echo "FOUND"
FOUND
$ [ -f "autopilot/dashboard/src/pages/Overview.tsx" ] && echo "FOUND"
FOUND
$ [ -f "autopilot/src/notifications/adapters/console.ts" ] && echo "FOUND"
FOUND
$ [ -f "autopilot/src/cli/index.ts" ] && echo "FOUND"
FOUND
```

### Commits Exist
```bash
$ git log --oneline --all | grep -q "9f9da2d" && echo "FOUND: 9f9da2d"
FOUND: 9f9da2d
$ git log --oneline --all | grep -q "898331c" && echo "FOUND: 898331c"
FOUND: 898331c
$ git log --oneline --all | grep -q "b96d66c" && echo "FOUND: b96d66c"
FOUND: b96d66c
```

### TypeScript Compilation
```bash
$ cd autopilot && npx tsc --noEmit && echo "PASSED"
PASSED
$ cd autopilot/dashboard && npx tsc --noEmit && echo "PASSED"
PASSED
```

### Dashboard Build
```bash
$ cd autopilot/dashboard && npm run build && echo "PASSED"
✓ built in 1.02s
PASSED
```

All verification checks passed.

---
*Phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access*
*Completed: 2026-02-25*
