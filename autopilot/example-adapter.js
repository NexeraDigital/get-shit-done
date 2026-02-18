/**
 * Example custom notification adapter for gsd-autopilot.
 *
 * Copy this file and modify it to create your own notification channel.
 * Load it with: gsd-autopilot --adapter-path ./my-adapter.js
 *
 * The adapter must export a default class with three methods:
 *   init()  - Called once at startup. Set up connections, validate config.
 *   send(notification) - Called for each notification. Fire and forget.
 *   close() - Called at shutdown. Clean up resources.
 *
 * The notification object has this shape:
 *   {
 *     id: string,          // Unique notification ID
 *     type: 'question' | 'progress' | 'error' | 'complete',
 *     title: string,       // Short title
 *     body: string,        // Full notification text
 *     severity: 'info' | 'warning' | 'critical',
 *     respondUrl?: string, // Dashboard URL to respond (for questions)
 *     options?: string[],  // Question option labels
 *     phase?: number,      // Current phase number
 *     step?: string,       // Current step name
 *     createdAt: string,   // ISO timestamp
 *     summary?: string,    // Build summary (for stop notifications)
 *     nextSteps?: string,  // What to do next (for stop notifications)
 *     errorMessage?: string // Error details (for error notifications)
 *   }
 */
export default class MyCustomAdapter {
  get name() {
    return 'my-custom';
  }

  async init() {
    // Called once at startup.
    // Example: validate environment variables, open connections
    console.log('[my-custom] Adapter initialized');
  }

  async send(notification) {
    // Called for each notification.
    // Example: send to your logging service, chat tool, email, etc.
    console.log(`[my-custom] ${notification.type}: ${notification.title}`);
    console.log(`[my-custom] ${notification.body}`);
    if (notification.respondUrl) {
      console.log(`[my-custom] Respond at: ${notification.respondUrl}`);
    }
  }

  async close() {
    // Called at shutdown.
    // Example: close connections, flush buffers
    console.log('[my-custom] Adapter closed');
  }
}
