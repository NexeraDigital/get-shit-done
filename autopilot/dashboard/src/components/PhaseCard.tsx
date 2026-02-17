// Current phase card (DASH-11).
// Shows phase info with clickable link to phase detail page.
// Step progress dots: idle, discuss, plan, execute, verify, done.

import { Link } from 'react-router';
import type { PhaseState, PhaseStep } from '../types/index.js';

interface PhaseCardProps {
  phases: PhaseState[];
  currentPhase: number;
  currentStep: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-yellow-100 text-yellow-700',
};

const STEP_ORDER = ['discuss', 'plan', 'execute', 'verify'] as const;
type StepKey = (typeof STEP_ORDER)[number];

function StepDot({ stepName, stepStatus, isActive }: {
  stepName: string;
  stepStatus: PhaseStep;
  isActive: boolean;
}) {
  let dotClass = 'w-3 h-3 rounded-full border-2 ';

  if (stepStatus === 'done') {
    dotClass += 'bg-green-500 border-green-500';
  } else if (isActive) {
    dotClass += 'bg-blue-500 border-blue-500 animate-pulse';
  } else {
    dotClass += 'bg-white border-gray-300';
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={dotClass} />
      <span className="text-xs text-gray-500">{stepName}</span>
    </div>
  );
}

export function PhaseCard({ phases, currentPhase, currentStep }: PhaseCardProps) {
  const phase = phases.find((p) => p.number === currentPhase);

  if (!phase) {
    return (
      <div className="rounded-lg border border-gray-200 shadow-sm p-6 bg-white">
        <p className="text-gray-400 text-sm">No phases loaded</p>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[phase.status] ?? STATUS_COLORS['pending']!;

  return (
    <Link
      to={`/phases/${String(currentPhase)}`}
      className="block rounded-lg border border-gray-200 shadow-sm p-6 bg-white hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-medium text-gray-500">
            Phase {phase.number}
          </span>
          <h3 className="text-lg font-semibold text-gray-900">{phase.name}</h3>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
        >
          {phase.status.replace('_', ' ')}
        </span>
      </div>

      {/* Current step label */}
      <div className="mb-4">
        <span className="inline-block bg-blue-50 text-blue-700 rounded px-2 py-0.5 text-xs font-medium">
          Step: {currentStep}
        </span>
      </div>

      {/* Step progress dots */}
      <div className="flex items-center justify-between gap-2">
        {STEP_ORDER.map((step) => {
          const stepStatus = phase.steps[step];
          const isActive = currentStep === step && phase.status === 'in_progress';
          return (
            <StepDot
              key={step}
              stepName={step}
              stepStatus={stepStatus}
              isActive={isActive}
            />
          );
        })}
      </div>
    </Link>
  );
}
