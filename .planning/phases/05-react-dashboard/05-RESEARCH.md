# Phase 5: React Dashboard - Research

**Researched:** 2026-02-17
**Domain:** React SPA with SSE real-time updates, pre-built for npm distribution, served by Express 5
**Confidence:** HIGH

## Summary

Phase 5 builds a React Single Page Application (SPA) that consumes the Phase 4 REST API and SSE endpoints to provide a real-time build progress dashboard, question response UI, phase detail views, and a live log viewer. The SPA lives in `autopilot/dashboard/` as a separate Vite project, is pre-built at publish time (FNDN-05), and served as static files by the existing Express server via the already-implemented `express.static()` + SPA fallback middleware.

The API contract is fully defined and implemented: `GET /api/status` (progress %), `GET /api/phases` (all phases), `GET /api/questions` (pending questions), `GET /api/questions/:id` (single question), `POST /api/questions/:id` (submit answer), and `GET /api/log/stream` (SSE). The SSE endpoint emits typed events: `phase-started`, `phase-completed`, `question-pending`, `question-answered`, `error`, `log-entry`, `build-complete`. The server also sends an initial burst of recent log entries on SSE connection, making the log viewer immediately useful for late-connecting clients.

The dashboard is a simple 4-page SPA (overview, question response, phase detail, log viewer) with no authentication, no complex forms, and no backend data mutation beyond question submission. This simplicity makes the standard React + Zustand + Tailwind CSS stack appropriate without heavier frameworks.

**Primary recommendation:** Use React 19 with Vite 7, Zustand 5 for state management, Tailwind CSS v4 for styling, React Router 7 (declarative mode) for client-side routing, and react-markdown for rendering question text. Connect to the existing SSE endpoint via native `EventSource` in a custom `useSSE` hook that updates the Zustand store. Use Vite's `server.proxy` during development to forward `/api` requests to the Express server on port 3847.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.2.4 | UI framework | Current stable, component model fits 4-page dashboard |
| react-dom | ^19.2.4 | DOM rendering | Required companion to React |
| react-router | ^7.13.0 | Client-side routing | v7 declarative mode, single import (no react-router-dom needed) |
| zustand | ^5.0.11 | Client-side state management | ~1KB, no boilerplate, SSE event handlers in ~20 lines, TypeScript-first |
| react-markdown | ^10.1.0 | Markdown rendering for questions (DASH-15) | ESM-only, CommonMark compliant, 4700+ dependents |

### Build & Styling
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | ^7.3.1 | Dev server + production build | Standard React build tool, fast HMR, optimized production bundles |
| @vitejs/plugin-react | ^5.1.4 | React Fast Refresh for Vite | Official Vite plugin for React |
| tailwindcss | ^4.1.18 | Utility-first CSS | Zero-config with Vite plugin, no tailwind.config.js needed in v4 |
| @tailwindcss/vite | ^4.1.18 | Tailwind CSS Vite integration | Official Vite plugin, replaces PostCSS setup |
| typescript | ~5.9.0 | Type checking | Match existing project TypeScript version |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | Redux Toolkit | Massive overkill for 4-page dashboard with simple state |
| Zustand | React Context | Re-render issues, no devtools, awkward for SSE event state |
| react-markdown | dangerouslySetInnerHTML + marked | Security risk (XSS), no React integration |
| Tailwind CSS v4 | CSS Modules | Tailwind faster for dashboard-style UIs, no naming overhead |
| React Router 7 declarative | createBrowserRouter (data mode) | Data mode adds complexity for no benefit -- no loaders/actions needed |
| EventSource (native) | react-sse-hooks / react-eventsource | Native API is sufficient, avoids unnecessary dependency for ~30 lines |

**Installation (from autopilot/dashboard/):**
```bash
npm install react react-dom react-router zustand react-markdown
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite typescript @types/react @types/react-dom
```

## Architecture Patterns

