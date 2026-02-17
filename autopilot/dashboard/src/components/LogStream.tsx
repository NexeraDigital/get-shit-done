// Live log stream with auto-scroll (DASH-14).
// Follows Pattern 6 from research: auto-scrolls when at bottom, pauses on manual scroll-up.

import { useEffect, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../types/index.js';

interface LogStreamProps {
  logs: LogEntry[];
  maxHeight?: string;
  collapsible?: boolean;
}

const LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-gray-300',
  warn: 'text-amber-400',
  error: 'text-red-400',
  fatal: 'text-red-600 font-bold',
};

/**
 * Format ISO timestamp to HH:MM:SS.
 */
function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch {
    return '??:??:??';
  }
}

function LogContent({ logs, maxHeight }: { logs: LogEntry[]; maxHeight: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll when new logs arrive and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  // Detect manual scroll to pause/resume auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  if (logs.length === 0) {
    return (
      <div
        className="bg-gray-950 text-gray-500 rounded-lg p-4 font-mono text-xs"
        style={{ maxHeight }}
      >
        No log entries yet...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="bg-gray-950 rounded-lg p-3 font-mono text-xs leading-5 overflow-y-auto"
      style={{ maxHeight }}
    >
      {logs.map((entry, i) => {
        const levelClass = LEVEL_CLASSES[entry.level] ?? 'text-gray-300';
        return (
          <div key={`${entry.timestamp}-${String(i)}`} className={levelClass}>
            <span className="text-gray-600">{formatTime(entry.timestamp)}</span>
            {' '}
            <span className="text-gray-500">[{entry.component}]</span>
            {' '}
            {entry.message}
          </div>
        );
      })}
      {!autoScroll && (
        <div className="sticky bottom-0 text-center py-1">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
              }
            }}
            className="text-xs text-blue-400 hover:text-blue-300 bg-gray-900/80 px-2 py-0.5 rounded"
          >
            Resume auto-scroll
          </button>
        </div>
      )}
    </div>
  );
}

export function LogStream({ logs, maxHeight = '24rem', collapsible = false }: LogStreamProps) {
  const [expanded, setExpanded] = useState(true);

  if (!collapsible) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Live Logs</h3>
        <LogContent logs={logs} maxHeight={maxHeight} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <button
        type="button"
        onClick={() => { setExpanded((prev) => !prev); }}
        className="flex items-center gap-2 w-full text-left"
      >
        <span
          className={`text-xs text-gray-400 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        >
          &#9654;
        </span>
        <h3 className="text-sm font-semibold text-gray-700">
          Live Logs ({logs.length})
        </h3>
      </button>
      {expanded && (
        <div className="mt-3">
          <LogContent logs={logs} maxHeight={maxHeight} />
        </div>
      )}
    </div>
  );
}
