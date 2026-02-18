/**
 * SlackAdapter: Sends notifications to Slack via Incoming Webhook.
 *
 * Per locked decisions:
 * - Uses Block Kit format with required top-level `text` fallback field
 * - Link only, no interactive components
 * - Minimal content: title, body, optional dashboard link
 */

import type { Notification, NotificationAdapter } from '../types.js';

export interface SlackAdapterOptions {
  webhookUrl: string;
}

export class SlackAdapter implements NotificationAdapter {
  readonly name = 'slack';

  private readonly webhookUrl: string;

  constructor(options: SlackAdapterOptions) {
    this.webhookUrl = options.webhookUrl;
  }

  /** No-op: Slack requires no initialization beyond constructor. */
  async init(): Promise<void> {
    // No-op
  }

  /** No-op: Slack requires no cleanup. */
  async close(): Promise<void> {
    // No-op
  }

  /** POST Block Kit payload to Slack webhook URL. */
  async send(notification: Notification): Promise<void> {
    const body = this.buildPayload(notification);

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Slack webhook returned ${response.status}: ${text}`,
      );
    }
  }

  private buildPayload(notification: Notification): unknown {
    // Top-level `text` is required by Slack API as notification fallback
    const fallbackText = `${notification.title}: ${notification.body}`;

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: notification.title,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: notification.body,
        },
      },
    ];

    if (notification.respondUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${notification.respondUrl}|Open Dashboard>`,
        },
      });
    }

    return {
      text: fallbackText,
      blocks,
    };
  }
}
