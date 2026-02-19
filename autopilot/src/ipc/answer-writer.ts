// AnswerWriter - writes answer JSON files for the autopilot to consume.
// Used by the standalone dashboard when a human submits an answer via the web UI.

import writeFileAtomic from 'write-file-atomic';
import { mkdir } from 'node:fs/promises';
import { IPC_PATHS } from './types.js';
import type { IPCAnswer } from './types.js';

export class AnswerWriter {
  private readonly projectDir: string;
  private initialized = false;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /** Ensures the answers directory exists */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(IPC_PATHS.answersDir(this.projectDir), { recursive: true });
    this.initialized = true;
  }

  /** Writes an answer file atomically */
  async writeAnswer(questionId: string, answers: Record<string, string>): Promise<void> {
    await this.ensureDir();
    const answer: IPCAnswer = {
      questionId,
      answers,
      answeredAt: new Date().toISOString(),
    };
    const filePath = IPC_PATHS.answer(this.projectDir, questionId);
    await writeFileAtomic(filePath, JSON.stringify(answer, null, 2) + '\n');
  }
}
