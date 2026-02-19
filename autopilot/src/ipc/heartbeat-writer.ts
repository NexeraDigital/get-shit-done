// HeartbeatWriter - writes a heartbeat JSON file at regular intervals.
// The dashboard process watches this file to detect autopilot liveness.

import writeFileAtomic from 'write-file-atomic';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { IPC_PATHS, HEARTBEAT_INTERVAL_MS } from './types.js';
import type { IPCHeartbeat } from './types.js';

export class HeartbeatWriter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;
  private status = 'running';

  constructor(projectDir: string) {
    this.filePath = IPC_PATHS.heartbeat(projectDir);
  }

  /** Starts writing heartbeat files at the configured interval */
  async start(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // Write initial heartbeat immediately
    await this.writeHeartbeat();
    this.timer = setInterval(() => {
      void this.writeHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    // Don't keep the process alive just for heartbeat
    this.timer.unref();
  }

  /** Updates the status reported in the heartbeat */
  setStatus(status: string): void {
    this.status = status;
  }

  /** Stops the heartbeat timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async writeHeartbeat(): Promise<void> {
    const heartbeat: IPCHeartbeat = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      status: this.status,
    };
    try {
      await writeFileAtomic(this.filePath, JSON.stringify(heartbeat, null, 2) + '\n');
    } catch {
      // Heartbeat write failure is non-fatal
    }
  }
}
