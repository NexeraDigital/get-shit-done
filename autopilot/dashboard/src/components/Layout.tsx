// Layout shell: shared header with nav, connection indicator, SSE hook, and initial data fetch.

import { useEffect } from 'react';
import { NavLink, Outlet, Link } from 'react-router';
import { useSSE } from '../hooks/useSSE.js';
import { useDashboardStore } from '../store/index.js';
import { fetchStatus, fetchPhases, fetchQuestions } from '../api/client.js';

export function Layout() {
  const connected = useDashboardStore((s) => s.connected);
  const questions = useDashboardStore((s) => s.questions);

  // Establish SSE connection once for the entire app
  useSSE();

  // Load initial data on mount
  useEffect(() => {
    void Promise.all([fetchStatus(), fetchPhases(), fetchQuestions()]).then(
      ([statusRes, phasesRes, questionsRes]) => {
        const store = useDashboardStore.getState();
        store.setStatus({
          status: statusRes.status,
          currentPhase: statusRes.currentPhase,
          currentStep: statusRes.currentStep,
          progress: statusRes.progress,
        });
        store.setPhases(phasesRes.phases);
        store.setQuestions(questionsRes.questions);
      },
    );
  }, []);

  const hasQuestions = questions.length > 0;
  const firstQuestion = hasQuestions ? questions[0]! : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* App title + connection indicator */}
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">
                GSD Autopilot
              </h1>
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-green-400' : 'bg-red-400'
                }`}
                title={connected ? 'Connected' : 'Disconnected'}
              />
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-6">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white border-b-2 border-blue-400 pb-0.5'
                      : 'text-gray-400 hover:text-gray-200'
                  }`
                }
              >
                Overview
              </NavLink>
              <NavLink
                to="/logs"
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white border-b-2 border-blue-400 pb-0.5'
                      : 'text-gray-400 hover:text-gray-200'
                  }`
                }
              >
                Logs
              </NavLink>
            </nav>
          </div>
        </div>
      </header>

      {/* Alert bar (fixed below header) */}
      {!connected ? (
        <div className="fixed top-14 left-0 right-0 z-40 bg-red-50 border-b border-red-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 py-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-semibold text-red-800">
                Disconnected from autopilot server
              </span>
              <span className="text-xs text-red-600 ml-auto">Reconnecting&hellip;</span>
            </div>
          </div>
        </div>
      ) : hasQuestions ? (
        <div className="fixed top-14 left-0 right-0 z-40 bg-amber-50 border-b border-amber-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              to={`/questions/${firstQuestion!.id}`}
              className="flex items-center gap-3 py-2 hover:bg-amber-100 transition-colors -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
            >
              <span className="text-amber-600 text-lg" role="img" aria-label="bell">&#128276;</span>
              <span className="text-sm font-semibold text-amber-800">
                {questions.length} {questions.length === 1 ? 'question needs' : 'questions need'} your attention
              </span>
              <span className="text-xs text-amber-600 ml-auto">&rarr; Click to respond</span>
            </Link>
          </div>
        </div>
      ) : null}

      {/* Main content area (offset for fixed header + optional alert bar) */}
      <main className={!connected || hasQuestions ? 'pt-24' : 'pt-14'}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
