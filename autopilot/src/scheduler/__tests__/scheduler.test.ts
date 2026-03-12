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
