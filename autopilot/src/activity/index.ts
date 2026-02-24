// Activity persistence manager for the autopilot dashboard.
// Provides atomic writes to .planning/autopilot-activity.json with restore capability.
// Non-critical path: persist errors are logged but don't throw.

import { join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import writeFileAtomic from 'write-file-atomic';
import type { ActivityEntry } from './types.js';

export class ActivityStore {
  private readonly filePath: string;
  private activities: ActivityEntry[] = [];

  constructor(projectDir: string) {
    this.filePath = join(projectDir, '.planning', 'autopilot-activity.json');
  }

  /**
   * Restores activities from disk. On ENOENT or parse error, starts with empty array.
   * Logs warning but does NOT throw -- activity persistence is non-critical.
   */
  async restore(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as { activities: ActivityEntry[] };
      this.activities = data.activities || [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet -- start with empty array
        this.activities = [];
      } else {
        // Parse error or other issue -- log warning but continue
        console.warn(
          `[ActivityStore] Failed to restore activities from ${this.filePath}:`,
          error,
        );
        this.activities = [];
      }
    }
  }

  /**
   * Adds a new activity entry to the store. Prepends to array (newest-first) and persists.
   * Wraps persist in try-catch -- logs error but doesn't throw (non-critical path).
   */
  async addActivity(entry: ActivityEntry): Promise<void> {
    this.activities.unshift(entry);
    try {
      await this.persist();
    } catch (error) {
      console.error(
        `[ActivityStore] Failed to persist activities to ${this.filePath}:`,
        error,
      );
    }
  }

  /**
   * Returns the most recent N entries (for SSE initial burst).
   */
  getRecent(limit = 50): ActivityEntry[] {
    return this.activities.slice(0, limit);
  }

  /**
   * Returns all activities (for REST endpoint).
   */
  getAll(): ActivityEntry[] {
    return this.activities;
  }

  /**
   * Persists the activity array to disk using atomic writes.
   */
  private async persist(): Promise<void> {
    const data = { activities: this.activities };
    const content = JSON.stringify(data, null, 2);

    // Ensure .planning directory exists
    const planningDir = join(this.filePath, '..');
    await mkdir(planningDir, { recursive: true });

    // Atomic write
    await writeFileAtomic(this.filePath, content, 'utf-8');
  }
}

/**
 * Truncates text at word boundaries for activity message display.
 * If text is longer than maxLength, finds the last space before maxLength.
 * If that space is > maxLength * 0.7, truncates there; otherwise truncates at maxLength.
 * Appends "..." to truncated result.
 */
export function truncateText(text: string, maxLength = 60): string {
  if (text.length <= maxLength) {
    return text;
  }

  const lastSpace = text.lastIndexOf(' ', maxLength);
  const truncateAt = lastSpace > maxLength * 0.7 ? lastSpace : maxLength;
  return text.slice(0, truncateAt) + '...';
}
