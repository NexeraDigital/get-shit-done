import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamLogger } from '../stream-logger.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('StreamLogger', () => {
  let tempDir: string;
  let logger: StreamLogger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gsd-stream-logger-'));
    logger = new StreamLogger(tempDir);
  });

  afterEach(async () => {
    await logger.flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes SDK messages to sdk-output.log as JSON', async () => {
    const message = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello' }],
      },
    };

    logger.write(message);
    await logger.flush();

    const logContent = readFileSync(
      join(tempDir, 'sdk-output.log'),
      'utf-8',
    );
    expect(logContent).toContain('sdk-message');
    expect(logContent).toContain('"type":"assistant"');
  });

  it('does NOT log individual text_delta messages (Pitfall 3)', async () => {
    const textDelta = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'H' },
      },
    };

    logger.write(textDelta);
    await logger.flush();

    const logContent = readFileSync(
      join(tempDir, 'sdk-output.log'),
      'utf-8',
    );
    // File should be empty (no text_delta logged)
    expect(logContent.trim()).toBe('');
  });

  it('logs non-delta stream_event messages', async () => {
    const contentBlockStart = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'text' },
      },
    };

    logger.write(contentBlockStart);
    await logger.flush();

    const logContent = readFileSync(
      join(tempDir, 'sdk-output.log'),
      'utf-8',
    );
    expect(logContent).toContain('content_block_start');
  });

  it('logs tool_progress messages', async () => {
    const toolProgress = {
      type: 'tool_progress',
      content: 'Processing...',
      tool_name: 'Read',
    };

    logger.write(toolProgress);
    await logger.flush();

    const logContent = readFileSync(
      join(tempDir, 'sdk-output.log'),
      'utf-8',
    );
    expect(logContent).toContain('tool_progress');
    expect(logContent).toContain('Processing...');
  });

  it('logs result messages', async () => {
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done',
    };

    logger.write(result);
    await logger.flush();

    const logContent = readFileSync(
      join(tempDir, 'sdk-output.log'),
      'utf-8',
    );
    expect(logContent).toContain('"type":"result"');
  });

  it('flush completes without error', async () => {
    logger.write({ type: 'system', subtype: 'init' });
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});
