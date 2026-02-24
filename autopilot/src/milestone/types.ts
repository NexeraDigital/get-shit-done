// Milestone type definitions

export type MilestoneStatus = 'active' | 'shipped';

export type MilestoneInfo = {
  version: string;       // e.g. "v1.0"
  name: string;          // e.g. "MVP"
  status: MilestoneStatus;
  shippedDate?: string;  // ISO date string, only for shipped milestones
  phaseCount: number;    // Number of phases in this milestone
  planCount: number;     // Number of plans across all milestone phases
  phasesCompleted: number; // Number of completed phases
  accomplishments: string[]; // Key accomplishments (from MILESTONES.md)
};

export type MilestoneResponse = {
  current: MilestoneInfo | null;  // Active milestone or null
  shipped: MilestoneInfo[];       // Shipped milestones (most recent first)
};
