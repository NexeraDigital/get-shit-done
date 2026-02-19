// EventWriter - appends NDJSON event lines to the event log file.
// Used by the autopilot process to persist events for the dashboard to tail.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { IPC_PATHS } from './types.js';
import type { IPCEvent } from './types.js';

export class EventWriter {
  private seq = 0;
  private readonly filePath: string;
  private initialized = false;

  constructor(projectDir: string) {
    this.filePath = IPC_PATHS.events(projectDir);
  }

  /** Ensures the parent directory exists */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    this.initialized = true;
  }

  /** Appends an event to the NDJSON file */
  async write(event: string, data: unknown): Promise<void> {
    await this.ensureDir();
    this.seq++;
    const entry: IPCEvent = {
      seq: this.seq,
      timestamp: new Date().toISOString(),
      event,
      data,
    };
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** Returns the current sequence number */
  get currentSeq(): number {
    return this.seq;
  }

  /** Returns the file path for the event log */
  get path(): string {
    return this.filePath;
  }
}
