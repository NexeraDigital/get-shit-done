// PushNotificationManager - sends Web Push notifications to all registered subscriptions.
// Wraps the web-push library and handles automatic cleanup of expired/invalid subscriptions.
// Uses VAPID authentication for secure push delivery.

import webpush from 'web-push';
import type { VAPIDKeys } from './vapid.js';
import type { SubscriptionStore, PushSubscription } from './subscription-store.js';

/** Payload structure for push notifications sent to browsers */
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  url?: string;
  icon?: string;
  data?: Record<string, unknown>;
}

/**
 * Manages Web Push notification delivery to all registered subscriptions.
 * Automatically removes expired subscriptions (404/410 responses).
 */
export class PushNotificationManager {
  private readonly vapidPublicKey: string;

  constructor(
    vapidKeys: VAPIDKeys,
    private readonly subscriptionStore: SubscriptionStore,
  ) {
    // Configure web-push with VAPID details
    webpush.setVapidDetails(
      vapidKeys.subject,
      vapidKeys.publicKey,
      vapidKeys.privateKey,
    );
    this.vapidPublicKey = vapidKeys.publicKey;
  }

  /**
   * Sends a push notification to all registered subscriptions.
   * Uses Promise.allSettled to send to all subscriptions even if some fail.
   * Automatically removes subscriptions that return 404 or 410 (expired/invalid).
   *
   * @param payload - Notification content and options
   */
  async sendToAll(payload: PushPayload): Promise<void> {
    const subscriptions = this.subscriptionStore.getAll();
    if (subscriptions.length === 0) {
      return;
    }

    const jsonPayload = JSON.stringify(payload);
    const urgency = payload.requireInteraction ? 'high' : 'normal';

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, jsonPayload, {
            TTL: 3600, // 1 hour
            urgency,
          });
        } catch (err) {
          // Remove expired or invalid subscriptions
          if (
            err &&
            typeof err === 'object' &&
            'statusCode' in err &&
            (err.statusCode === 404 || err.statusCode === 410)
          ) {
            this.subscriptionStore.remove(sub.endpoint);
            console.log(`Removed expired subscription: ${sub.endpoint}`);
          } else {
            console.warn(`Failed to send notification to ${sub.endpoint}:`, err);
          }
          throw err;
        }
      }),
    );

    // Log overall failure count
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(
        `Push notification delivery: ${results.length - failures.length}/${results.length} succeeded`,
      );
    }
  }

  /**
   * Returns the VAPID public key for client-side subscription.
   * The browser needs this key to create a push subscription.
   */
  getVapidPublicKey(): string {
    return this.vapidPublicKey;
  }
}
