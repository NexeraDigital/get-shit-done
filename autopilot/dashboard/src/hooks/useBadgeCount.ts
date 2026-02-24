// Badge API integration for pending question count.
// Sets the browser badge to the number of pending questions (progressive enhancement).

import { useEffect } from 'react';
import { useDashboardStore } from '../store/index.js';

export function useBadgeCount() {
  const questions = useDashboardStore((s) => s.questions);

  useEffect(() => {
    const count = questions.length;

    // Feature detection: Badge API is a progressive enhancement
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ('setAppBadge' in navigator) {
      const nav = navigator as Navigator & {
        setAppBadge: (count?: number) => Promise<void>;
        clearAppBadge: () => Promise<void>;
      };

      if (count > 0) {
        nav.setAppBadge(count).catch(() => {});
      } else {
        nav.clearAppBadge().catch(() => {});
      }
    }
  }, [questions]);
}
