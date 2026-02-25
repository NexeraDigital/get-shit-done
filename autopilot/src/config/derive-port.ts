// Derive a deterministic dashboard port from git repo identity (root commit + branch).
// This ensures multiple autopilot instances across repos don't compete for the same port.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT_MIN = 10000;
const PORT_RANGE = 50000; // 10000–59999

/**
 * Derive a stable port number from the git repo's root commit SHA + current branch.
 * Falls back to hashing the projectDir path for non-git directories.
 */
export async function derivePort(projectDir: string): Promise<number> {
  let hashInput: string;
  try {
    const { stdout: roots } = await execFileAsync(
      'git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: projectDir });
    const { stdout: branch } = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir });
    const rootSha = roots.split('\n')[0]?.trim() ?? '';
    hashInput = `${rootSha}:${branch.trim()}`;
  } catch {
    hashInput = projectDir; // non-git or no commits fallback
  }
  const hash = createHash('sha256').update(hashInput).digest();
  return PORT_MIN + (hash.readUInt32BE(0) % PORT_RANGE);
}
