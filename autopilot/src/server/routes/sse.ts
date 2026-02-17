// SSE (Server-Sent Events) endpoint and event wiring.
// Provides real-time streaming of orchestrator, claude, and logger events
// to connected dashboard clients via GET /api/log/stream.

import type { Express, Request, Response } from 'express';
import type { Orchestrator } from '../../orchestrator/index.js';
import type { ClaudeService } from '../../claude/index.js';
import type { AutopilotLogger } from '../../logger/index.js';

export interface SSEDeps {
  app: Express;
  orchestrator: Orchestrator;
  claudeService: ClaudeService;
  logger: AutopilotLogger;
}

/**
 * Sets up the SSE endpoint and wires orchestrator/claude/logger events to broadcast.
 *
 * @returns broadcast function for manual event emission and closeAll for shutdown
 */
export function setupSSE(deps: SSEDeps): {
  broadcast: (event: string, data: unknown) => void;
  closeAll: () => void;
} {
  const { app, orchestrator, claudeService, logger } = deps;

  // Track connected SSE clients
  const clients = new Set<Response>();

  // SSE endpoint: GET /api/log/stream
  app.get('/api/log/stream', (_req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Client reconnection interval (10 seconds)
    res.write('retry: 10000\n\n');

    // Initial burst: send recent log entries from ring buffer
    const recentEntries = logger.getRecentEntries();
    for (const entry of recentEntries) {
      res.write(`event: log-entry\ndata: ${JSON.stringify(entry)}\n\n`);
    }

    // Register client
    clients.add(res);

    // Clean up on disconnect
    _req.on('close', () => {
      clients.delete(res);
    });
  });

  // Broadcast an SSE event to all connected clients
  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected -- remove from set (Pitfall 2: handle disconnected clients)
        clients.delete(client);
      }
    }
  }

  // Wire Orchestrator events to broadcast (DASH-19)
  orchestrator.on('phase:started', (data: unknown) =>
    broadcast('phase-started', data),
  );
  orchestrator.on('phase:completed', (data: unknown) =>
    broadcast('phase-completed', data),
  );
  orchestrator.on('build:complete', () => broadcast('build-complete', {}));
  orchestrator.on('error:escalation', (data: unknown) =>
    broadcast('error', data),
  );

  // Wire ClaudeService events to broadcast (DASH-19)
  claudeService.on('question:pending', (data: unknown) =>
    broadcast('question-pending', data),
  );
  claudeService.on('question:answered', (data: unknown) =>
    broadcast('question-answered', data),
  );

  // Wire AutopilotLogger 'entry' event to broadcast
  logger.on('entry', (entry: unknown) => broadcast('log-entry', entry));

  // Close all SSE connections (for shutdown)
  function closeAll(): void {
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  }

  return { broadcast, closeAll };
}
