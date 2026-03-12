// ConsolidatedEventTailer - scans log/ directory for multiple NDJSON event files
// and merges them into a single event stream. Handles both sequential mode
// (events.ndjson) and parallel mode (events-phase-*.ndjson).
//
// Replaces EventTailer for dashboard use. Each discovered file gets independent
// sequence tracking to prevent cross-file dedup confusion.

import { EventEmitter } from 'node:events';
import { open, stat, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

const TAIL_INTERVAL_MS = 500;
const RING_BUFFER_SIZE = 200;

/** Per-file tracking state */
interface FileTailState {
  handle: FileHandle;
  offset: number;
  buffer: string;
  lastSeq: number;
}

/** Pattern matching event log filenames */
const EVENT_FILE_PATTERN = /^(events\.ndjson|events-phase-\d+\.ndjson)$/;

export class ConsolidatedEventTailer extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly logDir: string;
  private readonly files = new Map<string, FileTailState>();
  private readonly ringBuffer: Array<{ event: string; data: unknown }> = [];
  private initialScanDone = false;

  constructor(projectDir: string) {
    super();
    this.logDir = join(projectDir, '.planning', 'autopilot', 'log');
  }

  /** Returns recent events for SSE initial burst */
  getRecentEvents(): Array<{ event: string; data: unknown }> {
    return [...this.ringBuffer];
  }

  /** Starts scanning and tailing event files */
  async start(): Promise<void> {
    // Initial scan -- files found here start at EOF (skip pre-existing content)
    await this.discoverFiles();
    this.initialScanDone = true;

    this.timer = setInterval(() => {
      void this.tick();
    }, TAIL_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops tailing -- closes all file handles and clears timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const [, state] of this.files) {
      void state.handle.close();
    }
    this.files.clear();
    this.ringBuffer.length = 0;
  }

  /** One tick: discover new files, then tail all tracked files */
  private async tick(): Promise<void> {
    await this.discoverFiles();
    await this.tailAllFiles();
  }

  /** Scan logDir for matching event files and open any new ones */
  private async discoverFiles(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.logDir);
    } catch {
      // Directory doesn't exist yet -- nothing to do
      return;
    }

    // Filter to matching filenames and sort alphabetically
    const matching = entries.filter((name) => EVENT_FILE_PATTERN.test(name)).sort();

    for (const name of matching) {
      if (this.files.has(name)) continue;

      const filePath = join(this.logDir, name);
      try {
        const handle = await open(filePath, 'r');
        const s = await stat(filePath);
        // Files found on initial scan: start at EOF (skip pre-existing content)
        // Files discovered later (new workers): start at beginning to catch all content
        const startOffset = this.initialScanDone ? 0 : s.size;
        this.files.set(name, {
          handle,
          offset: startOffset,
          buffer: '',
          lastSeq: 0,
        });
      } catch {
        // File may have disappeared between readdir and open -- skip
      }
    }
  }

  /** Read new bytes from all tracked files in alphabetical order */
  private async tailAllFiles(): Promise<void> {
    // Process in alphabetical order (Map insertion order preserved from sorted discovery)
    const sortedEntries = [...this.files.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, state] of sortedEntries) {
      try {
        const filePath = join(this.logDir, name);
        const s = await stat(filePath);
        if (s.size <= state.offset) continue;

        const readSize = s.size - state.offset;
        const buf = Buffer.alloc(readSize);
        const { bytesRead } = await state.handle.read(buf, 0, readSize, state.offset);
        state.offset += bytesRead;

        // Append to line buffer and process complete lines
        state.buffer += buf.toString('utf-8', 0, bytesRead);
        const lines = state.buffer.split('\n');
        // Keep incomplete last line in buffer
        state.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as { seq: number; event: string; data: unknown };
            // Per-file sequence dedup
            if (entry.seq <= state.lastSeq) continue;
            state.lastSeq = entry.seq;

            const evt = { event: entry.event, data: entry.data };
            this.ringBuffer.push(evt);
            if (this.ringBuffer.length > RING_BUFFER_SIZE) {
              this.ringBuffer.shift();
            }
            this.emit('event', evt);
          } catch {
            // Malformed line -- skip
          }
        }
      } catch {
        // File may have been rotated/deleted -- close and remove from tracking
        void state.handle.close();
        this.files.delete(name);
      }
    }
  }
}
