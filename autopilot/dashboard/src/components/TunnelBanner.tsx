// TunnelBanner: Prominent banner showing public tunnel URL with copy button,
// or an error banner when tunnel creation failed.
// Reads tunnelUrl/tunnelError from Zustand store, renders nothing if both are null.

import { useState } from 'react';
import { useDashboardStore } from '../store/index.js';

export function TunnelBanner() {
  const tunnelUrl = useDashboardStore((s) => s.tunnelUrl);
  const tunnelError = useDashboardStore((s) => s.tunnelError);
  const [copied, setCopied] = useState(false);

  // Tunnel error state — show error banner with login hint
  if (!tunnelUrl && tunnelError) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="text-amber-500 text-xl flex-shrink-0 mt-0.5">&#x26A0;</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-900 mb-1">
              Remote access unavailable
            </div>
            <div className="text-sm text-amber-700">
              {tunnelError}
            </div>
            <div className="text-sm text-amber-600 mt-1">
              Run <code className="bg-amber-100 px-1.5 py-0.5 rounded text-amber-800 font-mono text-xs">/gsd:autopilot login</code> to authenticate, then restart.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If tunnelUrl is null and no error, render nothing (tunnel disabled or not attempted)
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
        <div className="text-purple-500 text-xl flex-shrink-0 mt-0.5">&#x1F310;</div>
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
        {copied ? '\u2713 Copied!' : 'Copy URL'}
      </button>
    </div>
  );
}
