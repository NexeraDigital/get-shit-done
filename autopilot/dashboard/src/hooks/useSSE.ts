// SSE hook: connects to /api/log/stream and dispatches events to Zustand store.
// Uses EventSource with auto-reconnect. Rehydrates full state from REST on each (re)connect.

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store/index.js';
import { fetchStatus, fetchPhases, fetchQuestions } from '../api/client.js';
import type { LogEntry, ActivityItem } from '../types/index.js';

/**
 * Rehydrate full dashboard state from REST endpoints.
 * Called on initial connect and every reconnect to ensure consistency.
 */
async function rehydrate(): Promise<void> {
  const store = useDashboardStore.getState();
  try {
    const [statusRes, phasesRes, questionsRes] = await Promise.all([
      fetchStatus(),
      fetchPhases(),
      fetchQuestions(),
    ]);
    store.setStatus({
      status: statusRes.status,
      currentPhase: statusRes.currentPhase,
      currentStep: statusRes.currentStep,
      progress: statusRes.progress,
    });
    store.setPhases(phasesRes.phases);
    store.setQuestions(questionsRes.questions);
  } catch {
    // Rehydration failure is non-fatal -- SSE events will still update state
  }
}

export function useSSE(): void {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/log/stream');
    esRef.current = es;

    const store = useDashboardStore.getState();

    es.onopen = () => {
      store.setConnected(true);
      void rehydrate();
    };

    es.onerror = () => {
      // Do NOT close -- EventSource auto-reconnects
      store.setConnected(false);
    };

    // Log entries
    es.addEventListener('log-entry', (e: MessageEvent) => {
      const entry = JSON.parse(e.data as string) as LogEntry;
      useDashboardStore.getState().addLog(entry);
    });

    // Phase lifecycle
    es.addEventListener('phase-started', (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { phase?: number; name?: string };
      const activity: ActivityItem = {
        type: 'phase-started',
        message: `Phase ${String(data.phase ?? '?')}: ${String(data.name ?? 'started')}`,
        timestamp: new Date().toISOString(),
      };
      useDashboardStore.getState().addActivity(activity);
      void Promise.all([fetchStatus(), fetchPhases()]).then(([s, p]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setPhases(p.phases);
      });
    });

    es.addEventListener('phase-completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { phase?: number; name?: string };
      const activity: ActivityItem = {
        type: 'phase-completed',
        message: `Phase ${String(data.phase ?? '?')}: ${String(data.name ?? 'completed')}`,
        timestamp: new Date().toISOString(),
      };
      useDashboardStore.getState().addActivity(activity);
      void Promise.all([fetchStatus(), fetchPhases()]).then(([s, p]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setPhases(p.phases);
      });
    });

    // Questions
    es.addEventListener('question-pending', (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { id?: string };
      const activity: ActivityItem = {
        type: 'question-pending',
        message: `New question pending: ${String(data.id ?? 'unknown')}`,
        timestamp: new Date().toISOString(),
      };
      useDashboardStore.getState().addActivity(activity);
      void fetchQuestions().then((q) => {
        useDashboardStore.getState().setQuestions(q.questions);
      });
    });

    es.addEventListener('question-answered', () => {
      void fetchQuestions().then((q) => {
        useDashboardStore.getState().setQuestions(q.questions);
      });
    });

    // Errors
    es.addEventListener('error', (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { message?: string };
      const activity: ActivityItem = {
        type: 'error',
        message: String(data.message ?? 'Unknown error'),
        timestamp: new Date().toISOString(),
      };
      useDashboardStore.getState().addActivity(activity);
    });

    // Build complete
    es.addEventListener('build-complete', () => {
      const activity: ActivityItem = {
        type: 'build-complete',
        message: 'Build complete',
        timestamp: new Date().toISOString(),
      };
      useDashboardStore.getState().addActivity(activity);
      void fetchStatus().then((s) => {
        useDashboardStore.getState().setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
      });
    });

    // Poll status + phases every 3s to catch state changes that don't emit SSE events
    // (e.g., init completing and phases being loaded, step transitions within a phase)
    const pollTimer = setInterval(() => {
      void Promise.all([fetchStatus(), fetchPhases(), fetchQuestions()]).then(([s, p, q]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setPhases(p.phases);
        st.setQuestions(q.questions);
      }).catch(() => { /* ignore poll failures */ });
    }, 3000);

    return () => {
      es.close();
      esRef.current = null;
      clearInterval(pollTimer);
    };
  }, []);
}
