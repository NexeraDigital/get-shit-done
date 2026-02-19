// FileStateReader - reads and watches the autopilot-state.json file.
// Used by the standalone dashboard to provide state without an in-process StateStore.
// Implements the StateProvider interface from api routes.

import { readFile, stat } from 'node:fs/promises';
import { IPC_PATHS, HEARTBEAT_STALE_MS } from './types.js';
import type { IPCHeartbeat } from './types.js';
import type { AutopilotState } from '../types/state.js';
import type { StateProvider } from '../server/routes/api.js';

const POLL_INTERVAL_MS = 1_000;

/** Default state returned when no state file exists yet */
function defaultState(): AutopilotState {
  const now = new Date().toISOString();
  return {
    status: 'idle',
    currentPhase: 0,
    currentStep: 'idle',
    phases: [],
    pendingQuestions: [],
    errorHistory: [],
    startedAt: now,
    lastUpdatedAt: now,
  };
}

export class FileStateReader implements StateProvider {
  private state: AutopilotState = defaultState();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly statePath: string;
  private readonly heartbeatPath: string;
  private lastMtimeMs = 0;

  constructor(projectDir: string) {
    this.statePath = IPC_PATHS.state(projectDir);
    this.heartbeatPath = IPC_PATHS.heartbeat(projectDir);
  }

  /** Returns the latest known state */
  getState(): Readonly<AutopilotState> {
    return { ...this.state };
  }

  /** Whether the autopilot process heartbeat is recent */
  async isAlive(): Promise<boolean> {
    try {
      const raw = await readFile(this.heartbeatPath, 'utf-8');
      const hb = JSON.parse(raw) as IPCHeartbeat;
      const age = Date.now() - new Date(hb.timestamp).getTime();
      return age < HEARTBEAT_STALE_MS;
    } catch {
      return false;
    }
  }

  /** Starts polling the state file for changes */
  start(): void {
    // Initial read
    void this.readStateFile();
    this.timer = setInterval(() => {
      void this.readStateFile();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops polling */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async readStateFile(): Promise<void> {
    try {
      const s = await stat(this.statePath);
      // Skip read if file hasn't changed
      if (s.mtimeMs === this.lastMtimeMs) return;
      this.lastMtimeMs = s.mtimeMs;

      const raw = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(raw) as AutopilotState;
    } catch {
      // File doesn't exist yet or is being written -- keep last known state
    }
  }
}
