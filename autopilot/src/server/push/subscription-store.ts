// In-memory push subscription storage for Web Push notifications.
// Stores push subscriptions keyed by endpoint URL for deduplication and removal.
// Uses the web-push library's PushSubscription type.

import type { PushSubscription as WebPushSubscription } from 'web-push';

/** Push subscription shape from web-push library */
export type PushSubscription = WebPushSubscription;

/**
 * In-memory store for push subscriptions.
 * Each subscription is keyed by its endpoint URL to prevent duplicates.
 * This is a simple implementation -- production apps would use a database.
 */
export class SubscriptionStore {
  private subscriptions = new Map<string, PushSubscription>();

  /**
   * Adds a push subscription to the store.
   * @param subscription - Push subscription from the browser
   * @returns The endpoint URL (used as the key)
   */
  add(subscription: PushSubscription): string {
    this.subscriptions.set(subscription.endpoint, subscription);
    return subscription.endpoint;
  }

  /**
   * Removes a subscription by its endpoint key.
   * @param key - The subscription endpoint URL
   * @returns true if the subscription was found and removed, false otherwise
   */
  remove(key: string): boolean {
    return this.subscriptions.delete(key);
  }

  /**
   * Returns all stored subscriptions as an array.
   * @returns Array of push subscriptions
   */
  getAll(): PushSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Returns the number of stored subscriptions.
   * @returns Subscription count
   */
  size(): number {
    return this.subscriptions.size;
  }
}
