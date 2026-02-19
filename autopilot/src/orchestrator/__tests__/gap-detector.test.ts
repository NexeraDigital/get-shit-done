import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForGaps, parsePhaseRange, findPhaseDir } from '../gap-detector.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

describe('checkForGaps', () => {
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockReaddir: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const fsMod = await import('node:fs/promises');
    mockReadFile = fsMod.readFile as unknown as ReturnType<typeof vi.fn>;
    mockReaddir = fsMod.readdir as unknown as ReturnType<typeof vi.fn>;
    mockReadFile.mockReset();
    mockReaddir.mockReset();

    // Default: readdir returns a matching phase directory
    mockReaddir.mockResolvedValue(['03-core-orchestrator']);
  });

  it('returns true when VERIFICATION.md contains "gaps_found"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        return '## Verification\nStatus: gaps_found\nSome gaps remain.';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(true);
  });

  it('returns true when VERIFICATION.md contains "GAPS_FOUND"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        return '## Result\nGAPS_FOUND: 2 issues';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(true);
  });

  it('returns false when VERIFICATION.md contains "passed"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        return '## Verification\nAll checks passed.';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(false);
  });

  it('returns false when VERIFICATION.md contains "PASSED"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        return '## Result: PASSED\nAll criteria met.';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(false);
  });

  it('returns false when no VERIFICATION.md exists (assume passed)', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(false);
  });

  it('returns true when UAT.md contains "FAIL"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      if (String(path).includes('UAT')) {
        return '## UAT Results\nTest 1: FAIL\nTest 2: PASS';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(true);
  });

  it('returns true when UAT.md contains "Issue Found"', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      if (String(path).includes('UAT')) {
        return '## UAT\nIssue Found: Missing error handling in login flow';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(true);
  });

  it('returns false when VERIFICATION.md passed and no UAT issues', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).includes('VERIFICATION')) {
        return '## Verification\nAll checks passed.';
      }
      if (String(path).includes('UAT')) {
        return '## UAT Results\nAll tests passed.\nNo issues.';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await checkForGaps('/project', 3);
    expect(result).toBe(false);
  });
});

describe('parsePhaseRange', () => {
  it('parses single number "3" into [3]', () => {
    expect(parsePhaseRange('3')).toEqual([3]);
  });

  it('parses range "2-5" into [2, 3, 4, 5]', () => {
    expect(parsePhaseRange('2-5')).toEqual([2, 3, 4, 5]);
  });

  it('parses range "1-1" into [1]', () => {
    expect(parsePhaseRange('1-1')).toEqual([1]);
  });

  it('parses comma-separated "1-3,5,7-9" into [1, 2, 3, 5, 7, 8, 9]', () => {
    expect(parsePhaseRange('1-3,5,7-9')).toEqual([1, 2, 3, 5, 7, 8, 9]);
  });

  it('deduplicates "3,3,5,5" into [3, 5]', () => {
    expect(parsePhaseRange('3,3,5,5')).toEqual([3, 5]);
  });

  it('throws on "5-3" (start > end)', () => {
    expect(() => parsePhaseRange('5-3')).toThrow(/start.*>.*end/i);
  });

  it('throws on "abc" (invalid format)', () => {
    expect(() => parsePhaseRange('abc')).toThrow(/invalid phase specifier/i);
  });

  it('throws on empty string', () => {
    expect(() => parsePhaseRange('')).toThrow(/invalid phase specifier/i);
  });

  it('throws on "1-2-3" (too many segments)', () => {
    expect(() => parsePhaseRange('1-2-3')).toThrow(/invalid phase specifier/i);
  });
});

describe('findPhaseDir', () => {
  let mockReaddir: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const fsMod = await import('node:fs/promises');
    mockReaddir = fsMod.readdir as unknown as ReturnType<typeof vi.fn>;
    mockReaddir.mockReset();
  });

  it('finds directory matching phase number prefix', async () => {
    mockReaddir.mockResolvedValue([
      '01-foundation',
      '02-claude-integration',
      '03-core-orchestrator',
    ]);

    const result = await findPhaseDir('/project', 3);
    expect(result).toContain('03-core-orchestrator');
  });

  it('throws when no matching directory exists', async () => {
    mockReaddir.mockResolvedValue([
      '01-foundation',
      '02-claude-integration',
    ]);

    await expect(findPhaseDir('/project', 99)).rejects.toThrow();
  });
});
