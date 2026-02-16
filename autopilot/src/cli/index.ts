#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config/index.js';
import { StateStore } from '../state/index.js';
import { AutopilotLogger } from '../logger/index.js';
import { ClaudeService } from '../claude/index.js';
import { Orchestrator } from '../orchestrator/index.js';
import { ShutdownManager } from '../orchestrator/shutdown.js';
import { parsePhaseRange } from '../orchestrator/gap-detector.js';

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous GSD workflow orchestrator -- turns a PRD into a built project')
  .version('0.1.0')
  .option('--prd <path>', 'Path to PRD/idea document')
  .option('--resume', 'Resume from last checkpoint')
  .option('--skip-discuss', 'Skip discuss-phase, let Claude decide everything')
  .option('--skip-verify', 'Skip verification step')
  .option('--phases <range>', 'Run specific phases (e.g., 1-3, 2)')
  .option('--notify <channel>', 'Notification channel (console, system, teams, slack)', 'console')
  .option('--webhook-url <url>', 'Webhook URL for Teams/Slack notifications')
  .option('--port <number>', 'Dashboard server port', '3847')
  .option('--depth <level>', 'Planning depth (quick, standard, comprehensive)', 'standard')
  .option('--model <profile>', 'Model profile (quality, balanced, budget)', 'balanced')
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Suppress non-error output')
  .action(async (options: {
    prd?: string;
    resume?: boolean;
    skipDiscuss?: boolean;
    skipVerify?: boolean;
    phases?: string;
    notify: string;
    webhookUrl?: string;
    port: string;
    depth: string;
    model: string;
    verbose?: boolean;
    quiet?: boolean;
  }) => {
    // a. Validate --prd / --resume mutual requirement
    if (!options.resume && !options.prd) {
      console.error('Error: Either --prd <path> or --resume is required');
      process.exit(1);
    }

    // If --prd provided, resolve and verify file exists
    if (options.prd) {
      const prdAbsolute = resolve(options.prd);
      try {
        await access(prdAbsolute);
      } catch {
        console.error(`Error: PRD file not found: ${prdAbsolute}`);
        process.exit(1);
      }
      // Store resolved path back for use below
      options.prd = prdAbsolute;
    }

    // b. Determine project directory
    const projectDir = process.cwd();

    // c. Load config with CLI overrides
    const config = await loadConfig(projectDir, {
      skipDiscuss: options.skipDiscuss ?? false,
      skipVerify: options.skipVerify ?? false,
      verbose: options.verbose ?? false,
      quiet: options.quiet ?? false,
      depth: options.depth as 'quick' | 'standard' | 'comprehensive',
      model: options.model as 'quality' | 'balanced' | 'budget',
      notify: options.notify as 'console' | 'system' | 'teams' | 'slack',
      webhookUrl: options.webhookUrl,
      port: parseInt(options.port, 10),
    });

    // d. Create components
    const logger = new AutopilotLogger(join(projectDir, '.planning', 'autopilot-log'));
    const claudeService = new ClaudeService({ defaultCwd: projectDir, autoAnswer: true });
    const stateStore = options.resume
      ? await StateStore.restore(join(projectDir, '.planning', 'autopilot-state.json'))
      : StateStore.createFresh(projectDir);

    // e. Parse phase range (if provided)
    const phaseRange = options.phases ? parsePhaseRange(options.phases) : undefined;

    // f. Create Orchestrator
    const orchestrator = new Orchestrator({
      stateStore,
      claudeService,
      logger,
      config,
      projectDir,
    });

    // g. Install ShutdownManager
    const shutdown = new ShutdownManager();
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Flushing logger on shutdown');
      await logger.flush();
    });
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Persisting state on shutdown');
      await stateStore.setState({ status: 'idle' });
    });
    shutdown.install(() => {
      logger.log('warn', 'cli', 'Shutdown requested, finishing current step...');
      orchestrator.requestShutdown();
    });

    // h. Run orchestrator
    try {
      const prdPath = options.prd ? resolve(options.prd) : '';
      await orchestrator.run(prdPath, phaseRange);

      if (!options.quiet) {
        console.log('\nAutopilot run complete.');
      }
      await logger.flush();
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log('error', 'cli', 'Autopilot failed', { error: message });
      if (!options.quiet) {
        console.error(`\nAutopilot failed: ${message}`);
      }
      process.exit(1);
    }
  });

// i. Top-level error handling
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
