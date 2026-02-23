// Overview page: main dashboard landing page composing all overview components.
// Wired to Zustand store with individual selectors for each data slice.

import { useDashboardStore } from '../store/index.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { PhaseCard } from '../components/PhaseCard.js';
import { ActivityFeed } from '../components/ActivityFeed.js';
import { LogStream } from '../components/LogStream.js';

export function Overview() {
  const status = useDashboardStore((s) => s.status);
  const progress = useDashboardStore((s) => s.progress);
  const phases = useDashboardStore((s) => s.phases);
  const currentPhase = useDashboardStore((s) => s.currentPhase);
  const activities = useDashboardStore((s) => s.activities);
  const logs = useDashboardStore((s) => s.logs);

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar (full width) */}
      <ProgressBar progress={progress} isInitializing={status === 'running' && phases.length === 0} />

      {/* Main content: Left column (Phases + Logs) | Right column (Activity feed spanning both) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Phases then Logs stacked */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <PhaseCard
            phases={phases}
            currentPhase={currentPhase}
          />
          <LogStream logs={logs} collapsible={true} />
        </div>

        {/* Right column: Activity feed pinned to viewport height */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] flex flex-col">
            <ActivityFeed activities={activities.slice(0, 10)} />
          </div>
        </div>
      </div>
    </div>
  );
}