### Recommended Project Structure
```
autopilot/
├── dashboard/                    # React SPA (separate Vite project)
│   ├── index.html                # Vite entry HTML
│   ├── package.json              # Dashboard-specific dependencies
│   ├── tsconfig.json             # TypeScript config (JSX, DOM libs)
│   ├── vite.config.ts            # Vite + React + Tailwind plugins, API proxy
│   ├── src/
│   │   ├── main.tsx              # ReactDOM.createRoot entry point
│   │   ├── App.tsx               # BrowserRouter + Routes layout
│   │   ├── index.css             # @import "tailwindcss"
│   │   ├── pages/
│   │   │   ├── Overview.tsx      # DASH-10, DASH-11, DASH-12, DASH-13, DASH-14
│   │   │   ├── QuestionResponse.tsx  # DASH-15, DASH-16
│   │   │   ├── PhaseDetail.tsx   # DASH-17
│   │   │   └── LogViewer.tsx     # DASH-18
│   │   ├── components/
│   │   │   ├── Layout.tsx        # Shared nav/header shell
│   │   │   ├── ProgressBar.tsx   # Overall progress bar (DASH-10)
│   │   │   ├── PhaseCard.tsx     # Current phase card (DASH-11)
│   │   │   ├── QuestionBadge.tsx # Pending questions CTA (DASH-12)
│   │   │   ├── ActivityFeed.tsx  # Recent activity feed (DASH-13)
│   │   │   ├── LogStream.tsx     # Live log stream component (DASH-14, DASH-18)
│   │   │   ├── OptionCard.tsx    # Clickable option card (DASH-15)
│   │   │   └── StepProgress.tsx  # Step-by-step progress (DASH-17)
│   │   ├── hooks/
│   │   │   └── useSSE.ts         # EventSource connection + Zustand update
│   │   ├── store/
│   │   │   └── index.ts          # Zustand store definition
│   │   ├── api/
│   │   │   └── client.ts         # fetch wrappers for REST endpoints
│   │   └── types/
│   │       └── index.ts          # Shared types (mirrors server types)
│   └── dist/                     # Vite build output (served by Express)
├── src/                          # Existing Node.js server code
│   └── server/
│       └── index.ts              # ResponseServer already has dashboardDir option
└── package.json                  # "dashboard/dist/" already in files array
```

### Pattern 1: Zustand Store with SSE Event Handlers
**What:** A single Zustand store holds all dashboard state. The SSE hook updates the store directly when events arrive. Components subscribe to specific slices.
**When to use:** Always -- this is the central state management pattern.
**Example:**
```typescript
// Source: Zustand docs + project-specific API types
import { create } from 'zustand';

interface DashboardState {
  // API state
  status: 'idle' | 'running' | 'waiting_for_human' | 'error' | 'complete';
  currentPhase: number;
  currentStep: string;
  progress: number;
  phases: PhaseState[];
  questions: QuestionEvent[];
  logs: LogEntry[];
  activities: ActivityItem[];
  connected: boolean;

  // Actions
  setStatus: (status: Partial<Pick<DashboardState, 'status' | 'currentPhase' | 'currentStep' | 'progress'>>) => void;
  setPhases: (phases: PhaseState[]) => void;
  setQuestions: (questions: QuestionEvent[]) => void;
  addLog: (entry: LogEntry) => void;
  addActivity: (item: ActivityItem) => void;
  setConnected: (connected: boolean) => void;
  updatePhase: (phaseNumber: number, patch: Partial<PhaseState>) => void;
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  status: 'idle',
  currentPhase: 0,
  currentStep: 'idle',
  progress: 0,
  phases: [],
  questions: [],
  logs: [],
  activities: [],
  connected: false,

  setStatus: (patch) => set((s) => ({ ...s, ...patch })),
  setPhases: (phases) => set({ phases }),
  setQuestions: (questions) => set({ questions }),
  addLog: (entry) => set((s) => ({
    logs: [...s.logs.slice(-499), entry], // Keep last 500 entries
  })),
  addActivity: (item) => set((s) => ({
    activities: [item, ...s.activities].slice(0, 50), // Keep last 50 activities
  })),
  setConnected: (connected) => set({ connected }),
  updatePhase: (phaseNumber, patch) => set((s) => ({
    phases: s.phases.map((p) =>
      p.number === phaseNumber ? { ...p, ...patch } : p
    ),
  })),
}));
```

