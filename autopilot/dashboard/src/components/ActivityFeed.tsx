// Recent activity feed (DASH-13).
// Scrollable list of recent activities with colored dots and relative timestamps.

import type { ActivityItem } from '../types/index.js';

interface ActivityFeedProps {
  activities: ActivityItem[];
}

/**
 * Format an ISO timestamp as a relative time string (e.g., "2m ago", "just now").
 */
function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 0 || isNaN(diffSeconds)) return 'just now';
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${String(diffSeconds)}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${String(diffDays)}d ago`;
}

const TYPE_COLORS: Record<ActivityItem['type'], string> = {
  'phase-started': 'bg-blue-500',
  'phase-completed': 'bg-green-500',
  'question-pending': 'bg-amber-500',
  'question-answered': 'bg-blue-400',
  'error': 'bg-red-500',
  'build-complete': 'bg-green-600',
};

export function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 h-full">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Recent Activity
        </h3>
        <p className="text-sm text-gray-400">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Recent Activity
      </h3>
      <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
        {activities.map((activity, i) => (
          <div key={`${activity.timestamp}-${String(i)}`} className="flex items-start gap-3 py-2">
            <span
              className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                TYPE_COLORS[activity.type]
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 truncate">
                {activity.message}
              </p>
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
              {timeAgo(activity.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
