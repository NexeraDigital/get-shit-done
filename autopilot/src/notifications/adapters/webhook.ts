/**
 * CustomWebhookAdapter: Sends raw Notification JSON to any HTTP endpoint.
 *
 * Per NOTF-06: No transformation -- the full Notification object is the payload.
 * Users can use this to integrate with any webhook-capable service.
 */

import type { Notification, NotificationAdapter } from '../types.js';

export interface CustomWebhookAdapterOptions {
  webhookUrl: string;
}

export class CustomWebhookAdapter implements NotificationAdapter {
  readonly name = 'webhook';

  private readonly webhookUrl: string;

  constructor(options: CustomWebhookAdapterOptions) {
    this.webhookUrl = options.webhookUrl;
  }

  /** No-op: webhook requires no initialization beyond constructor. */
  async init(): Promise<void> {
    // No-op
  }

  /** No-op: webhook requires no cleanup. */
  async close(): Promise<void> {
    // No-op
  }

  /** POST raw Notification JSON to the webhook URL. */
  async send(notification: Notification): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Webhook returned ${response.status}: ${text}`,
      );
    }
  }
}
