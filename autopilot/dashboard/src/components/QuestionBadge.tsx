// Pending questions CTA (DASH-12).
// Prominent badge when questions need attention, subdued when none pending.

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

  const firstQuestion = questions[0]!;

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
