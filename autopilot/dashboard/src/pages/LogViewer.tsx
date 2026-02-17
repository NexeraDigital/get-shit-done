// Full log viewer page with filtering, search, and auto-scroll (DASH-18).
// Dedicated page with phase/step filter dropdowns, text search, and log count stats.

import { useMemo, useRef, useState, useEffect } from 'react';
import { useDashboardStore } from '../store/index.js';
import type { LogEntry, LogLevel } from '../types/index.js';

const LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-gray-300',
  warn: 'text-amber-400',
  error: 'text-red-400',
  fatal: 'text-red-600 font-bold',
};

const LEVEL_BADGE_CLASSES: Record<LogLevel, string> = {
  debug: 'bg-gray-700 text-gray-300',
  info: 'bg-gray-600 text-gray-200',
  warn: 'bg-amber-800 text-amber-200',
  error: 'bg-red-900 text-red-200',
  fatal: 'bg-red-800 text-red-100 font-bold',
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

export function LogViewer() {
  const logs = useDashboardStore((s) => s.logs);

  // Filter state
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [stepFilter, setStepFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Auto-scroll state
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Extract unique phase numbers and step values from logs
  const uniquePhases = useMemo(() => {
    const phases = new Set<number>();
    for (const log of logs) {
      if (log.phase !== undefined) {
        phases.add(log.phase);
      }
    }
    return Array.from(phases).sort((a, b) => a - b);
  }, [logs]);

  const uniqueSteps = useMemo(() => {
    const steps = new Set<string>();
    for (const log of logs) {
      if (log.step) {
        steps.add(log.step);
      }
    }
    return Array.from(steps).sort();
  }, [logs]);

  // Apply all active filters (AND logic)
  const filteredLogs = useMemo(() => {
    return logs.filter((entry: LogEntry) => {
      // Phase filter
      if (phaseFilter !== 'all') {
        if (entry.phase === undefined || String(entry.phase) !== phaseFilter) {
          return false;
        }
      }
      // Step filter
      if (stepFilter !== 'all') {
        if (!entry.step || entry.step !== stepFilter) {
          return false;
        }
      }
      // Search filter (case-insensitive substring match)
      if (searchTerm) {
        if (!entry.message.toLowerCase().includes(searchTerm.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [logs, phaseFilter, stepFilter, searchTerm]);

  const isFiltering = phaseFilter !== 'all' || stepFilter !== 'all' || searchTerm !== '';

  // Auto-scroll when filtered logs change
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  // Clear all filters
  const clearFilters = () => {
    setPhaseFilter('all');
    setStepFilter('all');
    setSearchTerm('');
  };

  // Empty state
  if (logs.length === 0) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Filter toolbar */}
        <div className="flex gap-3 items-center p-4 bg-white border-b">
          <select disabled className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-400 bg-gray-50">
            <option>All phases</option>
          </select>
          <select disabled className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-400 bg-gray-50">
            <option>All steps</option>
          </select>
          <input
            disabled
            type="text"
            placeholder="Search logs..."
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-400 bg-gray-50 flex-1"
          />
        </div>
        {/* Empty log area */}
        <div className="flex-1 flex items-center justify-center bg-gray-950 text-gray-500 font-mono text-sm">
          No log entries yet. Logs will appear here as the build runs.
        </div>
        {/* Stats bar */}
        <div className="flex justify-between px-4 py-2 bg-gray-100 text-sm text-gray-600">
          <span>0 entries</span>
          <button type="button" disabled className="text-gray-400 text-xs">
            Auto-scroll: ON
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Filter toolbar */}
      <div className="flex gap-3 items-center p-4 bg-white border-b flex-wrap">
        {/* Phase filter */}
        <select
          value={phaseFilter}
          onChange={(e) => { setPhaseFilter(e.target.value); }}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">All phases</option>
          {uniquePhases.map((p) => (
            <option key={p} value={String(p)}>Phase {p}</option>
          ))}
        </select>

        {/* Step filter */}
        <select
          value={stepFilter}
          onChange={(e) => { setStepFilter(e.target.value); }}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">All steps</option>
          {uniqueSteps.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Search input */}
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); }}
          placeholder="Search logs..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm bg-white flex-1 min-w-48"
        />

        {/* Clear filters button */}
        {isFiltering && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm text-blue-600 hover:text-blue-800 px-2 py-1.5"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex justify-between items-center px-4 py-2 bg-gray-100 text-sm text-gray-600">
        <span>
          {isFiltering
            ? `${String(filteredLogs.length)} of ${String(logs.length)} entries`
            : `${String(logs.length)} entries`}
        </span>
        <button
          type="button"
          onClick={() => {
            setAutoScroll((prev) => !prev);
            if (!autoScroll && containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className={`text-xs px-2 py-1 rounded ${
            autoScroll
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-200 text-gray-500'
          }`}
        >
          Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Log container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-gray-950 text-gray-300 font-mono text-xs p-4 leading-5"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No logs match the current filters.
          </div>
        ) : (
          filteredLogs.map((entry, i) => {
            const levelClass = LEVEL_CLASSES[entry.level] ?? 'text-gray-300';
            const badgeClass = LEVEL_BADGE_CLASSES[entry.level] ?? 'bg-gray-600 text-gray-200';
            return (
              <div key={`${entry.timestamp}-${String(i)}`} className={`${levelClass} py-0.5`}>
                <span className="text-gray-600">{formatTime(entry.timestamp)}</span>
                {' '}
                <span className={`${badgeClass} px-1 py-0.5 rounded text-[10px] uppercase`}>
                  {entry.level}
                </span>
                {' '}
                <span className="text-gray-500">[{entry.component}]</span>
                {' '}
                {entry.message}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
