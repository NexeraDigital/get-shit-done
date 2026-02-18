/**
 * ConsoleAdapter: Default zero-dependency notification channel.
 * Prints inline colored notifications to stdout -- NOT a box/banner.
 *
 * Per locked decisions:
 * - Question notifications: full question text, options, clickable URL, terminal bell
 * - Stop/error notifications: status, summary, next steps -- no bell
 * - No bell for non-question types
 */

import ansis from 'ansis';
import type { Notification, NotificationAdapter } from '../types.js';

/** Minimal writable interface for testability (same pattern as StreamRenderer). */
interface WritableOutput {
  write(data: string): boolean;
}

export interface ConsoleAdapterOptions {
  port: number;
  stopSpinner?: () => void;
  output?: WritableOutput;
}

export class ConsoleAdapter implements NotificationAdapter {
  readonly name = 'console';

  private readonly port: number;
  private readonly stopSpinner?: () => void;
  private readonly output: WritableOutput;

  constructor(options: ConsoleAdapterOptions) {
    this.port = options.port;
    this.stopSpinner = options.stopSpinner;
    this.output = options.output ?? process.stdout;
  }

  /** No-op: console requires no initialization. */
  async init(): Promise<void> {
    // No-op
  }

  /** No-op: console requires no cleanup. */
  async close(): Promise<void> {
    // No-op
  }

  /** Render the notification as an inline colored line to stdout. */
  async send(notification: Notification): Promise<void> {
    // Stop spinner before writing to prevent garbled output (Pitfall 1)
    this.stopSpinner?.();

    const lines = this.format(notification);
    this.output.write(lines);
  }

  /**
   * Format a notification as a string ready for terminal output.
   * Exported for testability.
   */
  format(notification: Notification): string {
    switch (notification.type) {
      case 'question':
        return this.formatQuestion(notification);
      case 'error':
        return this.formatError(notification);
      case 'complete':
        return this.formatComplete(notification);
      case 'progress':
        return this.formatProgress(notification);
      default:
        return this.formatProgress(notification);
    }
  }

  private formatQuestion(n: Notification): string {
    const url = `http://localhost:${this.port}/questions/${n.id}`;
    const prefix = ansis.yellow('[?]');
    const titleLine = `\x07${prefix} ${ansis.white(n.title)} (${ansis.dim(url)})`;

    const optionLines: string[] = [];
    if (n.options && n.options.length > 0) {
      n.options.forEach((opt, idx) => {
        optionLines.push(`    ${ansis.dim(`Option ${idx + 1}: ${opt}`)}`);
      });
    }

    // Body contains the question text
    const bodyLine = n.body !== n.title ? `    ${ansis.dim(n.body)}` : '';

    const parts = [titleLine];
    if (bodyLine) parts.push(bodyLine);
    parts.push(...optionLines);

    return parts.join('\n') + '\n';
  }

  private formatError(n: Notification): string {
    const prefix = ansis.bold.red('[!]');
    const titleLine = `${prefix} ${ansis.white(n.title)}`;

    const lines = [titleLine];

    if (n.summary) {
      lines.push(`    ${ansis.dim(`Summary: ${n.summary}`)}`);
    }

    if (n.nextSteps) {
      lines.push(`    ${ansis.dim(`Next: ${n.nextSteps}`)}`);
    }

    if (n.errorMessage) {
      lines.push(`    ${ansis.dim(`Error: ${n.errorMessage}`)}`);
    }

    return lines.join('\n') + '\n';
  }

  private formatComplete(n: Notification): string {
    const prefix = ansis.green('[v]');
    const titleLine = `${prefix} ${ansis.white(n.title)}`;

    const lines = [titleLine];

    if (n.summary) {
      lines.push(`    ${ansis.dim(n.summary)}`);
    }

    if (n.nextSteps) {
      lines.push(`    ${ansis.dim(`Next: ${n.nextSteps}`)}`);
    }

    return lines.join('\n') + '\n';
  }

  private formatProgress(n: Notification): string {
    const prefix = ansis.dim('[i]');
    return `${prefix} ${ansis.white(n.title)}\n`;
  }
}
