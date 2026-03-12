// Completion summary table (DASH-03).
// Renders a build-complete summary matching the CLI renderSummary() format.
// Shows phase results with PASS/FAIL/SKIP status, merge info, duration, and errors.

import type { PhaseState } from '../types/index.js';

interface SummaryTableProps {
  phases: PhaseState[];
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '-';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'skip' }) {
  const styles: Record<string, string> = {
    pass: 'bg-green-100 text-green-800',
    fail: 'bg-red-100 text-red-800',
    skip: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${styles[status] ?? ''}`}>
      {status}
    </span>
  );
}

function MergeBadge({ mergeStatus }: { mergeStatus?: string }) {
  if (!mergeStatus) return <span className="text-xs text-gray-400">-</span>;

  const styles: Record<string, string> = {
    clean: 'text-green-700',
    resolved: 'text-yellow-700',
    conflict: 'text-red-700',
  };

  return (
    <span className={`text-xs font-medium ${styles[mergeStatus] ?? 'text-gray-500'}`}>
      {mergeStatus}
    </span>
  );
}

export function SummaryTable({ phases }: SummaryTableProps) {
  return (
    <div className="rounded-lg border border-gray-200 shadow-sm bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">Build Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Phase</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Merge</th>
              <th className="px-4 py-2 font-medium">Duration</th>
              <th className="px-4 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {phases.map((phase) => {
              const success = phase.status === 'completed';
              const skipped = phase.status === 'skipped';
              const failed = phase.status === 'failed';
              const resultStatus: 'pass' | 'fail' | 'skip' = skipped
                ? 'skip'
                : failed
                  ? 'fail'
                  : success
                    ? 'pass'
                    : 'pass'; // pending phases default to pass display

              return (
                <tr key={phase.number} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    {String(phase.number).padStart(2, '0')}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{phase.name}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={resultStatus} />
                  </td>
                  <td className="px-4 py-2">
                    <MergeBadge mergeStatus={phase.mergeStatus} />
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 font-mono">
                    {formatDuration(phase.duration)}
                  </td>
                  <td className="px-4 py-2 text-xs text-red-600 max-w-xs truncate" title={phase.error}>
                    {phase.error ?? '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
