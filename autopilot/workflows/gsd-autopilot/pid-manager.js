// PID manager for per-branch autopilot process tracking
// Pure JavaScript (not TypeScript) - runs directly from ~/.claude/skills/

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Sanitize branch name for use in filename
 * Replaces all / with -- to ensure valid filenames on all platforms
 * @param {string} branch - Git branch name
 * @returns {string} Sanitized branch name
 */
function sanitizeBranchName(branch) {
  return branch.replace(/\//g, '--');
}

/**
 * Write PID to branch-specific .pid file
 * @param {string} branch - Git branch name
 * @param {number} pid - Process ID to write
 * @param {string} projectDir - Project root directory (contains .planning/)
 * @returns {Promise<void>}
 */
export async function writePid(branch, pid, projectDir) {
  const sanitized = sanitizeBranchName(branch);
  const pidFilePath = join(projectDir, '.planning', `autopilot-${sanitized}.pid`);
  await writeFile(pidFilePath, String(pid), 'utf-8');
}

/**
 * Read PID from branch-specific .pid file
 * @param {string} branch - Git branch name
 * @param {string} projectDir - Project root directory (contains .planning/)
 * @returns {Promise<number|null>} PID as integer, or null if file doesn't exist
 */
export async function readPid(branch, projectDir) {
  const sanitized = sanitizeBranchName(branch);
  const pidFilePath = join(projectDir, '.planning', `autopilot-${sanitized}.pid`);

  try {
    const content = await readFile(pidFilePath, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch (err) {
    // File doesn't exist or can't be read
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Check if a process with given PID is running
 * Uses process.kill(pid, 0) signal check (no actual signal sent)
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process is running, false otherwise
 */
export function isProcessRunning(pid) {
  try {
    // Signal 0 is a special case - tests existence without sending a signal
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      // No such process
      return false;
    }
    if (err.code === 'EPERM') {
      // Process exists but we don't have permission to signal it
      // For our purposes, this means it's running
      return true;
    }
    // Other errors should be thrown
    throw err;
  }
}

/**
 * Stop a process, first gracefully (SIGTERM), then forcefully (SIGKILL) after timeout
 * @param {number} pid - Process ID to stop
 * @param {number} timeoutMs - Milliseconds to wait for graceful shutdown (default: 5000)
 * @returns {Promise<{status: string, graceful?: boolean}>} Result object
 */
export async function stopProcess(pid, timeoutMs = 5000) {
  // Check if process is already dead
  if (!isProcessRunning(pid)) {
    return { status: 'not_running' };
  }

  // Send SIGTERM for graceful shutdown
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process died between our check and SIGTERM - that's fine
      return { status: 'stopped', graceful: true };
    }
    throw err;
  }

  // Poll every 100ms to see if process has exited
  const pollInterval = 100;
  const maxPolls = Math.ceil(timeoutMs / pollInterval);

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    if (!isProcessRunning(pid)) {
      return { status: 'stopped', graceful: true };
    }
  }

  // Timeout reached - force kill with SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process died just before SIGKILL - still counts as stopped
      return { status: 'stopped', graceful: false };
    }
    throw err;
  }

  return { status: 'stopped', graceful: false };
}

/**
 * Delete the .pid file for a branch
 * @param {string} branch - Git branch name
 * @param {string} projectDir - Project root directory (contains .planning/)
 * @returns {Promise<void>}
 */
export async function cleanupPid(branch, projectDir) {
  const sanitized = sanitizeBranchName(branch);
  const pidFilePath = join(projectDir, '.planning', `autopilot-${sanitized}.pid`);

  try {
    await unlink(pidFilePath);
  } catch (err) {
    // Swallow ENOENT - file already gone is success
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}
