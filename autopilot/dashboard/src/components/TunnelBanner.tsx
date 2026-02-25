// TunnelBanner: Prominent banner showing public tunnel URL with copy button.
// Reads tunnelUrl from Zustand store, renders nothing if tunnel is disabled (null).
// Follows existing dashboard patterns: Tailwind CSS, functional component, minimal dependencies.

import { useState } from 'react';
import { useDashboardStore } from '../store/index.js';

export function TunnelBanner() {
  const tunnelUrl = useDashboardStore((s) => s.tunnelUrl);
  const [copied, setCopied] = useState(false);

  // If tunnelUrl is null, render nothing (no banner)
  if (!tunnelUrl) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tunnelUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed -- non-fatal
    }
  };

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Globe icon (Unicode symbol) */}
        <div className="text-purple-500 text-xl flex-shrink-0 mt-0.5">🌐</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-purple-900 mb-1">
            Remote access enabled
          </div>
          <a
            href={tunnelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-purple-700 hover:text-purple-900 underline break-all"
          >
            {tunnelUrl}
          </a>
        </div>
      </div>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded transition-colors"
      >
        {copied ? '✓ Copied!' : 'Copy URL'}
      </button>
    </div>
  );
}
