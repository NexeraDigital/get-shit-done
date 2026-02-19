// FileQuestionProvider - implements QuestionProvider using file-based IPC.
// Reads pending questions from the state file and writes answers as files.
// Used by the standalone dashboard process.

import type { QuestionProvider } from '../server/routes/api.js';
import type { QuestionEvent, QuestionItem } from '../claude/types.js';
import type { FileStateReader } from './file-state-reader.js';
import type { AnswerWriter } from './answer-writer.js';

export class FileQuestionProvider implements QuestionProvider {
  constructor(
    private readonly stateReader: FileStateReader,
    private readonly answerWriter: AnswerWriter,
  ) {}

  /** Returns pending questions from the state file's pendingQuestions array */
  getPendingQuestions(): QuestionEvent[] {
    const state = this.stateReader.getState();
    return state.pendingQuestions
      .filter((q) => !q.answeredAt)
      .map((q) => ({
        id: q.id,
        phase: q.phase,
        step: q.step,
        questions: q.questionItems ?? q.questions.map((text) => ({
          question: text,
          header: '',
          options: [],
          multiSelect: false,
        } satisfies QuestionItem)),
        createdAt: q.createdAt,
      }));
  }

  /** Writes an answer file for the autopilot to pick up */
  submitAnswer(questionId: string, answers: Record<string, string>): boolean {
    const state = this.stateReader.getState();
    const question = state.pendingQuestions.find(
      (q) => q.id === questionId && !q.answeredAt,
    );
    if (!question) return false;

    // Fire and forget -- the answer file write is async but submitAnswer is sync
    void this.answerWriter.writeAnswer(questionId, answers).catch(() => {});
    return true;
  }
}
