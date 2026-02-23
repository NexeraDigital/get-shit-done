#!/usr/bin/env node
// Standalone dashboard server -- runs in its own process, separate from the autopilot.
// Reads state and events from the filesystem; writes answers as files.

import { Command } from 'commander';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { FileStateReader } from '../ipc/file-state-reader.js';
import { EventTailer } from '../ipc/event-tailer.js';
import { AnswerWriter } from '../ipc/answer-writer.js';
import { FileQuestionProvider } from '../ipc/file-question-provider.js';
import { ResponseServer } from './index.js';

const program = new Command();

program
  .name('gsd-dashboard')
  .description('Standalone dashboard server for GSD autopilot')
  .version('0.1.0')
  .requiredOption('--project-dir <path>', 'Path to the project directory')
  .option('--port <number>', 'Dashboard server port', '3847')
  .action(async (options: { projectDir: string; port: string }) => {
    const projectDir = resolve(options.projectDir);
    const port = parseInt(options.port, 10);

    // Create file-based IPC components
    const stateReader = new FileStateReader(projectDir);
    const eventTailer = new EventTailer(projectDir);
    const answerWriter = new AnswerWriter(projectDir);
    const questionProvider = new FileQuestionProvider(stateReader, answerWriter);

    // Start IPC readers
    stateReader.start();
    await eventTailer.start();

    // Resolve dashboard dist path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const dashboardDir = join(__dirname, '..', '..', 'dashboard', 'dist');

    // Create and start the server
    const server = new ResponseServer({
      stateProvider: stateReader,
      questionProvider,
      livenessProvider: stateReader,
      sseDeps: {
        mode: 'file-tail' as const,
        eventTailer,
      },
      dashboardDir: existsSync(dashboardDir) ? dashboardDir : undefined,
    });

    await server.start(port);
    console.log(`Dashboard server: http://localhost:${port}`);
    console.log(`Watching project: ${projectDir}`);

    // Graceful shutdown
    const shutdown = () => {
      console.log('\nShutting down dashboard...');
      stateReader.stop();
      eventTailer.stop();
      void server.close().then(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
