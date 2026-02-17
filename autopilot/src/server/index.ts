// ResponseServer - Express 5 HTTP server for the autopilot dashboard.
// Accepts injected dependencies via constructor (DI pattern).
// Mounts REST API routes and error middleware.
// SSE streaming and SPA serving are deferred to Plan 02.

import express from 'express';
import type { Express } from 'express';
import type { Server } from 'node:http';
import { createApiRoutes } from './routes/api.js';
import { errorHandler } from './middleware/error.js';
import type { StateStore } from '../state/index.js';
import type { ClaudeService } from '../claude/index.js';
import type { Orchestrator } from '../orchestrator/index.js';
import type { AutopilotLogger } from '../logger/index.js';
import type { AutopilotConfig } from '../types/index.js';

export interface ResponseServerOptions {
  stateStore: StateStore;
  claudeService: ClaudeService;
  orchestrator: Orchestrator;
  logger: AutopilotLogger;
  config: AutopilotConfig;
  /** Path to dashboard/dist/ for Phase 5 SPA serving. */
  dashboardDir?: string;
}

/**
 * HTTP server exposing REST API endpoints for the autopilot dashboard.
 *
 * Lifecycle:
 * - Constructor sets up Express app with middleware and routes
 * - start(port) opens the server and resolves when listening
 * - close() shuts down the server gracefully
 */
export class ResponseServer {
  private server: Server | null = null;
  private readonly app: Express;

  constructor(private readonly options: ResponseServerOptions) {
    this.app = express();

    // JSON body parsing middleware
    this.app.use(express.json());

    // Mount REST API routes at /api
    const apiRouter = createApiRoutes({
      stateStore: options.stateStore,
      claudeService: options.claudeService,
    });
    this.app.use('/api', apiRouter);

    // Error handling middleware (must be last)
    this.app.use(errorHandler);
  }

  /**
   * Starts the HTTP server on the given port.
   * Resolves when the server is listening.
   * Throws a clear error if the port is already in use.
   */
  async start(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = this.app.listen(port, () => {
        this.server = server;
        resolve();
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `Port ${port} is already in use. Try --port <other>`,
            ),
          );
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Shuts down the HTTP server gracefully.
   * No-op if the server has not been started.
   */
  async close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Returns the underlying HTTP server address.
   * Useful for tests to get the OS-assigned port.
   */
  get address() {
    return this.server?.address() ?? null;
  }
}
