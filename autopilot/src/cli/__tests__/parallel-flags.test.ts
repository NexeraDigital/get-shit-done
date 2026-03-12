import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_PATH = join(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');

/**
 * Tests for --parallel and --concurrency CLI flags.
 *
 * We test via `--help` output since the CLI is a monolithic commander program.
 * This validates that the flags are registered and documented.
 */
describe('CLI --parallel and --concurrency flags', () => {
  let helpOutput: string;

  // Capture help output once for all tests
  try {
    helpOutput = execFileSync(process.execPath, [CLI_PATH, '--help'], {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch (err: any) {
    // Commander exits with code 0 for --help, but execFileSync may throw
    helpOutput = err.stdout ?? '';
  }

  it('--parallel flag appears in help output', () => {
    expect(helpOutput).toContain('--parallel');
  });

  it('--parallel has correct description', () => {
    expect(helpOutput).toContain('Run phases in parallel using git worktrees');
  });

  it('--concurrency flag appears in help output', () => {
    expect(helpOutput).toContain('--concurrency');
  });

  it('--concurrency has correct description mentioning default 3', () => {
    expect(helpOutput).toContain('Max concurrent workers');
    expect(helpOutput).toMatch(/default.*3/i);
  });

  it('help text includes parallel usage examples', () => {
    expect(helpOutput).toContain('--parallel');
    expect(helpOutput).toMatch(/--parallel\s+--concurrency\s+\d+/);
  });

  it('--parallel is a boolean flag (no argument placeholder in help)', () => {
    // Boolean flags in commander show as "--parallel" without angle brackets
    // Non-boolean flags show as "--concurrency <n>"
    // Check that --parallel line does NOT have <...> argument
    const parallelLine = helpOutput.split('\n').find(l => l.includes('--parallel') && l.includes('Run phases'));
    expect(parallelLine).toBeDefined();
    expect(parallelLine).not.toMatch(/--parallel\s+<[^>]+>/);
  });

  it('--concurrency takes a numeric argument', () => {
    // Should show as "--concurrency <n>" in help
    expect(helpOutput).toMatch(/--concurrency\s+<\w+>/);
  });
});
