// ResponseServer - Express 5 HTTP server for the autopilot dashboard.
// Accepts injected dependencies via constructor (DI pattern).
// Mounts REST API routes, SSE streaming, SPA fallback, and error middleware.

import express from 'express';
import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApiRoutes } from './routes/api.js';
import type { StateProvider, QuestionProvider, LivenessProvider, MilestoneProvider } from './routes/api.js';
import { setupSSE } from './routes/sse.js';
import type { SSEDepsInProcess, SSEDepsFileTail } from './routes/sse.js';
import { errorHandler } from './middleware/error.js';
import { loadVAPIDKeys } from './push/vapid.js';
import { SubscriptionStore } from './push/subscription-store.js';
import { PushNotificationManager } from './push/manager.js';
import { createPushRoutes } from './routes/push.js';

/** SSE options without the app (it's provided by the server) */
export type SSEOptions =
  | Omit<SSEDepsInProcess, 'app'>
  | Omit<SSEDepsFileTail, 'app'>;

export interface ResponseServerOptions {
  stateProvider: StateProvider;
  questionProvider: QuestionProvider;
  /** Optional liveness check for the autopilot process (standalone mode) */
  livenessProvider?: LivenessProvider;
  /** SSE config -- if not provided, SSE is disabled */
  sseDeps?: SSEOptions;
  /** Path to dashboard/dist/ for SPA serving. */
  dashboardDir?: string;
  /** Optional activity provider for activity feed */
  activityProvider?: import('./routes/api.js').ActivityProvider;
  /** Optional milestone data provider */
  milestoneProvider?: MilestoneProvider;
  /** Optional push notification manager (if already created) */
  pushManager?: PushNotificationManager;
  /** Optional subscription store (required if pushManager provided) */
  subscriptionStore?: SubscriptionStore;
  /** Optional VAPID public key (required if pushManager provided) */
  vapidPublicKey?: string;
}

/** Legacy options shape -- kept for backwards compatibility with existing callers */
export interface ResponseServerOptionsLegacy {
  stateStore: StateProvider;
  claudeService: QuestionProvider & { on(event: string, listener: (...args: any[]) => void): unknown };
  orchestrator: { on(event: string, listener: (...args: any[]) => void): unknown };
  logger: { on(event: string, listener: (...args: any[]) => void): unknown; getRecentEntries(): unknown[] };
  config: Record<string, unknown>;
  dashboardDir?: string;
  activityProvider?: import('./routes/api.js').ActivityProvider;
}

