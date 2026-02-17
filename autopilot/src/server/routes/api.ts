// REST route factory for the ResponseServer.
// Creates an Express Router with health, status, phases, and questions endpoints.
// All routes delegate to injected services -- no direct state mutation.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { StateStore } from '../../state/index.js';
import type { ClaudeService } from '../../claude/index.js';
import type { AutopilotState } from '../../types/state.js';

export interface ApiRouteDeps {
  stateStore: StateStore;
  claudeService: ClaudeService;
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
 * @param deps - Injected dependencies (stateStore, claudeService)
 * @returns Express Router mounted at /api by the ResponseServer
 */
export function createApiRoutes(deps: ApiRouteDeps): Router {
  const { stateStore, claudeService } = deps;
  const router = Router();

  // DASH-08: Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // DASH-02: Status with progress percentage
  router.get('/status', (_req: Request, res: Response) => {
    const state = stateStore.getState();
    res.json({
      status: state.status,
      currentPhase: state.currentPhase,
      currentStep: state.currentStep,
      progress: computeProgress(state),
      startedAt: state.startedAt,
      lastUpdatedAt: state.lastUpdatedAt,
    });
  });

  // DASH-03: All phases
  router.get('/phases', (_req: Request, res: Response) => {
    const state = stateStore.getState();
    res.json({ phases: state.phases });
  });

  // DASH-04: All pending questions
  router.get('/questions', (_req: Request, res: Response) => {
    const questions = claudeService.getPendingQuestions();
    res.json({ questions });
  });

  // DASH-05: Single question by ID
  router.get('/questions/:questionId', (req: Request, res: Response) => {
    const questionId = String(req.params['questionId']);
    const questions = claudeService.getPendingQuestions();
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
    const resolved = claudeService.submitAnswer(
      questionId,
      answers as Record<string, string>,
    );
    if (!resolved) {
      res.status(404).json({ error: 'Question not found or already answered' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
