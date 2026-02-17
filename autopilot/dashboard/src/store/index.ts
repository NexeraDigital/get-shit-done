// Zustand store for all dashboard state.
// Single store with state + actions using Zustand 5's curried create pattern.

import { create } from 'zustand';
import type {
  AutopilotStatus,
  PhaseState,
  QuestionEvent,
  LogEntry,
  ActivityItem,
} from '../types/index.js';

export interface DashboardState {
  // State
  status: AutopilotStatus;
  currentPhase: number;
  currentStep: string;
  progress: number;
  phases: PhaseState[];
  questions: QuestionEvent[];
  logs: LogEntry[];
  activities: ActivityItem[];
  connected: boolean;

  // Actions
  setStatus: (
    patch: Partial<
      Pick<DashboardState, 'status' | 'currentPhase' | 'currentStep' | 'progress'>
    >,
  ) => void;
  setPhases: (phases: PhaseState[]) => void;
  setQuestions: (questions: QuestionEvent[]) => void;
  addLog: (entry: LogEntry) => void;
  addActivity: (item: ActivityItem) => void;
  setConnected: (connected: boolean) => void;
  updatePhase: (phaseNumber: number, patch: Partial<PhaseState>) => void;
}

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Initial state
  status: 'idle',
  currentPhase: 0,
  currentStep: 'idle',
  progress: 0,
  phases: [],
  questions: [],
  logs: [],
  activities: [],
  connected: false,

  // Actions
  setStatus: (patch) => set((state) => ({ ...state, ...patch })),

  setPhases: (phases) => set({ phases }),

  setQuestions: (questions) => set({ questions }),

  addLog: (entry) =>
    set((state) => ({
      logs: [...state.logs.slice(-(500 - 1)), entry],
    })),

  addActivity: (item) =>
    set((state) => ({
      activities: [item, ...state.activities].slice(0, 50),
    })),

  setConnected: (connected) => set({ connected }),

  updatePhase: (phaseNumber, patch) =>
    set((state) => ({
      phases: state.phases.map((p) =>
        p.number === phaseNumber ? { ...p, ...patch } : p,
      ),
    })),
}));
