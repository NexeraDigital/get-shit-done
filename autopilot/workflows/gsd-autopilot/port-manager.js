// Port manager for deterministic branch-to-port assignment
// Pure JavaScript (not TypeScript) - runs directly from ~/.claude/skills/

import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_PORT = 3847;
const PORT_RANGE = 1000;

/**
 * Pure function: deterministically maps branch name to port number
 * Same branch name always produces same port
 * @param {string} branchName - Git branch name
 * @returns {number} Port number in range [3847, 4846]
 */
export function branchToPort(branchName) {
  // SHA-256 hash of branch name
  const hash = createHash('sha256')
    .update(branchName)
    .digest('hex');

  // Take first 8 hex characters and convert to integer
  const numericHash = parseInt(hash.slice(0, 8), 16);

  // Map to port range [BASE_PORT, BASE_PORT + PORT_RANGE)
  return BASE_PORT + (numericHash % PORT_RANGE);
}

/**
 * Async function: check if a port is available for binding
 * @param {number} port - Port number to check
 * @returns {Promise<boolean>} True if available, false if in use or error
 */
export async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();

    // Any error (EADDRINUSE, EACCES, etc.) means port not available
    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      // Port is available, close the test server
      server.close();
      resolve(true);
    });

    // Try to bind to the port on localhost
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Main entry point: assign a port to a branch with persistence and collision detection
 *
 * Algorithm:
 * 1. Check if branch has persisted port in state file - reuse if available
 * 2. Otherwise, compute deterministic port from branch name hash
 * 3. If that port is unavailable, increment until finding free port
 * 4. Persist assigned port to state file
 * 5. Return port number
 *
 * @param {string} branch - Git branch name
 * @param {string} projectDir - Project root directory (contains .planning/)
 * @returns {Promise<number>} Assigned port number
 * @throws {Error} If no ports available in range
 */
export async function assignPort(branch, projectDir) {
  const stateFilePath = join(projectDir, '.planning', 'autopilot-state.json');

  // Step 1: Try to read persisted port from state file
  let state = { branches: {} };
  try {
    const stateContent = await readFile(stateFilePath, 'utf-8');
    state = JSON.parse(stateContent);
    state.branches = state.branches || {};

    // Check if branch has persisted port
    if (state.branches[branch]?.port) {
      const persistedPort = state.branches[branch].port;

      // Verify port is still available
      if (await isPortAvailable(persistedPort)) {
        return persistedPort;
      }
      // Port no longer available, fall through to find new port
    }
  } catch (err) {
    // State file doesn't exist or invalid JSON - fall through to create new
    state = { branches: {} };
  }

  // Step 2: Compute initial port from branch name hash
  let port = branchToPort(branch);

  // Step 3: Linear probing for collision detection
  const maxPort = BASE_PORT + PORT_RANGE;
  while (port < maxPort) {
    if (await isPortAvailable(port)) {
      // Found available port!
      break;
    }
    port++;
  }

  // Check if we exhausted the range
  if (port >= maxPort) {
    throw new Error(`No available ports in range [${BASE_PORT}, ${maxPort})`);
  }

  // Step 4: Persist assigned port to state file
  state.branches[branch] = {
    port,
    assignedAt: new Date().toISOString()
  };

  // Ensure .planning directory exists
  await mkdir(join(projectDir, '.planning'), { recursive: true });

  // Write state file atomically
  await writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');

  // Step 5: Return assigned port
  return port;
}
