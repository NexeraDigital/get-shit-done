// Tests for REST API endpoints created by createApiRoutes().
// Uses a real Express server with mock dependencies and native fetch.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiRoutes } from '../routes/api.js';
import { errorHandler } from '../middleware/error.js';
import type { AutopilotState } from '../../types/state.js';
import type { QuestionEvent } from '../../claude/types.js';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const fakeState: AutopilotState = {
  status: 'running',
  currentPhase: 2,
  currentStep: 'execute',
  phases: [
    {
      number: 1,
      name: 'Foundation',
      status: 'completed',
      steps: { discuss: 'done', plan: 'done', execute: 'done', verify: 'done' },
      commits: [{ hash: 'abc123', message: 'initial commit' }],
      gapIterations: 0,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
    },
    {
      number: 2,
      name: 'Integration',
      status: 'in_progress',
      steps: { discuss: 'done', plan: 'done', execute: 'idle', verify: 'idle' },
      commits: [],
      gapIterations: 0,
      startedAt: '2026-01-02T00:00:00Z',
    },
  ],
  pendingQuestions: [],
  errorHistory: [],
  startedAt: '2026-01-01T00:00:00Z',
  lastUpdatedAt: '2026-01-02T12:00:00Z',
};

const fakeQuestions: QuestionEvent[] = [
  {
    id: 'q-001',
    phase: 2,
    step: 'execute',
    questions: [
      {
        question: 'Which database?',
        header: 'Database Selection',
        options: [
          { label: 'Postgres', description: 'Relational' },
          { label: 'MongoDB', description: 'Document' },
        ],
        multiSelect: false,
      },
    ],
    createdAt: '2026-01-02T12:00:00Z',
  },
];

const submittedAnswers = new Map<string, Record<string, string>>();

const mockStateStore = {
  getState: () => ({ ...fakeState }),
} as { getState: () => Readonly<AutopilotState> };

const mockClaudeService = {
  getPendingQuestions: () => [...fakeQuestions],
  submitAnswer: (questionId: string, answers: Record<string, string>) => {
    if (questionId === 'q-001') {
      submittedAnswers.set(questionId, answers);
      return true;
    }
    return false;
  },
};

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createApiRoutes({
      stateProvider: mockStateStore as any,
      questionProvider: mockClaudeService as any,
    }),
  );
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with status ok and numeric uptime', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThan(0);
  });
});

describe('GET /api/status', () => {
  it('returns 200 with status, currentPhase, currentStep, and progress', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('running');
    expect(body.currentPhase).toBe(2);
    expect(body.currentStep).toBe('execute');
    expect(typeof body.progress).toBe('number');
    expect(body.startedAt).toBeDefined();
    expect(body.lastUpdatedAt).toBeDefined();
  });

  it('computes progress correctly (6 of 8 steps done = 75%)', async () => {
    // Phase 1: 4/4 done, Phase 2: 2/4 done = 6/8 = 75%
    const res = await fetch(`${baseUrl}/api/status`);
    const body = (await res.json()) as any;
    expect(body.progress).toBe(75);
  });
});

describe('GET /api/phases', () => {
  it('returns 200 with phases array matching state', async () => {
    const res = await fetch(`${baseUrl}/api/phases`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.phases).toHaveLength(2);
    expect(body.phases[0].name).toBe('Foundation');
    expect(body.phases[1].name).toBe('Integration');
  });
});

describe('GET /api/questions', () => {
  it('returns 200 with questions array', async () => {
    const res = await fetch(`${baseUrl}/api/questions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].id).toBe('q-001');
  });
});

describe('GET /api/questions/:id', () => {
  it('returns 200 for existing question', async () => {
    const res = await fetch(`${baseUrl}/api/questions/q-001`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe('q-001');
    expect(body.questions[0].question).toBe('Which database?');
  });

  it('returns 404 for unknown question ID', async () => {
    const res = await fetch(`${baseUrl}/api/questions/nonexistent`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Question not found');
  });
});

describe('POST /api/questions/:id', () => {
  it('returns 200 with { ok: true } for valid answers', async () => {
    const res = await fetch(`${baseUrl}/api/questions/q-001`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { 'Which database?': 'Postgres' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(submittedAnswers.get('q-001')).toEqual({
      'Which database?': 'Postgres',
    });
  });

  it('returns 404 for unknown question ID', async () => {
    const res = await fetch(`${baseUrl}/api/questions/nonexistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { 'q': 'a' } }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Question not found or already answered');
  });

  it('returns 400 for missing answers', async () => {
    const res = await fetch(`${baseUrl}/api/questions/q-001`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Missing or invalid answers object');
  });

  it('returns 400 for answers as array', async () => {
    const res = await fetch(`${baseUrl}/api/questions/q-001`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: ['not', 'an', 'object'] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Missing or invalid answers object');
  });
});