### Pattern 2: Custom useSSE Hook with Zustand Integration
**What:** A custom hook connects to `EventSource`, dispatches events to the Zustand store, and handles reconnection gracefully. Uses the native `EventSource` browser API.
**When to use:** Called once at the app root level (in Layout or App component).
**Example:**
```typescript
// Source: MDN EventSource docs + Zustand store pattern
import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store';

export function useSSE(): void {
  const sourceRef = useRef<EventSource | null>(null);
  const store = useDashboardStore;

  useEffect(() => {
    const es = new EventSource('/api/log/stream');
    sourceRef.current = es;

    es.onopen = () => {
      store.getState().setConnected(true);
    };

    es.onerror = () => {
      store.getState().setConnected(false);
      // EventSource auto-reconnects (retry: 10000 sent by server)
    };

    // Wire each SSE event type to the Zustand store
    es.addEventListener('log-entry', (e) => {
      const entry = JSON.parse(e.data);
      store.getState().addLog(entry);
    });

    es.addEventListener('phase-started', (e) => {
      const data = JSON.parse(e.data);
      store.getState().addActivity({
        type: 'phase-started',
        message: `Phase ${data.phase} started: ${data.name}`,
        timestamp: new Date().toISOString(),
      });
      // Refresh full status from API
      fetch('/api/status').then(r => r.json()).then(s => store.getState().setStatus(s));
      fetch('/api/phases').then(r => r.json()).then(d => store.getState().setPhases(d.phases));
    });

    es.addEventListener('phase-completed', (e) => {
      const data = JSON.parse(e.data);
      store.getState().addActivity({
        type: 'phase-completed',
        message: `Phase ${data.phase} completed: ${data.name}`,
        timestamp: new Date().toISOString(),
      });
      fetch('/api/status').then(r => r.json()).then(s => store.getState().setStatus(s));
      fetch('/api/phases').then(r => r.json()).then(d => store.getState().setPhases(d.phases));
    });

    es.addEventListener('question-pending', (e) => {
      const data = JSON.parse(e.data);
      store.getState().addActivity({
        type: 'question-pending',
        message: `New question pending (Phase ${data.phase ?? '?'})`,
        timestamp: new Date().toISOString(),
      });
      // Refresh questions from API to get full list
      fetch('/api/questions').then(r => r.json()).then(d => store.getState().setQuestions(d.questions));
    });

    es.addEventListener('question-answered', () => {
      fetch('/api/questions').then(r => r.json()).then(d => store.getState().setQuestions(d.questions));
    });

    es.addEventListener('error', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      store.getState().addActivity({
        type: 'error',
        message: data.message ?? 'Error occurred',
        timestamp: new Date().toISOString(),
      });
    });

    es.addEventListener('build-complete', () => {
      store.getState().addActivity({
        type: 'build-complete',
        message: 'Build complete!',
        timestamp: new Date().toISOString(),
      });
      fetch('/api/status').then(r => r.json()).then(s => store.getState().setStatus(s));
    });

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);
}
```

### Pattern 3: API Client with Type Safety
**What:** Thin fetch wrappers for each REST endpoint with TypeScript types matching the server's response shapes.
**When to use:** For initial data loading and question submission.
**Example:**
```typescript
// Source: Existing server routes (autopilot/src/server/routes/api.ts)
const BASE = ''; // Same origin in production; Vite proxy in dev

export async function fetchStatus() {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json() as Promise<{
    status: string;
    currentPhase: number;
    currentStep: string;
    progress: number;
    startedAt: string;
    lastUpdatedAt: string;
  }>;
}

export async function fetchPhases() {
  const res = await fetch(`${BASE}/api/phases`);
  if (!res.ok) throw new Error(`Phases fetch failed: ${res.status}`);
  return res.json() as Promise<{ phases: PhaseState[] }>;
}

export async function fetchQuestions() {
  const res = await fetch(`${BASE}/api/questions`);
  if (!res.ok) throw new Error(`Questions fetch failed: ${res.status}`);
  return res.json() as Promise<{ questions: QuestionEvent[] }>;
}

export async function submitAnswer(
  questionId: string,
  answers: Record<string, string>,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/questions/${questionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? `Submit failed: ${res.status}`);
  }
  return res.json();
}
```

