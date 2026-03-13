// Git worktree lifecycle functions for parallel phase execution.
// Each function is pure and independently testable.
// Uses execFile (NOT exec) for Windows path safety per project pattern.

import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';

/**
 * Promisified wrapper around child_process.execFile for git commands.
 * Returns trimmed stdout on success, rejects on non-zero exit.
 */
export function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Compute the worktree path for a given phase.
 * Pattern: ../{repo}-worktrees/phase-{N}/
 */
function worktreePath(projectDir: string, phaseNumber: number): string {
  const repoName = basename(resolve(projectDir));
  return resolve(projectDir, '..', `${repoName}-worktrees`, `phase-${phaseNumber}`);
}

/**
 * Compute the branch name for a given phase.
 * Pattern: gsd/phase-{N}
 */
export function branchName(phaseNumber: number): string {
  return `gsd/phase-${phaseNumber}`;
}

/**
 * Create a git worktree at ../{repo}-worktrees/phase-{N}/ on branch gsd/phase-{N}.
 * The branch is created from the current HEAD.
 * Returns the absolute path to the worktree directory.
 */
export async function createWorktree(projectDir: string, phaseNumber: number): Promise<string> {
  const wtPath = worktreePath(projectDir, phaseNumber);
  const branch = branchName(phaseNumber);

  await execGit(projectDir, ['worktree', 'add', '-b', branch, wtPath]);
  return wtPath;
}

/**
 * Merge the worktree branch back to the current branch from projectDir.
 * Returns true on success, false on merge conflict.
 * Per CONTEXT.md: merge from main repo cwd, not from within the worktree.
 */
export async function mergeWorktree(projectDir: string, phaseNumber: number): Promise<boolean> {
  const branch = branchName(phaseNumber);
  try {
    await execGit(projectDir, ['merge', branch, '--no-edit']);
    return true;
  } catch {
    return false; // Conflict -- Phase 3 handles auto-resolution
  }
}

/**
 * Remove the worktree and delete the branch.
 * Uses --force to handle locked worktrees (per RESEARCH.md pitfall 5).
 */
export async function cleanupWorktree(projectDir: string, phaseNumber: number): Promise<void> {
  const wtPath = worktreePath(projectDir, phaseNumber);
  const branch = branchName(phaseNumber);

  await execGit(projectDir, ['worktree', 'remove', wtPath, '--force']);
  await execGit(projectDir, ['branch', '-d', branch]);
}

/**
 * Clean up stale worktree/branch from crashed runs before creating fresh ones.
 * Idempotent: no error if nothing to clean.
 * Per RESEARCH.md pitfall 1: handles stale branches/worktrees from previous runs.
 */
export async function ensureCleanWorktree(projectDir: string, phaseNumber: number): Promise<void> {
  const wtPath = worktreePath(projectDir, phaseNumber);
  const branch = branchName(phaseNumber);

  // Remove existing worktree directory (may not exist -- that's fine)
  try {
    await execGit(projectDir, ['worktree', 'remove', wtPath, '--force']);
  } catch { /* Not found -- OK */ }

  // Check if branch exists before attempting cleanup
  let branchExists = false;
  try {
    await execGit(projectDir, ['rev-parse', '--verify', branch]);
    branchExists = true;
  } catch { /* Branch doesn't exist -- nothing to clean */ }

  if (branchExists) {
    // Check if branch is already merged into HEAD
    let isMerged = false;
    try {
      const merged = await execGit(projectDir, ['branch', '--merged', 'HEAD']);
      isMerged = merged.split('\n').some(b => b.trim() === branch);
    } catch { /* Assume not merged */ }

    if (!isMerged) {
      // Branch has unmerged work — attempt to merge it before deleting
      try {
        await execGit(projectDir, ['merge', branch, '--no-edit']);
      } catch {
        // Merge conflict — abort merge, then force-merge with --theirs strategy
        try { await execGit(projectDir, ['merge', '--abort']); } catch { /* clean state */ }
        // Use merge with theirs strategy to preserve the branch work
        try {
          await execGit(projectDir, ['merge', '-X', 'theirs', branch, '--no-edit']);
        } catch {
          // Last resort: abort and leave branch for manual recovery
          try { await execGit(projectDir, ['merge', '--abort']); } catch { /* already clean */ }
          throw new Error(
            `Cannot safely clean worktree for phase ${phaseNumber}: ` +
            `branch ${branch} has unmerged commits. Resolve manually.`
          );
        }
      }
    }

    // Branch is now merged (or was already) — safe to delete
    try {
      await execGit(projectDir, ['branch', '-d', branch]);
    } catch { /* Already deleted or other issue */ }
  }

  // Prune stale worktree entries from .git/worktrees
  await execGit(projectDir, ['worktree', 'prune']);
}
