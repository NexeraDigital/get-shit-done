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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Top row: Progress bar (full width) */}
      <div className="lg:col-span-3">
        <ProgressBar progress={progress} isInitializing={status === 'running' && phases.length === 0} />
      </div>

      {/* Middle row: Phase card (2/3) + Activity feed (1/3) */}
      <div className="lg:col-span-2">
        <PhaseCard
          phases={phases}
          currentPhase={currentPhase}
        />
      </div>
      <div className="lg:col-span-1">
        <ActivityFeed activities={activities} />
      </div>

      {/* Bottom row: Log stream (full width) */}
      <div className="lg:col-span-3">
        <LogStream logs={logs} collapsible={true} />
      </div>
    </div>
  );
}
