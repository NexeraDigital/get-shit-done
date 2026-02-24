// Notification toggle component: permission management and per-type preference toggles.
// Provides soft-ask permission flow and granular notification control.

import { useState } from 'react';
import { usePushSubscription } from '../hooks/usePushSubscription.js';
import { useNotificationPreferences } from '../utils/notification-preferences.js';

export function NotificationToggle() {
  const { permission, subscribe, unsubscribe, loading } = usePushSubscription();
  const { prefs, updatePref } = useNotificationPreferences();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Soft-ask flow: show enable link when permission is default (not yet requested)
  if (permission === 'default') {
    return (
      <button
        onClick={() => void subscribe()}
        disabled={loading}
        className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer transition-colors"
      >
        {loading ? 'Enabling...' : 'Enable notifications'}
      </button>
    );
  }

  // Permission denied: show help text
  if (permission === 'denied') {
    return (
      <span
        className="text-xs text-gray-400 cursor-help"
        title="Enable in browser settings: chrome://settings/content/notifications"
      >
        Notifications blocked
      </span>
    );
  }

  // Permission granted: show dropdown with per-type toggles
  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="text-xs text-gray-400 hover:text-gray-200 cursor-pointer transition-colors"
      >
        Notifications
      </button>

      {dropdownOpen && (
        <>
          {/* Overlay to close dropdown when clicking outside */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setDropdownOpen(false)}
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-50">
            <div className="text-xs font-medium text-gray-700 mb-3">
              Notification preferences
            </div>

            {/* Per-type toggles */}
            <div className="space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.questions}
                  onChange={() => updatePref('questions', !prefs.questions)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800">Questions</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.errors}
                  onChange={() => updatePref('errors', !prefs.errors)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800">Errors</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.phaseCompleted}
                  onChange={() => updatePref('phaseCompleted', !prefs.phaseCompleted)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800">Phase completed</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.buildComplete}
                  onChange={() => updatePref('buildComplete', !prefs.buildComplete)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800">Build complete</span>
              </label>
            </div>

            {/* Disable all link */}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <button
                onClick={() => {
                  void unsubscribe();
                  setDropdownOpen(false);
                }}
                disabled={loading}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {loading ? 'Disabling...' : 'Disable all notifications'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
