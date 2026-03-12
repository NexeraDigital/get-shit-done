// Pending questions CTA (DASH-12).
// Prominent badge when questions need attention, subdued when none pending.
// Groups questions by phase when multiple phases have pending questions.

import { Link } from 'react-router';
import type { QuestionEvent } from '../types/index.js';

interface QuestionBadgeProps {
  questions: QuestionEvent[];
}

export function QuestionBadge({ questions }: QuestionBadgeProps) {
  const count = questions.length;

  if (count === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-lg">&#10003;</span>
          <span className="text-sm font-medium text-green-700">
            No pending questions
          </span>
        </div>
      </div>
    );
  }

  // Group questions by phase
  const byPhase = new Map<number | undefined, QuestionEvent[]>();
  for (const q of questions) {
    const key = q.phase;
    const list = byPhase.get(key) ?? [];
    list.push(q);
    byPhase.set(key, list);
  }

  // If all questions are from the same phase (or all have no phase), use single-line display
  const uniquePhases = [...byPhase.keys()];
  const singlePhase = uniquePhases.length <= 1;
  const firstQuestion = questions[0]!;

  if (singlePhase) {
    return (
      <Link
        to={`/questions/${firstQuestion.id}`}
        className="block rounded-lg border border-amber-200 bg-amber-50 p-6 hover:shadow-md transition-shadow cursor-pointer"
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-amber-600 text-xl" role="img" aria-label="bell">
            &#128276;
          </span>
          <span className="text-2xl font-bold text-amber-800">{count}</span>
        </div>
        <p className="text-sm font-medium text-amber-700">
          {count === 1 ? 'question needs' : 'questions need'} your attention
        </p>
      </Link>
    );
  }

  // Multi-phase: show per-phase breakdown
  const sortedPhases = [...byPhase.entries()].sort((a, b) => {
    const aKey = a[0] ?? Infinity;
    const bKey = b[0] ?? Infinity;
    return (typeof aKey === 'number' ? aKey : Infinity) - (typeof bKey === 'number' ? bKey : Infinity);
  });

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-amber-600 text-xl" role="img" aria-label="bell">
          &#128276;
        </span>
        <span className="text-2xl font-bold text-amber-800">{count}</span>
        <span className="text-sm font-medium text-amber-700">
          {count === 1 ? 'question needs' : 'questions need'} your attention
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {sortedPhases.map(([phase, phaseQuestions]) => {
          const first = phaseQuestions[0]!;
          const label = phase != null ? `Phase ${phase}` : 'General';
          return (
            <Link
              key={phase ?? 'none'}
              to={`/questions/${first.id}`}
              className="flex items-center justify-between rounded px-3 py-1.5 hover:bg-amber-100 transition-colors"
            >
              <span className="text-sm text-amber-800">{label}</span>
              <span className="text-xs font-semibold text-amber-700 bg-amber-200 rounded-full px-2 py-0.5">
                {phaseQuestions.length} {phaseQuestions.length === 1 ? 'question' : 'questions'}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
