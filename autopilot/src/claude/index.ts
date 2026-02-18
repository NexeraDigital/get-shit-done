// ClaudeService facade for the Claude Agent SDK.
// Wraps the SDK's query() async generator behind a single runGsdCommand() method.
// Integrates timeout, question handler, and result parser modules.

import './polyfills.js';
import { EventEmitter } from 'node:events';
import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { createTimeout } from './timeout.js';
import { parseResult } from './result-parser.js';
import { QuestionHandler } from './question-handler.js';
import type { CommandResult, RunCommandOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

export interface ClaudeServiceOptions {
  defaultTimeoutMs?: number;
  defaultCwd?: string;
  /** When true, auto-select the first option for AskUserQuestion instead of blocking. */
  autoAnswer?: boolean;
}

/**
 * Facade for all Claude Agent SDK interaction.
 *
 * The orchestrator calls runGsdCommand() without knowing about the Agent SDK,
 * message streams, tool callbacks, or abort controllers. ClaudeService
 * encapsulates all SDK complexity behind one method.
 *
 * Events:
 * - 'message' -> SDKMessage (every message from the SDK stream -- for StreamRenderer/StreamLogger)
 * - 'question:pending' -> QuestionEvent (forwarded from QuestionHandler)
 * - 'question:answered' -> { id: string, answers: Record<string, string> }
 */
export class ClaudeService extends EventEmitter {
  private readonly questionHandler = new QuestionHandler();
  private readonly defaultTimeoutMs: number;
  private readonly defaultCwd: string | undefined;
  private readonly autoAnswer: boolean;
  private running = false;
  private currentAbort: AbortController | null = null;

  constructor(options?: ClaudeServiceOptions) {
    super();
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultCwd = options?.defaultCwd;
    this.autoAnswer = options?.autoAnswer ?? false;

    // Forward QuestionHandler lifecycle events
    this.questionHandler.on('question:pending', (event) => {
      this.emit('question:pending', event);
    });
    this.questionHandler.on('question:answered', (event) => {
      this.emit('question:answered', event);
    });
  }

  /**
   * Execute a GSD command via the Claude Agent SDK.
   *
   * @param prompt - The prompt/command to send (e.g., '/gsd:plan-phase 2')
   * @param options - Optional timeout, cwd, and metadata
   * @returns A CommandResult with success/failure status and metadata
   * @throws Error if a command is already running (no concurrent execution)
   */
  async runGsdCommand(
    prompt: string,
    options?: RunCommandOptions,
  ): Promise<CommandResult> {
    if (this.running) {
      throw new Error(
        'A command is already running. ClaudeService does not support concurrent execution.',
      );
    }

    this.running = true;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const { controller, cleanup } = createTimeout(timeoutMs);
    this.currentAbort = controller;
    const startTimeMs = Date.now();
    let sessionId = '';

    try {
      for await (const message of query({
        prompt,
        options: {
          cwd: options?.cwd ?? this.defaultCwd ?? process.cwd(),
          env: (() => {
            const env = { ...process.env };
            delete env.CLAUDECODE;
            return env;
          })(),
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: 'CRITICAL: When you spawn background Task subagents, do NOT end your turn while tasks are pending. Poll their output files (Read or Bash `cat`) every 10-15 seconds until all tasks complete, then continue your work. The session ends when you stop making tool calls.',
          },
          settingSources: ['project', 'user'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          // Enable streaming partial messages for real-time terminal output.
          // WARNING: If thinking/maxThinkingTokens is set, stream_event messages are NOT emitted (SDK limitation).
          includePartialMessages: true,
          allowedTools: [
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob',
            'Grep',
            'WebFetch',
            'WebSearch',
            'Task',
            'Skill',
            'AskUserQuestion',
          ],
          ...(options?.maxTurns != null ? { maxTurns: options.maxTurns } : {}),
          abortController: controller,
          canUseTool: this.createCanUseTool(),
        },
      })) {
        this.emit('message', message);

        if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
          sessionId = message.session_id;
        }

        if (message.type === 'result') {
          return parseResult(message, sessionId, startTimeMs);
        }
      }

      // for-await completed without a 'result' message
      return {
        success: false,
        error: 'No result message received from SDK',
        sessionId,
        durationMs: Date.now() - startTimeMs,
        costUsd: 0,
        numTurns: 0,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          error: `Command timed out after ${timeoutMs}ms`,
          sessionId,
          durationMs: Date.now() - startTimeMs,
          costUsd: 0,
          numTurns: 0,
        };
      }
      throw err;
    } finally {
      cleanup();
      this.running = false;
      this.currentAbort = null;
    }
  }

  /**
   * Creates the canUseTool callback for the SDK query options.
   * Routes AskUserQuestion tool calls to the QuestionHandler;
   * allows all other tools to proceed.
   *
   * When autoAnswer is enabled, questions are answered immediately
   * by selecting the first option instead of blocking for human input.
   */
  private createCanUseTool(): CanUseTool {
    return async (toolName, input) => {
      if (toolName === 'AskUserQuestion') {
        const typedInput = input as unknown as Parameters<QuestionHandler['handleQuestion']>[0];

        if (this.autoAnswer) {
          // Auto-select the first option for each question
          const answers: Record<string, string> = {};
          for (const q of typedInput.questions) {
            if (q.options.length > 0) {
              answers[q.question] = q.options[0]!.label;
            }
          }
          return {
            behavior: 'allow' as const,
            updatedInput: { questions: typedInput.questions, answers },
          };
        }

        // Delegate to QuestionHandler -- this blocks SDK execution
        // until submitAnswer() resolves the deferred promise.
        return await this.questionHandler.handleQuestion(typedInput);
      }

      return { behavior: 'allow' as const, updatedInput: input };
    };
  }

  /**
   * Resolves a pending question by ID.
   *
   * @param questionId - The ID from the QuestionEvent
   * @param answers - Record mapping question text to selected label
   * @returns true if the question was found and resolved, false otherwise
   */
  submitAnswer(questionId: string, answers: Record<string, string>): boolean {
    return this.questionHandler.submitAnswer(questionId, answers);
  }

  /**
   * Returns all currently pending questions.
   */
  getPendingQuestions() {
    return this.questionHandler.getPending();
  }

  /**
   * Aborts the currently running command and rejects all pending questions.
   */
  abortCurrent(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    this.questionHandler.rejectAll(new Error('Command aborted'));
  }

  /**
   * Whether a command is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }
}
