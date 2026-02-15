// writeYoloConfig - stub for TDD RED phase
// Generates .planning/config.json for autonomous GSD execution

import type { AutopilotConfig } from '../types/index.js';

export async function writeYoloConfig(
  _projectDir: string,
  _config: Pick<AutopilotConfig, 'depth' | 'model' | 'skipVerify'>,
): Promise<void> {
  throw new Error('Not implemented');
}