### Pattern 4: Vite Dev Proxy to Express Server
**What:** During development, Vite dev server proxies `/api` requests to the running Express server on port 3847. In production, both SPA and API are served from the same origin.
**When to use:** Always during development (the Vite dev server runs on port 5173, the Express API on 3847).
**Example:**
```typescript
// dashboard/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

### Pattern 5: React Router 7 Declarative Routing
**What:** Use `BrowserRouter` + `Routes` + `Route` for client-side navigation between the 4 pages. The SPA fallback in Express handles refreshes on nested routes.
**When to use:** Always -- the SPA has 4 routes.
**Example:**
```tsx
// Source: React Router 7 official docs (declarative mode)
import { BrowserRouter, Routes, Route } from 'react-router';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { QuestionResponse } from './pages/QuestionResponse';
import { PhaseDetail } from './pages/PhaseDetail';
import { LogViewer } from './pages/LogViewer';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="questions/:questionId" element={<QuestionResponse />} />
          <Route path="phases/:phaseNumber" element={<PhaseDetail />} />
          <Route path="logs" element={<LogViewer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

### Pattern 6: Auto-Scrolling Log Viewer
**What:** The log viewer auto-scrolls to the bottom when new entries arrive, but stops auto-scrolling when the user scrolls up to read history.
**When to use:** For DASH-14 (collapsible, auto-scrolling log stream) and DASH-18 (full log viewer).
**Example:**
```tsx
import { useEffect, useRef, useState } from 'react';

function LogStream({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll when new logs arrive (if enabled)
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="overflow-y-auto max-h-96 font-mono text-sm"
    >
      {logs.map((log, i) => (
        <div key={i} className={logLevelClass(log.level)}>
          <span className="text-gray-500">{formatTime(log.timestamp)}</span>
          {' '}
          <span className="font-bold">[{log.component}]</span>
          {' '}
          {log.message}
        </div>
      ))}
    </div>
  );
}
```

### Anti-Patterns to Avoid
- **Polling REST endpoints instead of using SSE:** The SSE endpoint exists specifically for real-time updates. Do not poll `/api/status` on a timer. Use SSE events and fetch only on initial load or reconnection.
- **Putting EventSource in every component:** The SSE connection should be established once at the app level and routed through the Zustand store. Components subscribe to store slices, not raw SSE events.
- **Using Redux or Context API:** The state is simple (status, phases, questions, logs). Zustand handles this with ~30 lines. Redux adds hundreds of lines of boilerplate for no benefit. Context API causes unnecessary re-renders.
- **Building the SPA at runtime:** The SPA must be pre-built (`vite build`) and included in the npm package. Never require Vite or build tools at runtime.
- **Importing server-side types directly:** The dashboard is a separate Vite project. Duplicate the types (they are small) or create a shared types file that both tsconfigs reference. Do not import from `../src/types/` as Vite's resolver will not find Node.js source files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client-side routing | Custom hash-based router | React Router 7 (declarative mode) | Handles URL updates, back/forward, nested routes, SPA fallback |
| SSE reconnection | Custom reconnect logic with timers | Native `EventSource` auto-reconnect | EventSource reconnects automatically using the `retry:` interval from server |
| Markdown rendering | regex-based markdown parser | react-markdown | XSS-safe, CommonMark compliant, handles edge cases |
| Progress bar | Custom CSS animation | Tailwind CSS `w-[${percent}%]` transition | Tailwind handles transitions, responsive widths |
| State management | Custom pub/sub event system | Zustand store | Handles React re-renders, subscriptions, devtools |
| CSS framework | Custom CSS variables + classes | Tailwind CSS v4 | Zero-config content detection, utility-first, fast iteration |

**Key insight:** The dashboard is a consumer of existing APIs with minimal business logic. Its complexity is in UI presentation, not data management. Use off-the-shelf solutions for everything except the SSE-to-store wiring and the question response form.

## Common Pitfalls

### Pitfall 1: SSE EventSource Error Handling
**What goes wrong:** The `EventSource.onerror` handler fires on both temporary disconnects and permanent failures, but provides no error details. The dashboard shows a "disconnected" state permanently.
**Why it happens:** The SSE spec does not expose error details in the `onerror` event. `EventSource` auto-reconnects, but the `onerror` fires before reconnection attempt.
**How to avoid:** Set a `connected: false` state on `onerror`, but also set `connected: true` on `onopen` (which fires on successful reconnection). Do not close the `EventSource` on error -- let it auto-reconnect. Show a subtle "reconnecting..." indicator, not an error dialog.
**Warning signs:** Dashboard permanently shows "disconnected" after a brief network hiccup.

### Pitfall 2: Log Memory Accumulation
**What goes wrong:** Storing every log entry in the Zustand store causes the browser tab to consume unbounded memory during long builds.
**Why it happens:** A multi-hour build can produce thousands of log entries. The SSE initial burst sends the ring buffer contents, and then live entries keep accumulating.
**How to avoid:** Cap the log array in the store (e.g., keep last 500 entries). The server's ring buffer already caps at a fixed capacity. The dashboard does not need the full history -- the log file has that.
**Warning signs:** Browser tab becoming sluggish after running for hours.

### Pitfall 3: Stale State on Tab Refocus
**What goes wrong:** If the browser tab is backgrounded for a while, the SSE connection may have dropped and reconnected, but the dashboard shows stale data from before the disconnect.
**Why it happens:** SSE reconnection delivers events from the reconnection point forward. Events that occurred during the disconnect gap are lost (the server does not implement `Last-Event-ID` replay).
**How to avoid:** On SSE reconnection (detected via `onopen` after an `onerror`), fetch the full state from REST endpoints (`/api/status`, `/api/phases`, `/api/questions`) to rehydrate the store. The SSE `onopen` event is the signal.
**Warning signs:** Progress bar shows old percentage after returning to the tab.

### Pitfall 4: Question Response Timing (DASH-16)
**What goes wrong:** User submits an answer via POST, then tries to change it, but the orchestrator has already consumed it.
**Why it happens:** `submitAnswer()` in the server immediately resolves the deferred promise. The orchestrator's `await promise` unblocks instantly. There is no "buffered answer" state.
**How to avoid:** DASH-16 ("User can change question response before orchestrator picks it up") should be implemented as client-side UX: the user can modify their selections in the form before clicking submit. Once submitted, it is final. The UI should show a clear "Submitting..." -> "Submitted" transition and disable the form. Do not show an "edit response" button after submission because the answer is already consumed.
**Warning signs:** User clicks "edit" after submitting, changes answer, resubmits, gets 404 (question already resolved).

### Pitfall 5: Shared Types Between Server and Dashboard
**What goes wrong:** TypeScript types defined in `autopilot/src/types/` cannot be imported by the dashboard because Vite uses a different tsconfig and module resolution.
**Why it happens:** The dashboard has its own `tsconfig.json` with DOM libs and JSX support. The server's types use `NodeNext` module resolution. Cross-project imports break.
**How to avoid:** Create a `dashboard/src/types/index.ts` file that mirrors the server types needed by the dashboard (`PhaseState`, `PhaseStep`, `QuestionEvent`, `LogEntry`, etc.). These types are small (~50 lines total) and change infrequently. Keeping them in sync is a minor maintenance cost that avoids complex project reference or shared package setups.
**Warning signs:** Vite compile errors about unresolved imports from `../../src/types`.

### Pitfall 6: Vite Build Base Path
**What goes wrong:** The Vite build assumes assets are served from `/` but the Express server may serve them from a different path, causing 404s for JS/CSS files.
**Why it happens:** Vite's default `base` config is `/`, which matches the Express SPA fallback behavior. No issue unless someone changes the serving path.
**How to avoid:** Keep the default `base: '/'` in Vite config. The Express server's `express.static()` + SPA fallback already serves from root. Do not add a custom base path.
**Warning signs:** 404 errors for `*.js` or `*.css` files in the browser console.

### Pitfall 7: Tailwind CSS v4 Not Loading
**What goes wrong:** Tailwind utility classes render as plain text (no styling applied).
**Why it happens:** Tailwind CSS v4 requires the `@tailwindcss/vite` plugin and a CSS file with `@import "tailwindcss"`. Missing either one causes silent failure -- no errors, just no styles.
**How to avoid:** Ensure three things: (1) `@tailwindcss/vite` in `vite.config.ts` plugins, (2) `@import "tailwindcss"` in `src/index.css`, (3) `import './index.css'` in `src/main.tsx`. No `tailwind.config.js` is needed in v4.
**Warning signs:** All Tailwind classes ignored, page renders with browser defaults.

## Code Examples

Verified patterns from official sources:

### Vite Project Configuration
```typescript
// dashboard/vite.config.ts
// Source: Vite docs (vite.dev/guide), Tailwind CSS v4 docs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

### Dashboard TypeScript Configuration
```json
// dashboard/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

### Tailwind CSS v4 Entry Point
```css
/* dashboard/src/index.css */
/* Source: Tailwind CSS v4 docs (tailwindcss.com/docs) */
@import "tailwindcss";
```

### Entry Point (main.tsx)
```tsx
// dashboard/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### Question Response Page Pattern (DASH-15, DASH-16)
```tsx
// Source: Existing API contract (POST /api/questions/:id)
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import Markdown from 'react-markdown';
import { submitAnswer } from '../api/client';
import { useDashboardStore } from '../store';

export function QuestionResponse() {
  const { questionId } = useParams();
  const navigate = useNavigate();
  const questions = useDashboardStore((s) => s.questions);
  const question = questions.find((q) => q.id === questionId);

  // Local form state -- user can change answers before submitting (DASH-16)
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!question) return <div>Question not found</div>;

  const handleSelectOption = (questionText: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [questionText]: label }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Merge option selections with freeform text
      const merged = { ...answers };
      for (const [key, val] of Object.entries(freeform)) {
        if (val.trim()) merged[key] = val;
      }
      await submitAnswer(questionId!, merged);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {question.questions.map((q) => (
        <div key={q.question}>
          <Markdown>{q.question}</Markdown>
          <div className="grid grid-cols-2 gap-3">
            {q.options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => handleSelectOption(q.question, opt.label)}
                disabled={submitted}
                className={`p-4 rounded border ${
                  answers[q.question] === opt.label
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200'
                }`}
              >
                <div className="font-bold">{opt.label}</div>
                <div className="text-sm text-gray-600">{opt.description}</div>
              </button>
            ))}
          </div>
          <textarea
            placeholder="Or type a custom response..."
            value={freeform[q.question] ?? ''}
            onChange={(e) =>
              setFreeform((prev) => ({ ...prev, [q.question]: e.target.value }))
            }
            disabled={submitted}
          />
        </div>
      ))}
      <button onClick={handleSubmit} disabled={submitting || submitted}>
        {submitted ? 'Submitted' : submitting ? 'Submitting...' : 'Submit Response'}
      </button>
    </div>
  );
}
```

### Dashboard Package.json
```json
{
  "name": "@gsd/autopilot-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router": "^7.13.0",
    "zustand": "^5.0.11",
    "react-markdown": "^10.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.18",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.1.4",
    "tailwindcss": "^4.1.18",
    "typescript": "~5.9.0",
    "vite": "^7.3.1"
  }
}
```

## DASH-16 Analysis: Changing Submitted Responses

**Server-side reality:** The `QuestionHandler.submitAnswer()` method immediately resolves the deferred promise and deletes the question from the pending map. The `handleQuestion()` method's `await promise` returns instantly, and the SDK continues execution with the provided answers. There is no server-side buffer or delay.

**Implication for DASH-16:** "User can change question response before orchestrator picks it up" means:
1. **Client-side editing before submit:** The user can select options, type freeform text, change their mind, and re-select different options -- all before clicking "Submit". This is the primary DASH-16 use case.
2. **No post-submit editing:** Once the user clicks Submit and the POST succeeds, the answer is consumed immediately by the orchestrator. An "edit after submit" feature would require server-side changes (adding a buffer/delay to `submitAnswer`) which is out of scope for Phase 5.

**Recommendation:** Implement DASH-16 as a form that allows free editing of all answers before submission. Show a clear confirmation step ("Review your answers before submitting"). After submission, disable the form and show a success state. Do not offer an "edit submitted response" button.

## Build Integration

### Pre-built SPA for npm Distribution (FNDN-05)

The existing `autopilot/package.json` already includes `"dashboard/dist/"` in the `files` array. The build integration requires:

1. **Dashboard build script:** `cd dashboard && npm run build` produces `dashboard/dist/index.html` + hashed JS/CSS assets.
2. **Parent package build script:** Update `autopilot/package.json` scripts to include dashboard build:
   ```json
   {
     "scripts": {
       "build": "tsc && cd dashboard && npm run build",
       "build:dashboard": "cd dashboard && npm run build"
     }
   }
   ```
3. **Server dashboard path:** The `ResponseServer` constructor accepts `dashboardDir` option. The CLI should resolve this path:
   ```typescript
   // In CLI bootstrap (autopilot/src/cli/index.ts)
   import { fileURLToPath } from 'node:url';
   import { dirname, join } from 'node:path';

   const __dirname = dirname(fileURLToPath(import.meta.url));
   const dashboardDir = join(__dirname, '..', '..', 'dashboard', 'dist');
   ```
4. **Existing SPA fallback:** The `ResponseServer` already checks `existsSync(dashboardDir)` before mounting static files and SPA fallback. No server changes needed.

### Development Workflow

1. Start the autopilot server: `cd autopilot && npm run dev` (or run the CLI with `--prd`)
2. Start the dashboard dev server: `cd autopilot/dashboard && npm run dev` (Vite on port 5173)
3. Vite proxies `/api` requests to `http://localhost:3847`
4. Edit React components with instant HMR feedback
5. Production build: `cd autopilot/dashboard && npm run build` outputs to `dashboard/dist/`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App | Vite with @vitejs/plugin-react | CRA deprecated 2023 | Faster builds, modern defaults |
| Tailwind CSS v3 with tailwind.config.js | Tailwind CSS v4 with @tailwindcss/vite plugin | Tailwind v4 (Jan 2025) | No config file needed, CSS-first setup, automatic content detection |
| React Router 6 (react-router-dom) | React Router 7 (react-router, single package) | RR v7 (2025) | Single import, cleaner API, optional framework/data modes |
| Zustand 4 create() | Zustand 5 create<T>()() curried | Zustand 5 (late 2024) | Required for TypeScript middleware inference |
| Redux / Context for small apps | Zustand for simple state | Industry shift 2023-2024 | ~1KB vs ~40KB, no boilerplate |
| Manual SSE with fetch + ReadableStream | Native EventSource API | Always available | Auto-reconnect, spec-compliant, 3 lines of code |

