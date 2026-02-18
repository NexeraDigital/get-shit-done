/**
 * TeamsAdapter: Sends notifications to Microsoft Teams via Incoming Webhook.
 *
 * Per locked decisions:
 * - Uses Adaptive Card format (NOT deprecated MessageCard)
 * - Teams Workflows connector accepts the message/attachments envelope
 * - Link only, no inline action buttons
 * - Minimal content: title, body, optional dashboard link
 * - Same minimal style for both question and stop notifications
 */

import type { Notification, NotificationAdapter } from '../types.js';

export interface TeamsAdapterOptions {
  webhookUrl: string;
}

export class TeamsAdapter implements NotificationAdapter {
  readonly name = 'teams';

  private readonly webhookUrl: string;

  constructor(options: TeamsAdapterOptions) {
    this.webhookUrl = options.webhookUrl;
  }

  /** No-op: Teams requires no initialization beyond constructor. */
  async init(): Promise<void> {
    // No-op
  }

  /** No-op: Teams requires no cleanup. */
  async close(): Promise<void> {
    // No-op
  }

  /** POST Adaptive Card to Teams webhook URL. */
  async send(notification: Notification): Promise<void> {
    const body = this.buildCard(notification);

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Teams webhook returned ${response.status}: ${text}`,
      );
    }
  }

  private buildCard(notification: Notification): unknown {
    const bodyBlocks: unknown[] = [
      {
        type: 'TextBlock',
        text: notification.title,
        weight: 'Bolder',
        size: 'Medium',
      },
      {
        type: 'TextBlock',
        text: notification.body,
        wrap: true,
      },
    ];

    if (notification.respondUrl) {
      bodyBlocks.push({
        type: 'TextBlock',
        text: `[Open Dashboard](${notification.respondUrl})`,
        wrap: true,
      });
    }

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: bodyBlocks,
          },
        },
      ],
    };
  }
}
