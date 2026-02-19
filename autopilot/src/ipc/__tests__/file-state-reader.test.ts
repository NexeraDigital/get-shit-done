import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import writeFileAtomic from 'write-file-atomic';
import { FileStateReader } from '../file-state-reader.js';
import type { AutopilotState } from '../../types/state.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-state-reader-'));
  await mkdir(join(testDir, '.planning'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function writeState(state: AutopilotState): Promise<void> {
  const path = join(testDir, '.planning', 'autopilot-state.json');
  return writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
}

function makeState(overrides?: Partial<AutopilotState>): AutopilotState {
  return {
    status: 'idle',
    currentPhase: 0,
    currentStep: 'idle',
    phases: [],
    pendingQuestions: [],
    errorHistory: [],
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FileStateReader', () => {
  it('returns default state when no file exists', () => {
    const reader = new FileStateReader(testDir);
    const state = reader.getState();
    expect(state.status).toBe('idle');
    expect(state.phases).toEqual([]);
  });

  it('reads state from file after start', async () => {
    const expected = makeState({ status: 'running', currentPhase: 3 });
    await writeState(expected);

    const reader = new FileStateReader(testDir);
    reader.start();

    // Wait for poll to read the file
    await new Promise((r) => setTimeout(r, 1500));

    const state = reader.getState();
    expect(state.status).toBe('running');
    expect(state.currentPhase).toBe(3);

    reader.stop();
  });

  it('detects file changes', async () => {
    await writeState(makeState({ status: 'idle' }));

    const reader = new FileStateReader(testDir);
    reader.start();

    await new Promise((r) => setTimeout(r, 1500));
    expect(reader.getState().status).toBe('idle');

    // Update state
    await writeState(makeState({ status: 'running' }));

    await new Promise((r) => setTimeout(r, 1500));
    expect(reader.getState().status).toBe('running');

    reader.stop();
  });

  it('isAlive returns false when no heartbeat file exists', async () => {
    const reader = new FileStateReader(testDir);
    const alive = await reader.isAlive();
    expect(alive).toBe(false);
  });

  it('isAlive returns true when heartbeat is recent', async () => {
    const hbPath = join(testDir, '.planning', 'autopilot-heartbeat.json');
    await writeFileAtomic(hbPath, JSON.stringify({
      pid: process.pid,
      timestamp: new Date().toISOString(),
      status: 'running',
    }));

    const reader = new FileStateReader(testDir);
    const alive = await reader.isAlive();
    expect(alive).toBe(true);
  });

  it('isAlive returns false when heartbeat is stale', async () => {
    const hbPath = join(testDir, '.planning', 'autopilot-heartbeat.json');
    const staleTime = new Date(Date.now() - 30_000).toISOString();
    await writeFileAtomic(hbPath, JSON.stringify({
      pid: 12345,
      timestamp: staleTime,
      status: 'running',
    }));

    const reader = new FileStateReader(testDir);
    const alive = await reader.isAlive();
    expect(alive).toBe(false);
  });
});