**Deprecated/outdated:**
- `react-router-dom`: Merged into `react-router` in v7. Use `react-router` only.
- `tailwind.config.js`: Not needed in Tailwind CSS v4. Use `@import "tailwindcss"` in CSS.
- `@tailwind base/components/utilities` directives: Replaced by `@import "tailwindcss"` in v4.
- Create React App (CRA): Officially deprecated. Use Vite.

## Open Questions

1. **Dashboard npm install strategy**
   - What we know: The dashboard is a separate Vite project in `autopilot/dashboard/` with its own `package.json`. The parent `autopilot/package.json` only ships `dashboard/dist/` (built assets).
   - What's unclear: Whether `npm install` at the autopilot root should also install dashboard dev dependencies, or whether dashboard deps should be installed separately.
   - Recommendation: Keep dashboard deps separate. The dashboard `node_modules` is only needed during development/build, not at runtime. Add `cd dashboard && npm install && npm run build` to the parent's `build` script. For CI, this runs automatically. Users who only consume the npm package never need dashboard source dependencies.

2. **Vitest for dashboard component testing**
   - What we know: The existing server code uses Vitest with `environment: 'node'`. Dashboard components need `environment: 'jsdom'` or `environment: 'happy-dom'`.
   - What's unclear: Whether to add a separate Vitest config for the dashboard or use the existing one.
   - Recommendation: Add a `dashboard/vitest.config.ts` with `environment: 'happy-dom'`. Keep dashboard tests independent from server tests. Test store logic and API client functions (pure logic). Do not over-test React rendering -- the dashboard is a thin UI layer over the API.

