import { describe, it, expect, vi } from 'vitest';
import { QuestionHandler } from '../question-handler.js';
import type { AskUserQuestionInput } from '../question-handler.js';
import type { QuestionEvent } from '../types.js';

function makeInput(overrides?: Partial<AskUserQuestionInput>): AskUserQuestionInput {
  return {
    questions: [
      {
        question: 'Which database?',
        header: 'Database Selection',
        options: [
          { label: 'PostgreSQL', description: 'Relational database' },
          { label: 'SQLite', description: 'Embedded database' },
        ],
        multiSelect: false,
      },
    ],
    ...overrides,
  };
}

describe('QuestionHandler', () => {
  describe('handleQuestion', () => {
    it('returns a promise that resolves when submitAnswer is called', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const resultPromise = handler.handleQuestion(input);

      // Should have one pending question
      const pending = handler.getPending();
      expect(pending).toHaveLength(1);

      // Submit the answer
      const questionId = pending[0]!.id;
      const answers = { 'Which database?': 'PostgreSQL' };
      handler.submitAnswer(questionId, answers);

      const result = await resultPromise;
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: {
          questions: input.questions,
          answers,
        },
      });
    });

    it('generates a unique ID for each question', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const p1 = handler.handleQuestion(input);
      const p2 = handler.handleQuestion(input);

      const pending = handler.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0]!.id).not.toBe(pending[1]!.id);

      // Clean up
      handler.submitAnswer(pending[0]!.id, {});
      handler.submitAnswer(pending[1]!.id, {});
      await Promise.all([p1, p2]);
    });

    it('emits question:pending event with QuestionEvent data', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();
      const listener = vi.fn();

      handler.on('question:pending', listener);
      const resultPromise = handler.handleQuestion(input);

      expect(listener).toHaveBeenCalledOnce();
      const event: QuestionEvent = listener.mock.calls[0][0];
      expect(event.id).toBeDefined();
      expect(event.questions).toEqual(input.questions);
      expect(event.createdAt).toBeDefined();

      // Clean up
      handler.submitAnswer(event.id, {});
      await resultPromise;
    });

    it('includes phase and step in QuestionEvent when provided', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();
      const listener = vi.fn();

      handler.on('question:pending', listener);
      const resultPromise = handler.handleQuestion(input, { phase: 2, step: 'plan' });

      const event: QuestionEvent = listener.mock.calls[0][0];
      expect(event.phase).toBe(2);
      expect(event.step).toBe('plan');

      // Clean up
      handler.submitAnswer(event.id, {});
      await resultPromise;
    });
  });

  describe('submitAnswer', () => {
    it('resolves the deferred promise with the provided answers and returns true', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const resultPromise = handler.handleQuestion(input);
      const questionId = handler.getPending()[0]!.id;
      const answers = { 'Which database?': 'SQLite' };

      const success = handler.submitAnswer(questionId, answers);
      expect(success).toBe(true);

      const result = await resultPromise;
      expect(result.updatedInput.answers).toEqual(answers);
    });

    it('returns false for unknown question IDs', () => {
      const handler = new QuestionHandler();
      const result = handler.submitAnswer('nonexistent-id', { foo: 'bar' });
      expect(result).toBe(false);
    });

    it('does not emit question:answered for unknown IDs', () => {
      const handler = new QuestionHandler();
      const listener = vi.fn();
      handler.on('question:answered', listener);

      handler.submitAnswer('nonexistent-id', { foo: 'bar' });
      expect(listener).not.toHaveBeenCalled();
    });

    it('emits question:answered event with id and answers', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();
      const listener = vi.fn();

      handler.on('question:answered', listener);
      const resultPromise = handler.handleQuestion(input);
      const questionId = handler.getPending()[0]!.id;
      const answers = { 'Which database?': 'PostgreSQL' };

      handler.submitAnswer(questionId, answers);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ id: questionId, answers });

      await resultPromise;
    });

    it('removes the question from pending after submission', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const resultPromise = handler.handleQuestion(input);
      const questionId = handler.getPending()[0]!.id;

      handler.submitAnswer(questionId, {});
      expect(handler.getPending()).toHaveLength(0);
      expect(handler.getPendingById(questionId)).toBeUndefined();

      await resultPromise;
    });
  });

  describe('getPending', () => {
    it('returns empty array when no questions are pending', () => {
      const handler = new QuestionHandler();
      expect(handler.getPending()).toEqual([]);
    });

    it('returns all pending QuestionEvent objects', async () => {
      const handler = new QuestionHandler();
      const input1 = makeInput();
      const input2 = makeInput({
        questions: [
          {
            question: 'Which framework?',
            header: 'Framework',
            options: [{ label: 'Express', description: 'Web framework' }],
            multiSelect: false,
          },
        ],
      });

      const p1 = handler.handleQuestion(input1);
      const p2 = handler.handleQuestion(input2);

      const pending = handler.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0]!.questions[0]!.question).toBe('Which database?');
      expect(pending[1]!.questions[0]!.question).toBe('Which framework?');

      // Clean up
      handler.submitAnswer(pending[0]!.id, {});
      handler.submitAnswer(pending[1]!.id, {});
      await Promise.all([p1, p2]);
    });
  });

  describe('getPendingById', () => {
    it('returns a specific pending question by ID', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const resultPromise = handler.handleQuestion(input);
      const pending = handler.getPending();
      const questionId = pending[0]!.id;

      const found = handler.getPendingById(questionId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(questionId);
      expect(found!.questions).toEqual(input.questions);

      // Clean up
      handler.submitAnswer(questionId, {});
      await resultPromise;
    });

    it('returns undefined for unknown ID', () => {
      const handler = new QuestionHandler();
      expect(handler.getPendingById('nonexistent')).toBeUndefined();
    });
  });

  describe('rejectAll', () => {
    it('rejects all pending promises', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const p1 = handler.handleQuestion(input);
      const p2 = handler.handleQuestion(input);

      handler.rejectAll('Aborted');

      await expect(p1).rejects.toBe('Aborted');
      await expect(p2).rejects.toBe('Aborted');
    });

    it('clears the pending map', async () => {
      const handler = new QuestionHandler();
      const input = makeInput();

      const p1 = handler.handleQuestion(input);
      handler.rejectAll('Aborted');

      expect(handler.getPending()).toHaveLength(0);

      // Consume rejection to avoid unhandled rejection
      await p1.catch(() => {});
    });

    it('does nothing when no questions are pending', () => {
      const handler = new QuestionHandler();
      // Should not throw
      handler.rejectAll('Aborted');
      expect(handler.getPending()).toHaveLength(0);
    });
  });

  describe('concurrent questions', () => {
    it('handles multiple concurrent questions independently', async () => {
      const handler = new QuestionHandler();
      const input1 = makeInput();
      const input2 = makeInput({
        questions: [
          {
            question: 'Which ORM?',
            header: 'ORM Selection',
            options: [
              { label: 'Prisma', description: 'Type-safe ORM' },
              { label: 'Drizzle', description: 'Lightweight ORM' },
            ],
            multiSelect: false,
          },
        ],
      });

      const p1 = handler.handleQuestion(input1);
      const p2 = handler.handleQuestion(input2);

      const pending = handler.getPending();
      expect(pending).toHaveLength(2);

      // Answer second question first
      const answers2 = { 'Which ORM?': 'Drizzle' };
      handler.submitAnswer(pending[1]!.id, answers2);

      // Second should resolve, first still pending
      const result2 = await p2;
      expect(result2.updatedInput.answers).toEqual(answers2);
      expect(handler.getPending()).toHaveLength(1);

      // Now answer first question
      const answers1 = { 'Which database?': 'PostgreSQL' };
      handler.submitAnswer(pending[0]!.id, answers1);

      const result1 = await p1;
      expect(result1.updatedInput.answers).toEqual(answers1);
      expect(handler.getPending()).toHaveLength(0);
    });
  });
});
