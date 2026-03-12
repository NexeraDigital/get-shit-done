import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WorkerPoolOptions } from '../types.js';

// ---------------------------------------------------------------------------
// Hoisted mocks -- vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockEnsureClean,
  mockCreateWorktree,
  mockMergeWorktree,
  mockCleanupWorktree,
} = vi.hoisted(() => ({
  mockEnsureClean: vi.fn(),
  mockCreateWorktree: vi.fn(),
  mockMergeWorktree: vi.fn(),
  mockCleanupWorktree: vi.fn(),
}));

vi.mock('../git-worktree.js', () => ({
  ensureCleanWorktree: mockEnsureClean,
  createWorktree: mockCreateWorktree,
  mergeWorktree: mockMergeWorktree,
  cleanupWorktree: mockCleanupWorktree,
}));

vi.mock('../../claude/index.js', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class MockCS extends EE {
    runGsdCommand = vi.fn().mockResolvedValue({ success: true });
    abortCurrent = vi.fn();
    constructor(_opts?: unknown) {
      super();
    }
  }
  return { ClaudeService: MockCS };
});

// Import the module under test AFTER mocks are set up
import { WorkerPool } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOpts(overrides?: Partial<WorkerPoolOptions>): WorkerPoolOptions {
  return {
    concurrency: 3,
    parallel: true,
    projectDir: '/test/project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup default implementations after clearAllMocks
    mockEnsureClean.mockResolvedValue(undefined);
    mockCreateWorktree.mockImplementation((_dir: string, phase: number) =>
      Promise.resolve(`/tmp/worktrees/phase-${phase}`),
    );
    mockMergeWorktree.mockResolvedValue(true);
    mockCleanupWorktree.mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('creates a WorkerPool with given options', () => {
      const pool = new WorkerPool(defaultOpts());
      expect(pool).toBeInstanceOf(EventEmitter);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe('dispatch (parallel mode)', () => {
    it('calls ensureCleanWorktree and createWorktree in parallel mode', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: true }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 1, name: 'Test', dependencies: [] }, runPhaseFn);
      const result = await pool.waitForAny();

      expect(mockEnsureClean).toHaveBeenCalledWith('/test/project', 1);
      expect(mockCreateWorktree).toHaveBeenCalledWith('/test/project', 1);
      expect(result.phaseNumber).toBe(1);
      expect(result.success).toBe(true);
    });

    it('calls runPhaseFn with worktree path and a ClaudeService', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: true }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 2, name: 'Phase 2', dependencies: [] }, runPhaseFn);
      await pool.waitForAny();

      expect(runPhaseFn).toHaveBeenCalledWith(
        '/tmp/worktrees/phase-2',
        expect.anything(), // ClaudeService instance
      );
    });

    it('merges and cleans up worktree on success', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: true }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 3, name: 'Phase 3', dependencies: [] }, runPhaseFn);
      await pool.waitForAny();

      expect(mockMergeWorktree).toHaveBeenCalledWith('/test/project', 3);
      expect(mockCleanupWorktree).toHaveBeenCalledWith('/test/project', 3);
    });

    it('preserves worktree on merge failure', async () => {
      mockMergeWorktree.mockResolvedValueOnce(false);

      const pool = new WorkerPool(defaultOpts({ parallel: true }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 4, name: 'Phase 4', dependencies: [] }, runPhaseFn);
      const result = await pool.waitForAny();

      expect(mockMergeWorktree).toHaveBeenCalledWith('/test/project', 4);
      expect(mockCleanupWorktree).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.mergeSuccess).toBe(false);
    });

    it('returns failure result when runPhaseFn throws', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: true }));
      const runPhaseFn = vi.fn().mockRejectedValue(new Error('phase failed'));

      pool.dispatch({ number: 5, name: 'Phase 5', dependencies: [] }, runPhaseFn);
      const result = await pool.waitForAny();

      expect(result.phaseNumber).toBe(5);
      expect(result.success).toBe(false);
      expect(result.error).toBe('phase failed');
    });
  });

  describe('dispatch (sequential mode)', () => {
    it('skips worktree operations in sequential mode', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: false }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 1, name: 'Phase 1', dependencies: [] }, runPhaseFn);
      await pool.waitForAny();

      expect(mockEnsureClean).not.toHaveBeenCalled();
      expect(mockCreateWorktree).not.toHaveBeenCalled();
      expect(mockMergeWorktree).not.toHaveBeenCalled();
      expect(mockCleanupWorktree).not.toHaveBeenCalled();
    });

    it('calls runPhaseFn with projectDir in sequential mode', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: false }));
      const runPhaseFn = vi.fn().mockResolvedValue(undefined);

      pool.dispatch({ number: 1, name: 'Phase 1', dependencies: [] }, runPhaseFn);
      await pool.waitForAny();

      expect(runPhaseFn).toHaveBeenCalledWith(
        '/test/project',
        expect.anything(), // ClaudeService instance
      );
    });
  });

  describe('activeCount', () => {
    it('tracks active workers', () => {
      const pool = new WorkerPool(defaultOpts());
      const neverResolve = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch({ number: 1, name: 'P1', dependencies: [] }, neverResolve);
      expect(pool.activeCount).toBe(1);

      pool.dispatch({ number: 2, name: 'P2', dependencies: [] }, neverResolve);
      expect(pool.activeCount).toBe(2);
    });
  });

  describe('waitForAny', () => {
    it('resolves when any active worker completes', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: false }));
      let resolvePhase1!: () => void;
      const p1 = new Promise<void>((r) => { resolvePhase1 = r; });

      pool.dispatch({ number: 1, name: 'P1', dependencies: [] }, () => p1);
      pool.dispatch(
        { number: 2, name: 'P2', dependencies: [] },
        vi.fn().mockResolvedValue(undefined),
      );

      // Phase 2 should complete first
      const result = await pool.waitForAny();
      expect(result.phaseNumber).toBe(2);
      expect(pool.activeCount).toBe(1);

      // Resolve phase 1
      resolvePhase1();
      const result2 = await pool.waitForAny();
      expect(result2.phaseNumber).toBe(1);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe('merge serialization', () => {
    it('serializes merge operations to prevent concurrent git conflicts', async () => {
      const mergeOrder: number[] = [];
      mockMergeWorktree.mockImplementation(async (_dir: string, phase: number) => {
        mergeOrder.push(phase);
        await new Promise((r) => setTimeout(r, 10));
        return true;
      });

      const pool = new WorkerPool(defaultOpts({ parallel: true }));

      pool.dispatch(
        { number: 1, name: 'P1', dependencies: [] },
        vi.fn().mockResolvedValue(undefined),
      );
      pool.dispatch(
        { number: 2, name: 'P2', dependencies: [] },
        vi.fn().mockResolvedValue(undefined),
      );

      await pool.waitForAny();
      await pool.waitForAny();

      // Both merges should have been called
      expect(mergeOrder.length).toBe(2);
    });
  });

  describe('abortAll', () => {
    it('aborts all active workers', () => {
      const pool = new WorkerPool(defaultOpts({ parallel: false }));
      const neverResolve = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch({ number: 1, name: 'P1', dependencies: [] }, neverResolve);
      pool.dispatch({ number: 2, name: 'P2', dependencies: [] }, neverResolve);

      pool.abortAll();

      // Workers are still tracked (abort doesn't remove from active map)
      expect(pool.activeCount).toBe(2);
    });
  });

  describe('event forwarding', () => {
    it('re-emits ClaudeService events with phase metadata', async () => {
      const pool = new WorkerPool(defaultOpts({ parallel: false }));
      const events: unknown[] = [];
      pool.on('worker:message', (e) => events.push(e));

      const runPhaseFn = vi.fn().mockImplementation((_cwd: string, cs: EventEmitter) => {
        cs.emit('message', { type: 'text', content: 'hello' });
        return Promise.resolve();
      });

      pool.dispatch({ number: 1, name: 'P1', dependencies: [] }, runPhaseFn);
      await pool.waitForAny();

      expect(events.length).toBe(1);
      expect(events[0]).toEqual(expect.objectContaining({
        phaseNumber: 1,
        type: 'text',
        content: 'hello',
      }));
    });
  });
});
