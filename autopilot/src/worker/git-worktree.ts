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

  // Try removing existing worktree (may not exist -- that's fine)
  try {
    await execGit(projectDir, ['worktree', 'remove', wtPath, '--force']);
  } catch { /* Not found -- OK */ }

  // Try deleting existing branch (force delete to handle unmerged branches)
  try {
    await execGit(projectDir, ['branch', '-D', branch]);
  } catch { /* Not found -- OK */ }

  // Prune stale worktree entries from .git/worktrees
  await execGit(projectDir, ['worktree', 'prune']);
}
