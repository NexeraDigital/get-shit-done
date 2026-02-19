// SSE (Server-Sent Events) endpoint and event wiring.
// Supports two modes:
// - 'in-process': wires directly to orchestrator/claude/logger EventEmitters
// - 'file-tail': reads events from an EventTailer (file-based IPC)

import type { Express, Request, Response } from 'express';
import type { EventEmitter } from 'node:events';

/** Minimal EventEmitter interface that any event source must satisfy */
interface EventSource {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** In-process mode: wires to live EventEmitter instances */
export interface SSEDepsInProcess {
  mode: 'in-process';
  app: Express;
  orchestrator: EventSource;
  claudeService: EventSource;
  logger: EventSource & {
    getRecentEntries(): unknown[];
  };
}

/** File-tail mode: reads from an EventTailer that emits 'event' events */
export interface SSEDepsFileTail {
  mode: 'file-tail';
  app: Express;
  eventTailer: EventSource & {
    getRecentEvents(): Array<{ event: string; data: unknown }>;
  };
}

export type SSEDeps = SSEDepsInProcess | SSEDepsFileTail;

/**
 * Sets up the SSE endpoint and wires events to broadcast.
 *
 * @returns broadcast function for manual event emission and closeAll for shutdown
 */
export function setupSSE(deps: SSEDeps): {
  broadcast: (event: string, data: unknown) => void;
  closeAll: () => void;
} {
  const { app } = deps;

  // Track connected SSE clients
  const clients = new Set<Response>();

  // Broadcast an SSE event to all connected clients
  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  }

  // SSE endpoint: GET /api/log/stream
  app.get('/api/log/stream', (_req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Client reconnection interval (10 seconds)
    res.write('retry: 10000\n\n');

    // Initial burst depends on mode
    if (deps.mode === 'in-process') {
      const recentEntries = deps.logger.getRecentEntries();
      for (const entry of recentEntries) {
        res.write(`event: log-entry\ndata: ${JSON.stringify(entry)}\n\n`);
      }
    } else {
      const recentEvents = deps.eventTailer.getRecentEvents();
      for (const evt of recentEvents) {
        res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
      }
    }

    // Register client
    clients.add(res);

    // Clean up on disconnect
    _req.on('close', () => {
      clients.delete(res);
    });
  });

  // Wire events based on mode
  if (deps.mode === 'in-process') {
    const { orchestrator, claudeService, logger } = deps;

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

    claudeService.on('question:pending', (data: unknown) =>
      broadcast('question-pending', data),
    );
    claudeService.on('question:answered', (data: unknown) =>
      broadcast('question-answered', data),
    );

    logger.on('entry', (entry: unknown) => broadcast('log-entry', entry));
  } else {
    // File-tail mode: EventTailer emits 'event' with { event, data }
    deps.eventTailer.on('event', (evt: { event: string; data: unknown }) => {
      broadcast(evt.event, evt.data);
    });
  }

  // Close all SSE connections (for shutdown)
  function closeAll(): void {
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  }

  return { broadcast, closeAll };
}
