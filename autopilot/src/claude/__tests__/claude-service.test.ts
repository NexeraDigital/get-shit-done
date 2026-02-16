import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../index.js';
import type { QuestionEvent } from '../types.js';

// Mock the SDK module to avoid spawning real processes
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Import the mocked query after vi.mock so we can control it
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mockQueryFn: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  mockQueryFn = sdk.query as unknown as ReturnType<typeof vi.fn>;
  mockQueryFn.mockReset();
});

// Helper: create an async generator yielding a sequence of messages
async function* mockMessageStream(messages: unknown[]): AsyncGenerator<unknown, void> {
  for (const msg of messages) {
    yield msg;
  }
}

// Helper: create a mock that looks like a Query (AsyncGenerator with extra methods)
function createMockQuery(messages: unknown[]) {
  const gen = mockMessageStream(messages);
  // Add Query interface methods (unused in our tests but needed for type compat)
  return Object.assign(gen, {
    interrupt: vi.fn(),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    setMaxThinkingTokens: vi.fn(),
    initializationResult: vi.fn(),
    supportedCommands: vi.fn(),
    supportedModels: vi.fn(),
    mcpServerStatus: vi.fn(),
    accountInfo: vi.fn(),
    rewindFiles: vi.fn(),
    reconnectMcpServer: vi.fn(),
    toggleMcpServer: vi.fn(),
    setMcpServers: vi.fn(),
    streamInput: vi.fn(),
    stopTask: vi.fn(),
    close: vi.fn(),
  });
}

// Mock SDK init system message
function createInitMessage(sessionId = 'test-session') {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    apiKeySource: 'user',
    claude_code_version: '1.0.0',
    cwd: '/test',
    tools: [],
    mcp_servers: [],
    model: 'claude-opus-4-20250514',
    permissionMode: 'bypassPermissions',
    slash_commands: [],
    output_style: 'text',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000000',
  };
}

