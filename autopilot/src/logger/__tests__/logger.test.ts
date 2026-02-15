import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { AutopilotLogger } from '../index.js';
import { RingBuffer } from '../ring-buffer.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Helper: flush a pino logger's SonicBoom destination.
 * Waits for SonicBoom to be ready, then calls flushSync.
 */
function flushPinoLogger(pinoLogger: pino.Logger): Promise<void> {
  // Access the underlying stream via the pino symbols API
  const dest = (pinoLogger as unknown as Record<symbol, unknown>)[
    pino.symbols.streamSym
  ] as { flushSync?: () => void; once?: (e: string, fn: () => void) => void; removeAllListeners?: (e: string) => void; destroyed?: boolean } | undefined;

  if (!dest || typeof dest.flushSync !== 'function') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    if (dest.destroyed) {
      resolve();
      return;
    }
    // Try flush immediately; if not ready, wait for 'ready' event
    if (dest.once) {
      dest.once('ready', () => {
        dest.flushSync!();
        resolve();
      });
    }
    try {
      dest.flushSync!();
      dest.removeAllListeners?.('ready');
      resolve();
    } catch {
      // Not ready yet -- the 'ready' listener handles it
    }
  });
}

describe('AutopilotLogger', () => {
  let logDir: string;
  let logger: AutopilotLogger;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'gsd-logger-test-'));
    logger = new AutopilotLogger(logDir);
  });

  afterEach(async () => {
    // Flush the logger before cleaning up the temp directory
    await logger.flush();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('creates log directory if it does not exist', async () => {
    const nestedDir = join(logDir, 'nested', 'deep');
    // Constructor should create the directory
    const newLogger = new AutopilotLogger(nestedDir);
    expect(existsSync(nestedDir)).toBe(true);
    await newLogger.flush();
  });

  it('log() adds entry to ring buffer via getRecentEntries()', () => {
    logger.log('info', 'test-component', 'hello world');
    const entries = logger.getRecentEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.component).toBe('test-component');
    expect(entries[0]!.message).toBe('hello world');
    expect(entries[0]!.level).toBe('info');
  });

  it('log() writes to pino log file (verify file exists with JSON after flush)', async () => {
    logger.log('info', 'test-component', 'pino test message');
    await logger.flush();

    const logFile = join(logDir, 'autopilot.log');
    expect(existsSync(logFile)).toBe(true);

    const content = readFileSync(logFile, 'utf-8').trim();
    expect(content.length).toBeGreaterThan(0);

    // pino writes NDJSON -- each line is valid JSON
    const parsed = JSON.parse(content.split('\n')[0]!) as Record<string, unknown>;
    expect(parsed).toHaveProperty('msg', 'pino test message');
    expect(parsed).toHaveProperty('component', 'test-component');
  });

  it('createPhaseLogger() creates file named phase-{N}-{step}.log', async () => {
    const phaseLogger = logger.createPhaseLogger(1, 'plan');
    phaseLogger.info({ component: 'orchestrator' }, 'phase log test');

    // Flush the phase logger's destination
    await flushPinoLogger(phaseLogger);

    const phaseFile = join(logDir, 'phase-1-plan.log');
    expect(existsSync(phaseFile)).toBe(true);

    const content = readFileSync(phaseFile, 'utf-8').trim();
    expect(content.length).toBeGreaterThan(0);

    const parsed = JSON.parse(content.split('\n')[0]!) as Record<string, unknown>;
    expect(parsed).toHaveProperty('msg', 'phase log test');
  });

  it('ring buffer accessible via getRingBuffer()', () => {
    const rb = logger.getRingBuffer();
    expect(rb).toBeInstanceOf(RingBuffer);
    expect(rb.size).toBe(0);

    logger.log('debug', 'comp', 'msg');
    expect(rb.size).toBe(1);
  });

  it('log entries have correct structure (timestamp, level, component, message)', () => {
    logger.log('warn', 'my-component', 'warning message', {
      phase: 2,
      step: 'execute',
    });

    const entries = logger.getRecentEntries();
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.level).toBe('warn');
    expect(entry.component).toBe('my-component');
    expect(entry.message).toBe('warning message');
    expect(entry.phase).toBe(2);
    expect(entry.step).toBe('execute');
  });

  it('log entries include meta when provided', () => {
    logger.log('info', 'comp', 'with meta', { extra: 'data', count: 42 });
    const entry = logger.getRecentEntries()[0]!;
    expect(entry.meta).toEqual({ extra: 'data', count: 42 });
  });

  it('multiple log calls accumulate in ring buffer in order', () => {
    logger.log('info', 'a', 'first');
    logger.log('debug', 'b', 'second');
    logger.log('error', 'c', 'third');

    const entries = logger.getRecentEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.message)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
