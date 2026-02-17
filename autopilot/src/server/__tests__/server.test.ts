// Tests for ResponseServer class lifecycle (start, close, EADDRINUSE).
// Uses minimal mock dependencies and OS-assigned ports.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { ResponseServer } from '../index.js';

// ---------------------------------------------------------------------------
// Minimal mock dependencies
// ---------------------------------------------------------------------------

function createMockDeps() {
  return {
    stateStore: {
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
    },
    claudeService: Object.assign(new EventEmitter(), {
      getPendingQuestions: () => [],
      submitAnswer: () => false,
    }),
    orchestrator: new EventEmitter(),
    logger: Object.assign(new EventEmitter(), {
      log: () => {},
      getRecentEntries: () => [],
    }),
    config: {
      port: 3847,
      notify: 'console',
      depth: 'standard' as const,
      model: 'balanced' as const,
      skipDiscuss: false,
      skipVerify: false,
      verbose: false,
      quiet: false,
    },
  };
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

describe('ResponseServer', () => {
  it('start() opens a port and health endpoint responds', async () => {
    const server = new ResponseServer(createMockDeps() as any);
    serverToClean = server;

    await server.start(0); // OS-assigned port

    const addr = server.address as AddressInfo;
    expect(addr).toBeTruthy();
    expect(addr.port).toBeGreaterThan(0);

    // Health endpoint should respond
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
  });

  it('close() shuts down cleanly', async () => {
    const server = new ResponseServer(createMockDeps() as any);
    serverToClean = server;

    await server.start(0);
    const addr = server.address as AddressInfo;
    const port = addr.port;

    // Verify it's responding
    const res1 = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res1.status).toBe(200);

    // Close the server
    await server.close();
    serverToClean = null;

    // Subsequent requests should fail
    await expect(
      fetch(`http://127.0.0.1:${port}/api/health`),
    ).rejects.toThrow();
  });

  it('close() is a no-op if server not started', async () => {
    const server = new ResponseServer(createMockDeps() as any);
    // Should not throw
    await server.close();
  });

  it('start() throws on EADDRINUSE with clear message', async () => {
    // Occupy a port with a raw TCP server
    const blocker = createServer();
    const blockerPort = await new Promise<number>((resolve) => {
      blocker.listen(0, () => {
        const addr = blocker.address() as AddressInfo;
        resolve(addr.port);
      });
    });

    try {
      const server = new ResponseServer(createMockDeps() as any);
      serverToClean = server;

      await expect(server.start(blockerPort)).rejects.toThrow(
        `Port ${blockerPort} is already in use`,
      );
      serverToClean = null;
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
