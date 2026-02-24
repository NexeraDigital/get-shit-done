// VAPID key management for Web Push notifications.
// Loads VAPID keys from environment variables or generates/persists them to .planning/.vapid-keys.json.
// Ensures the server has stable keys across restarts without committing secrets to git.

import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface VAPIDKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Loads or generates VAPID keys for Web Push.
 * Priority:
 * 1. Environment variables (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
 * 2. Persisted keys in .planning/.vapid-keys.json
 * 3. Generate new keys, persist to .planning/.vapid-keys.json
 *
 * @param planningDir - Absolute path to the .planning/ directory
 * @returns VAPID keys ready for webpush.setVapidDetails()
 */
export async function loadVAPIDKeys(planningDir: string): Promise<VAPIDKeys> {
  // Check environment variables first
  const envPublic = process.env['VAPID_PUBLIC_KEY'];
  const envPrivate = process.env['VAPID_PRIVATE_KEY'];
  const envSubject = process.env['VAPID_SUBJECT'];

  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject ?? 'mailto:dev@gsd-autopilot.local',
    };
  }

  // Check for persisted keys
  const keysFilePath = join(planningDir, '.vapid-keys.json');
  if (existsSync(keysFilePath)) {
    try {
      const content = readFileSync(keysFilePath, 'utf-8');
      const keys = JSON.parse(content) as { publicKey: string; privateKey: string; subject?: string };
      return {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: keys.subject ?? 'mailto:dev@gsd-autopilot.local',
      };
    } catch (err) {
      console.warn(`Failed to read ${keysFilePath}, generating new keys:`, err);
    }
  }

  // Generate new keys
  const keys = webpush.generateVAPIDKeys();
  const vapidKeys: VAPIDKeys = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: 'mailto:dev@gsd-autopilot.local',
  };

  // Persist to disk
  try {
    writeFileSync(keysFilePath, JSON.stringify(vapidKeys, null, 2), 'utf-8');
    console.log(`Generated new VAPID keys and saved to ${keysFilePath}`);
  } catch (err) {
    console.warn(`Failed to persist VAPID keys to ${keysFilePath}:`, err);
  }

  return vapidKeys;
}
