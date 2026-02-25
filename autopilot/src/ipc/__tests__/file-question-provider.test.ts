import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import writeFileAtomic from 'write-file-atomic';
import { FileStateReader } from '../file-state-reader.js';
import { AnswerWriter } from '../answer-writer.js';
import { FileQuestionProvider } from '../file-question-provider.js';
import type { AutopilotState } from '../../types/state.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ipc-fqp-'));
  await mkdir(join(testDir, '.planning', 'autopilot'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function writeState(state: AutopilotState): Promise<void> {
  const path = join(testDir, '.planning', 'autopilot', 'state.json');
  return writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
}

function makeState(overrides?: Partial<AutopilotState>): AutopilotState {
  return {
    status: 'idle',
    currentPhase: 0,
    currentStep: 'idle',
    phases: [],
    pendingQuestions: [],
    errorHistory: [],
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FileQuestionProvider', () => {
  it('returns empty questions when no pending questions in state', async () => {
    await writeState(makeState());

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const questions = provider.getPendingQuestions();
    expect(questions).toEqual([]);

    reader.stop();
  });

  it('returns unanswered questions from state with questionItems', async () => {
    await writeState(makeState({
      pendingQuestions: [
        {
          id: 'q-100',
          phase: 1,
          step: 'plan',
          questions: ['Which framework?'],
          questionItems: [
            {
              question: 'Which framework?',
              header: 'Framework',
              options: [
                { label: 'React', description: 'UI lib' },
                { label: 'Vue', description: 'Progressive' },
              ],
              multiSelect: false,
            },
          ],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }));

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const questions = provider.getPendingQuestions();

    expect(questions).toHaveLength(1);
    expect(questions[0]!.id).toBe('q-100');
    expect(questions[0]!.questions[0]!.question).toBe('Which framework?');
    expect(questions[0]!.questions[0]!.options).toHaveLength(2);

    reader.stop();
  });

  it('filters out answered questions', async () => {
    await writeState(makeState({
      pendingQuestions: [
        {
          id: 'q-answered',
          phase: 1,
          step: 'plan',
          questions: ['Answered?'],
          createdAt: '2026-01-01T00:00:00Z',
          answeredAt: '2026-01-01T00:01:00Z',
          answers: { 'Answered?': 'Yes' },
        },
        {
          id: 'q-pending',
          phase: 1,
          step: 'plan',
          questions: ['Still pending?'],
          createdAt: '2026-01-01T00:02:00Z',
        },
      ],
    }));

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const questions = provider.getPendingQuestions();

    expect(questions).toHaveLength(1);
    expect(questions[0]!.id).toBe('q-pending');

    reader.stop();
  });

  it('submitAnswer returns false for unknown question', async () => {
    await writeState(makeState());

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const result = provider.submitAnswer('nonexistent', { a: 'b' });
    expect(result).toBe(false);

    reader.stop();
  });

  it('submitAnswer returns true for existing unanswered question', async () => {
    await writeState(makeState({
      pendingQuestions: [
        {
          id: 'q-submit',
          phase: 1,
          step: 'execute',
          questions: ['Which option?'],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }));

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const result = provider.submitAnswer('q-submit', { 'Which option?': 'A' });
    expect(result).toBe(true);

    reader.stop();
  });

  it('falls back to plain text questions when no questionItems', async () => {
    await writeState(makeState({
      pendingQuestions: [
        {
          id: 'q-plain',
          phase: 1,
          step: 'plan',
          questions: ['What color?', 'What size?'],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }));

    const reader = new FileStateReader(testDir);
    reader.start();
    await new Promise((r) => setTimeout(r, 1500));

    const provider = new FileQuestionProvider(reader, new AnswerWriter(testDir));
    const questions = provider.getPendingQuestions();

    expect(questions).toHaveLength(1);
    expect(questions[0]!.questions).toHaveLength(2);
    expect(questions[0]!.questions[0]!.question).toBe('What color?');
    expect(questions[0]!.questions[0]!.options).toEqual([]);

    reader.stop();
  });
});
