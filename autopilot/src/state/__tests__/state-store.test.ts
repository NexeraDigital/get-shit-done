import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { StateStore } from '../index.js';
import type { AutopilotState, ErrorRecord, PendingQuestion } from '../../types/index.js';

describe('StateStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gsd-state-test-'));
    // Create .planning subdirectory for createFresh
    await mkdir(join(tempDir, '.planning'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('createFresh', () => {
    it('creates StateStore with default state (status: idle, currentPhase: 0, empty arrays)', () => {
      const store = StateStore.createFresh(tempDir);
      const state = store.getState();

      expect(state.status).toBe('idle');
      expect(state.currentPhase).toBe(0);
      expect(state.currentStep).toBe('idle');
      expect(state.phases).toEqual([]);
      expect(state.pendingQuestions).toEqual([]);
      expect(state.errorHistory).toEqual([]);
      expect(state.startedAt).toBeDefined();
      expect(state.lastUpdatedAt).toBeDefined();
    });

    it('uses path.join for file path construction (no hardcoded separators)', () => {
      const store = StateStore.createFresh(tempDir);
      const expectedPath = join(tempDir, '.planning', 'autopilot-state.json');
      // Verify the store uses the correctly joined path
      expect(store.filePath).toBe(expectedPath);
    });
  });

  describe('getState', () => {
    it('returns Readonly copy -- mutations to returned object do not affect internal state', () => {
      const store = StateStore.createFresh(tempDir);
      const state = store.getState();

      // Try to mutate the returned state - should not affect internal state
      // TypeScript prevents direct mutation with Readonly, but at runtime
      // we verify the internal state is unaffected
      const stateAsMutable = state as AutopilotState;
      stateAsMutable.status = 'running';

      const freshState = store.getState();
      expect(freshState.status).toBe('idle');
    });
  });

  describe('setState', () => {
    it('merges patch into state and updates lastUpdatedAt', async () => {
      const store = StateStore.createFresh(tempDir);
      const beforeUpdate = store.getState().lastUpdatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.setState({ status: 'running' });
      const state = store.getState();

      expect(state.status).toBe('running');
      expect(state.lastUpdatedAt).not.toBe(beforeUpdate);
      // Other fields should remain unchanged
      expect(state.currentPhase).toBe(0);
      expect(state.currentStep).toBe('idle');
    });

    it('writes to disk atomically -- file contains valid JSON matching state', async () => {
      const store = StateStore.createFresh(tempDir);
      await store.setState({ status: 'running', currentPhase: 1 });

      const filePath = join(tempDir, '.planning', 'autopilot-state.json');
      const fileContent = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(fileContent) as AutopilotState;

      expect(parsed.status).toBe('running');
      expect(parsed.currentPhase).toBe(1);
      expect(parsed.currentStep).toBe('idle');
    });

    it('patches state immutably (original state unchanged, new state merged)', async () => {
      const store = StateStore.createFresh(tempDir);
      const original = store.getState();

      await store.setState({ status: 'running' });
      const updated = store.getState();

      // Original snapshot should still be idle (immutability)
      expect(original.status).toBe('idle');
      expect(updated.status).toBe('running');
    });

    it('handles multiple sequential setState calls -- final state reflects all patches', async () => {
      const store = StateStore.createFresh(tempDir);

      await store.setState({ status: 'running' });
      await store.setState({ currentPhase: 1 });
      await store.setState({ currentStep: 'plan' });

      const state = store.getState();
      expect(state.status).toBe('running');
      expect(state.currentPhase).toBe(1);
      expect(state.currentStep).toBe('plan');

      // Verify final state on disk too
      const filePath = join(tempDir, '.planning', 'autopilot-state.json');
      const fileContent = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(fileContent) as AutopilotState;
      expect(parsed.status).toBe('running');
      expect(parsed.currentPhase).toBe(1);
      expect(parsed.currentStep).toBe('plan');
    });
  });

  describe('error history', () => {
    it('stores error records with timestamp, phase, step, message, and truncatedOutput', async () => {
      const store = StateStore.createFresh(tempDir);

      const errorRecord: ErrorRecord = {
        timestamp: new Date().toISOString(),
        phase: 1,
        step: 'execute',
        message: 'Build failed with exit code 1',
        truncatedOutput: 'Error: Module not found...',
      };

      await store.setState({
        errorHistory: [errorRecord],
      });

      const state = store.getState();
      expect(state.errorHistory).toHaveLength(1);
      expect(state.errorHistory[0]).toEqual(errorRecord);
      expect(state.errorHistory[0]!.timestamp).toBeDefined();
      expect(state.errorHistory[0]!.phase).toBe(1);
      expect(state.errorHistory[0]!.step).toBe('execute');
      expect(state.errorHistory[0]!.message).toBe('Build failed with exit code 1');
      expect(state.errorHistory[0]!.truncatedOutput).toBe('Error: Module not found...');
    });

    it('appends error records to existing history', async () => {
      const store = StateStore.createFresh(tempDir);

      const error1: ErrorRecord = {
        timestamp: new Date().toISOString(),
        phase: 1,
        step: 'execute',
        message: 'First error',
      };

      await store.setState({ errorHistory: [error1] });

      const error2: ErrorRecord = {
        timestamp: new Date().toISOString(),
        phase: 2,
        step: 'verify',
        message: 'Second error',
        truncatedOutput: 'Test failed...',
      };

      const current = store.getState();
      await store.setState({
        errorHistory: [...current.errorHistory, error2],
      });

      const state = store.getState();
      expect(state.errorHistory).toHaveLength(2);
      expect(state.errorHistory[0]!.message).toBe('First error');
      expect(state.errorHistory[1]!.message).toBe('Second error');
    });
  });

  describe('pending questions', () => {
    it('persists pending questions with id, phase, step, questions, createdAt', async () => {
      const store = StateStore.createFresh(tempDir);

      const question: PendingQuestion = {
        id: 'q-001',
        phase: 1,
        step: 'discuss',
        questions: ['What auth provider?', 'Which database?'],
        createdAt: new Date().toISOString(),
      };

      await store.setState({
        pendingQuestions: [question],
      });

      const state = store.getState();
      expect(state.pendingQuestions).toHaveLength(1);
      expect(state.pendingQuestions[0]).toEqual(question);
      expect(state.pendingQuestions[0]!.id).toBe('q-001');
      expect(state.pendingQuestions[0]!.phase).toBe(1);
      expect(state.pendingQuestions[0]!.step).toBe('discuss');
      expect(state.pendingQuestions[0]!.questions).toEqual(['What auth provider?', 'Which database?']);
    });

    it('survives a restore cycle (persist -> restore -> read)', async () => {
      const store = StateStore.createFresh(tempDir);

      const question: PendingQuestion = {
        id: 'q-002',
        phase: 2,
        step: 'plan',
        questions: ['Should we use monorepo?'],
        createdAt: new Date().toISOString(),
      };

      await store.setState({
        status: 'waiting_for_human',
        pendingQuestions: [question],
      });

      // Restore from file
      const filePath = join(tempDir, '.planning', 'autopilot-state.json');
      const restored = await StateStore.restore(filePath);
      const state = restored.getState();

      expect(state.status).toBe('waiting_for_human');
      expect(state.pendingQuestions).toHaveLength(1);
      expect(state.pendingQuestions[0]!.id).toBe('q-002');
      expect(state.pendingQuestions[0]!.questions).toEqual(['Should we use monorepo?']);
    });
  });

  describe('restore', () => {
    it('reads file, validates with Zod schema, returns populated StateStore', async () => {
      // First create and persist a state
      const store = StateStore.createFresh(tempDir);
      await store.setState({ status: 'running', currentPhase: 3 });

      // Now restore from the file
      const filePath = join(tempDir, '.planning', 'autopilot-state.json');
      const restored = await StateStore.restore(filePath);
      const state = restored.getState();

      expect(state.status).toBe('running');
      expect(state.currentPhase).toBe(3);
      expect(state.currentStep).toBe('idle');
      expect(state.phases).toEqual([]);
    });

    it('throws descriptive error for invalid JSON', async () => {
      const filePath = join(tempDir, 'invalid-state.json');
      await writeFile(filePath, '{ broken json !!!', 'utf-8');

      await expect(StateStore.restore(filePath)).rejects.toThrow(/invalid|parse|JSON/i);
    });

    it('throws descriptive error for missing file', async () => {
      const filePath = join(tempDir, 'nonexistent-state.json');

      await expect(StateStore.restore(filePath)).rejects.toThrow(/not found|ENOENT|no such file|exist/i);
    });

    it('throws descriptive error for schema-invalid state data', async () => {
      const filePath = join(tempDir, 'bad-schema.json');
      // Write valid JSON but invalid schema (missing required fields)
      await writeFile(filePath, JSON.stringify({ status: 'invalid_status', foo: 'bar' }), 'utf-8');

      await expect(StateStore.restore(filePath)).rejects.toThrow();
    });
  });
});
