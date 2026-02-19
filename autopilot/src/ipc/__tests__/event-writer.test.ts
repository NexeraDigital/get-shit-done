import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventWriter } from '../event-writer.js';
import type { IPCEvent } from '../types.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-event-writer-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('EventWriter', () => {
  it('creates the events file and parent directory on first write', async () => {
    const writer = new EventWriter(testDir);
    await writer.write('test-event', { key: 'value' });

    const content = await readFile(writer.path, 'utf-8');
    expect(content).toBeTruthy();
  });

  it('writes valid NDJSON with sequence numbers', async () => {
    const writer = new EventWriter(testDir);
    await writer.write('event-one', { a: 1 });
    await writer.write('event-two', { b: 2 });

    const content = await readFile(writer.path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as IPCEvent;
    const second = JSON.parse(lines[1]!) as IPCEvent;

    expect(first.seq).toBe(1);
    expect(first.event).toBe('event-one');
    expect(first.data).toEqual({ a: 1 });
    expect(first.timestamp).toBeTruthy();

    expect(second.seq).toBe(2);
    expect(second.event).toBe('event-two');
    expect(second.data).toEqual({ b: 2 });
  });

  it('tracks sequence number via currentSeq', async () => {
    const writer = new EventWriter(testDir);
    expect(writer.currentSeq).toBe(0);

    await writer.write('e', {});
    expect(writer.currentSeq).toBe(1);

    await writer.write('e', {});
    expect(writer.currentSeq).toBe(2);
  });
});
