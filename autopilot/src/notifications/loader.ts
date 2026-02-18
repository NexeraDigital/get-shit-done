/**
 * loadCustomAdapter: Loads a user-provided notification adapter from a local file path.
 *
 * Per user decision NOTF-07: Supports custom adapter path via CLI flag.
 * Per research Pitfall 6: Relative paths resolved against process.cwd(), not import.meta.url.
 *
 * Expected export format:
 *   - Default export is a class: new AdapterClass() is called
 *   - Default export is already an instance: used directly
 *
 * The adapter is validated to have init/send/close methods before returning.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NotificationAdapter } from '../types/notification.js';

export async function loadCustomAdapter(adapterPath: string): Promise<NotificationAdapter> {
  // Resolve relative to process.cwd() per research Pitfall 6
  const absolutePath = resolve(process.cwd(), adapterPath);
  const fileUrl = pathToFileURL(absolutePath).href;

  const mod = await import(fileUrl) as Record<string, unknown>;

  // Expect default export to be a class or an already-instantiated adapter
  const AdapterClass = mod['default'] ?? mod;

  let adapter: NotificationAdapter;

  if (typeof AdapterClass === 'function') {
    // It's a class (or factory function) -- instantiate it
    adapter = new (AdapterClass as new () => NotificationAdapter)();
  } else if (
    typeof AdapterClass === 'object' &&
    AdapterClass !== null &&
    'send' in AdapterClass
  ) {
    // Already an instantiated adapter
    adapter = AdapterClass as NotificationAdapter;
  } else {
    throw new Error(
      `Custom adapter at ${adapterPath} must export a class with init()/send()/close() methods ` +
        `or an adapter instance as default export`,
    );
  }

  // Validate the adapter has required methods
  if (typeof adapter.send !== 'function') {
    throw new Error(`Custom adapter at ${adapterPath} is missing required send() method`);
  }
  if (typeof adapter.init !== 'function') {
    throw new Error(`Custom adapter at ${adapterPath} is missing required init() method`);
  }
  if (typeof adapter.close !== 'function') {
    throw new Error(`Custom adapter at ${adapterPath} is missing required close() method`);
  }

  return adapter;
}