function isLegacy(opts: ResponseServerOptions | ResponseServerOptionsLegacy): opts is ResponseServerOptionsLegacy {
  return 'stateStore' in opts && 'orchestrator' in opts;
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
  private closeAllSSE: (() => void) | null = null;
  private pushManager: PushNotificationManager | null = null;

  constructor(opts: ResponseServerOptions | ResponseServerOptionsLegacy) {
    this.app = express();

    // JSON body parsing middleware
    this.app.use(express.json());

    let stateProvider: StateProvider;
    let questionProvider: QuestionProvider;
    let livenessProvider: LivenessProvider | undefined;
    let sseOptions: SSEOptions | undefined;
    let dashboardDir: string | undefined;
    let activityProvider: import('./routes/api.js').ActivityProvider | undefined;
    let milestoneProvider: MilestoneProvider | undefined;
    let pushManagerProvided: PushNotificationManager | undefined;
    let subscriptionStore: SubscriptionStore | undefined;
    let vapidPublicKey: string | undefined;

    if (isLegacy(opts)) {
      // Legacy path: map old prop names to new interfaces
      stateProvider = opts.stateStore;
      questionProvider = opts.claudeService;
      sseOptions = {
        mode: 'in-process' as const,
        orchestrator: opts.orchestrator,
        claudeService: opts.claudeService,
        logger: opts.logger,
      };
      dashboardDir = opts.dashboardDir;
      activityProvider = opts.activityProvider;
    } else {
      stateProvider = opts.stateProvider;
      questionProvider = opts.questionProvider;
      livenessProvider = opts.livenessProvider;
      sseOptions = opts.sseDeps;
      dashboardDir = opts.dashboardDir;
      activityProvider = opts.activityProvider;
      milestoneProvider = opts.milestoneProvider;
      pushManagerProvided = opts.pushManager;
      subscriptionStore = opts.subscriptionStore;
      vapidPublicKey = opts.vapidPublicKey;
    }

    // Store pushManager if provided
    if (pushManagerProvided) {
      this.pushManager = pushManagerProvided;
    }

    // Mount REST API routes at /api
    const apiRouter = createApiRoutes({ stateProvider, questionProvider, livenessProvider, activityProvider, milestoneProvider });
    this.app.use('/api', apiRouter);

    // Mount push routes at /api/push if push infrastructure was provided
    if (subscriptionStore && vapidPublicKey) {
      const pushRouter = createPushRoutes({ subscriptionStore, vapidPublicKey });
      this.app.use('/api/push', pushRouter);
    }

    // Mount SSE endpoint and wire events (if deps provided)
    if (sseOptions) {
      const { closeAll } = setupSSE({ ...sseOptions, app: this.app } as any);
      this.closeAllSSE = closeAll;
    }

    // SPA fallback (DASH-09): serve dashboard/dist/ if directory exists
    if (dashboardDir && existsSync(dashboardDir)) {
      this.app.use(express.static(dashboardDir));
      this.app.get('{*path}', (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(join(dashboardDir, 'index.html'));
      });
    }

    // Error handling middleware (must be last)
    this.app.use(errorHandler);
  }

  /**
   * Initializes push notification infrastructure with VAPID keys.
   * This is a helper method for in-process mode that creates and wires pushManager
   * after construction. For standalone mode, pass pushManager via constructor options instead.
   *
   * @param planningDir - Path to the .planning/ directory for VAPID key storage
   * @returns PushNotificationManager instance for wiring to event sources
   */
  async initPush(planningDir: string): Promise<PushNotificationManager> {
    // Create subscription store
    const subscriptionStore = new SubscriptionStore();

    // Load or generate VAPID keys
    const vapidKeys = await loadVAPIDKeys(planningDir);

    // Create push notification manager
    this.pushManager = new PushNotificationManager(vapidKeys, subscriptionStore);

    // Mount push routes by inserting before error handler
    const pushRouter = createPushRoutes({
      subscriptionStore,
      vapidPublicKey: vapidKeys.publicKey,
    });

    // Insert routes before error handler (which should be last)
    const middlewareStack = (this.app as any)._router.stack;
    const errorHandlerIndex = middlewareStack.findIndex(
      (layer: any) => layer.name === 'errorHandler' || (layer.handle && layer.handle.length === 4)
    );

    if (errorHandlerIndex !== -1) {
      // Insert push router before error handler
      middlewareStack.splice(errorHandlerIndex, 0, ...pushRouter.stack);
    } else {
      // Fallback: just append if error handler not found
      this.app.use('/api/push', pushRouter);
    }

    return this.pushManager;
  }

  /**
   * Returns the PushNotificationManager instance for wiring to SSE events.
   * Returns null if initPush() has not been called.
   */
  getPushManager(): PushNotificationManager | null {
    return this.pushManager;
  }

  /**
   * Starts the HTTP server on the given port.
   * Resolves when the server is listening.
   * Throws a clear error if the port is already in use.
   */
  async start(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer(this.app);

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

      server.listen(port, () => {
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * Shuts down the HTTP server gracefully.
   * No-op if the server has not been started.
   */
  async close(): Promise<void> {
    // Close SSE connections first (prevents hanging connections from blocking server.close)
    if (this.closeAllSSE) {
      this.closeAllSSE();
    }

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
