import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventWriter } from '../event-writer.js';
import { EventTailer } from '../event-tailer.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-event-tailer-'));
  await mkdir(join(testDir, '.planning', 'autopilot-log'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('EventTailer', () => {
  it('tails events written by EventWriter', async () => {
    const writer = new EventWriter(testDir);
    const tailer = new EventTailer(testDir);

    // Write some events first
    await writer.write('phase-started', { phase: 1 });
    await writer.write('log-entry', { message: 'hello' });

    // Start tailer (it starts at end of file)
    await tailer.start();

    // Write new event after tailer started
    await writer.write('phase-completed', { phase: 1 });

    // Wait for tailer to pick up the event
    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt) => {
        received.push(evt);
        if (received.length >= 1) resolve();
      });

      // Timeout safety
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!.event).toBe('phase-completed');
    expect(received[0]!.data).toEqual({ phase: 1 });
  });

  it('maintains a ring buffer of recent events', async () => {
    const writer = new EventWriter(testDir);
    const tailer = new EventTailer(testDir);

    await writer.write('e1', { n: 1 });

    await tailer.start();

    // Write events after start
    await writer.write('e2', { n: 2 });
    await writer.write('e3', { n: 3 });

    // Wait for events to be processed
    await new Promise<void>((resolve) => {
      let count = 0;
      tailer.on('event', () => {
        count++;
        if (count >= 2) resolve();
      });
      setTimeout(resolve, 3000);
    });

    const recent = tailer.getRecentEvents();
    expect(recent.length).toBeGreaterThanOrEqual(2);

    tailer.stop();
  });

  it('handles non-existent file gracefully', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'ipc-tailer-empty-'));
    const tailer = new EventTailer(emptyDir);

    // Should not throw
    await tailer.start();

    // getRecentEvents should return empty
    expect(tailer.getRecentEvents()).toEqual([]);

    tailer.stop();
    await rm(emptyDir, { recursive: true, force: true });
  });
});
