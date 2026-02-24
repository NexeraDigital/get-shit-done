// REST route factory for the ResponseServer.
// Creates an Express Router with health, status, phases, and questions endpoints.
// All routes delegate to injected services -- no direct state mutation.

import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AutopilotState } from '../../types/state.js';
import type { QuestionEvent } from '../../claude/types.js';
import type { MilestoneResponse } from '../../milestone/types.js';

/**
 * Reads .planning/PROJECT.md and extracts the "What This Is" section content.
 * Returns empty string if the file doesn't exist or the section isn't found.
 */
function readProjectDescription(): string {
  try {
    const projectMd = readFileSync(join(process.cwd(), '.planning', 'PROJECT.md'), 'utf-8');
    const match = projectMd.match(/## What This Is\n\n([\s\S]*?)(?:\n## |\n---|\n$)/);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Provides readonly access to autopilot state */
export interface StateProvider {
  getState(): Readonly<AutopilotState>;
}

/** Provides question listing and answer submission */
export interface QuestionProvider {
  getPendingQuestions(): QuestionEvent[];
  submitAnswer(questionId: string, answers: Record<string, string>): boolean;
}

/** Provides autopilot process liveness check */
export interface LivenessProvider {
  isAlive(): Promise<boolean>;
}

/** Provides access to persisted activity entries */
export interface ActivityProvider {
  getAll(): { type: string; message: string; timestamp: string; metadata?: Record<string, unknown> }[];
}

/** Provides milestone lifecycle data parsed from planning files */
export interface MilestoneProvider {
  getMilestones(): MilestoneResponse;
}

export interface ApiRouteDeps {
  stateProvider: StateProvider;
  questionProvider: QuestionProvider;
  livenessProvider?: LivenessProvider;
  activityProvider?: ActivityProvider;
  milestoneProvider?: MilestoneProvider;
}

/**
 * Computes overall progress percentage from state.
 * Each phase has 4 steps (discuss, plan, execute, verify).
 * A step is complete when its value is 'done'.
 */
export function computeProgress(state: Readonly<AutopilotState>): number {
  if (state.phases.length === 0) return 0;
  const totalSteps = state.phases.length * 4;
  let completedSteps = 0;
  for (const phase of state.phases) {
    if (phase.steps.discuss === 'done') completedSteps++;
    if (phase.steps.plan === 'done') completedSteps++;
    if (phase.steps.execute === 'done') completedSteps++;
    if (phase.steps.verify === 'done') completedSteps++;
  }
  return Math.round((completedSteps / totalSteps) * 100);
}

/**
 * Creates an Express Router with all REST API endpoints.
 *
 * @param deps - Injected dependencies (stateProvider, questionProvider)
 * @returns Express Router mounted at /api by the ResponseServer
 */
export function createApiRoutes(deps: ApiRouteDeps): Router {
  const { stateProvider, questionProvider, livenessProvider, activityProvider, milestoneProvider } = deps;
  const router = Router();

  // DASH-08: Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // DASH-02: Status with progress percentage
  router.get('/status', async (_req: Request, res: Response) => {
    const state = stateProvider.getState();
    const alive = livenessProvider ? await livenessProvider.isAlive() : true;
    res.json({
      status: state.status,
      currentPhase: state.currentPhase,
      currentStep: state.currentStep,
      progress: computeProgress(state),
      startedAt: state.startedAt,
      lastUpdatedAt: state.lastUpdatedAt,
      alive,
      projectName: basename(process.cwd()),
      projectDescription: readProjectDescription(),
    });
  });

  // DASH-03: All phases
  router.get('/phases', (_req: Request, res: Response) => {
    const state = stateProvider.getState();
    res.json({ phases: state.phases });
  });

  // DASH-04: All pending questions
  router.get('/questions', (_req: Request, res: Response) => {
    const questions = questionProvider.getPendingQuestions();
    res.json({ questions });
  });

  // DASH-05: Single question by ID
  router.get('/questions/:questionId', (req: Request, res: Response) => {
    const questionId = String(req.params['questionId']);
    const questions = questionProvider.getPendingQuestions();
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    res.json(question);
  });

  // DASH-06: Submit answer for a question
  router.post('/questions/:questionId', (req: Request, res: Response) => {
    const questionId = String(req.params['questionId']);
    const { answers } = req.body as { answers?: unknown };
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      res.status(400).json({ error: 'Missing or invalid answers object' });
      return;
    }
    const resolved = questionProvider.submitAnswer(
      questionId,
      answers as Record<string, string>,
    );
    if (!resolved) {
      res.status(404).json({ error: 'Question not found or already answered' });
      return;
    }
    res.json({ ok: true });
  });

  // DASH-17: Activities endpoint
  router.get('/activities', (_req: Request, res: Response) => {
    if (!activityProvider) {
      res.json({ activities: [] });
      return;
    }
    const activities = activityProvider.getAll();
    res.json({ activities });
  });

  // Milestones endpoint
  router.get('/milestones', (_req: Request, res: Response) => {
    if (!milestoneProvider) {
      res.json({ current: null, shipped: [] });
      return;
    }
    const milestones = milestoneProvider.getMilestones();
    res.json(milestones);
  });

  // Shutdown endpoint -- allows the launcher to remotely stop the dashboard process.
  // Responds 200 then exits after a short delay to allow the response to flush.
  router.post('/shutdown', (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Shutting down' });
    setTimeout(() => process.exit(0), 200);
  });

  return router;
}
