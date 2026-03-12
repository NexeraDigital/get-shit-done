// Merge conflict auto-resolution and reporting for parallel phase execution.
// Uses --theirs strategy (prefer phase branch work) per RESEARCH.md recommendation.
// Uses execFile (NOT exec) for Windows path safety per project pattern.

import { execGit } from './git-worktree.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileResolution {
  file: string;
  strategy: 'theirs' | 'ours';
  outcome: 'resolved' | 'failed';
}

export interface MergeReport {
  phaseNumber: number;
  files: FileResolution[];
  timestamp: string;
  success: boolean;
  priorContext?: string; // Summary of prior resolution strategies
}

/**
 * Detect conflicting files and auto-resolve them using --theirs strategy.
 * If resolution fails partway, aborts the merge to clean up state.
 *
 * @param projectDir - Root directory of the git repo (in merge-conflict state)
 * @param phaseNumber - Phase number for the report
 * @param priorReports - Previous merge reports for context documentation
 * @returns MergeReport documenting all resolutions
 */
export async function resolveConflicts(
  projectDir: string,
  phaseNumber: number,
  priorReports: MergeReport[],
): Promise<MergeReport> {
  const timestamp = new Date().toISOString();

  // Build prior context summary
  const priorContext = priorReports.length > 0
    ? priorReports
        .map(r => `Phase ${r.phaseNumber} resolved ${r.files.length} files with ${r.files[0]?.strategy ?? 'theirs'} strategy.`)
        .join(' ')
    : undefined;

  // Detect conflicting files
  let conflictOutput: string;
  try {
    conflictOutput = await execGit(projectDir, ['diff', '--name-only', '--diff-filter=U']);
  } catch {
    // No conflicts or not in merge state
    conflictOutput = '';
  }

  const conflictFiles = conflictOutput
    .split('\n')
    .map(f => f.trim())
    .filter(f => f.length > 0);

  // No conflicts -- return success with empty file list
  if (conflictFiles.length === 0) {
    return {
      phaseNumber,
      files: [],
      timestamp,
      success: true,
      priorContext,
    };
  }

  // Resolve each conflicting file
  const files: FileResolution[] = [];

  try {
    for (const file of conflictFiles) {
      try {
        await execGit(projectDir, ['checkout', '--theirs', '--', file]);
        await execGit(projectDir, ['add', file]);
        files.push({ file, strategy: 'theirs', outcome: 'resolved' });
      } catch {
        files.push({ file, strategy: 'theirs', outcome: 'failed' });
        throw new Error(`Failed to resolve conflict for ${file}`);
      }
    }

    // All files resolved -- complete the merge commit
    // Use `git commit --no-edit` as it's more portable than `git merge --continue`
    await execGit(projectDir, ['-c', 'core.editor=true', 'commit', '--no-edit']);

    return {
      phaseNumber,
      files,
      timestamp,
      success: true,
      priorContext,
    };
  } catch (err) {
    // Resolution failed -- abort merge to clean up
    try {
      await execGit(projectDir, ['merge', '--abort']);
    } catch { /* merge state may already be clean */ }

    return {
      phaseNumber,
      files,
      timestamp,
      success: false,
      priorContext,
    };
  }
}

/**
 * Write a structured markdown merge report to the specified phase directory.
 * Creates the directory if it does not exist.
 */
export async function writeMergeReport(
  phaseDir: string,
  report: MergeReport,
): Promise<void> {
  await mkdir(phaseDir, { recursive: true });

  const lines: string[] = [
    `# Merge Report`,
    ``,
    `**Phase:** ${report.phaseNumber}`,
    `**Timestamp:** ${report.timestamp}`,
    `**Success:** ${report.success}`,
    `**Files resolved:** ${report.files.length}`,
    ``,
  ];

  if (report.files.length > 0) {
    lines.push(`## Resolved Files`);
    lines.push(``);
    lines.push(`| File | Strategy | Outcome |`);
    lines.push(`|------|----------|---------|`);
    for (const f of report.files) {
      lines.push(`| ${f.file} | ${f.strategy} | ${f.outcome} |`);
    }
    lines.push(``);
  }

  if (report.priorContext) {
    lines.push(`## Prior Context`);
    lines.push(``);
    lines.push(report.priorContext);
    lines.push(``);
  }

  await writeFile(join(phaseDir, 'merge-report.md'), lines.join('\n'), 'utf-8');
}
