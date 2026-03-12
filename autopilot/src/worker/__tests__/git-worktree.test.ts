import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createWorktree,
  mergeWorktree,
  cleanupWorktree,
  ensureCleanWorktree,
  execGit,
} from '../git-worktree.js';

const execFileAsync = promisify(execFileCb);

let testDir: string;
let repoDir: string;

/**
 * Creates a temporary directory with a git repo initialized inside it.
 * Structure: testDir/test-repo/ (the git repo)
 */
async function setupTestRepo(): Promise<void> {
  testDir = await mkdtemp(join(tmpdir(), 'gsd-worktree-'));
  repoDir = join(testDir, 'test-repo');

  // Create the repo directory and initialize git
  await execFileAsync('git', ['init', repoDir]);
  await execFileAsync('git', ['-C', repoDir, 'config', 'user.email', 'test@test.com']);
  await execFileAsync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);

  // Create an initial commit so we have a HEAD
  await writeFile(join(repoDir, 'README.md'), '# Test Repo\n');
  await execFileAsync('git', ['-C', repoDir, 'add', '.']);
  await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'initial commit']);
}

beforeEach(async () => {
  await setupTestRepo();
});

afterEach(async () => {
  // Clean up worktrees first to avoid git lock issues
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain']);
    // Only attempt removal of non-bare worktrees
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.startsWith('worktree ') && !line.includes(repoDir.replace(/\\/g, '/'))) {
        const wtPath = line.replace('worktree ', '');
        try {
          await execFileAsync('git', ['-C', repoDir, 'worktree', 'remove', wtPath, '--force']);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  await rm(testDir, { recursive: true, force: true });
});

describe('execGit', () => {
  it('runs a git command and returns stdout', async () => {
    const result = await execGit(repoDir, ['rev-parse', '--is-inside-work-tree']);
    expect(result).toBe('true');
  });

  it('rejects on invalid git command', async () => {
    await expect(execGit(repoDir, ['not-a-real-command'])).rejects.toThrow();
  });
});

describe('createWorktree', () => {
  it('creates a worktree at the expected path', async () => {
    const wtPath = await createWorktree(repoDir, 1);
    expect(wtPath).toContain('test-repo-worktrees');
    expect(wtPath).toContain('phase-1');

    // Verify the directory was created by checking git worktree list
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list']);
    expect(stdout).toContain('phase-1');
  });

  it('creates a branch named gsd/phase-{N}', async () => {
    await createWorktree(repoDir, 3);

    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'branch', '--list', 'gsd/phase-3']);
    expect(stdout.trim()).toContain('gsd/phase-3');
  });

  it('places the worktree adjacent to the repo (../{repo}-worktrees/)', async () => {
    const wtPath = await createWorktree(repoDir, 2);

    // Worktree should be at testDir/test-repo-worktrees/phase-2/
    const expectedParent = join(testDir, 'test-repo-worktrees');
    expect(wtPath.replace(/\\/g, '/')).toContain(expectedParent.replace(/\\/g, '/'));
  });
});

describe('mergeWorktree', () => {
  it('merges worktree branch changes back to main', async () => {
    const wtPath = await createWorktree(repoDir, 1);

    // Make a change in the worktree
    await writeFile(join(wtPath, 'new-file.txt'), 'from worktree\n');
    await execFileAsync('git', ['-C', wtPath, 'add', '.']);
    await execFileAsync('git', ['-C', wtPath, 'commit', '-m', 'worktree change']);

    // Merge back
    const success = await mergeWorktree(repoDir, 1);
    expect(success).toBe(true);

    // Verify the change is on main
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'log', '--oneline']);
    expect(stdout).toContain('worktree change');
  });

  it('returns false on merge conflict', async () => {
    const wtPath = await createWorktree(repoDir, 1);

    // Make conflicting changes in both main and worktree
    await writeFile(join(repoDir, 'conflict.txt'), 'main version\n');
    await execFileAsync('git', ['-C', repoDir, 'add', '.']);
    await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'main change']);

    await writeFile(join(wtPath, 'conflict.txt'), 'worktree version\n');
    await execFileAsync('git', ['-C', wtPath, 'add', '.']);
    await execFileAsync('git', ['-C', wtPath, 'commit', '-m', 'worktree change']);

    const success = await mergeWorktree(repoDir, 1);
    expect(success).toBe(false);

    // Abort the failed merge so cleanup works
    try {
      await execFileAsync('git', ['-C', repoDir, 'merge', '--abort']);
    } catch { /* ignore */ }
  });
});

