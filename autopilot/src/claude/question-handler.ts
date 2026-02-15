// Question handler for intercepting AskUserQuestion tool calls from the Claude Agent SDK.
// Creates deferred Promises to block SDK execution until human answers arrive.
// Must import polyfill before using Promise.withResolvers (ES2024, native in Node 22+).

import './polyfills.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { QuestionEvent, QuestionItem } from './types.js';

// Locally-defined interfaces matching the SDK's AskUserQuestion shapes.
// We define these here rather than importing from the SDK to keep tests SDK-free.

export interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

export interface PermissionResultAllow {
  behavior: 'allow';
  updatedInput: {
    questions: AskUserQuestionInput['questions'];
    answers: Record<string, string>;
  };
}

interface PendingQuestion {
  resolve: (answers: Record<string, string>) => void;
  reject: (reason?: unknown) => void;
  event: QuestionEvent;
  questions: AskUserQuestionInput['questions'];
}

export interface HandleQuestionOptions {
  phase?: number;
  step?: string;
}

/**
 * Manages the deferred-promise lifecycle for AskUserQuestion interception.
 *
 * When Claude asks a question during a GSD command, the handler:
 * 1. Creates a deferred promise via Promise.withResolvers
 * 2. Emits 'question:pending' for the orchestrator/notification system
 * 3. Blocks SDK execution until submitAnswer() resolves the promise
 * 4. Returns a PermissionResult-shaped object to the SDK
 *
 * Events:
 * - 'question:pending' -> QuestionEvent
 * - 'question:answered' -> { id: string, answers: Record<string, string> }
 */
export class QuestionHandler extends EventEmitter {
  private readonly pendingQuestions = new Map<string, PendingQuestion>();

  /**
   * Handles an AskUserQuestion tool call by creating a deferred promise
   * that blocks until submitAnswer() is called with the matching question ID.
   *
   * @param input - The AskUserQuestion input from the SDK
   * @param options - Optional phase/step metadata for the QuestionEvent
   * @returns A PermissionResult-shaped object for the SDK
   */
  async handleQuestion(
    input: AskUserQuestionInput,
    options?: HandleQuestionOptions,
  ): Promise<PermissionResultAllow> {
    const id = randomUUID();

    const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();

    const event: QuestionEvent = {
      id,
      questions: input.questions as QuestionItem[],
      createdAt: new Date().toISOString(),
      ...(options?.phase !== undefined && { phase: options.phase }),
      ...(options?.step !== undefined && { step: options.step }),
    };

    this.pendingQuestions.set(id, {
      resolve,
      reject,
      event,
      questions: input.questions,
    });

    this.emit('question:pending', event);

    // Block SDK execution until the human responds
    const answers = await promise;

    return {
      behavior: 'allow',
      updatedInput: {
        questions: input.questions,
        answers,
      },
    };
  }

  /**
   * Resolves the deferred promise for a pending question.
   *
   * @param questionId - The ID of the pending question
   * @param answers - Record mapping question text to selected label
   * @returns true if the question was found and resolved, false otherwise
   */
  submitAnswer(questionId: string, answers: Record<string, string>): boolean {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) {
      return false;
    }

    pending.resolve(answers);
    this.pendingQuestions.delete(questionId);
    this.emit('question:answered', { id: questionId, answers });
    return true;
  }

  /**
   * Returns all pending QuestionEvent objects.
   */
  getPending(): QuestionEvent[] {
    return Array.from(this.pendingQuestions.values()).map((p) => p.event);
  }

  /**
   * Returns a specific pending question by ID, or undefined if not found.
   */
  getPendingById(id: string): QuestionEvent | undefined {
    return this.pendingQuestions.get(id)?.event;
  }

  /**
   * Rejects all pending promises (for cleanup on abort/timeout).
   *
   * @param reason - The rejection reason passed to each pending promise
   */
  rejectAll(reason?: unknown): void {
    for (const pending of this.pendingQuestions.values()) {
      pending.reject(reason);
    }
    this.pendingQuestions.clear();
  }
}
