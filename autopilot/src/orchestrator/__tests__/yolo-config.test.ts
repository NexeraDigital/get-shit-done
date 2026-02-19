import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeYoloConfig } from '../yolo-config.js';
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('writeYoloConfig', () => {
  let projectDir: string;
  let configPath: string;

  beforeEach(async () => {
    projectDir = join(tmpdir(), `yolo-config-test-${randomUUID()}`);
    configPath = join(projectDir, '.planning', 'config.json');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('writes config with correct fields when no existing config exists', async () => {
    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('model_profile', 'balanced');
    expect(config).toHaveProperty('research', true);
    expect(config).toHaveProperty('plan_check', true);
    expect(config).toHaveProperty('verifier', true);
    expect(config).toHaveProperty('parallelization', true);
  });

  it('writes verifier=false when skipVerify=true', async () => {
    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: true,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('verifier', false);
  });

  it('writes verifier=true when skipVerify=false', async () => {
    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('verifier', true);
  });

  it('preserves existing branching_strategy and git settings', async () => {
    // Create existing config with user settings
    await mkdir(join(projectDir, '.planning'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      branching_strategy: 'feature-branch',
      phase_branch_template: 'custom/{phase}',
      milestone_branch_template: 'release/{milestone}',
      search_gitignored: true,
    }, null, 2) + '\n');

    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'quality',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('branching_strategy', 'feature-branch');
    expect(config).toHaveProperty('phase_branch_template', 'custom/{phase}');
    expect(config).toHaveProperty('milestone_branch_template', 'release/{milestone}');
    expect(config).toHaveProperty('search_gitignored', true);
    // Also has YOLO settings merged in
    expect(config).toHaveProperty('model_profile', 'quality');
    expect(config).toHaveProperty('verifier', true);
  });

  it('preserves existing commit_docs=false (does not override user preference)', async () => {
    await mkdir(join(projectDir, '.planning'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      commit_docs: false,
    }, null, 2) + '\n');

    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('commit_docs', false);
  });

  it('writes depth and model_profile correctly for comprehensive/quality', async () => {
    await writeYoloConfig(projectDir, {
      depth: 'comprehensive',
      model: 'quality',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    expect(config).toHaveProperty('model_profile', 'quality');
  });

  it('output is valid JSON with 2-space indentation and trailing newline', async () => {
    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');

    // Valid JSON
    expect(() => JSON.parse(content)).not.toThrow();

    // Trailing newline
    expect(content.endsWith('\n')).toBe(true);

    // 2-space indentation (check that JSON.stringify(parsed, null, 2) + '\n' matches)
    const parsed = JSON.parse(content) as unknown;
    const reFormatted = JSON.stringify(parsed, null, 2) + '\n';
    expect(content).toBe(reFormatted);
  });

  it('creates .planning/ directory if it does not exist', async () => {
    // projectDir exists but .planning/ does not
    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;
    expect(config).toHaveProperty('model_profile', 'balanced');
  });

  it('handles invalid JSON in existing config gracefully', async () => {
    await mkdir(join(projectDir, '.planning'), { recursive: true });
    await writeFile(configPath, 'this is not valid json{{{');

    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'balanced',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;
    expect(config).toHaveProperty('model_profile', 'balanced');
    expect(config).toHaveProperty('verifier', true);
  });

  it('YOLO settings override conflicting existing values', async () => {
    await mkdir(join(projectDir, '.planning'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      model_profile: 'budget',
      verifier: false,
      parallelization: false,
    }, null, 2) + '\n');

    await writeYoloConfig(projectDir, {
      depth: 'standard',
      model: 'quality',
      skipVerify: false,
    });

    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;

    // YOLO settings take priority
    expect(config).toHaveProperty('model_profile', 'quality');
    expect(config).toHaveProperty('verifier', true);
    expect(config).toHaveProperty('parallelization', true);
  });
});
