// Notification sound hook: plays audio when question count increases.
// Workaround for browser Push API limitation (no custom notification sounds).
// Only plays if user has question notifications enabled in preferences.

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store/index.js';
import { loadNotificationPreferences } from '../utils/notification-preferences.js';

/**
 * Plays notification sound when a new question arrives via SSE.
 * Watches the questions array in the store and plays sound when count increases.
 * Respects user's notification preferences (only plays if questions enabled).
 */
export function useNotificationSound(): void {
  const questions = useDashboardStore((s) => s.questions);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCountRef = useRef(questions.length);

  // Create audio element once on mount
  useEffect(() => {
    audioRef.current = new Audio('/notification-sound.mp3');
    audioRef.current.volume = 0.5; // 50% volume for subtlety
  }, []);

  // Play sound when question count increases
  useEffect(() => {
    if (questions.length > prevCountRef.current) {
      // Check if user has question notifications enabled
      const prefs = loadNotificationPreferences();
      if (prefs.questions) {
        // Play sound (catch because browsers may block autoplay)
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {
            // Silent failure: autoplay blocked or audio not loaded
          });
        }
      }
    }
    prevCountRef.current = questions.length;
  }, [questions.length]);
}
