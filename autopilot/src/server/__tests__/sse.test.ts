// Tests for SSE endpoint (GET /api/log/stream) and event broadcasting.
// Uses ResponseServer with EventEmitter-based mocks for orchestrator, claudeService, logger.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ResponseServer } from '../index.js';
import type { LogEntry } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse SSE text into an array of { event, data } objects. */
function parseSSE(raw: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  const blocks = raw.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event && data) events.push({ event, data });
  }
  return events;
}

/** Read SSE response text with a timeout. */
async function readSSE(
  url: string,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });

  return new Promise((resolve) => {
    let text = '';
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const pump = (): void => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            clearTimeout(timeout);
            resolve({ response, text });
            return;
          }
          text += decoder.decode(value, { stream: true });
          pump();
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve({ response, text });
        });
    };
    pump();
  });
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockDeps() {
  const orchestrator = new EventEmitter();
  const claudeService = Object.assign(new EventEmitter(), {
    getPendingQuestions: () => [],
    submitAnswer: () => false,
  });
  const logger = Object.assign(new EventEmitter(), {
    log: () => {},
    getRecentEntries: () => [] as LogEntry[],
  });
  const stateStore = {
    getState: () => ({
      status: 'idle' as const,
      currentPhase: 0,
      currentStep: 'idle' as const,
      phases: [],
      pendingQuestions: [],
      errorHistory: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    }),
  };
  const config = {
    port: 3847,
    notify: 'console',
    depth: 'standard' as const,
    model: 'balanced' as const,
    skipDiscuss: false,
    skipVerify: false,
    verbose: false,
    quiet: false,
  };

  return { orchestrator, claudeService, logger, stateStore, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let serverToClean: ResponseServer | null = null;

afterEach(async () => {
  if (serverToClean) {
    await serverToClean.close();
    serverToClean = null;
  }
});

describe('SSE endpoint', () => {
  it('responds with text/event-stream content type', async () => {
    const deps = createMockDeps();
    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;
    const { response } = await readSSE(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      300,
    );

    expect(response.headers.get('content-type')).toBe('text/event-stream');
  });

  it('sends initial burst of recent log entries on connect', async () => {
    const deps = createMockDeps();
    const fakeEntries: LogEntry[] = [
      {
        timestamp: '2026-01-01T00:00:00Z',
        level: 'info',
        component: 'test',
        message: 'entry-one',
      },
      {
        timestamp: '2026-01-01T00:00:01Z',
        level: 'warn',
        component: 'test',
        message: 'entry-two',
      },
    ];
    deps.logger.getRecentEntries = () => fakeEntries;

    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;
    const { text } = await readSSE(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      300,
    );

    const events = parseSSE(text);
    const logEvents = events.filter((e) => e.event === 'log-entry');
    expect(logEvents.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(logEvents[0]!.data).message).toBe('entry-one');
    expect(JSON.parse(logEvents[1]!.data).message).toBe('entry-two');
  });

  it('broadcasts phase-started when orchestrator emits phase:started', async () => {
    const deps = createMockDeps();
    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;

    // Connect SSE, then emit event after a small delay
    const ssePromise = readSSE(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      500,
    );

    // Give SSE connection time to establish
    await new Promise((r) => setTimeout(r, 50));
    deps.orchestrator.emit('phase:started', { phase: 1, name: 'Foundation' });

    const { text } = await ssePromise;
    const events = parseSSE(text);
    const phaseEvents = events.filter((e) => e.event === 'phase-started');
    expect(phaseEvents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(phaseEvents[0]!.data).phase).toBe(1);
  });

  it('broadcasts question-pending when claudeService emits question:pending', async () => {
    const deps = createMockDeps();
    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;

    const ssePromise = readSSE(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      500,
    );

    await new Promise((r) => setTimeout(r, 50));
    deps.claudeService.emit('question:pending', { id: 'q-123' });

    const { text } = await ssePromise;
    const events = parseSSE(text);
    const qEvents = events.filter((e) => e.event === 'question-pending');
    expect(qEvents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(qEvents[0]!.data).id).toBe('q-123');
  });

  it('broadcasts log-entry when logger emits entry event', async () => {
    const deps = createMockDeps();
    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;

    const ssePromise = readSSE(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      500,
    );

    await new Promise((r) => setTimeout(r, 50));
    deps.logger.emit('entry', {
      timestamp: '2026-01-01T00:00:05Z',
      level: 'info',
      component: 'test',
      message: 'live-entry',
    });

    const { text } = await ssePromise;
    const events = parseSSE(text);
    const logEvents = events.filter((e) => e.event === 'log-entry');
    // Should have at least the live event (no initial burst since getRecentEntries returns [])
    const liveEvent = logEvents.find(
      (e) => JSON.parse(e.data).message === 'live-entry',
    );
    expect(liveEvent).toBeDefined();
  });

  it('handles client disconnect without errors when broadcasting', async () => {
    const deps = createMockDeps();
    const server = new ResponseServer(deps as any);
    serverToClean = server;
    await server.start(0);

    const addr = server.address as AddressInfo;

    // Connect and immediately disconnect
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${addr.port}/api/log/stream`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    controller.abort();

    // Wait for disconnect to be processed
    await new Promise((r) => setTimeout(r, 100));

    // Emitting events should not throw (client was removed)
    expect(() => {
      deps.orchestrator.emit('phase:started', { phase: 1, name: 'Test' });
    }).not.toThrow();
  });
});
