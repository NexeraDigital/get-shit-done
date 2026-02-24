// Recent activity feed (DASH-13).
// Scrollable list of recent activities with colored dots and relative timestamps.

import { useState, useEffect } from 'react';
import type { ActivityItem } from '../types/index.js';

interface ActivityFeedProps {
  activities: ActivityItem[];
}

/**
 * Format an ISO timestamp with relative time < 24h and absolute date >= 24h.
 * Uses current time passed in for live refresh support.
 */
function formatTimestamp(isoString: string, now: number): string {
  const then = new Date(isoString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 0 || isNaN(diffSeconds)) return 'just now';

  const diffHours = Math.floor(diffSeconds / 3600);

  // Absolute date for >= 24h (per locked decision)
  if (diffHours >= 24) {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }); // e.g., "Feb 24, 2:30 PM"
  }

  // Relative time for < 24h
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${String(diffSeconds)}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${String(diffMinutes)} minutes ago`;
  return `${String(diffHours)} hours ago`;
}

const TYPE_COLORS: Record<ActivityItem['type'], string> = {
  'phase-started': 'bg-blue-500',      // blue for progress
  'phase-completed': 'bg-green-500',   // green for success
  'phase-failed': 'bg-red-500',        // red for errors
  'step-started': 'bg-blue-400',       // blue for progress
  'step-completed': 'bg-blue-400',     // blue for progress
  'question-pending': 'bg-orange-500', // orange for questions
  'question-answered': 'bg-green-400', // green for success (answered)
  'error': 'bg-red-500',              // red for errors
  'build-complete': 'bg-green-600',    // green for success
};

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadMore = () => setVisibleCount((prev) => prev + 20);
  const visibleActivities = activities.slice(0, visibleCount);
  const hasMore = visibleCount < activities.length;

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
        {visibleActivities.map((activity, i) => {
          const isError = activity.type === 'error' || activity.type === 'phase-failed';
          const isAnswered = activity.type === 'question-answered';

          return (
            <div
              key={`${activity.timestamp}-${String(i)}`}
              className={`flex items-start gap-3 py-2 ${isError ? 'bg-red-50 rounded px-2 -mx-2' : ''}`}
            >
              <span
                className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  TYPE_COLORS[activity.type]
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${isError ? 'text-red-700 font-bold' : 'text-gray-700'}`}>
                  {isAnswered && <span className="text-green-600 mr-1">&#10003;</span>}
                  {activity.message}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                {formatTimestamp(activity.timestamp, currentTime)}
              </span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
        >
          Load more
        </button>
      )}
    </div>
  );
}
