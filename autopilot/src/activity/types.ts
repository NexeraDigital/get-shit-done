// Activity entry types for the activity feed.
// Defines all 9 activity types tracked by the dashboard.

export type ActivityEntry = {
  type:
    | 'phase-started'
    | 'phase-completed'
    | 'phase-failed'
    | 'step-started'
    | 'step-completed'
    | 'question-pending'
    | 'question-answered'
    | 'error'
    | 'build-complete';
  message: string;
  timestamp: string; // ISO 8601, server-generated
  metadata?: {
    phase?: number;
    step?: string;
    questionId?: string;
    [key: string]: unknown;
  };
};