// Mock SDK result message
function createResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done',
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 3,
    total_cost_usd: 0.05,
    stop_reason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000001',
    session_id: 'test-session',
    ...overrides,
  };
}

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(() => {
    service = new ClaudeService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Success result
  it('runGsdCommand returns success CommandResult for successful query', async () => {
    mockQueryFn.mockReturnValue(
      createMockQuery([createInitMessage(), createResultMessage()]),
    );

    const result = await service.runGsdCommand('/gsd:plan-phase 2');

    expect(result.success).toBe(true);
    expect(result.result).toBe('Done');
    expect(result.sessionId).toBe('test-session');
    expect(result.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // Test 2: Error result
  it('runGsdCommand returns failure CommandResult for error result', async () => {
    mockQueryFn.mockReturnValue(
      createMockQuery([
        createInitMessage(),
        createResultMessage({
          subtype: 'error_max_turns',
          is_error: true,
          errors: ['Too many turns'],
          result: undefined,
        }),
      ]),
    );

    const result = await service.runGsdCommand('/gsd:test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many turns');
    expect(result.sessionId).toBe('test-session');
  });

  // Test 3: Correct options passed to query
  it('runGsdCommand passes correct options to query', async () => {
    mockQueryFn.mockReturnValue(
      createMockQuery([createInitMessage(), createResultMessage()]),
    );

    await service.runGsdCommand('/gsd:test', { cwd: '/test', timeoutMs: 5000 });

    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    const callArgs = mockQueryFn.mock.calls[0]![0] as {
      prompt: string;
      options: Record<string, unknown>;
    };

    expect(callArgs.prompt).toBe('/gsd:test');
    expect(callArgs.options.cwd).toBe('/test');
    expect(callArgs.options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
    });
    expect(callArgs.options.settingSources).toEqual(['project', 'user']);
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
    expect(callArgs.options.allowDangerouslySkipPermissions).toBe(true);
    expect(callArgs.options.abortController).toBeInstanceOf(AbortController);
    expect(typeof callArgs.options.canUseTool).toBe('function');
    expect(callArgs.options.includePartialMessages).toBe(true);
  });

  // Test 3b: Message emission for each SDK message
  it('runGsdCommand emits message event for each SDK message', async () => {
    mockQueryFn.mockReturnValue(
      createMockQuery([createInitMessage(), createResultMessage()]),
    );

    const messages: unknown[] = [];
    service.on('message', (m) => messages.push(m));

    await service.runGsdCommand('/gsd:test');

    expect(messages.length).toBe(2);
    expect((messages[0] as { type: string }).type).toBe('system');
    expect((messages[1] as { type: string }).type).toBe('result');
  });

  // Test 3c: includePartialMessages passed to query options
  it('runGsdCommand passes includePartialMessages: true to query options', async () => {
    mockQueryFn.mockReturnValue(
      createMockQuery([createInitMessage(), createResultMessage()]),
    );

    await service.runGsdCommand('/gsd:test');

    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    const callArgs = mockQueryFn.mock.calls[0]![0] as {
      options: Record<string, unknown>;
    };
    expect(callArgs.options.includePartialMessages).toBe(true);
  });

  // Test 4: Timeout handling
  it('runGsdCommand handles timeout via AbortError', async () => {
    // Create a generator that hangs after init
    async function* hangingStream() {
      yield createInitMessage();
      // Wait indefinitely (will be aborted by timeout)
      await new Promise(() => {
        // Never resolves -- simulates a hanging SDK
      });
    }

    const gen = hangingStream();
    const mockQuery = Object.assign(gen, {
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
      setModel: vi.fn(),
      setMaxThinkingTokens: vi.fn(),
      initializationResult: vi.fn(),
      supportedCommands: vi.fn(),
      supportedModels: vi.fn(),
      mcpServerStatus: vi.fn(),
      accountInfo: vi.fn(),
      rewindFiles: vi.fn(),
      reconnectMcpServer: vi.fn(),
      toggleMcpServer: vi.fn(),
      setMcpServers: vi.fn(),
      streamInput: vi.fn(),
      stopTask: vi.fn(),
      close: vi.fn(),
    });

    // Make the mock throw AbortError when the controller aborts
    mockQueryFn.mockImplementation((params: { options?: { abortController?: AbortController } }) => {
      const controller = params.options?.abortController;
      if (controller) {
        controller.signal.addEventListener('abort', () => {
          // The real SDK throws AbortError when aborted
          // We simulate this by making the generator throw
        });
      }

      // Return a generator that checks abort signal
      async function* abortableStream() {
        yield createInitMessage();
        // Wait for abort
        await new Promise((_, reject) => {
          if (controller?.signal.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          controller?.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }

      const abortGen = abortableStream();
      return Object.assign(abortGen, {
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        setMaxThinkingTokens: vi.fn(),
        initializationResult: vi.fn(),
        supportedCommands: vi.fn(),
        supportedModels: vi.fn(),
        mcpServerStatus: vi.fn(),
        accountInfo: vi.fn(),
        rewindFiles: vi.fn(),
        reconnectMcpServer: vi.fn(),
        toggleMcpServer: vi.fn(),
        setMcpServers: vi.fn(),
        streamInput: vi.fn(),
        stopTask: vi.fn(),
        close: vi.fn(),
      });
    });

    const result = await service.runGsdCommand('/gsd:slow', { timeoutMs: 50 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 10_000);

  // Test 5: Concurrent execution guard
  it('runGsdCommand prevents concurrent execution', async () => {
    mockQueryFn.mockImplementation((params: { options?: { abortController?: AbortController } }) => {
      const controller = params.options?.abortController;

      async function* hangingStream() {
        yield createInitMessage();
        // Wait until aborted
        await new Promise((_, reject) => {
          if (controller?.signal.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          controller?.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }

      return Object.assign(hangingStream(), {
        interrupt: vi.fn(),
        close: vi.fn(),
      });
    });

    // Start first command (don't await)
    const firstPromise = service.runGsdCommand('/gsd:first', { timeoutMs: 30_000 });

    // Wait a tick so the first command starts running
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second command should throw
    await expect(
      service.runGsdCommand('/gsd:second'),
    ).rejects.toThrow('already running');

    // Clean up: abort the first command
    service.abortCurrent();

    // First command should complete with abort/timeout error
    const result = await firstPromise;
    expect(result.success).toBe(false);
    expect(service.isRunning).toBe(false);
  });

  // Test 6: AskUserQuestion routing
  it('canUseTool routes AskUserQuestion to question handler', async () => {
    let capturedCanUseTool: (
      toolName: string,
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;

    mockQueryFn.mockImplementation((params: { options?: { canUseTool?: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = params.options!.canUseTool!;
      return createMockQuery([createInitMessage(), createResultMessage()]);
    });

    // Start the command so canUseTool gets captured
    const commandPromise = service.runGsdCommand('/gsd:test');

    // Wait for query to be called
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Set up listener for question:pending
    const questionPromise = new Promise<QuestionEvent>((resolve) => {
      service.once('question:pending', resolve);
    });

    const mockInput = {
      questions: [
        {
          question: 'Pick a color',
          header: 'Color Selection',
          options: [
            { label: 'Red', description: 'A warm color' },
            { label: 'Blue', description: 'A cool color' },
          ],
          multiSelect: false,
        },
      ],
    };

    // Invoke canUseTool with AskUserQuestion
    const canUseToolPromise = capturedCanUseTool!(
      'AskUserQuestion',
      mockInput as unknown as Record<string, unknown>,
      { signal: new AbortController().signal, toolUseID: 'test-tool-use' },
    );

    // Wait for the question event
    const event = await questionPromise;
    expect(event.questions).toHaveLength(1);
    expect(event.questions[0]!.question).toBe('Pick a color');

    // Submit the answer
    const answered = service.submitAnswer(event.id, { 'Pick a color': 'Red' });
    expect(answered).toBe(true);

    // canUseTool should resolve with the answer
    const result = await canUseToolPromise as {
      behavior: string;
      updatedInput: { questions: unknown[]; answers: Record<string, string> };
    };
    expect(result.behavior).toBe('allow');
    expect(result.updatedInput.answers).toEqual({ 'Pick a color': 'Red' });

    await commandPromise;
  });

  // Test 7: Non-AskUserQuestion tools allowed through
  it('canUseTool allows non-AskUserQuestion tools', async () => {
    let capturedCanUseTool: (
      toolName: string,
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;

    mockQueryFn.mockImplementation((params: { options?: { canUseTool?: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = params.options!.canUseTool!;
      return createMockQuery([createInitMessage(), createResultMessage()]);
    });

    const commandPromise = service.runGsdCommand('/gsd:test');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await capturedCanUseTool!(
      'Read',
      { path: '/test' },
      { signal: new AbortController().signal, toolUseID: 'test-tool-use' },
    ) as { behavior: string; updatedInput: Record<string, unknown> };

    expect(result.behavior).toBe('allow');
    expect(result.updatedInput).toEqual({ path: '/test' });

    await commandPromise;
  });

  // Test 8: Unknown question ID
  it('submitAnswer returns false for unknown question ID', () => {
    const result = service.submitAnswer('nonexistent', {});
    expect(result).toBe(false);
  });

  // Test 9: Abort rejects pending questions
  it('abortCurrent aborts running command and rejects pending questions', async () => {
    let capturedCanUseTool: (
      toolName: string,
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;

    mockQueryFn.mockImplementation((params: { options?: { abortController?: AbortController; canUseTool?: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = params.options!.canUseTool!;
      const controller = params.options?.abortController;

      async function* abortableStream() {
        yield createInitMessage();
        await new Promise((_, reject) => {
          controller?.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }

      return Object.assign(abortableStream(), {
        interrupt: vi.fn(),
        close: vi.fn(),
      });
    });

    const commandPromise = service.runGsdCommand('/gsd:test', { timeoutMs: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Trigger a question
    const questionPromise = capturedCanUseTool!(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Continue?',
            header: 'Confirm',
            options: [{ label: 'Yes', description: 'Proceed' }],
            multiSelect: false,
          },
        ],
      },
      { signal: new AbortController().signal, toolUseID: 'test-tool-use' },
    );

    // Wait for question to be pending
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.getPendingQuestions()).toHaveLength(1);

    // Abort
    service.abortCurrent();

    // The question should be rejected
    await expect(questionPromise).rejects.toThrow('Command aborted');

    // The command should complete with timeout/abort result
    const result = await commandPromise;
    expect(result.success).toBe(false);

    // After abort, isRunning should be false
    expect(service.isRunning).toBe(false);
  });

  // Test 10: No result message
  it('runGsdCommand returns error when no result message received', async () => {
    // Generator yields only init, no result
    mockQueryFn.mockReturnValue(
      createMockQuery([createInitMessage()]),
    );

    const result = await service.runGsdCommand('/gsd:test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No result message');
    expect(result.sessionId).toBe('test-session');
  });
});
