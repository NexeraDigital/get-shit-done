/**
 * DAG-based dependency scheduler for parallel phase execution.
 *
 * Accepts SchedulerPhase[] (pre-parsed from ROADMAP.md), validates no cycles
 * via Kahn's algorithm, and provides ready/in-progress/complete tracking.
 */

export interface SchedulerPhase {
  number: number;
  name: string;
  dependencies: number[];
}

export class CycleError extends Error {
  public readonly participants: number[];

  constructor(participants: number[]) {
    const phaseList = participants.map(n => `Phase ${n}`).join(', ');
    super(`Dependency cycle detected among: ${phaseList}`);
    this.name = 'CycleError';
    this.participants = participants;
  }
}

export class DependencyScheduler {
  private readonly phases: Map<number, SchedulerPhase>;
  private readonly completed: Set<number> = new Set();
  private readonly inProgress: Set<number> = new Set();

  constructor(phases: SchedulerPhase[]) {
    this.phases = new Map(phases.map(p => [p.number, p]));
    this.warnMissingDeps();
    this.validateNoCycles();
  }

  /** Returns phases whose dependencies are all satisfied and not yet started or completed. */
  getReady(): SchedulerPhase[] {
    return [...this.phases.values()].filter(p =>
      !this.completed.has(p.number) &&
      !this.inProgress.has(p.number) &&
      p.dependencies.every(dep =>
        this.completed.has(dep) || !this.phases.has(dep),
      ),
    );
  }

  /** Marks a phase as in-progress (removes from getReady results). */
  markInProgress(phaseNumber: number): void {
    this.inProgress.add(phaseNumber);
  }

  /** Marks a phase as complete and returns newly eligible phases. */
  markComplete(phaseNumber: number): SchedulerPhase[] {
    this.completed.add(phaseNumber);
    this.inProgress.delete(phaseNumber);
    return this.getReady();
  }

  /** Returns true when all phases have been completed. */
  isComplete(): boolean {
    return this.completed.size === this.phases.size;
  }

  /** Warns about dependency references to phases not in the scheduler. */
  private warnMissingDeps(): void {
    for (const phase of this.phases.values()) {
      for (const dep of phase.dependencies) {
        if (!this.phases.has(dep)) {
          console.warn(
            `Phase ${phase.number} depends on Phase ${dep}, which is not in the scheduler. Treating as satisfied.`,
          );
        }
      }
    }
  }

  /** Kahn's algorithm: validates the dependency graph has no cycles. */
  private validateNoCycles(): void {
    // Build in-degree map counting only edges to known phases
    const inDegree = new Map<number, number>();
    for (const p of this.phases.values()) {
      if (!inDegree.has(p.number)) inDegree.set(p.number, 0);
      for (const dep of p.dependencies) {
        if (this.phases.has(dep)) {
          inDegree.set(p.number, (inDegree.get(p.number) ?? 0) + 1);
        }
      }
    }

    // Start with all zero-degree nodes
    const queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([num]) => num);

    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      // For each phase that depends on current, decrement in-degree
      for (const p of this.phases.values()) {
        if (p.dependencies.includes(current) && this.phases.has(current)) {
          const newDeg = (inDegree.get(p.number) ?? 1) - 1;
          inDegree.set(p.number, newDeg);
          if (newDeg === 0) queue.push(p.number);
        }
      }
    }

    if (visited < this.phases.size) {
      // Identify cycle participants: phases that were never visited
      const participants = [...this.phases.keys()].filter(num => {
        const deg = inDegree.get(num);
        return deg !== undefined && deg > 0;
      });
      throw new CycleError(participants);
    }
  }
}
