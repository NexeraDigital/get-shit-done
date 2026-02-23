#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../config/index.js';
import { StateStore } from '../state/index.js';
import { AutopilotLogger } from '../logger/index.js';
import { ClaudeService } from '../claude/index.js';
import { Orchestrator } from '../orchestrator/index.js';
import { ShutdownManager } from '../orchestrator/shutdown.js';
import { parsePhaseRange } from '../orchestrator/gap-detector.js';
import { runPreflightChecks } from './preflight.js';
import { runSetupWizard } from './wizard.js';
import { StreamRenderer, StreamLogger } from '../output/index.js';
import type { VerbosityLevel } from '../output/index.js';
import { ResponseServer } from '../server/index.js';
import { EventWriter } from '../ipc/event-writer.js';
import { HeartbeatWriter } from '../ipc/heartbeat-writer.js';
import { AnswerPoller } from '../ipc/answer-poller.js';
import {
  NotificationManager,
  ConsoleAdapter,
  TeamsAdapter,
  SlackAdapter,
  CustomWebhookAdapter,
  SystemAdapter,
  loadCustomAdapter,
} from '../notifications/index.js';
import { randomUUID } from 'node:crypto';
import type { Notification } from '../types/notification.js';
import type { QuestionEvent } from '../claude/types.js';

const program = new Command();

