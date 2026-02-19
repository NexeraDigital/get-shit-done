import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AnswerWriter } from '../answer-writer.js';
import { AnswerPoller } from '../answer-poller.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-answer-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('Answer roundtrip (AnswerWriter + AnswerPoller)', () => {
  it('writes an answer file and polls it back', async () => {
    const writer = new AnswerWriter(testDir);
    const received = new Map<string, Record<string, string>>();

    const poller = new AnswerPoller(testDir, (qId, answers) => {
      received.set(qId, answers);
      return true;
    });

    await poller.start();

    // Write answer
    await writer.writeAnswer('q-123', { 'Which DB?': 'Postgres' });

    // Wait for poller to pick it up
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.has('q-123')) {
          clearInterval(check);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    poller.stop();

    expect(received.get('q-123')).toEqual({ 'Which DB?': 'Postgres' });
  });

  it('handles multiple answers', async () => {
    const writer = new AnswerWriter(testDir);
    const received = new Map<string, Record<string, string>>();

    const poller = new AnswerPoller(testDir, (qId, answers) => {
      received.set(qId, answers);
      return true;
    });

    await poller.start();

    await writer.writeAnswer('q-1', { a: '1' });
    await writer.writeAnswer('q-2', { b: '2' });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.size >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    poller.stop();

    expect(received.get('q-1')).toEqual({ a: '1' });
    expect(received.get('q-2')).toEqual({ b: '2' });
  });

  it('deletes answer files after processing', async () => {
    const writer = new AnswerWriter(testDir);
    const poller = new AnswerPoller(testDir, () => true);
    await poller.start();

    await writer.writeAnswer('q-del', { x: 'y' });

    // Wait for processing
    await new Promise((r) => setTimeout(r, 3000));
    poller.stop();

    // Verify file was deleted
    const { readdir } = await import('node:fs/promises');
    const answersDir = join(testDir, '.planning', 'autopilot-answers');
    const files = await readdir(answersDir);
    const answerFiles = files.filter(f => f.endsWith('.json'));
    expect(answerFiles).toHaveLength(0);
  });
});
