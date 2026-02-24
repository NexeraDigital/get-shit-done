// Launcher for gsd-autopilot slash command
// Main entry point that routes subcommands and manages background autopilot process
// Pure JavaScript (not TypeScript) - runs directly from ~/.claude/skills/

const CLI_PATH = '__CLI_PATH__';

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { request } from 'node:http';
import { assignPort } from './port-manager.js';
import { writePid, readPid, isProcessRunning, stopProcess, cleanupPid } from './pid-manager.js';

/**
 * Main entry point
 * Usage: node launcher.js <branch> [subcommand|args...]
 */
async function main() {
  const branch = process.argv[2];
  const projectDir = process.cwd();

  if (!branch) {
    console.error('Error: Branch name required');
    console.error('Usage: node launcher.js <branch> [subcommand|args...]');
    process.exit(1);
  }

  const subcommandOrArg = process.argv[3];

  // Route to appropriate handler
  if (subcommandOrArg === 'status') {
    await handleStatus(branch, projectDir);
  } else if (subcommandOrArg === 'stop') {
    await handleStop(branch, projectDir);
  } else {
    // Everything else goes to launch (including no args, --prd, --resume, etc.)
    const remainingArgs = process.argv.slice(3);
    await handleLaunch(branch, projectDir, remainingArgs);
  }
}

/**
 * Handle launch subcommand (or default action)
 * Spawns autopilot as detached background process
 */
async function handleLaunch(branch, projectDir, args) {
  // 1. Check if already running
  const existingPid = await readPid(branch, projectDir);
  if (existingPid && isProcessRunning(existingPid)) {
    // Read port from state file to show dashboard URL
    const stateFilePath = join(projectDir, '.planning', 'autopilot-state.json');
    let port = 3847; // default
    try {
      const stateContent = await readFile(stateFilePath, 'utf-8');
      const state = JSON.parse(stateContent);
      port = state.branches?.[branch]?.port ?? 3847;
    } catch {
      // State file doesn't exist or invalid - use default port
    }

    console.log(`Autopilot already running for branch '${branch}' on port ${port}`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`PID: ${existingPid}`);
    return;
  }

  // 2. Detect resume vs fresh: check for existing ROADMAP.md
  const roadmapPath = join(projectDir, '.planning', 'ROADMAP.md');
  let hasRoadmap = false;
  try {
    await readFile(roadmapPath, 'utf-8');
    hasRoadmap = true;
  } catch {
    // ROADMAP.md doesn't exist
  }

  // If no ROADMAP and no --prd in args, prompt for PRD path
  const hasPrdArg = args.some(arg => arg === '--prd' || arg.startsWith('--prd='));
  if (!hasRoadmap && !hasPrdArg) {
    console.log('No existing planning found (.planning/ROADMAP.md)');
    const prdPath = await promptForPrdPath();
    args.push('--prd', prdPath);
  }

  // 3. Assign port
  const port = await assignPort(branch, projectDir);

  // 4. Build spawn args
  const spawnArgs = [CLI_PATH, '--port', String(port), ...args];

  // 5. Spawn in a visible cmd window using `start` (Windows built-in)
  // Write a temporary .cmd file to avoid quoting hell with nested cmd interpreters
  console.log(`Starting autopilot for branch '${branch}' on port ${port}...`);
  const cmdTitle = `GSD Autopilot [${branch}] :${port}`;
  const batContent = `@title ${cmdTitle}\n@"${process.execPath}" ${spawnArgs.map(a => `"${a}"`).join(' ')}\n@pause\n`;
  const batPath = join(projectDir, '.planning', 'autopilot-run.cmd');
  await writeFile(batPath, batContent, 'utf-8');
  const child = spawn('start', ['""', batPath], {
    shell: true,
    stdio: 'ignore',
    cwd: projectDir,
    env: process.env,
  });
  child.unref();

  // 6. Write PID (the `start` wrapper exits immediately; read actual PID from
  //    the heartbeat file once the autopilot process writes it)
  // Write the shell PID as a fallback — the health check gives the process time to start
  await writePid(branch, child.pid, projectDir);

  // 7. Health check
  const healthCheckSuccess = await performHealthCheck(port);

  if (healthCheckSuccess) {
    console.log(`Autopilot started successfully (PID ${child.pid})`);
  } else {
    console.log(`Autopilot process started (PID ${child.pid}) but dashboard may take a moment to become available.`);
  }

  console.log(`Dashboard: http://localhost:${port}`);
}