describe('cleanupWorktree', () => {
  it('removes the worktree and deletes the branch', async () => {
    await createWorktree(repoDir, 1);
    await cleanupWorktree(repoDir, 1);

    // Verify worktree is gone
    const { stdout: wtList } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list']);
    expect(wtList).not.toContain('phase-1');

    // Verify branch is gone
    const { stdout: brList } = await execFileAsync('git', ['-C', repoDir, 'branch', '--list', 'gsd/phase-1']);
    expect(brList.trim()).toBe('');
  });
});

describe('ensureCleanWorktree', () => {
  it('is idempotent when no stale worktree exists', async () => {
    // Should not throw when nothing to clean
    await expect(ensureCleanWorktree(repoDir, 99)).resolves.toBeUndefined();
  });

  it('cleans up stale worktree and branch before creating fresh', async () => {
    // Create a worktree (simulating a stale one from a crashed run)
    await createWorktree(repoDir, 5);

    // Verify stale worktree exists
    const { stdout: before } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list']);
    expect(before).toContain('phase-5');

    // ensureClean should remove it
    await ensureCleanWorktree(repoDir, 5);

    // Verify worktree is gone
    const { stdout: after } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list']);
    expect(after).not.toContain('phase-5');

    // Verify branch is gone
    const { stdout: brList } = await execFileAsync('git', ['-C', repoDir, 'branch', '--list', 'gsd/phase-5']);
    expect(brList.trim()).toBe('');
  });

  it('handles stale branch without worktree', async () => {
    // Create just a branch (no worktree) -- simulating partial cleanup
    await execFileAsync('git', ['-C', repoDir, 'branch', 'gsd/phase-7']);

    await ensureCleanWorktree(repoDir, 7);

    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'branch', '--list', 'gsd/phase-7']);
    expect(stdout.trim()).toBe('');
  });
});

describe('full lifecycle', () => {
  it('ensureClean -> create -> merge -> cleanup', async () => {
    // 1. Ensure clean (nothing to clean)
    await ensureCleanWorktree(repoDir, 1);

    // 2. Create worktree
    const wtPath = await createWorktree(repoDir, 1);

    // 3. Make a change in worktree
    await writeFile(join(wtPath, 'lifecycle.txt'), 'lifecycle test\n');
    await execFileAsync('git', ['-C', wtPath, 'add', '.']);
    await execFileAsync('git', ['-C', wtPath, 'commit', '-m', 'lifecycle commit']);

    // 4. Merge back
    const merged = await mergeWorktree(repoDir, 1);
    expect(merged).toBe(true);

    // 5. Cleanup
    await cleanupWorktree(repoDir, 1);

    // 6. Verify everything is cleaned up
    const { stdout: wtList } = await execFileAsync('git', ['-C', repoDir, 'worktree', 'list']);
    expect(wtList).not.toContain('phase-1');

    const { stdout: brList } = await execFileAsync('git', ['-C', repoDir, 'branch', '--list', 'gsd/phase-1']);
    expect(brList.trim()).toBe('');

    // 7. Verify the merged commit is on main
    const { stdout: log } = await execFileAsync('git', ['-C', repoDir, 'log', '--oneline']);
    expect(log).toContain('lifecycle commit');
  });
});
