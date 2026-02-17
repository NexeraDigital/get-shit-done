// Step-by-step progress component for a phase (DASH-17).
// Horizontal stepper with 4 labeled steps: Discuss, Plan, Execute, Verify.
// Each step shows as a circle connected by lines with status-dependent styling.

import type { PhaseStep } from '../types/index.js';

interface StepProgressProps {
  steps: {
    discuss: PhaseStep;
    plan: PhaseStep;
    execute: PhaseStep;
    verify: PhaseStep;
  };
}

const STEP_ORDER = ['discuss', 'plan', 'execute', 'verify'] as const;
type StepKey = (typeof STEP_ORDER)[number];

const STEP_LABELS: Record<StepKey, string> = {
  discuss: 'Discuss',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
};

function StepCircle({
  status,
  isActive,
}: {
  status: PhaseStep;
  isActive: boolean;
}) {
  if (status === 'done') {
    return (
      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
        <svg
          className="w-4 h-4 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="w-8 h-8 rounded-full bg-blue-500 animate-pulse" />
    );
  }

  return (
    <div className="w-8 h-8 rounded-full border-2 border-gray-300 bg-white" />
  );
}

export function StepProgress({ steps }: StepProgressProps) {
  return (
    <div className="flex items-center justify-between">
      {STEP_ORDER.map((stepKey, index) => {
        const status = steps[stepKey];
        // A step is "active" if it is not idle and not done (i.e., it matches its own name)
        const isActive = status !== 'idle' && status !== 'done' && status === stepKey;

        return (
          <div key={stepKey} className="flex items-center flex-1 last:flex-initial">
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1">
              <StepCircle status={status} isActive={isActive} />
              <span className="text-xs text-gray-500 font-medium">
                {STEP_LABELS[stepKey]}
              </span>
            </div>

            {/* Connecting line (not after the last step) */}
            {index < STEP_ORDER.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-2 ${
                  status === 'done' ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
