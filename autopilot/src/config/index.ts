// Config loader with precedence chain: CLI > env > file > defaults
// Implements requirement CLI-12

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AutopilotConfigSchema } from '../types/index.js';
import type { AutopilotConfig } from '../types/index.js';

const CONFIG_FILENAME = '.gsd-autopilot.json';
const ENV_PREFIX = 'GSD_AUTOPILOT_';

/**
 * Convert UPPER_SNAKE_CASE key (after prefix strip) to camelCase.
 * Example: WEBHOOK_URL -> webhookUrl, SKIP_DISCUSS -> skipDiscuss
 */
function snakeToCamel(key: string): string {
  return key
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Coerce string values to appropriate JS types.
 * - "true"/"false" -> boolean
 * - numeric strings -> number
 * - everything else -> string
 */
function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

/**
 * Extract GSD_AUTOPILOT_* environment variables, strip prefix,
 * convert to camelCase, and coerce types.
 */
function loadEnvVars(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(ENV_PREFIX) && value !== undefined) {
      const stripped = key.slice(ENV_PREFIX.length);
      const camelKey = snakeToCamel(stripped);
      result[camelKey] = coerceValue(value);
    }
  }
  return result;
}

/**
 * Try to read and parse the config file from projectDir.
 * Returns parsed object or empty object if file not found.
 * Throws clear error for invalid JSON.
 */
async function loadConfigFile(
  projectDir: string,
): Promise<Record<string, unknown>> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    // ENOENT = file not found -> not an error, use defaults
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return {};
    }
    throw err;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Invalid config file at ${configPath}: file contains malformed JSON`,
    );
  }
}

/**
 * Load configuration with precedence: CLI flags > env vars > config file > derived defaults > Zod defaults.
 *
 * @param projectDir - Project root directory containing .gsd-autopilot.json
 * @param cliFlags - CLI flag overrides (partial config)
 * @param derivedDefaults - Derived defaults (e.g. port from git repo identity), below file/env/CLI
 * @returns Validated AutopilotConfig
 */
export async function loadConfig(
  projectDir: string,
  cliFlags: Partial<AutopilotConfig>,
  derivedDefaults?: Partial<AutopilotConfig>,
): Promise<AutopilotConfig> {
  // 1. Load from config file (may be empty if no file)
  const fileConfig = await loadConfigFile(projectDir);

  // 2. Load from environment variables
  const envConfig = loadEnvVars();

  // 3. Merge with precedence: derived < file < env < CLI
  const merged = { ...derivedDefaults, ...fileConfig, ...envConfig, ...cliFlags };

  // 4. Validate with Zod safeParse (user-facing input)
  const result = AutopilotConfigSchema.safeParse(merged);

  if (!result.success) {
    // Format field-level errors into a clear message
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  return result.data;
}
