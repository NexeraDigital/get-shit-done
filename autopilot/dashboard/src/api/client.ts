// Typed fetch wrappers for all REST API endpoints.
// Base URL is empty string -- same origin in production, Vite proxy in dev.

import type {
  AutopilotStatus,
  PhaseState,
  QuestionEvent,
  ActivityItem,
} from '../types/index.js';

export interface StatusResponse {
  status: AutopilotStatus;
  currentPhase: number;
  currentStep: string;
  progress: number;
  startedAt: string;
  lastUpdatedAt: string;
  alive: boolean;
}

export interface PhasesResponse {
  phases: PhaseState[];
}

export interface QuestionsResponse {
  questions: QuestionEvent[];
}

export interface SubmitAnswerResponse {
  ok: boolean;
}

export interface ActivitiesResponse {
  activities: ActivityItem[];
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status');
  if (!res.ok) {
    throw new Error(`fetchStatus failed: ${String(res.status)}`);
  }
  return res.json() as Promise<StatusResponse>;
}

export async function fetchPhases(): Promise<PhasesResponse> {
  const res = await fetch('/api/phases');
  if (!res.ok) {
    throw new Error(`fetchPhases failed: ${String(res.status)}`);
  }
  return res.json() as Promise<PhasesResponse>;
}

export async function fetchQuestions(): Promise<QuestionsResponse> {
  const res = await fetch('/api/questions');
  if (!res.ok) {
    throw new Error(`fetchQuestions failed: ${String(res.status)}`);
  }
  return res.json() as Promise<QuestionsResponse>;
}

export async function fetchQuestion(id: string): Promise<QuestionEvent> {
  const res = await fetch(`/api/questions/${id}`);
  if (!res.ok) {
    throw new Error(`fetchQuestion failed: ${String(res.status)}`);
  }
  return res.json() as Promise<QuestionEvent>;
}

export async function submitAnswer(
  questionId: string,
  answers: Record<string, string>,
): Promise<SubmitAnswerResponse> {
  const res = await fetch(`/api/questions/${questionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) {
    throw new Error(`submitAnswer failed: ${String(res.status)}`);
  }
  return res.json() as Promise<SubmitAnswerResponse>;
}

export async function fetchActivities(): Promise<ActivitiesResponse> {
  const res = await fetch('/api/activities');
  if (!res.ok) {
    throw new Error(`fetchActivities failed: ${String(res.status)}`);
  }
  return res.json() as Promise<ActivitiesResponse>;
}

// Push notification endpoints

export interface VapidKeyResponse {
  publicKey: string;
}

export interface PushSubscriptionResponse {
  ok: boolean;
}

export async function fetchVapidPublicKey(): Promise<VapidKeyResponse> {
  const res = await fetch('/api/push/vapid-public-key');
  if (!res.ok) {
    throw new Error(`fetchVapidPublicKey failed: ${String(res.status)}`);
  }
  return res.json() as Promise<VapidKeyResponse>;
}

export async function subscribePush(subscription: object): Promise<PushSubscriptionResponse> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) {
    throw new Error(`subscribePush failed: ${String(res.status)}`);
  }
  return res.json() as Promise<PushSubscriptionResponse>;
}

export async function unsubscribePush(endpoint: string): Promise<PushSubscriptionResponse> {
  const res = await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    throw new Error(`unsubscribePush failed: ${String(res.status)}`);
  }
  return res.json() as Promise<PushSubscriptionResponse>;
}
