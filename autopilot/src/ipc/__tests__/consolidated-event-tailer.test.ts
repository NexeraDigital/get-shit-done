import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Helper: create a valid NDJSON event line
function eventLine(seq: number, event: string, data: unknown = {}): string {
  return JSON.stringify({ seq, timestamp: new Date().toISOString(), event, data }) + '\n';
}

let testDir: string;
let logDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-consolidated-tailer-'));
  logDir = join(testDir, '.planning', 'autopilot', 'log');
  await mkdir(logDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Dynamic import to avoid module-not-found at parse time
async function loadTailer() {
  const mod = await import('../consolidated-event-tailer.js');
  return mod.ConsolidatedEventTailer;
}

describe('ConsolidatedEventTailer', () => {
  it('starts without error on empty log directory', async () => {
    const ConsolidatedEventTailer = await loadTailer();
    const tailer = new ConsolidatedEventTailer(testDir);

    // Should not throw
    await tailer.start();
    expect(tailer.getRecentEvents()).toEqual([]);
    tailer.stop();
  });

  it('tails a single events.ndjson file (sequential mode)', async () => {
    const ConsolidatedEventTailer = await loadTailer();
    const eventsFile = join(logDir, 'events.ndjson');

    // Write initial event before start
    await writeFile(eventsFile, eventLine(1, 'init', { mode: 'sequential' }));

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Write a new event after start
    await appendFile(eventsFile, eventLine(2, 'phase-started', { phase: 1 }));

    // Wait for event to be picked up
    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt: { event: string; data: unknown }) => {
        received.push(evt);
        resolve();
      });
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    // Should have received the new event (tailer starts at current end of each file)
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!.event).toBe('phase-started');
  });

  it('tails multiple events-phase-*.ndjson files (parallel mode)', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    const file1 = join(logDir, 'events-phase-1.ndjson');
    const file2 = join(logDir, 'events-phase-2.ndjson');

    // Create both files with initial content
    await writeFile(file1, eventLine(1, 'init-p1', {}));
    await writeFile(file2, eventLine(1, 'init-p2', {}));

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Write new events to both files
    await appendFile(file1, eventLine(2, 'work-p1', { worker: 1 }));
    await appendFile(file2, eventLine(2, 'work-p2', { worker: 2 }));

    // Wait for events
    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt: { event: string; data: unknown }) => {
        received.push(evt);
        if (received.length >= 2) resolve();
      });
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    expect(received.length).toBeGreaterThanOrEqual(2);
    const events = received.map((r) => r.event);
    expect(events).toContain('work-p1');
    expect(events).toContain('work-p2');
  });

  it('auto-discovers new files appearing after start', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    const file1 = join(logDir, 'events-phase-1.ndjson');
    await writeFile(file1, eventLine(1, 'init-p1', {}));

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Write to file1 so we know tailer is working
    await appendFile(file1, eventLine(2, 'work-p1', {}));

    // Wait a tick for the tailer to process
    await new Promise((r) => setTimeout(r, 600));

    // NOW create a new file that didn't exist at start
    const file3 = join(logDir, 'events-phase-3.ndjson');
    await writeFile(file3, eventLine(1, 'new-worker', { worker: 3 }));

    // The new file should be discovered and its content tailed
    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt: { event: string; data: unknown }) => {
        received.push(evt);
        if (evt.event === 'new-worker') resolve();
      });
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    const events = received.map((r) => r.event);
    expect(events).toContain('new-worker');
  });

  it('has independent per-file sequence tracking', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    const file1 = join(logDir, 'events-phase-1.ndjson');
    const file2 = join(logDir, 'events-phase-2.ndjson');

    // Both files start empty
    await writeFile(file1, '');
    await writeFile(file2, '');

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Both files have seq=1 -- should NOT be deduped
    await appendFile(file1, eventLine(1, 'from-file1', {}));
    await appendFile(file2, eventLine(1, 'from-file2', {}));

    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt: { event: string; data: unknown }) => {
        received.push(evt);
        if (received.length >= 2) resolve();
      });
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    // Both events should be received despite having the same seq number
    expect(received.length).toBe(2);
    const events = received.map((r) => r.event);
    expect(events).toContain('from-file1');
    expect(events).toContain('from-file2');
  });

  it('getRecentEvents returns merged ring buffer from all files', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    const file1 = join(logDir, 'events-phase-1.ndjson');
    const file2 = join(logDir, 'events-phase-2.ndjson');

    await writeFile(file1, '');
    await writeFile(file2, '');

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Write events to both files
    await appendFile(file1, eventLine(1, 'a1', {}));
    await appendFile(file2, eventLine(1, 'b1', {}));
    await appendFile(file1, eventLine(2, 'a2', {}));

    // Wait for processing
    await new Promise<void>((resolve) => {
      let count = 0;
      tailer.on('event', () => {
        count++;
        if (count >= 3) resolve();
      });
      setTimeout(resolve, 3000);
    });

    const recent = tailer.getRecentEvents();
    tailer.stop();

    expect(recent.length).toBe(3);
    const events = recent.map((r) => r.event);
    expect(events).toContain('a1');
    expect(events).toContain('b1');
    expect(events).toContain('a2');
  });

  it('stop() clears timer and handles', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    const file1 = join(logDir, 'events-phase-1.ndjson');
    await writeFile(file1, eventLine(1, 'init', {}));

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Stop should not throw and should be idempotent
    tailer.stop();
    tailer.stop(); // second call should be safe

    expect(tailer.getRecentEvents()).toEqual([]);
  });

  it('processes files in alphabetical order per tick', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    // Create files with names that sort: events-phase-1 < events-phase-2
    const file1 = join(logDir, 'events-phase-1.ndjson');
    const file2 = join(logDir, 'events-phase-2.ndjson');

    await writeFile(file1, '');
    await writeFile(file2, '');

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Write to both files simultaneously
    await appendFile(file1, eventLine(1, 'first', {}));
    await appendFile(file2, eventLine(1, 'second', {}));

    const received: Array<{ event: string; data: unknown }> = [];
    await new Promise<void>((resolve) => {
      tailer.on('event', (evt: { event: string; data: unknown }) => {
        received.push(evt);
        if (received.length >= 2) resolve();
      });
      setTimeout(resolve, 3000);
    });

    tailer.stop();

    // Events from file1 (alphabetically first) should come before file2
    expect(received[0]!.event).toBe('first');
    expect(received[1]!.event).toBe('second');
  });

  it('ignores non-matching files in log directory', async () => {
    const ConsolidatedEventTailer = await loadTailer();

    // Create a file that should NOT be tailed
    const otherFile = join(logDir, 'other-log.ndjson');
    await writeFile(otherFile, eventLine(1, 'should-not-appear', {}));

    const tailer = new ConsolidatedEventTailer(testDir);
    await tailer.start();

    // Wait a couple ticks
    await new Promise((r) => setTimeout(r, 1200));

    tailer.stop();
    expect(tailer.getRecentEvents()).toEqual([]);
  });
});
