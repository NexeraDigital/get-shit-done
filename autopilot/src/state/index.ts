// StateStore - placeholder for TDD RED phase
// This file intentionally has no implementation yet

export class StateStore {
  get filePath(): string {
    throw new Error('Not implemented');
  }

  getState(): never {
    throw new Error('Not implemented');
  }

  async setState(_patch: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  static async restore(_filePath: string): Promise<StateStore> {
    throw new Error('Not implemented');
  }

  static createFresh(_projectDir: string): StateStore {
    throw new Error('Not implemented');
  }
}
