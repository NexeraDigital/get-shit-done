import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import type { AutopilotConfig } from '../types/index.js';

const execFileAsync = promisify(execFile);

interface PreflightCheck {
  name: string;
  check: () => Promise<boolean>;
  error: string;
  fix: string;
}

export interface PreflightFailure {
  error: string;
  fix: string;
}

/**
 * Runs all preflight checks in parallel and returns failures.
 *
 * Validates:
 * 1. Claude CLI is installed
 * 2. PRD file exists (if prdPath provided)
 * 3. Port is available
 * 4. GSD workflows are installed
 *
 * @param config - Autopilot configuration
 * @param prdPath - Optional PRD file path to validate
 * @returns Array of failures (empty if all passed)
 */
export async function runPreflightChecks(
  config: AutopilotConfig,
  prdPath?: string,
): Promise<PreflightFailure[]> {
  const checks: PreflightCheck[] = [
    {
      name: 'claude-cli',
      check: async () => {
        try {
          await execFileAsync('claude', ['--version']);
          return true;
        } catch {
          return false;
        }
      },
      error: 'Claude CLI not found',
      fix: 'Install it: npm install -g @anthropic-ai/claude-code',
    },
    {
      name: 'port-available',
      check: async () => {
        return new Promise<boolean>((resolve) => {
          const server = createServer();

          server.once('listening', () => {
            server.close();
            resolve(true);
          });

          server.once('error', () => {
            resolve(false);
          });

          server.listen(config.port);
        });
      },
      error: `Port ${config.port} is already in use`,
      fix: 'Use --port <number> to specify a different port',
    },
    {
      name: 'gsd-installation',
      check: async () => {
        try {
          const gsdPath = join(homedir(), '.claude', 'get-shit-done');
          await access(gsdPath);
          return true;
        } catch {
          return false;
        }
      },
      error: 'GSD workflows not found',
      fix: 'Install GSD: npm install -g get-shit-done-cc',
    },
  ];

  // Add PRD file check if path provided
  if (prdPath) {
    checks.push({
      name: 'prd-file',
      check: async () => {
        try {
          await access(resolve(prdPath));
          return true;
        } catch {
          return false;
        }
      },
      error: `PRD file not found: ${prdPath}`,
      fix: 'Check the path and try again, or use --resume to continue a previous run',
    });
  }

  // Run all checks in parallel
  const results = await Promise.all(
    checks.map(async (check) => {
      const passed = await check.check();
      return { check, passed };
    }),
  );

  // Collect failures
  const failures: PreflightFailure[] = results
    .filter((r) => !r.passed)
    .map((r) => ({
      error: r.check.error,
      fix: r.check.fix,
    }));

  return failures;
}
