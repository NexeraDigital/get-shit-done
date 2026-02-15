import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Import the function under test (will fail until implementation exists)
import { loadConfig } from '../index.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gsd-config-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  let projectDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    projectDir = makeTmpDir();
    // Clear any GSD_AUTOPILOT_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GSD_AUTOPILOT_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GSD_AUTOPILOT_')) {
        delete process.env[key];
      }
    }
    // Clean up tmp dir
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Test 1: No file, no env -> returns all defaults
  it('returns all defaults when no config file, env vars, or CLI flags', async () => {
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(3847);
    expect(config.depth).toBe('standard');
    expect(config.notify).toBe('console');
    expect(config.model).toBe('balanced');
    expect(config.skipDiscuss).toBe(false);
    expect(config.skipVerify).toBe(false);
    expect(config.verbose).toBe(false);
    expect(config.quiet).toBe(false);
  });

  // Test 2: Config file overrides defaults
  it('loads config from .gsd-autopilot.json and overrides defaults', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 4000 }),
    );
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(4000);
    // Other fields remain at defaults
    expect(config.depth).toBe('standard');
    expect(config.notify).toBe('console');
  });

  // Test 3: CLI flags override config file
  it('CLI flags override config file values', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 4000 }),
    );
    const config = await loadConfig(projectDir, { port: 5000 });
    expect(config.port).toBe(5000);
  });

  // Test 4: Env var overrides defaults
  it('env var GSD_AUTOPILOT_PORT overrides defaults', async () => {
    process.env['GSD_AUTOPILOT_PORT'] = '4000';
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(4000);
  });

  // Test 5: CLI flags override env vars
  it('CLI flags override env vars', async () => {
    process.env['GSD_AUTOPILOT_PORT'] = '4000';
    const config = await loadConfig(projectDir, { port: 5000 });
    expect(config.port).toBe(5000);
  });

  // Test 6: Env vars override config file
  it('env vars override config file values', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 3000 }),
    );
    process.env['GSD_AUTOPILOT_PORT'] = '4000';
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(4000);
  });

  // Test 7: Full precedence chain - CLI > env > file > defaults
  it('full precedence: CLI > env > file > defaults', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 3000 }),
    );
    process.env['GSD_AUTOPILOT_PORT'] = '4000';
    const config = await loadConfig(projectDir, { port: 5000 });
    expect(config.port).toBe(5000);
  });

  // Test 8: Invalid JSON in config file -> clear error
  it('throws clear error for invalid JSON in config file', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      '{ not valid json !!!',
    );
    await expect(loadConfig(projectDir, {})).rejects.toThrow(/Invalid config file/i);
  });

  // Test 9: Config file with invalid field type -> clear validation error
  it('throws clear validation error for invalid field types', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 'not-a-number' }),
    );
    await expect(loadConfig(projectDir, {})).rejects.toThrow(/port/i);
  });

  // Test 10: Boolean coercion from env var (true)
  it('coerces GSD_AUTOPILOT_SKIP_DISCUSS=true to boolean true', async () => {
    process.env['GSD_AUTOPILOT_SKIP_DISCUSS'] = 'true';
    const config = await loadConfig(projectDir, {});
    expect(config.skipDiscuss).toBe(true);
  });

  // Test 11: Boolean coercion from env var (false)
  it('coerces GSD_AUTOPILOT_VERBOSE=false to boolean false', async () => {
    process.env['GSD_AUTOPILOT_VERBOSE'] = 'false';
    const config = await loadConfig(projectDir, {});
    expect(config.verbose).toBe(false);
  });

  // Test 12: String passthrough from env var
  it('passes through string env var GSD_AUTOPILOT_NOTIFY=teams', async () => {
    process.env['GSD_AUTOPILOT_NOTIFY'] = 'teams';
    const config = await loadConfig(projectDir, {});
    expect(config.notify).toBe('teams');
  });

  // Test 13: Config file path uses path.join (not hardcoded separators)
  it('uses path.join for config file location', async () => {
    // Verify by writing config file at the expected path and reading succeeds
    const configPath = join(projectDir, '.gsd-autopilot.json');
    writeFileSync(configPath, JSON.stringify({ port: 9999 }));
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(9999);
  });

  // Test 14: Env var key mapping: GSD_AUTOPILOT_WEBHOOK_URL -> webhookUrl
  it('maps GSD_AUTOPILOT_WEBHOOK_URL to webhookUrl (snake_case to camelCase)', async () => {
    process.env['GSD_AUTOPILOT_WEBHOOK_URL'] = 'https://hooks.example.com/test';
    const config = await loadConfig(projectDir, {});
    expect(config.webhookUrl).toBe('https://hooks.example.com/test');
  });

  // Test 15: Missing config file is not an error
  it('does not throw when config file is missing', async () => {
    // projectDir has no .gsd-autopilot.json
    const config = await loadConfig(projectDir, {});
    expect(config).toBeDefined();
    expect(config.port).toBe(3847); // defaults
  });

  // Additional edge cases

  it('handles multiple env vars simultaneously', async () => {
    process.env['GSD_AUTOPILOT_PORT'] = '8080';
    process.env['GSD_AUTOPILOT_VERBOSE'] = 'true';
    process.env['GSD_AUTOPILOT_DEPTH'] = 'comprehensive';
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(8080);
    expect(config.verbose).toBe(true);
    expect(config.depth).toBe('comprehensive');
  });

  it('merges config file and env vars correctly', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ port: 4000, verbose: true }),
    );
    process.env['GSD_AUTOPILOT_DEPTH'] = 'quick';
    const config = await loadConfig(projectDir, {});
    expect(config.port).toBe(4000);      // from file
    expect(config.verbose).toBe(true);    // from file
    expect(config.depth).toBe('quick');   // from env
  });

  it('does not throw raw ZodError for validation failures', async () => {
    writeFileSync(
      join(projectDir, '.gsd-autopilot.json'),
      JSON.stringify({ depth: 'invalid-depth-value' }),
    );
    try {
      await loadConfig(projectDir, {});
      // Should not reach here
      expect.unreachable('Should have thrown');
    } catch (error) {
      // Error should NOT be a raw ZodError -- should be wrapped
      expect((error as Error).constructor.name).not.toBe('ZodError');
      expect((error as Error).message).toMatch(/depth/i);
    }
  });

  it('handles GSD_AUTOPILOT_ADAPTER_PATH env var as string', async () => {
    process.env['GSD_AUTOPILOT_ADAPTER_PATH'] = './my-adapter.js';
    const config = await loadConfig(projectDir, {});
    expect(config.adapterPath).toBe('./my-adapter.js');
  });
});
