// AnswerPoller - polls the autopilot-answers directory for answer JSON files.
// When a file is found, calls the provided submit function and deletes the file.
// Used by the autopilot process to receive answers from the dashboard.

import { readdir, readFile, unlink, mkdir } from 'node:fs/promises';
import { IPC_PATHS, ANSWER_POLL_INTERVAL_MS } from './types.js';
import type { IPCAnswer } from './types.js';

export type SubmitFn = (questionId: string, answers: Record<string, string>) => boolean;

export class AnswerPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly answersDir: string;
  private readonly submitFn: SubmitFn;

  constructor(projectDir: string, submitFn: SubmitFn) {
    this.answersDir = IPC_PATHS.answersDir(projectDir);
    this.submitFn = submitFn;
  }

  /** Starts polling for answer files */
  async start(): Promise<void> {
    await mkdir(this.answersDir, { recursive: true });
    this.timer = setInterval(() => {
      void this.poll();
    }, ANSWER_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops the polling timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Reads and processes any answer files in the directory */
  async poll(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.answersDir);
    } catch {
      return; // Directory may not exist yet
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = `${this.answersDir}/${file}`;
      try {
        const raw = await readFile(filePath, 'utf-8');
        const answer = JSON.parse(raw) as IPCAnswer;
        this.submitFn(answer.questionId, answer.answers);
        await unlink(filePath);
      } catch {
        // Malformed or already-deleted file -- skip
      }
    }
  }
}
