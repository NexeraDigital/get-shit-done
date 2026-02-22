// Overall progress bar (DASH-10).
// Renders a horizontal bar with animated width transition and percentage text.
// During init (no phases yet), shows an animated indeterminate bar.

interface ProgressBarProps {
  progress: number; // 0-100
  isInitializing?: boolean;
}

export function ProgressBar({ progress, isInitializing = false }: ProgressBarProps) {
  // Clamp to 0-100
  const pct = Math.max(0, Math.min(100, progress));
  const isComplete = pct >= 100;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">
          Overall Progress
        </span>
        <span className="text-sm font-medium text-gray-700">
          {isInitializing ? 'Initializing...' : `${pct}%`}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
        {isInitializing ? (
          <div
            className="h-4 rounded-full bg-blue-400 animate-pulse"
            style={{ width: '30%' }}
          />
        ) : (
          <div
            className={`h-4 rounded-full transition-all duration-500 ease-out ${
              isComplete ? 'bg-green-500' : 'bg-blue-600'
            }`}
            style={{ width: `${String(pct)}%` }}
          />
        )}
      </div>
    </div>
  );
}