3. **CORS during dashboard development**
   - What we know: The Vite dev server (port 5173) proxies `/api` requests to Express (port 3847). With proxy, no CORS is needed.
   - What's unclear: Whether there are edge cases where the proxy does not work (e.g., SSE through proxy).
   - Recommendation: Vite's proxy handles SSE (it supports HTTP streaming). No CORS middleware is needed on the Express server. If SSE issues arise through the proxy, add a dev-only CORS header to the SSE endpoint.

## Sources

### Primary (HIGH confidence)
- Existing codebase `autopilot/src/server/index.ts` -- ResponseServer class, dashboardDir option, SPA fallback
- Existing codebase `autopilot/src/server/routes/api.ts` -- REST API endpoints, response shapes
- Existing codebase `autopilot/src/server/routes/sse.ts` -- SSE event types, broadcast pattern
- Existing codebase `autopilot/src/types/state.ts` -- PhaseState, AutopilotState, PendingQuestion types
- Existing codebase `autopilot/src/claude/types.ts` -- QuestionEvent, QuestionItem types
- Existing codebase `autopilot/src/claude/question-handler.ts` -- submitAnswer() immediate resolution
- Existing codebase `autopilot/src/types/log.ts` -- LogEntry type
- Existing codebase `autopilot/package.json` -- "dashboard/dist/" in files array
- [React Router 7 installation docs](https://reactrouter.com/start/declarative/installation) -- BrowserRouter declarative setup
- [Vite build documentation](https://vite.dev/guide/build) -- Build configuration, output directory
- [Vite server proxy documentation](https://vite.dev/config/server-options) -- Proxy configuration for dev server
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4) -- Zero-config setup, Vite plugin
- [MDN EventSource docs](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) -- Native SSE API, auto-reconnect

### Secondary (MEDIUM confidence)
- [Zustand TypeScript guide](https://zustand.docs.pmnd.rs/guides/beginner-typescript) -- create<T>()() curried pattern
- [Vite + React setup guides](https://medium.com/@robinviktorsson/complete-guide-to-setting-up-react-with-typescript-and-vite-2025-468f6556aaf2) -- 2026 project setup patterns
- [react-markdown npm](https://www.npmjs.com/package/react-markdown) -- v10.1.0, ESM-only, CommonMark
- npm version checks (ran 2026-02-17): react 19.2.4, react-dom 19.2.4, react-router 7.13.0, zustand 5.0.11, vite 7.3.1, tailwindcss 4.1.18, @vitejs/plugin-react 5.1.4, @tailwindcss/vite 4.1.18, react-markdown 10.1.0

### Tertiary (LOW confidence)
- None. All findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries verified via npm, versions confirmed, well-established ecosystem choices matching project-level STACK.md recommendations
- Architecture: HIGH -- API contract fully implemented and tested in Phase 4; project structure follows established React + Vite patterns; SSE integration uses native browser API
- Pitfalls: HIGH -- SSE pitfalls verified via MDN docs and Phase 4 implementation experience; DASH-16 constraint verified by reading QuestionHandler source code
- Build integration: HIGH -- Existing package.json already includes dashboard/dist/ in files; ResponseServer already accepts dashboardDir option

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (30 days -- stable domain, all dependencies at stable major versions)
