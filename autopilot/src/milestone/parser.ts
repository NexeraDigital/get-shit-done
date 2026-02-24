import type { MilestoneResponse } from './types.js';

/**
 * Parse milestone data from GSD planning files
 * @param planningDir - Path to .planning directory
 * @returns MilestoneResponse with current and shipped milestones
 */
export function parseMilestoneData(planningDir: string): MilestoneResponse {
  // Stub implementation - will fail tests
  return {
    current: null,
    shipped: [],
  };
}
