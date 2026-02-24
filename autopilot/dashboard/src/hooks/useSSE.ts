// SSE hook: connects to /api/log/stream and dispatches events to Zustand store.
// Uses EventSource with auto-reconnect. Rehydrates full state from REST on each (re)connect.

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store/index.js';
import { fetchStatus, fetchPhases, fetchQuestions, fetchActivities } from '../api/client.js';
import type { LogEntry } from '../types/index.js';

/**
 * Rehydrate full dashboard state from REST endpoints.
 * Called on initial connect and every reconnect to ensure consistency.
 */
async function rehydrate(): Promise<void> {
  const store = useDashboardStore.getState();
  try {
    const [statusRes, phasesRes, questionsRes, activitiesRes] = await Promise.all([
      fetchStatus(),
      fetchPhases(),
      fetchQuestions(),
      fetchActivities(),
    ]);
    store.setStatus({
      status: statusRes.status,
      currentPhase: statusRes.currentPhase,
      currentStep: statusRes.currentStep,
      progress: statusRes.progress,
      projectName: statusRes.projectName ?? '',
      projectDescription: statusRes.projectDescription ?? '',
    });
    store.setAutopilotAlive(statusRes.alive);
    store.setPhases(phasesRes.phases);
    store.setQuestions(questionsRes.questions);
    store.setActivities(activitiesRes.activities);
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
    es.addEventListener('phase-started', () => {
      void Promise.all([fetchStatus(), fetchPhases(), fetchActivities()]).then(([s, p, a]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setAutopilotAlive(s.alive);
        st.setPhases(p.phases);
        st.setActivities(a.activities);
      });
    });

    es.addEventListener('phase-completed', () => {
      void Promise.all([fetchStatus(), fetchPhases(), fetchActivities()]).then(([s, p, a]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setAutopilotAlive(s.alive);
        st.setPhases(p.phases);
        st.setActivities(a.activities);
      });
    });

    // Step completed — refresh phases to pick up new commits immediately
    es.addEventListener('step-completed', () => {
      void Promise.all([fetchStatus(), fetchPhases(), fetchActivities()]).then(([s, p, a]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setAutopilotAlive(s.alive);
        st.setPhases(p.phases);
        st.setActivities(a.activities);
      });
    });

    // Questions
    es.addEventListener('question-pending', () => {
      void Promise.all([fetchQuestions(), fetchActivities()]).then(([q, a]) => {
        useDashboardStore.getState().setQuestions(q.questions);
        useDashboardStore.getState().setActivities(a.activities);
      });
    });

    es.addEventListener('question-answered', () => {
      void Promise.all([fetchQuestions(), fetchActivities()]).then(([q, a]) => {
        useDashboardStore.getState().setQuestions(q.questions);
        useDashboardStore.getState().setActivities(a.activities);
      });
    });

    // Errors
    es.addEventListener('error', () => {
      void fetchActivities().then((a) => {
        useDashboardStore.getState().setActivities(a.activities);
      });
    });

    // Build complete
    es.addEventListener('build-complete', () => {
      void Promise.all([fetchStatus(), fetchActivities()]).then(([s, a]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setAutopilotAlive(s.alive);
        st.setActivities(a.activities);
      });
    });

    // Poll status + phases every 3s to catch state changes that don't emit SSE events
    // (e.g., init completing and phases being loaded, step transitions within a phase)
    const pollTimer = setInterval(() => {
      void Promise.all([fetchStatus(), fetchPhases(), fetchQuestions(), fetchActivities()]).then(([s, p, q, a]) => {
        const st = useDashboardStore.getState();
        st.setStatus({
          status: s.status,
          currentPhase: s.currentPhase,
          currentStep: s.currentStep,
          progress: s.progress,
        });
        st.setAutopilotAlive(s.alive);
        st.setPhases(p.phases);
        st.setQuestions(q.questions);
        st.setActivities(a.activities);
      }).catch(() => { /* ignore poll failures */ });
    }, 3000);

    return () => {
      es.close();
      esRef.current = null;
      clearInterval(pollTimer);
    };
  }, []);
}
