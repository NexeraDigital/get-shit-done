// EventTailer - tails the NDJSON event log file and emits events.
// Used by the standalone dashboard to provide SSE events without in-process EventEmitters.
// Maintains a ring buffer of recent events for initial burst on SSE connect.

import { EventEmitter } from 'node:events';
import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { IPC_PATHS } from './types.js';
import type { IPCEvent } from './types.js';

const TAIL_INTERVAL_MS = 500;
const RING_BUFFER_SIZE = 200;

export class EventTailer extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;
  private fileHandle: FileHandle | null = null;
  private offset = 0;
  private buffer = '';
  private readonly ringBuffer: Array<{ event: string; data: unknown }> = [];
  private lastSeq = 0;

  constructor(projectDir: string) {
    super();
    this.filePath = IPC_PATHS.events(projectDir);
  }

  /** Returns recent events for SSE initial burst */
  getRecentEvents(): Array<{ event: string; data: unknown }> {
    return [...this.ringBuffer];
  }

  /** Starts tailing the event log file */
  async start(): Promise<void> {
    // Try to open the file; if it doesn't exist we'll retry on each tick
    await this.tryOpen();
    this.timer = setInterval(() => {
      void this.tail();
    }, TAIL_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops tailing */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.fileHandle) {
      void this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  private async tryOpen(): Promise<void> {
    if (this.fileHandle) return;
    try {
      this.fileHandle = await open(this.filePath, 'r');
      // Seek to end if the file already has content (we only want new events)
      const s = await stat(this.filePath);
      this.offset = s.size;
    } catch {
      // File doesn't exist yet -- will retry
    }
  }

  private async tail(): Promise<void> {
    if (!this.fileHandle) {
      await this.tryOpen();
      if (!this.fileHandle) return;
    }

    try {
      const s = await stat(this.filePath);
      if (s.size <= this.offset) return;

      // Read new bytes
      const readSize = s.size - this.offset;
      const buf = Buffer.alloc(readSize);
      const { bytesRead } = await this.fileHandle.read(buf, 0, readSize, this.offset);
      this.offset += bytesRead;

      // Append to line buffer and process complete lines
      this.buffer += buf.toString('utf-8', 0, bytesRead);
      const lines = this.buffer.split('\n');
      // Keep incomplete last line in buffer
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as IPCEvent;
          if (entry.seq <= this.lastSeq) continue; // Dedup
          this.lastSeq = entry.seq;

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
      // File may have been rotated or deleted -- reopen
      if (this.fileHandle) {
        void this.fileHandle.close();
        this.fileHandle = null;
      }
      this.offset = 0;
      this.buffer = '';
    }
  }
}
