import { describe, it, expect, vi } from 'vitest';
import { DependencyScheduler, CycleError } from '../index.js';
import type { SchedulerPhase } from '../index.js';

describe('DependencyScheduler', () => {
  describe('getReady()', () => {
    it('returns phases with no dependencies as immediately ready', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      const ready = scheduler.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]!.number).toBe(1);
    });

    it('returns multiple independent roots in initial getReady()', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
        { number: 3, name: 'Phase 3', dependencies: [1, 2] },
      ];
      const scheduler = new DependencyScheduler(phases);

      const ready = scheduler.getReady();
      expect(ready).toHaveLength(2);
      expect(ready.map(p => p.number).sort()).toEqual([1, 2]);
    });

    it('does not return phases whose dependencies are not yet satisfied', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      const ready = scheduler.getReady();
      expect(ready.map(p => p.number)).toEqual([1]);
    });
  });

  describe('markInProgress()', () => {
    it('removes a phase from getReady() results', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const ready = scheduler.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]!.number).toBe(2);
    });
  });

  describe('markComplete()', () => {
    it('returns newly eligible phases whose dependencies are now satisfied', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const newlyReady = scheduler.markComplete(1);
      expect(newlyReady).toHaveLength(2);
      expect(newlyReady.map(p => p.number).sort()).toEqual([2, 3]);
    });

    it('does not return phases with partially satisfied dependencies', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
        { number: 3, name: 'Phase 3', dependencies: [1, 2] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const newlyReady = scheduler.markComplete(1);
      // Phase 3 still depends on Phase 2 which is not complete
      expect(newlyReady.map(p => p.number)).not.toContain(3);
    });
  });

  describe('missing dependency references', () => {
    it('warns but treats missing deps as satisfied (lenient)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [99] },
      ];
      const scheduler = new DependencyScheduler(phases);

      const ready = scheduler.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]!.number).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('99'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('cycle detection', () => {
    it('throws CycleError for direct cycle at construction', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [2] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];

      expect(() => new DependencyScheduler(phases)).toThrow(CycleError);
    });

    it('throws CycleError for indirect cycle at construction', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [3] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [2] },
      ];

      expect(() => new DependencyScheduler(phases)).toThrow(CycleError);
    });

    it('CycleError message includes cycle participant info', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [2] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];

      try {
        new DependencyScheduler(phases);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(CycleError);
        const msg = (e as CycleError).message;
        expect(msg).toMatch(/cycle/i);
      }
    });
  });

  describe('isComplete()', () => {
    it('returns false when phases remain', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);
      expect(scheduler.isComplete()).toBe(false);
    });

    it('returns true when all phases are completed', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markComplete(1);
      scheduler.markInProgress(2);
      scheduler.markComplete(2);

      expect(scheduler.isComplete()).toBe(true);
    });
  });

  describe('markFailed()', () => {
    it('marks a phase as failed and transitively skips all dependents', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [2] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const skipped = scheduler.markFailed(1);

      // Phase 2 depends on 1, Phase 3 depends on 2 -- both should be skipped
      expect(skipped).toHaveLength(2);
      expect(skipped.map(p => p.number).sort()).toEqual([2, 3]);
    });

    it('removes the failed phase from inProgress', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1);

      // Phase 1 should not appear in getReady
      const ready = scheduler.getReady();
      expect(ready.map(p => p.number)).toEqual([2]);
    });

    it('is a no-op when called on an already-failed phase', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1);
      const secondCall = scheduler.markFailed(1);

      expect(secondCall).toHaveLength(0);
    });

    it('skips a phase whose dependency was skipped (transitive)', () => {
      // 1 -> 2 -> 3 -> 4
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [2] },
        { number: 4, name: 'Phase 4', dependencies: [3] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const skipped = scheduler.markFailed(1);

      expect(skipped).toHaveLength(3);
      expect(skipped.map(p => p.number).sort()).toEqual([2, 3, 4]);
    });

    it('does not skip phases with independent paths', () => {
      // 1 -> 2, 3 -> 4, 2 & 4 -> 5
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [] },
        { number: 4, name: 'Phase 4', dependencies: [3] },
        { number: 5, name: 'Phase 5', dependencies: [2, 4] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      const skipped = scheduler.markFailed(1);

      // Phase 2 and 5 should be skipped (5 depends on 2 which is skipped)
      // Phase 3 and 4 are independent
      expect(skipped.map(p => p.number).sort()).toEqual([2, 5]);
    });
  });

  describe('markSkipped()', () => {
    it('marks a phase as skipped so it does not appear in getReady', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markSkipped(1);
      const ready = scheduler.getReady();
      expect(ready.map(p => p.number)).toEqual([2]);
    });
  });

  describe('getStatus()', () => {
    it('returns correct status for each phase state', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
        { number: 3, name: 'Phase 3', dependencies: [] },
        { number: 4, name: 'Phase 4', dependencies: [] },
        { number: 5, name: 'Phase 5', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(2);
      scheduler.markInProgress(3);
      scheduler.markComplete(3);
      scheduler.markInProgress(4);
      scheduler.markFailed(4);

      expect(scheduler.getStatus(1)).toBe('ready');
      expect(scheduler.getStatus(2)).toBe('in-progress');
      expect(scheduler.getStatus(3)).toBe('completed');
      expect(scheduler.getStatus(4)).toBe('failed');
      expect(scheduler.getStatus(5)).toBe('ready');
    });

    it('returns skipped for transitively skipped phases', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1);

      expect(scheduler.getStatus(2)).toBe('skipped');
    });
  });

  describe('isComplete() with failures', () => {
    it('returns true when all phases are completed, failed, or skipped', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [1] },
        { number: 3, name: 'Phase 3', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1); // Phase 1 failed, Phase 2 skipped
      scheduler.markInProgress(3);
      scheduler.markComplete(3);

      expect(scheduler.isComplete()).toBe(true);
    });

    it('returns false when some phases are still pending', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
        { number: 3, name: 'Phase 3', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1);
      // Phase 2 and 3 are still pending

      expect(scheduler.isComplete()).toBe(false);
    });
  });

  describe('getReady() with failures', () => {
    it('excludes failed and skipped phases from ready list', () => {
      const phases: SchedulerPhase[] = [
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 2, name: 'Phase 2', dependencies: [] },
        { number: 3, name: 'Phase 3', dependencies: [1] },
      ];
      const scheduler = new DependencyScheduler(phases);

      scheduler.markInProgress(1);
      scheduler.markFailed(1);

      const ready = scheduler.getReady();
      // Phase 1 is failed, Phase 3 is skipped, only Phase 2 should be ready
      expect(ready.map(p => p.number)).toEqual([2]);
    });
  });

  describe('no implicit sequential ordering', () => {
    it('phases without dependencies are all ready regardless of number', () => {
      const phases: SchedulerPhase[] = [
        { number: 3, name: 'Phase 3', dependencies: [] },
        { number: 1, name: 'Phase 1', dependencies: [] },
        { number: 5, name: 'Phase 5', dependencies: [] },
      ];
      const scheduler = new DependencyScheduler(phases);

      const ready = scheduler.getReady();
      expect(ready).toHaveLength(3);
      expect(ready.map(p => p.number).sort()).toEqual([1, 3, 5]);
    });
  });
});
