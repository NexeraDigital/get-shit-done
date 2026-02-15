// writeYoloConfig - Generates .planning/config.json for autonomous GSD execution
// Reads existing config, merges YOLO-specific settings while preserving user preferences

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AutopilotConfig } from '../types/index.js';

/**
 * Write YOLO mode config for autonomous GSD execution.
 *
 * Merges YOLO-specific settings (model_profile, research, plan_checker, verifier,
 * parallelization) with existing user settings (branching_strategy, commit_docs,
 * search_gitignored, git templates). User preferences are preserved -- only
 * YOLO-specific keys are overridden.
 *
 * @param projectDir - Project root directory
 * @param config - Autopilot config subset with depth, model, and skipVerify
 */
export async function writeYoloConfig(
  projectDir: string,
  config: Pick<AutopilotConfig, 'depth' | 'model' | 'skipVerify'>,
): Promise<void> {
  const configPath = join(projectDir, '.planning', 'config.json');

  // Ensure .planning/ directory exists
  await mkdir(dirname(configPath), { recursive: true });

  // Read existing config (if any) -- preserve user settings
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // ENOENT or invalid JSON -- start from empty object
  }

  // Build YOLO overrides (only orchestrator-controlled settings)
  const yoloSettings: Record<string, unknown> = {
    model_profile: config.model,
    research: true,
    plan_checker: true,
    verifier: !config.skipVerify,
    parallelization: true,
  };

  // Merge: existing user settings + YOLO overrides
  // User settings like branching_strategy, commit_docs, search_gitignored are preserved
  // because they exist in `existing` and are NOT in `yoloSettings`
  const merged = { ...existing, ...yoloSettings };

  // Write with 2-space indentation and trailing newline
  await writeFile(configPath, JSON.stringify(merged, null, 2) + '\n');
}
