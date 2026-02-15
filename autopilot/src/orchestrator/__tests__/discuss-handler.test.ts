import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSkipDiscussContext, writeSkipDiscussContext } from '../discuss-handler.js';
import type { PhaseInfo } from '../discuss-handler.js';

// Mock node:fs/promises for writeSkipDiscussContext tests
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('generateSkipDiscussContext', () => {
  const phase: PhaseInfo = { number: 3, name: 'Core Orchestrator' };

  // Freeze date for deterministic output
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(globalThis, 'Date').mockImplementation(
      () => new Date('2026-02-15T12:00:00Z') as unknown as Date,
    );
    // Restore the real Date for static methods we don't mock
    (dateSpy as any).now = Date.now;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces output containing phase number and name in the title', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain('# Phase 3: Core Orchestrator - Context');
  });

  it('contains today\'s date in YYYY-MM-DD format in the Gathered field', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain('**Gathered:** 2026-02-15');
  });

  it('contains Claude\'s Discretion section with skip-discuss explanation', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain("Claude's Discretion");
    expect(output).toContain('--skip-discuss');
  });

  it('contains --skip-discuss reference explaining why decisions are deferred', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toMatch(/--skip-discuss/);
    expect(output).toMatch(/deferred|discretion/i);
  });

  it('contains phase slug footer (e.g., "03-core-orchestrator")', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain('03-core-orchestrator');
  });

  it('contains empty Deferred Ideas section', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain('<deferred>');
    expect(output).toContain('</deferred>');
    expect(output).toMatch(/None|skipped/i);
  });

  it('contains all expected CONTEXT.md template sections', () => {
    const output = generateSkipDiscussContext(phase);
    expect(output).toContain('<domain>');
    expect(output).toContain('</domain>');
    expect(output).toContain('<decisions>');
    expect(output).toContain('</decisions>');
    expect(output).toContain('<specifics>');
    expect(output).toContain('</specifics>');
    expect(output).toContain('<deferred>');
    expect(output).toContain('</deferred>');
  });

  it('correctly formats single-digit phase numbers with zero padding in footer', () => {
    const p: PhaseInfo = { number: 5, name: 'React Dashboard' };
    const output = generateSkipDiscussContext(p);
    expect(output).toContain('05-react-dashboard');
  });

  it('correctly formats double-digit phase numbers without extra padding', () => {
    const p: PhaseInfo = { number: 12, name: 'Final Polish' };
    const output = generateSkipDiscussContext(p);
    expect(output).toContain('12-final-polish');
  });
});

describe('writeSkipDiscussContext', () => {
  let mockWriteFile: ReturnType<typeof vi.fn>;
  let mockMkdir: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.restoreAllMocks();

    // Re-import to get fresh mocks
    const fsMod = await import('node:fs/promises');
    mockWriteFile = fsMod.writeFile as unknown as ReturnType<typeof vi.fn>;
    mockMkdir = fsMod.mkdir as unknown as ReturnType<typeof vi.fn>;

    // Freeze date
    vi.spyOn(globalThis, 'Date').mockImplementation(
      () => new Date('2026-02-15T12:00:00Z') as unknown as Date,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the file to the correct phase directory path', async () => {
    const phase: PhaseInfo = { number: 3, name: 'Core Orchestrator' };
    const filePath = await writeSkipDiscussContext('/project', phase);

    // Should construct path: /project/.planning/phases/03-core-orchestrator/03-CONTEXT.md
    expect(filePath).toContain('03-core-orchestrator');
    expect(filePath).toContain('03-CONTEXT.md');
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('creates directory if needed before writing', async () => {
    const phase: PhaseInfo = { number: 7, name: 'CLI Polish' };
    await writeSkipDiscussContext('/project', phase);

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('07-cli-polish'),
      { recursive: true },
    );
  });

  it('returns the file path that was written', async () => {
    const phase: PhaseInfo = { number: 1, name: 'Foundation' };
    const result = await writeSkipDiscussContext('/project', phase);

    expect(typeof result).toBe('string');
    expect(result).toContain('01-CONTEXT.md');
  });
});
