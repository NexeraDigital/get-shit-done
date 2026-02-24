// VictoryScreen: Milestone completion celebration component.
// Displays when a milestone has been shipped, showing stats and next-milestone prompt.

import type { MilestoneInfo } from '../types/index.js';

interface VictoryScreenProps {
  milestone: MilestoneInfo;
}

export function VictoryScreen({ milestone }: VictoryScreenProps) {
  // Format shipped date
  const shippedDateStr = milestone.shippedDate
    ? new Date(milestone.shippedDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Just now';

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border-2 border-green-200 p-8 md:p-12">
      {/* Header section - Centered celebration */}
      <div className="text-center mb-8">
        {/* Green checkmark circle (CSS-only) */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500 mb-4">
          <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold text-green-900 mb-2">
          Milestone Shipped!
        </h1>

        {/* Subtitle - Milestone identity */}
        <p className="text-xl text-green-700 font-semibold mb-1">
          {milestone.version} {milestone.name}
        </p>

        {/* Shipped date */}
        <p className="text-sm text-green-600">
          {shippedDateStr}
        </p>
      </div>

      {/* Stats grid - Key metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white/60 rounded-lg border border-green-200 p-4 text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Phases</p>
          <p className="text-2xl font-bold text-gray-900">
            {milestone.phasesCompleted}/{milestone.phaseCount}
          </p>
        </div>

        <div className="bg-white/60 rounded-lg border border-green-200 p-4 text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Plans</p>
          <p className="text-2xl font-bold text-gray-900">{milestone.planCount}</p>
        </div>

        <div className="bg-white/60 rounded-lg border border-green-200 p-4 text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Shipped</p>
          <p className="text-2xl font-bold text-gray-900">{shippedDateStr}</p>
        </div>
      </div>

      {/* Accomplishments section */}
      {milestone.accomplishments.length > 0 && (
        <div className="bg-white/60 rounded-lg border border-green-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Key Accomplishments</h2>
          <ul className="space-y-2">
            {milestone.accomplishments.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                {/* Green checkmark bullet */}
                <svg
                  className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-gray-700 text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next steps prompt */}
      <div className="bg-white/80 rounded-lg border border-green-200 p-6 text-center">
        <p className="text-gray-700 mb-3 font-medium">Ready for the next milestone?</p>
        <div className="bg-gray-100 rounded px-4 py-3 inline-block">
          <code className="text-sm font-mono text-gray-800">
            Run /gsd:new-milestone to begin
          </code>
        </div>
      </div>
    </div>
  );
}