/**
 * Handle status subcommand
 * Reports running state, phase progress, and dashboard URL
 */
async function handleStatus(branch, projectDir) {
  // 1. Check if process is running
  const pid = await readPid(branch, projectDir);
  if (!pid || !isProcessRunning(pid)) {
    console.log(`No autopilot running for branch '${branch}'`);
    return;
  }

  // 2. Read state file for progress
  const stateFilePath = join(projectDir, '.planning', 'autopilot-state.json');
  let status = 'unknown';
  let currentPhase = 0;
  let totalPhases = 0;
  let progress = 0;
  let port = 3847;

  try {
    const stateContent = await readFile(stateFilePath, 'utf-8');
    const state = JSON.parse(stateContent);

    status = state.status ?? 'unknown';
    currentPhase = state.currentPhase ?? 0;
    totalPhases = state.phases?.length ?? 0;

    // Compute progress: count completed phases
    const completedPhases = state.phases?.filter(p => p.status === 'completed').length ?? 0;
    progress = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0;

    // Get port from branches
    port = state.branches?.[branch]?.port ?? 3847;
  } catch (err) {
    // State file doesn't exist or invalid
    console.log(`Autopilot Status (${branch})`);
    console.log(`Status: running (no state file yet)`);
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`PID: ${pid}`);
    return;
  }

  // 4. Print formatted status
  console.log(`Autopilot Status (${branch})`);
  console.log(`Status: ${status}`);
  console.log(`Phase:  ${currentPhase}/${totalPhases}`);
  console.log(`Progress: ${progress}%`);
  console.log(`Dashboard: http://localhost:${port}`);
  console.log(`PID: ${pid}`);
}

/**
 * Handle stop subcommand
 * Sends SIGTERM, waits, then SIGKILL if needed
 */
async function handleStop(branch, projectDir) {
  // 1. Read PID
  const pid = await readPid(branch, projectDir);
  if (!pid || !isProcessRunning(pid)) {
    console.log(`No autopilot running for branch '${branch}'`);
    return;
  }

  // 2. Stop process
  console.log(`Stopping autopilot for branch '${branch}'...`);
  const result = await stopProcess(pid);

  // 3. Report result
  if (result.status === 'not_running') {
    console.log(`Autopilot was not running`);
  } else if (result.graceful) {
    console.log(`Autopilot stopped gracefully.`);
  } else {
    console.log(`Autopilot force-stopped after timeout.`);
  }

  // 4. Clean up PID file
  await cleanupPid(branch, projectDir);
}

/**
 * Prompt user for PRD path using readline
 * @returns {Promise<string>} Path entered by user
 */
function promptForPrdPath() {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Enter path to PRD document: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Perform health check on dashboard server
 * Retries 3 times with 1-second delays
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if health check succeeds
 */
async function performHealthCheck(port) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Wait 1 second before each attempt
    await new Promise(resolve => setTimeout(resolve, 1000));

    const success = await checkHealth(port);
    if (success) {
      return true;
    }
  }
  return false;
}

/**
 * Single health check attempt
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if responds successfully
 */
function checkHealth(port) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/health',
      method: 'GET',
      timeout: 2000,
    };

    const req = request(options, (res) => {
      // Any response (even error codes) means server is up
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => {
      // Connection refused or timeout - server not ready yet
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Run main
main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
