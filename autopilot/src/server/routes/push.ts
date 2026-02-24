// REST routes for push notification subscription management.
// Provides endpoints for the dashboard to subscribe/unsubscribe from push notifications
// and retrieve the VAPID public key for creating subscriptions.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SubscriptionStore, PushSubscription } from '../push/subscription-store.js';
import type { PushNotificationManager } from '../push/manager.js';

export interface PushRouteDeps {
  subscriptionStore: SubscriptionStore;
  vapidPublicKey: string;
  pushManager?: PushNotificationManager;
}

/**
 * Creates an Express Router with push notification subscription endpoints.
 * These routes will be mounted at /api/push by the ResponseServer.
 *
 * @param deps - Injected dependencies (subscriptionStore, vapidPublicKey)
 * @returns Express Router with push subscription endpoints
 */
export function createPushRoutes(deps: PushRouteDeps): Router {
  const { subscriptionStore, vapidPublicKey, pushManager } = deps;
  const router = Router();

  /**
   * GET /vapid-public-key
   * Returns the VAPID public key needed for the browser to create a push subscription.
   */
  router.get('/vapid-public-key', (_req: Request, res: Response) => {
    res.json({ publicKey: vapidPublicKey });
  });

  /**
   * POST /subscribe
   * Accepts a push subscription from the browser and stores it.
   * Body: { endpoint: string, keys: { p256dh: string, auth: string } }
   */
  router.post('/subscribe', (req: Request, res: Response) => {
    const body = req.body as unknown;

    // Validate required fields
    if (
      !body ||
      typeof body !== 'object' ||
      !('endpoint' in body) ||
      !('keys' in body)
    ) {
      res.status(400).json({ error: 'Missing endpoint or keys' });
      return;
    }

    const { endpoint, keys } = body as { endpoint: unknown; keys: unknown };

    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint must be a string' });
      return;
    }

    if (
      !keys ||
      typeof keys !== 'object' ||
      !('p256dh' in keys) ||
      !('auth' in keys)
    ) {
      res.status(400).json({ error: 'keys must contain p256dh and auth' });
      return;
    }

    const subscription: PushSubscription = {
      endpoint,
      keys: keys as { p256dh: string; auth: string },
    };

    subscriptionStore.add(subscription);
    res.json({ ok: true });
  });

  /**
   * DELETE /subscribe
   * Removes a push subscription from the store.
   * Body: { endpoint: string }
   */
  router.delete('/subscribe', (req: Request, res: Response) => {
    const body = req.body as unknown;

    if (
      !body ||
      typeof body !== 'object' ||
      !('endpoint' in body)
    ) {
      res.status(400).json({ error: 'Missing endpoint' });
      return;
    }

    const { endpoint } = body as { endpoint: unknown };

    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint must be a string' });
      return;
    }

    subscriptionStore.remove(endpoint);
    res.json({ ok: true });
  });

  /**
   * POST /send
   * Sends a push notification to all subscribers. Called by the CLI process
   * to deliver notifications synchronously before exit.
   * Body: { title: string, body: string, tag?: string, ... }
   */
  if (pushManager) {
    router.post('/send', async (req: Request, res: Response) => {
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || !payload.title) {
        res.status(400).json({ error: 'Missing title in payload' });
        return;
      }
      try {
        await pushManager.sendToAll(payload);
        res.json({ ok: true, subscribers: subscriptionStore.size() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: msg });
      }
    });
  }

  return router;
}
