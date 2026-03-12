import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConflicts, writeMergeReport } from '../merge-resolver.js';
import type { MergeReport } from '../merge-resolver.js';
import { execGit } from '../git-worktree.js';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Helper: create a git repo with a merge conflict.
 * 1. Init repo, create a file, commit on main
 * 2. Create branch, modify file on branch, commit
 * 3. Switch to main, modify same file differently, commit
 * 4. Start merge (which will fail with conflict)
 * Returns the repo path (in merge-conflict state).
 */
async function createConflictRepo(
  fileCount = 1,
): Promise<{ repoDir: string; conflictFiles: string[] }> {
  const repoDir = await mkdtemp(join(tmpdir(), 'merge-test-'));
  await execGit(repoDir, ['init', '--initial-branch=main']);
  await execGit(repoDir, ['config', 'user.email', 'test@test.com']);
  await execGit(repoDir, ['config', 'user.name', 'Test']);

  const conflictFiles: string[] = [];

  for (let i = 0; i < fileCount; i++) {
    const filename = `file${i}.txt`;
    conflictFiles.push(filename);
    await writeFile(join(repoDir, filename), `original content ${i}\n`);
  }

  await execGit(repoDir, ['add', '.']);
  await execGit(repoDir, ['commit', '-m', 'initial']);

  // Create branch and modify files there
  await execGit(repoDir, ['checkout', '-b', 'feature']);
  for (const filename of conflictFiles) {
    await writeFile(join(repoDir, filename), `feature branch content\n`);
  }
  await execGit(repoDir, ['add', '.']);
  await execGit(repoDir, ['commit', '-m', 'feature changes']);

  // Switch back to main and make conflicting changes
  await execGit(repoDir, ['checkout', 'main']);
  for (const filename of conflictFiles) {
    await writeFile(join(repoDir, filename), `main branch content\n`);
  }
  await execGit(repoDir, ['add', '.']);
  await execGit(repoDir, ['commit', '-m', 'main changes']);

  // Start merge -- will fail with conflict
  try {
    await execGit(repoDir, ['merge', 'feature', '--no-edit']);
  } catch {
    // Expected: merge conflict
  }

  return { repoDir, conflictFiles };
}

/**
 * Helper: create a repo with NO merge conflict (clean merge).
 */
async function createCleanMergeRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'merge-clean-'));
  await execGit(repoDir, ['init', '--initial-branch=main']);
  await execGit(repoDir, ['config', 'user.email', 'test@test.com']);
  await execGit(repoDir, ['config', 'user.name', 'Test']);

  await writeFile(join(repoDir, 'file.txt'), 'original\n');
  await execGit(repoDir, ['add', '.']);
  await execGit(repoDir, ['commit', '-m', 'initial']);

  return repoDir;
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch { /* cleanup best-effort */ }
  }
  tempDirs = [];
});

describe('resolveConflicts()', () => {
  it('resolves a single file conflict with --theirs strategy', async () => {
    const { repoDir, conflictFiles } = await createConflictRepo(1);
    tempDirs.push(repoDir);

    const report = await resolveConflicts(repoDir, 1, []);

    expect(report.success).toBe(true);
    expect(report.phaseNumber).toBe(1);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]!.file).toBe(conflictFiles[0]);
    expect(report.files[0]!.strategy).toBe('theirs');
    expect(report.files[0]!.outcome).toBe('resolved');

    // Verify file content is from the feature branch (--theirs)
    const content = await readFile(join(repoDir, conflictFiles[0]!), 'utf-8');
    expect(content.trim()).toBe('feature branch content');
  });

  it('resolves multiple file conflicts', async () => {
    const { repoDir } = await createConflictRepo(3);
    tempDirs.push(repoDir);

    const report = await resolveConflicts(repoDir, 2, []);

    expect(report.success).toBe(true);
    expect(report.files).toHaveLength(3);
    expect(report.files.every(f => f.outcome === 'resolved')).toBe(true);
  });

  it('returns success with zero files when there are no conflicts', async () => {
    const repoDir = await createCleanMergeRepo();
    tempDirs.push(repoDir);

    const report = await resolveConflicts(repoDir, 3, []);

    expect(report.success).toBe(true);
    expect(report.files).toHaveLength(0);
    expect(report.phaseNumber).toBe(3);
  });

  it('includes timestamp in the report', async () => {
    const { repoDir } = await createConflictRepo(1);
    tempDirs.push(repoDir);

    const before = new Date().toISOString();
    const report = await resolveConflicts(repoDir, 1, []);
    const after = new Date().toISOString();

    expect(report.timestamp).toBeDefined();
    expect(report.timestamp >= before).toBe(true);
    expect(report.timestamp <= after).toBe(true);
  });

  it('includes priorContext summary when priorReports are provided', async () => {
    const { repoDir } = await createConflictRepo(1);
    tempDirs.push(repoDir);

    const priorReports: MergeReport[] = [
      {
        phaseNumber: 0,
        files: [{ file: 'old.txt', strategy: 'theirs', outcome: 'resolved' }],
        timestamp: new Date().toISOString(),
        success: true,
        priorContext: undefined,
      },
    ];

    const report = await resolveConflicts(repoDir, 1, priorReports);

    expect(report.success).toBe(true);
    expect(report.priorContext).toBeDefined();
    expect(report.priorContext).toContain('Phase 0');
  });
});

describe('writeMergeReport()', () => {
  it('writes valid markdown report to the specified directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-'));
    tempDirs.push(dir);

    const report: MergeReport = {
      phaseNumber: 5,
      files: [
        { file: 'src/main.ts', strategy: 'theirs', outcome: 'resolved' },
        { file: 'src/util.ts', strategy: 'theirs', outcome: 'resolved' },
      ],
      timestamp: '2026-03-12T12:00:00Z',
      success: true,
    };

    await writeMergeReport(dir, report);

    const content = await readFile(join(dir, 'merge-report.md'), 'utf-8');

    expect(content).toContain('# Merge Report');
    expect(content).toContain('**Phase:** 5');
    expect(content).toContain('2026-03-12T12:00:00Z');
    expect(content).toContain('src/main.ts');
    expect(content).toContain('src/util.ts');
    expect(content).toContain('theirs');
    expect(content).toContain('resolved');
  });

  it('includes prior context summary when available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-'));
    tempDirs.push(dir);

    const report: MergeReport = {
      phaseNumber: 3,
      files: [],
      timestamp: '2026-03-12T12:00:00Z',
      success: true,
      priorContext: 'Phase 1 resolved 2 files with theirs strategy.',
    };

    await writeMergeReport(dir, report);

    const content = await readFile(join(dir, 'merge-report.md'), 'utf-8');
    expect(content).toContain('Prior Context');
    expect(content).toContain('Phase 1 resolved 2 files');
  });

  it('creates the directory if it does not exist', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'report-'));
    const nestedDir = join(baseDir, 'nested', 'phase');
    tempDirs.push(baseDir);

    const report: MergeReport = {
      phaseNumber: 1,
      files: [],
      timestamp: '2026-03-12T12:00:00Z',
      success: true,
    };

    await writeMergeReport(nestedDir, report);

    const content = await readFile(join(nestedDir, 'merge-report.md'), 'utf-8');
    expect(content).toContain('# Merge Report');
  });
});
