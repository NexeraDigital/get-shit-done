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

/** Minimal PushManager interface for sending notifications */
interface PushManager {
  sendToAll(payload: unknown): Promise<void>;
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
  pushManager?: PushManager;
}

/** File-tail mode: reads from an EventTailer that emits 'event' events */
export interface SSEDepsFileTail {
  mode: 'file-tail';
  app: Express;
  eventTailer: EventSource & {
    getRecentEvents(): Array<{ event: string; data: unknown }>;
  };
  pushManager?: PushManager;
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
    const { orchestrator, claudeService, logger, pushManager } = deps;

    orchestrator.on('phase:started', (data: unknown) =>
      broadcast('phase-started', data),
    );
    orchestrator.on('phase:completed', (data: unknown) =>
      broadcast('phase-completed', data),
    );
    orchestrator.on('step:completed', (data: unknown) =>
      broadcast('step-completed', data),
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

    // Wire push notifications if pushManager is provided
    if (pushManager) {
      const pm = pushManager;

      // Question grouping: debounce rapid-fire questions into a single notification
      let questionDebounceTimer: NodeJS.Timeout | null = null;
      let pendingQuestionCount = 0;

      claudeService.on('question:pending', (data: unknown) => {
        // Increment pending count
        pendingQuestionCount++;

        // Clear any existing timer
        if (questionDebounceTimer) {
          clearTimeout(questionDebounceTimer);
        }

        // Set new debounce timer (500ms)
        questionDebounceTimer = setTimeout(() => {
          if (pendingQuestionCount === 1) {
            // Single question notification
            const questionText =
              data &&
              typeof data === 'object' &&
              'text' in data &&
              typeof data.text === 'string'
                ? data.text
                : 'A question needs your input';

            const questionId =
              data &&
              typeof data === 'object' &&
              'id' in data &&
              typeof data.id === 'string'
                ? data.id
                : '';

            void pm.sendToAll({
              title: 'GSD Autopilot: Question needs your input',
              body:
                questionText.length > 100
                  ? questionText.slice(0, 97) + '...'
                  : questionText,
              tag: 'gsd-question',
              url: questionId ? `/questions/${questionId}` : '/questions',
              requireInteraction: true,
              silent: false,
            });
          } else {
            // Multiple questions notification
            void pm.sendToAll({
              title: 'GSD Autopilot: Questions need your input',
              body: `${pendingQuestionCount} questions are waiting for your response`,
              tag: 'gsd-question',
              url: '/questions',
              requireInteraction: true,
              silent: false,
            });
          }

          // Reset counter
          pendingQuestionCount = 0;
          questionDebounceTimer = null;
        }, 500);
      });

      // Error escalation notification
      orchestrator.on('error:escalation', (data: unknown) => {
        const errorMessage =
          data &&
          typeof data === 'object' &&
          ('error' in data || 'message' in data)
            ? String('error' in data ? (data as any).error : (data as any).message)
            : 'An error needs attention';

        const phaseNumber =
          data &&
          typeof data === 'object' &&
          'phase' in data &&
          typeof (data as any).phase === 'number'
            ? String((data as any).phase)
            : '';

        void pm.sendToAll({
          title: 'GSD Autopilot: Error needs attention',
          body: errorMessage,
          tag: 'gsd-error',
          url: phaseNumber ? `/phases/${phaseNumber}` : '/',
          requireInteraction: true,
          silent: true,
        });
      });

      // Phase completed notification
      orchestrator.on('phase:completed', (data: unknown) => {
        const phaseName =
          data &&
          typeof data === 'object' &&
          'name' in data &&
          typeof (data as any).name === 'string'
            ? (data as any).name
            : 'Phase completed';

        void pm.sendToAll({
          title: 'GSD Autopilot: Phase completed',
          body: phaseName,
          tag: 'gsd-phase-complete',
          url: '/',
          requireInteraction: false,
          silent: true,
        });
      });

      // Build complete notification
      orchestrator.on('build:complete', (data: unknown) => {
        let bodyText = 'All phases completed successfully!';

        // Try to extract summary stats if available
        if (data && typeof data === 'object') {
          const phaseCount =
            'phasesCompleted' in data && typeof (data as any).phasesCompleted === 'number'
              ? (data as any).phasesCompleted
              : null;
          const duration =
            'duration' in data && typeof (data as any).duration === 'string'
              ? (data as any).duration
              : null;

          if (phaseCount !== null && duration !== null) {
            bodyText = `${phaseCount} phases completed in ${duration}`;
          } else if (phaseCount !== null) {
            bodyText = `${phaseCount} phases completed`;
          }
        }

        void pm.sendToAll({
          title: 'GSD Autopilot: Build complete!',
          body: bodyText,
          tag: 'gsd-build-complete',
          url: '/',
          requireInteraction: false,
          silent: true,
        });
      });
    }
  } else {
    // File-tail mode: EventTailer emits 'event' with { event, data }
    const { eventTailer, pushManager } = deps;

    eventTailer.on('event', (evt: { event: string; data: unknown }) => {
      broadcast(evt.event, evt.data);

      // Wire push notifications for file-tail mode
      if (pushManager) {
        const pm = pushManager;

        if (evt.event === 'question-pending') {
          const questionText =
            evt.data &&
            typeof evt.data === 'object' &&
            'text' in evt.data &&
            typeof evt.data.text === 'string'
              ? evt.data.text
              : 'A question needs your input';

          const questionId =
            evt.data &&
            typeof evt.data === 'object' &&
            'id' in evt.data &&
            typeof evt.data.id === 'string'
              ? evt.data.id
              : '';

          void pm.sendToAll({
            title: 'GSD Autopilot: Question needs your input',
            body:
              questionText.length > 100
                ? questionText.slice(0, 97) + '...'
                : questionText,
            tag: 'gsd-question',
            url: questionId ? `/questions/${questionId}` : '/questions',
            requireInteraction: true,
            silent: false,
          });
        } else if (evt.event === 'error') {
          const errorMessage =
            evt.data &&
            typeof evt.data === 'object' &&
            ('error' in evt.data || 'message' in evt.data)
              ? String('error' in evt.data ? (evt.data as any).error : (evt.data as any).message)
              : 'An error needs attention';

          const phaseNumber =
            evt.data &&
            typeof evt.data === 'object' &&
            'phase' in evt.data &&
            typeof (evt.data as any).phase === 'number'
              ? String((evt.data as any).phase)
              : '';

          void pm.sendToAll({
            title: 'GSD Autopilot: Error needs attention',
            body: errorMessage,
            tag: 'gsd-error',
            url: phaseNumber ? `/phases/${phaseNumber}` : '/',
            requireInteraction: true,
            silent: true,
          });
        } else if (evt.event === 'phase-completed') {
          const phaseName =
            evt.data &&
            typeof evt.data === 'object' &&
            'name' in evt.data &&
            typeof (evt.data as any).name === 'string'
              ? (evt.data as any).name
              : 'Phase completed';

          void pm.sendToAll({
            title: 'GSD Autopilot: Phase completed',
            body: phaseName,
            tag: 'gsd-phase-complete',
            url: '/',
            requireInteraction: false,
            silent: true,
          });
        } else if (evt.event === 'build-complete') {
          let bodyText = 'All phases completed successfully!';

          if (evt.data && typeof evt.data === 'object') {
            const phaseCount =
              'phasesCompleted' in evt.data && typeof (evt.data as any).phasesCompleted === 'number'
                ? (evt.data as any).phasesCompleted
                : null;
            const duration =
              'duration' in evt.data && typeof (evt.data as any).duration === 'string'
                ? (evt.data as any).duration
                : null;

            if (phaseCount !== null && duration !== null) {
              bodyText = `${phaseCount} phases completed in ${duration}`;
            } else if (phaseCount !== null) {
              bodyText = `${phaseCount} phases completed`;
            }
          }

          void pm.sendToAll({
            title: 'GSD Autopilot: Build complete!',
            body: bodyText,
            tag: 'gsd-build-complete',
            url: '/',
            requireInteraction: false,
            silent: true,
          });
        }
      }
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