program
  .name('gsd-autopilot')
  .description('Autonomous GSD workflow orchestrator -- turns a PRD into a built project')
  .version('0.1.0')
  .showHelpAfterError('(run gsd-autopilot --help for usage information)')
  .addHelpText('after', `
Examples:
  $ gsd-autopilot --prd ./idea.md
  $ gsd-autopilot --resume
  $ gsd-autopilot --prd ./spec.md --notify teams --webhook-url https://...
  $ gsd-autopilot --prd ./plan.md --phases 1-3,5 --depth comprehensive

Dashboard:
  http://localhost:3847 (configurable with --port)
`)
  .option('--prd <path>', 'Path to PRD/idea document')
  .option('--resume', 'Resume from last checkpoint')
  .option('--skip-discuss', 'Skip discuss-phase, let Claude decide everything')
  .option('--skip-verify', 'Skip verification step')
  .option('--phases <range>', 'Run specific phases (e.g., 1-3,5,7-9)')
  .option('--notify <channel>', 'Notification channel (console, system, teams, slack)', 'console')
  .option('--webhook-url <url>', 'Webhook URL for Teams/Slack notifications')
  .option('--port <number>', 'Dashboard server port', '3847')
  .option('--depth <level>', 'Planning depth (quick, standard, comprehensive)', 'standard')
  .option('--model <profile>', 'Model profile (quality, balanced, budget)', 'balanced')
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Suppress non-error output')
  .option('--adapter-path <path>', 'Path to custom notification adapter module')
  .option('--embedded-server', 'Run dashboard server in-process (legacy mode)')
  .action(async (options: {
    prd?: string;
    resume?: boolean;
    skipDiscuss?: boolean;
    skipVerify?: boolean;
    phases?: string;
    notify: string;
    webhookUrl?: string;
    adapterPath?: string;
    port: string;
    depth: string;
    model: string;
    verbose?: boolean;
    quiet?: boolean;
    embeddedServer?: boolean;
  }) => {
    // a. Launch interactive wizard if no --prd or --resume provided
    if (!options.resume && !options.prd) {
      // No args provided -- launch interactive setup wizard (per user decision)
      const wizardResult = await runSetupWizard();
      options.prd = wizardResult.prdPath;
      options.notify = wizardResult.notify;
      options.model = wizardResult.model;
      options.depth = wizardResult.depth;
      if (wizardResult.webhookUrl) {
        options.webhookUrl = wizardResult.webhookUrl;
      }
    }

    // If --prd provided, resolve path (existence check happens in preflight)
    if (options.prd) {
      options.prd = resolve(options.prd);
    }

    // b. Determine project directory
    const projectDir = process.cwd();

    // c. Load config with CLI overrides
    let config;
    try {
      config = await loadConfig(projectDir, {
        skipDiscuss: options.skipDiscuss ?? false,
        skipVerify: options.skipVerify ?? false,
        verbose: options.verbose ?? false,
        quiet: options.quiet ?? false,
        depth: options.depth as 'quick' | 'standard' | 'comprehensive',
        model: options.model as 'quality' | 'balanced' | 'budget',
        notify: options.notify as 'console' | 'system' | 'teams' | 'slack' | 'webhook',
        webhookUrl: options.webhookUrl,
        adapterPath: options.adapterPath,
        port: parseInt(options.port, 10),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Configuration error: ${msg}\n`);
      console.error('Check your .gsd-autopilot.json file or CLI flags.');
      console.error('Run gsd-autopilot --help for valid options.');
      process.exit(1);
    }

    // d. Run preflight checks -- validate ALL prerequisites at once
    const preflightFailures = await runPreflightChecks(config, options.prd);
    if (preflightFailures.length > 0) {
      console.error('\nPreflight checks failed:\n');
      for (const failure of preflightFailures) {
        console.error(`  x ${failure.error}`);
        console.error(`    ${failure.fix}\n`);
      }
      process.exit(1);
    }

    // e. Create core components
    const logger = new AutopilotLogger(join(projectDir, '.planning', 'autopilot-log'));
    const claudeService = new ClaudeService({ defaultCwd: projectDir, autoAnswer: false });

    // Handle --resume with no state file
    let stateStore;
    if (options.resume) {
      try {
        stateStore = await StateStore.restore(join(projectDir, '.planning', 'autopilot-state.json'));
      } catch {
        console.error('No previous run found in this directory.\n');
        console.error('To start a new run:');
        console.error('  gsd-autopilot --prd <path-to-your-prd>\n');
        console.error('The --resume flag requires a previous autopilot run in the current directory.');
        process.exit(1);
      }
    } else {
      stateStore = StateStore.createFresh(projectDir);
    }

    // f. Determine verbosity level from config
    const verbosity: VerbosityLevel = config.quiet ? 'quiet' : config.verbose ? 'verbose' : 'default';

    // g. Create output streaming components
    const streamRenderer = new StreamRenderer(verbosity, undefined, new Set(['AskUserQuestion']));
    const streamLogger = new StreamLogger(join(projectDir, '.planning', 'autopilot-log'));

    // Wire SDK message stream to terminal renderer and log file (dual output per user decision)
    claudeService.on('message', (message: unknown) => {
      streamRenderer.render(message);
      streamLogger.write(message);
    });

    // h. Parse phase range (if provided)
    const phaseRange = options.phases ? parsePhaseRange(options.phases) : undefined;

    // i. Create NotificationManager and wire adapters
    const notificationManager = new NotificationManager({
      questionReminderMs: config.questionReminderMs,
    });

    // Always add console adapter (default, zero-dependency)
    notificationManager.addAdapter(new ConsoleAdapter({
      port: config.port,
      stopSpinner: () => streamRenderer.stopSpinner(),
    }));

    // Add channel-specific adapter based on config.notify
    switch (config.notify) {
      case 'system':
        notificationManager.addAdapter(new SystemAdapter());
        break;
      case 'teams':
        if (config.webhookUrl) {
          notificationManager.addAdapter(new TeamsAdapter({ webhookUrl: config.webhookUrl }));
        } else {
          console.error('Warning: --notify teams requires --webhook-url');
        }
        break;
      case 'slack':
        if (config.webhookUrl) {
          notificationManager.addAdapter(new SlackAdapter({ webhookUrl: config.webhookUrl }));
        } else {
          console.error('Warning: --notify slack requires --webhook-url');
        }
        break;
      case 'webhook':
        if (config.webhookUrl) {
          notificationManager.addAdapter(new CustomWebhookAdapter({ webhookUrl: config.webhookUrl }));
        } else {
          console.error('Warning: --notify webhook requires --webhook-url');
        }
        break;
      case 'console':
      default:
        // Console already added above
        break;
    }

    // Load custom adapter if --adapter-path provided
    if (config.adapterPath) {
      try {
        const customAdapter = await loadCustomAdapter(config.adapterPath);
        notificationManager.addAdapter(customAdapter);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Warning: Failed to load custom adapter: ${msg}`);
      }
    }

    // Initialize all adapters (failures logged and adapter removed, not thrown)
    await notificationManager.init();

    // j. Create IPC components for file-based communication with dashboard
    const eventWriter = new EventWriter(projectDir);
    const heartbeatWriter = new HeartbeatWriter(projectDir);

    const answerPoller = new AnswerPoller(projectDir, (qId, answers) => claudeService.submitAnswer(qId, answers));

    // k. Create Orchestrator
    const orchestrator = new Orchestrator({
      stateStore,
      claudeService,
      logger,
      config,
      projectDir,
    });

    // Wire phase/step banners to StreamRenderer
    orchestrator.on('phase:started', ({ phase, name }: { phase: number; name: string }) => {
      streamRenderer.showBanner(phase, `Starting: ${name}`);
    });
    orchestrator.on('step:started', ({ phase, step }: { phase: number; step: string }) => {
      streamRenderer.startSpinner(`Phase ${phase}: ${step}...`);
    });
    orchestrator.on('step:completed', () => {
      streamRenderer.stopSpinner();
    });
    orchestrator.on('build:complete', () => {
      streamRenderer.stopSpinner();
    });

    // Wire events to EventWriter for IPC
    orchestrator.on('phase:started', (data: unknown) => {
      void eventWriter.write('phase-started', data);
    });
    orchestrator.on('phase:completed', (data: unknown) => {
      void eventWriter.write('phase-completed', data);
    });
    orchestrator.on('step:completed', (data: unknown) => {
      void eventWriter.write('step-completed', data);
    });
    orchestrator.on('build:complete', () => {
      void eventWriter.write('build-complete', {});
    });
    orchestrator.on('error:escalation', (data: unknown) => {
      void eventWriter.write('error', data);
    });
    claudeService.on('question:pending', (data: unknown) => {
      void eventWriter.write('question-pending', data);
    });
    claudeService.on('question:answered', (data: unknown) => {
      void eventWriter.write('question-answered', data);
    });
    logger.on('entry', (entry: unknown) => {
      void eventWriter.write('log-entry', entry);
    });

    // Wire SDK messages to EventWriter as log-entry events for dashboard live logs.
    // Converts meaningful message types (tool use, assistant text) to LogEntry format.
    // Skips noisy stream_event text deltas to prevent log bloat.
    // Track tool_use IDs already logged from assistant messages to avoid duplicates with tool_use_summary
    const loggedToolUseIds = new Set<string>();

    claudeService.on('message', (message: unknown) => {
      const msg = message as { type?: string; subtype?: string; tool_name?: string; tool_use_id?: string; parameters?: Record<string, unknown>; message?: { content?: Array<{ type?: string; text?: string; name?: string; id?: string }> }; parent_tool_use_id?: string | null; event?: { type?: string; content_block?: { type?: string; name?: string }; delta?: { type?: string } } };

      if (msg.type === 'tool_use_summary') {
        // Skip if already logged from assistant message
        if (msg.tool_use_id && loggedToolUseIds.has(msg.tool_use_id)) {
          loggedToolUseIds.delete(msg.tool_use_id);
          return;
        }
        const toolName = msg.tool_name ?? 'unknown';
        if (toolName === 'AskUserQuestion') return;
        const params = msg.parameters ?? {};
        const summary = (params.file_path ?? params.command ?? params.pattern ?? params.query ?? params.description ?? params.skill ?? '') as string;
        const preview = typeof summary === 'string' ? summary.split('\n')[0]?.slice(0, 120) ?? '' : '';
        void eventWriter.write('log-entry', {
          timestamp: new Date().toISOString(),
          level: 'info',
          component: 'claude',
          message: `[${toolName}] ${preview}`.trimEnd(),
        });
      } else if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            const preview = block.text.split('\n')[0]?.slice(0, 200) ?? '';
            if (preview.trim()) {
              void eventWriter.write('log-entry', {
                timestamp: new Date().toISOString(),
                level: 'info',
                component: 'claude',
                message: preview,
              });
            }
          } else if (block.type === 'tool_use' && block.name) {
            if (block.name === 'AskUserQuestion') continue;
            const input = (block as { input?: Record<string, unknown> }).input ?? {};
            const summary = (input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.description ?? input.skill ?? '') as string;
            const preview = typeof summary === 'string' ? summary.split('\n')[0]?.slice(0, 120) ?? '' : '';
            if (block.id) loggedToolUseIds.add(block.id);
            void eventWriter.write('log-entry', {
              timestamp: new Date().toISOString(),
              level: 'info',
              component: 'claude',
              message: `[${block.name}] ${preview}`.trimEnd(),
            });
          }
        }
      } else if (msg.type === 'result') {
        const result = message as { is_error?: boolean; result?: string; num_turns?: number; duration_ms?: number };
        const isError = result.is_error === true;
        void eventWriter.write('log-entry', {
          timestamp: new Date().toISOString(),
          level: isError ? 'error' : 'info',
          component: 'claude',
          message: isError
            ? `Command failed: ${(result.result ?? 'Unknown error').slice(0, 200)}`
            : `Command completed (${result.num_turns ?? 0} turns, ${((result.duration_ms ?? 0) / 1000).toFixed(1)}s)`,
        });
      }
    });

    // Wire question:pending -> persist full question data to state file
    claudeService.on('question:pending', (event: QuestionEvent) => {
      const state = stateStore.getState();
      const pendingQuestions = [...state.pendingQuestions];
      pendingQuestions.push({
        id: event.id,
        phase: event.phase ?? 0,
        step: (event.step as any) ?? 'idle',
        questions: event.questions.map(q => q.question),
        questionItems: event.questions,
        createdAt: event.createdAt,
      });
      void stateStore.setState({ pendingQuestions });
    });

    // Wire question:answered -> update state file + log selected answers
    claudeService.on('question:answered', ({ id, answers }: { id: string; answers: Record<string, string> }) => {
      const state = stateStore.getState();
      const pendingQuestions = state.pendingQuestions.map(q =>
        q.id === id ? { ...q, answeredAt: new Date().toISOString(), answers } : q,
      );
      void stateStore.setState({ pendingQuestions });

      // Log each answered question with the selected option
      for (const [question, answer] of Object.entries(answers)) {
        const short = question.length > 80 ? question.slice(0, 77) + '...' : question;
        void eventWriter.write('log-entry', {
          timestamp: new Date().toISOString(),
          level: 'info',
          component: 'claude',
          message: `[Answer] ${short} -> ${answer}`,
        });
      }
    });

    // Wire question:pending -> notification dispatch + reminder
    claudeService.on('question:pending', (event: QuestionEvent) => {
      const respondUrl = `http://localhost:${config.port}/questions/${event.id}`;
      const questionText = event.questions.map(q => q.question).join('\n');
      const optionLabels = event.questions.flatMap(q => q.options.map(o => o.label));

      const notification: Notification = {
        id: randomUUID(),
        type: 'question',
        title: `Question${event.phase ? ` (Phase ${event.phase})` : ''}: ${event.questions[0]?.header ?? 'Input needed'}`,
        body: questionText,
        severity: 'warning',
        respondUrl,
        options: optionLabels.length > 0 ? optionLabels : undefined,
        phase: event.phase,
        step: event.step,
        createdAt: new Date().toISOString(),
      };

      notificationManager.notify(notification);
      notificationManager.startReminder(event.id, notification);
    });

    // Wire question:answered -> cancel reminder
    claudeService.on('question:answered', ({ id }: { id: string }) => {
      notificationManager.cancelReminder(id);
    });

    // Wire build:complete -> completion notification
    orchestrator.on('build:complete', () => {
      const state = stateStore.getState();
      const completedCount = state.phases.filter(p => p.status === 'completed').length;
      const totalCount = state.phases.length;
      const elapsed = state.startedAt
        ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 60000)
        : 0;

      const notification: Notification = {
        id: randomUUID(),
        type: 'complete',
        title: 'Build complete',
        body: 'All phases finished successfully.',
        severity: 'info',
        createdAt: new Date().toISOString(),
        summary: `${completedCount} of ${totalCount} phases completed in ${elapsed} min`,
        nextSteps: 'Review output in .planning/ directory',
      };

      notificationManager.notify(notification);
    });

    // Wire error:escalation -> error notification
    orchestrator.on('error:escalation', ({ phase, step, error }: { phase: number; step: string; error: string }) => {
      const state = stateStore.getState();
      const completedCount = state.phases.filter(p => p.status === 'completed').length;
      const totalCount = state.phases.length;
      const elapsed = state.startedAt
        ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 60000)
        : 0;

      const notification: Notification = {
        id: randomUUID(),
        type: 'error',
        title: `Autopilot stopped (Phase ${phase}, ${step})`,
        body: error,
        severity: 'critical',
        phase,
        step,
        createdAt: new Date().toISOString(),
        summary: `${completedCount} of ${totalCount} phases completed in ${elapsed} min`,
        nextSteps: 'Run `gsd-autopilot --resume` to retry from the failed step',
        errorMessage: error,
      };

      notificationManager.notify(notification);
    });

    // l. Install ShutdownManager (created before dashboard spawn so child cleanup can register)
    const shutdown = new ShutdownManager();

    // m. Resolve dashboard dist path for SPA serving
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const dashboardDir = join(__dirname, '..', '..', 'dashboard', 'dist');

    // n. Start dashboard -- either embedded (legacy) or as a separate process
    let responseServer: ResponseServer | null = null;

    if (options.embeddedServer) {
      // Legacy mode: run dashboard server in-process
      responseServer = new ResponseServer({
        stateStore,
        claudeService,
        orchestrator,
        logger,
        config,
        dashboardDir,
      });
      await responseServer.start(config.port);
    } else {
      // Spawn dashboard as a detached child process
      const standaloneScript = join(__dirname, '..', 'server', 'standalone.js');
      const child = spawn(
        process.execPath,
        [standaloneScript, '--project-dir', projectDir, '--port', String(config.port)],
        {
          stdio: 'ignore',
          detached: true,
        },
      );
      child.unref();

      // Kill detached dashboard server on shutdown
      shutdown.register(async () => {
        if (child.pid && !child.killed) {
          try {
            process.kill(child.pid);
          } catch {
            // Already exited -- ignore
          }
        }
      });
    }

    if (!options.quiet) {
      console.log(`Dashboard server: http://localhost:${config.port}`);
    }
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Flushing stream logger on shutdown');
      await streamLogger.flush();
    });
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Flushing logger on shutdown');
      await logger.flush();
    });
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Persisting state on shutdown');
      await stateStore.setState({ status: 'idle' });
    });
    // Register notification manager shutdown (runs before server due to LIFO)
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Closing notification manager');
      await notificationManager.close();
    });
    // Register IPC cleanup
    shutdown.register(async () => {
      logger.log('info', 'cli', 'Stopping IPC components');
      heartbeatWriter.stop();
      answerPoller?.stop();
    });
    // Register server shutdown if embedded (runs FIRST due to LIFO -- registered last)
    if (responseServer) {
      shutdown.register(async () => {
        logger.log('info', 'cli', 'Shutting down embedded response server');
        await responseServer!.close();
      });
    }
    shutdown.install(() => {
      logger.log('warn', 'cli', 'Shutdown requested, finishing current step...');
      orchestrator.requestShutdown();
    });

    // o. Start IPC components
    await heartbeatWriter.start();
    await answerPoller?.start();

    // p. Run orchestrator
    try {
      const prdPath = options.prd ? resolve(options.prd) : '';
      await orchestrator.run(prdPath, phaseRange);

      if (!options.quiet) {
        console.log('\nAutopilot run complete.');
      }
      heartbeatWriter.stop();
      answerPoller?.stop();
      await notificationManager.close();
      if (responseServer) await responseServer.close();
      await streamLogger.flush();
      await logger.flush();
      process.exit(0);
    } catch (err) {
      streamRenderer.stopSpinner();
      heartbeatWriter.stop();
      answerPoller?.stop();
      await notificationManager.close();
      if (responseServer) await responseServer.close();
      const message = err instanceof Error ? err.message : String(err);
      logger.log('error', 'cli', 'Autopilot failed', { error: message });
      if (!options.quiet) {
        console.error(`\nAutopilot failed: ${message}`);
      }
      process.exit(1);
    }
  });

// q. Top-level error handling
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
