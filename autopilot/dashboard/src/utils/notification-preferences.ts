// Notification preferences persistence and React hook.
// Stores per-type notification toggles in localStorage with cross-tab synchronization.

import { useState, useEffect } from 'react';

export interface NotificationPreferences {
  questions: boolean;
  errors: boolean;
  phaseCompleted: boolean;
  buildComplete: boolean;
}

const STORAGE_KEY = 'gsd-notification-preferences';

export function getDefaultPreferences(): NotificationPreferences {
  return {
    questions: true,        // Action-needed: on by default
    errors: true,           // Action-needed: on by default
    phaseCompleted: false,  // Informational: off by default per Claude's discretion
    buildComplete: true,    // Informational but important: on by default
  };
}

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return getDefaultPreferences();
    }
    const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;
    // Spread over defaults for forward compatibility
    return { ...getDefaultPreferences(), ...parsed };
  } catch {
    return getDefaultPreferences();
  }
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silent fail - localStorage might be unavailable
  }
}

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(loadNotificationPreferences);

  // Sync across tabs using storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPrefs(loadNotificationPreferences());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const updatePref = (type: keyof NotificationPreferences, enabled: boolean) => {
    const updated = { ...prefs, [type]: enabled };
    setPrefs(updated);
    saveNotificationPreferences(updated);
  };

  return { prefs, updatePref };
}
