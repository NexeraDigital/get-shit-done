// HeartbeatWriter - writes a heartbeat JSON file at regular intervals.
// The dashboard process watches this file to detect autopilot liveness.

import writeFileAtomic from 'write-file-atomic';
import { mkdir, access, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IPC_PATHS, HEARTBEAT_INTERVAL_MS } from './types.js';
import type { IPCHeartbeat } from './types.js';

/** Path to the shutdown marker file, relative to project .planning/ dir */
export function shutdownMarkerPath(projectDir: string): string {
  return join(projectDir, '.planning', 'autopilot-shutdown');
}

export class HeartbeatWriter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;
  private readonly projectDir: string;
  private status = 'running';
  /** Callback invoked when the shutdown marker file is detected */
  onShutdown: (() => void) | null = null;

  constructor(projectDir: string) {
    this.filePath = IPC_PATHS.heartbeat(projectDir);
    this.projectDir = projectDir;
  }

  /** Starts writing heartbeat files at the configured interval */
  async start(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // Clean up any stale shutdown marker from a previous session
    try { await unlink(shutdownMarkerPath(this.projectDir)); } catch { /* ignore */ }
    // Write initial heartbeat immediately
    await this.writeHeartbeat();
    this.timer = setInterval(() => {
      void this.tick();
    }, HEARTBEAT_INTERVAL_MS);
    // Don't keep the process alive just for heartbeat
    this.timer.unref();
  }

  /** Each tick: write heartbeat + check for shutdown marker */
  private async tick(): Promise<void> {
    await this.writeHeartbeat();
    await this.checkShutdownMarker();
  }

  /** Check if the shutdown marker file exists; if so, trigger shutdown */
  private async checkShutdownMarker(): Promise<void> {
    try {
      await access(shutdownMarkerPath(this.projectDir));
      // Marker exists — trigger shutdown
      try { await unlink(shutdownMarkerPath(this.projectDir)); } catch { /* ignore */ }
      if (this.onShutdown) {
        this.onShutdown();
      }
    } catch {
      // Marker doesn't exist — normal operation
    }
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
