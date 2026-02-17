// Phase detail page (DASH-17).
// Shows step-by-step progress, commits, verification status, timing, and filtered logs.
// All data sourced from Zustand store.

import { useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { useDashboardStore } from '../store/index.js';
import { fetchPhases } from '../api/client.js';
import { StepProgress } from '../components/StepProgress.js';
import { LogStream } from '../components/LogStream.js';
import type { PhaseStatus } from '../types/index.js';

const STATUS_COLORS: Record<PhaseStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-yellow-100 text-yellow-700',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatElapsed(startIso: string, endIso: string): string {
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (ms < 0) return '---';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${String(hours)}h ${String(minutes % 60)}m`;
    if (minutes > 0) return `${String(minutes)}m ${String(seconds % 60)}s`;
    return `${String(seconds)}s`;
  } catch {
    return '---';
  }
}

export function PhaseDetail() {
  const { phaseNumber } = useParams();
  const phaseNum = Number(phaseNumber);
  const phases = useDashboardStore((s) => s.phases);
  const logs = useDashboardStore((s) => s.logs);
  const phase = phases.find((p) => p.number === phaseNum);

  // Fetch phases on mount if not loaded
  useEffect(() => {
    if (phases.length === 0) {
      void fetchPhases().then((res) => {
        useDashboardStore.getState().setPhases(res.phases);
      });
    }
  }, [phases.length]);

  // Filter logs for this phase
  const phaseLogs = logs.filter((log) => log.phase === phaseNum);

  if (!phase) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Phase not found
          </h2>
          <Link to="/" className="text-blue-600 hover:text-blue-800 underline">
            Back to Overview
          </Link>
        </div>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[phase.status] ?? STATUS_COLORS.pending;

  // Verification status
  let verifyBadge: { text: string; className: string };
  if (phase.steps.verify === 'done') {
    verifyBadge = { text: 'Verified', className: 'bg-green-100 text-green-700' };
  } else if (phase.steps.verify === 'idle') {
    verifyBadge = { text: 'Not verified yet', className: 'bg-gray-100 text-gray-700' };
  } else {
    verifyBadge = { text: 'Verifying...', className: 'bg-blue-100 text-blue-700' };
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Back navigation */}
      <Link
        to="/"
        className="text-blue-600 hover:text-blue-800 mb-6 inline-flex items-center gap-1"
      >
        &larr; Back to Overview
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mt-4">
        <div>
          <span className="text-sm font-medium text-gray-500">
            Phase {phase.number}
          </span>
          <h1 className="text-2xl font-bold text-gray-900">{phase.name}</h1>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}
        >
          {phase.status.replace('_', ' ')}
        </span>
      </div>

      {/* Step Progress */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Step Progress
        </h2>
        <div className="border border-gray-200 rounded-lg p-6 bg-white">
          <StepProgress steps={phase.steps} />
        </div>
      </section>

      {/* Timing */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Timing</h2>
        <div className="border border-gray-200 rounded-lg p-6 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Started</span>
              <p className="font-medium text-gray-900 mt-1">
                {phase.startedAt ? formatDate(phase.startedAt) : '---'}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Completed</span>
              <p className="font-medium text-gray-900 mt-1">
                {phase.completedAt ? formatDate(phase.completedAt) : '---'}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Elapsed</span>
              <p className="font-medium text-gray-900 mt-1">
                {phase.startedAt && phase.completedAt
                  ? formatElapsed(phase.startedAt, phase.completedAt)
                  : '---'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Commits */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Commits</h2>
        <div className="border border-gray-200 rounded-lg p-6 bg-white">
          {phase.commits.length === 0 ? (
            <p className="text-sm text-gray-400">No commits recorded</p>
          ) : (
            <ul className="space-y-2">
              {phase.commits.map((hash) => (
                <li key={hash} className="font-mono text-sm text-gray-700">
                  {hash}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Verification Status */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Verification
        </h2>
        <div className="border border-gray-200 rounded-lg p-6 bg-white">
          <div className="flex items-center gap-4">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${verifyBadge.className}`}
            >
              {verifyBadge.text}
            </span>
            {phase.gapIterations > 0 && (
              <span className="text-sm text-gray-500">
                Gap iterations: {phase.gapIterations}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Filtered Logs */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Phase Logs
        </h2>
        <LogStream logs={phaseLogs} maxHeight="16rem" />
      </section>
    </div>
  );
}
