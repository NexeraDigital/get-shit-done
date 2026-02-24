import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, extractPhasesFromContent } from '../index.js';
import type { OrchestratorOptions } from '../index.js';
import type { AutopilotState, PhaseState } from '../../types/state.js';
import type { AutopilotConfig } from '../../types/config.js';
import type { CommandResult } from '../../claude/types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../yolo-config.js', () => ({
  writeYoloConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../discuss-handler.js', () => ({
  writeSkipDiscussContext: vi.fn().mockResolvedValue('/test/project/.planning/phases/01-test/01-CONTEXT.md'),
}));

vi.mock('../gap-detector.js', () => ({
  checkForGaps: vi.fn().mockResolvedValue(false),
}));

// Import mocked modules so we can configure them per test
import { writeYoloConfig } from '../yolo-config.js';
import { writeSkipDiscussContext } from '../discuss-handler.js';
import { checkForGaps } from '../gap-detector.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDefaultConfig(overrides?: Partial<AutopilotConfig>): AutopilotConfig {
  return {
    notify: 'console',
    questionReminderMs: 300_000,
    port: 3847,
    depth: 'standard',
    model: 'balanced',
    skipDiscuss: false,
    skipVerify: false,
    verbose: false,
    quiet: false,
    ...overrides,
  };
}

function createPhase(number: number, name: string, overrides?: Partial<PhaseState>): PhaseState {
  return {
    number,
    name,
    status: 'pending',
    steps: {
      discuss: 'idle',
      plan: 'idle',
      execute: 'idle',
      verify: 'idle',
    },
    commits: [],
    gapIterations: 0,
    ...overrides,
  };
}

function createState(overrides?: Partial<AutopilotState>): AutopilotState {
  return {
    status: 'running',
    currentPhase: 1,
    currentStep: 'idle',
    phases: [createPhase(1, 'Foundation')],
    pendingQuestions: [],
    errorHistory: [],
    startedAt: '2026-01-01T00:00:00Z',
    lastUpdatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function successResult(): CommandResult {
  return {
    success: true,
    result: 'Done',
    sessionId: 'sess-1',
    durationMs: 100,
    costUsd: 0.01,
    numTurns: 1,
  };
}

function failureResult(error = 'Something went wrong'): CommandResult {
  return {
    success: false,
    error,
    sessionId: 'sess-1',
    durationMs: 100,
    costUsd: 0.01,
    numTurns: 1,
  };
}

interface MockDeps {
  stateStore: {
    getState: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    filePath: string;
  };
  claudeService: {
    runGsdCommand: ReturnType<typeof vi.fn>;
    abortCurrent: ReturnType<typeof vi.fn>;
    isRunning: boolean;
  };
  logger: {
    log: ReturnType<typeof vi.fn>;
    createPhaseLogger: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
  };
  config: AutopilotConfig;
  projectDir: string;
}

function createMockDeps(overrides?: Partial<MockDeps>): MockDeps {
  const state = createState();
  return {
    stateStore: {
      getState: vi.fn().mockReturnValue(state),
      setState: vi.fn().mockResolvedValue(undefined),
      filePath: '/test/project/.planning/autopilot-state.json',
      ...overrides?.stateStore,
    },
    claudeService: {
      runGsdCommand: vi.fn().mockResolvedValue(successResult()),
      abortCurrent: vi.fn(),
      isRunning: false,
      ...overrides?.claudeService,
    },
    logger: {
      log: vi.fn(),
      createPhaseLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      flush: vi.fn().mockResolvedValue(undefined),
      ...overrides?.logger,
    },
    config: overrides?.config ?? createDefaultConfig(),
    projectDir: overrides?.projectDir ?? '/test/project',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator', () => {
  let deps: MockDeps;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    orchestrator = new Orchestrator(deps as unknown as OrchestratorOptions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Sequences through all steps for a single phase
  // -------------------------------------------------------------------------
  it('sequences through discuss, plan, execute, verify for a single phase', async () => {
    await orchestrator.run('/test/prd.md');

    const calls = deps.claudeService.runGsdCommand.mock.calls;
    // Filter out init call if any (phase 0 check)
    const stepCalls = calls.map((c: unknown[]) => c[0] as string);

    expect(stepCalls).toContain('/gsd:discuss-phase 1');
    expect(stepCalls).toContain('/gsd:plan-phase 1');
    expect(stepCalls).toContain('/gsd:execute-phase 1');
    expect(stepCalls).toContain('/gsd:verify-work 1');

    // Verify ordering: discuss before plan before execute before verify
    const discussIdx = stepCalls.indexOf('/gsd:discuss-phase 1');
    const planIdx = stepCalls.indexOf('/gsd:plan-phase 1');
    const executeIdx = stepCalls.indexOf('/gsd:execute-phase 1');
    const verifyIdx = stepCalls.indexOf('/gsd:verify-work 1');

    expect(discussIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(executeIdx);
    expect(executeIdx).toBeLessThan(verifyIdx);
  });

  // -------------------------------------------------------------------------
  // Test 2: Skips completed steps on resume
  // -------------------------------------------------------------------------
  it('skips completed steps on resume', async () => {
    const state = createState({
      phases: [
        createPhase(1, 'Foundation', {
          status: 'in_progress',
          steps: { discuss: 'done', plan: 'done', execute: 'idle', verify: 'idle' },
        }),
      ],
    });
    deps.stateStore.getState.mockReturnValue(state);

    await orchestrator.run('/test/prd.md');

    const calls = deps.claudeService.runGsdCommand.mock.calls;
    const stepCalls = calls.map((c: unknown[]) => c[0] as string);

    expect(stepCalls).not.toContain('/gsd:discuss-phase 1');
    expect(stepCalls).not.toContain('/gsd:plan-phase 1');
    expect(stepCalls).toContain('/gsd:execute-phase 1');
    expect(stepCalls).toContain('/gsd:verify-work 1');
  });

  // -------------------------------------------------------------------------
  // Test 3: Skips completed phases
  // -------------------------------------------------------------------------
  it('skips completed phases', async () => {
    const state = createState({
      phases: [
        createPhase(1, 'Foundation', { status: 'completed' }),
        createPhase(2, 'Integration'),
      ],
    });
    deps.stateStore.getState.mockReturnValue(state);

    await orchestrator.run('/test/prd.md');

    const calls = deps.claudeService.runGsdCommand.mock.calls;
    const stepCalls = calls.map((c: unknown[]) => c[0] as string);

    // Phase 1 steps should NOT appear
    expect(stepCalls.some((c: string) => c.includes('phase 1') || c.includes('work 1'))).toBe(false);
    // Phase 2 steps should appear
    expect(stepCalls).toContain('/gsd:discuss-phase 2');
    expect(stepCalls).toContain('/gsd:plan-phase 2');
  });

  // -------------------------------------------------------------------------
  // Test 4: Persists state before each ClaudeService call
  // -------------------------------------------------------------------------
  it('persists state before each ClaudeService call', async () => {
    const callOrder: string[] = [];

    deps.stateStore.setState.mockImplementation(async () => {
      callOrder.push('setState');
    });
    deps.claudeService.runGsdCommand.mockImplementation(async () => {
      callOrder.push('runGsdCommand');
      return successResult();
    });

    await orchestrator.run('/test/prd.md');

    // For each step, setState should appear before the corresponding runGsdCommand
    // Pattern: ...setState... runGsdCommand ...setState... runGsdCommand...
    // At minimum, there should be a setState before the first runGsdCommand
    const firstRun = callOrder.indexOf('runGsdCommand');
    const firstState = callOrder.indexOf('setState');
    expect(firstState).toBeLessThan(firstRun);

    // Every runGsdCommand should be preceded by at least one setState
    for (let i = 0; i < callOrder.length; i++) {
      if (callOrder[i] === 'runGsdCommand') {
        const precedingSetState = callOrder.slice(0, i).lastIndexOf('setState');
        expect(precedingSetState).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: Retries once on failure, then escalates
  // -------------------------------------------------------------------------
  it('retries once on failure, then escalates with error in state', async () => {
    deps.claudeService.runGsdCommand.mockResolvedValue(failureResult('Command failed'));

    const escalationEvents: unknown[] = [];
    orchestrator.on('error:escalation', (event) => escalationEvents.push(event));

    await expect(orchestrator.run('/test/prd.md')).rejects.toThrow('Command failed after retry');

    // Should have been called exactly 2 times for the discuss step
    // (first attempt + one retry)
    const discussCalls = deps.claudeService.runGsdCommand.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('discuss'),
    );
    expect(discussCalls).toHaveLength(2);

    // Error escalation event should have been emitted
    expect(escalationEvents).toHaveLength(1);

    // Error should be recorded in state
    const setStateCalls = deps.stateStore.setState.mock.calls;
    const errorHistoryCall = setStateCalls.find(
      (c: unknown[]) => (c[0] as Partial<AutopilotState>).errorHistory !== undefined,
    );
    expect(errorHistoryCall).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 6: Retries once and succeeds on second attempt
  // -------------------------------------------------------------------------
  it('retries once and succeeds on second attempt', async () => {
    deps.claudeService.runGsdCommand
      .mockResolvedValueOnce(failureResult('Transient error'))
      .mockResolvedValue(successResult());

    await orchestrator.run('/test/prd.md');

    // First call failed, second succeeded, then continues to plan/execute/verify
    expect(deps.claudeService.runGsdCommand.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  // -------------------------------------------------------------------------
  // Test 7: Skips discuss when config.skipDiscuss is true
  // -------------------------------------------------------------------------
  it('skips discuss when config.skipDiscuss is true', async () => {
    deps = createMockDeps({ config: createDefaultConfig({ skipDiscuss: true }) });
    orchestrator = new Orchestrator(deps as unknown as OrchestratorOptions);

    await orchestrator.run('/test/prd.md');

    // writeSkipDiscussContext should have been called
    expect(writeSkipDiscussContext).toHaveBeenCalledWith(
      '/test/project',
      expect.objectContaining({ number: 1, name: 'Foundation' }),
    );

    // No discuss runGsdCommand call
    const calls = deps.claudeService.runGsdCommand.mock.calls;
    const discussCalls = calls.filter((c: unknown[]) => (c[0] as string).includes('discuss'));
    expect(discussCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: Skips verify when config.skipVerify is true
  // -------------------------------------------------------------------------
  it('skips verify when config.skipVerify is true', async () => {
    deps = createMockDeps({ config: createDefaultConfig({ skipVerify: true }) });
    orchestrator = new Orchestrator(deps as unknown as OrchestratorOptions);

    await orchestrator.run('/test/prd.md');

    const calls = deps.claudeService.runGsdCommand.mock.calls;
    const verifyCalls = calls.filter((c: unknown[]) => (c[0] as string).includes('verify'));
    expect(verifyCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 9: Runs gap detection loop after verify
  // -------------------------------------------------------------------------
  it('runs gap detection loop after verify', async () => {
    const checkForGapsMock = vi.mocked(checkForGaps);
    checkForGapsMock
      .mockResolvedValueOnce(true)   // First verify: gaps found
      .mockResolvedValueOnce(false); // Second verify: no gaps

    await orchestrator.run('/test/prd.md');

    // checkForGaps should have been called twice
    expect(checkForGapsMock).toHaveBeenCalledTimes(2);

    // Should have re-plan with --gaps and re-execute with --gaps-only
    const calls = deps.claudeService.runGsdCommand.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((c: string) => c.includes('--gaps'))).toBe(true);
    expect(calls.some((c: string) => c.includes('--gaps-only'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 10: Caps gap detection at 3 iterations
  // -------------------------------------------------------------------------
  it('caps gap detection at 3 iterations', async () => {
    const checkForGapsMock = vi.mocked(checkForGaps);
    checkForGapsMock.mockResolvedValue(true); // Always has gaps

    const gapEvents: unknown[] = [];
    orchestrator.on('gap:escalated', (event) => gapEvents.push(event));

    await orchestrator.run('/test/prd.md');

    // Should call checkForGaps exactly 3 times (3 verify iterations)
    expect(checkForGapsMock).toHaveBeenCalledTimes(3);

    // gap:escalated event should have been emitted
    expect(gapEvents).toHaveLength(1);
    expect(gapEvents[0]).toEqual({ phase: 1, iterations: 3 });
  });

  // -------------------------------------------------------------------------
  // Test 11: Stops on shutdown request and persists state
  // -------------------------------------------------------------------------
  it('stops on shutdown request and persists state', async () => {
    const state = createState({
      phases: [
        createPhase(1, 'Foundation'),
        createPhase(2, 'Integration'),
      ],
    });
    deps.stateStore.getState.mockReturnValue(state);

    // Request shutdown after first phase's discuss step starts
    let callCount = 0;
    deps.claudeService.runGsdCommand.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // After first command (discuss for phase 1), request shutdown
        // The step will complete but the next step check will stop
        orchestrator.requestShutdown();
      }
      return successResult();
    });

    await orchestrator.run('/test/prd.md');

    // Phase 2 should NOT have started (no discuss-phase 2 call)
    const calls = deps.claudeService.runGsdCommand.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((c: string) => c.includes('phase 2'))).toBe(false);

    // State should have been persisted with idle status
    const setStateCalls = deps.stateStore.setState.mock.calls;
    const idleCalls = setStateCalls.filter(
      (c: unknown[]) => (c[0] as Partial<AutopilotState>).status === 'idle',
    );
    expect(idleCalls.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 12: Emits phase:started and phase:completed events
  // -------------------------------------------------------------------------
  it('emits phase:started and phase:completed events', async () => {
    const startedEvents: unknown[] = [];
    const completedEvents: unknown[] = [];

    orchestrator.on('phase:started', (event) => startedEvents.push(event));
    orchestrator.on('phase:completed', (event) => completedEvents.push(event));

    await orchestrator.run('/test/prd.md');

    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]).toEqual({ phase: 1, name: 'Foundation' });

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toEqual({ phase: 1, name: 'Foundation' });
  });

  // -------------------------------------------------------------------------
  // Test 13: Writes YOLO config at startup
  // -------------------------------------------------------------------------
  it('writes YOLO config at startup', async () => {
    await orchestrator.run('/test/prd.md');

    expect(writeYoloConfig).toHaveBeenCalledWith('/test/project', deps.config);
  });

  // -------------------------------------------------------------------------
  // Test 14: Respects phaseRange filter
  // -------------------------------------------------------------------------
  it('respects phaseRange filter', async () => {
    const state = createState({
      phases: [
        createPhase(1, 'Foundation'),
        createPhase(2, 'Integration'),
        createPhase(3, 'Orchestrator'),
        createPhase(4, 'Server'),
        createPhase(5, 'Dashboard'),
      ],
    });
    deps.stateStore.getState.mockReturnValue(state);

    await orchestrator.run('/test/prd.md', [2, 3]);

    const calls = deps.claudeService.runGsdCommand.mock.calls.map((c: unknown[]) => c[0] as string);

    // Only phases 2 and 3 should have been executed
    expect(calls.some((c: string) => c.includes('phase 1') || c.includes('work 1'))).toBe(false);
    expect(calls.some((c: string) => c.includes('phase 2') || c.includes('work 2'))).toBe(true);
    expect(calls.some((c: string) => c.includes('phase 3') || c.includes('work 3'))).toBe(true);
    expect(calls.some((c: string) => c.includes('phase 4') || c.includes('work 4'))).toBe(false);
    expect(calls.some((c: string) => c.includes('phase 5') || c.includes('work 5'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 15: Does not retry on shutdown-aborted command
  // -------------------------------------------------------------------------
  it('does not retry on shutdown-aborted command', async () => {
    // First call fails and shutdown is requested during the call
    deps.claudeService.runGsdCommand.mockImplementation(async () => {
      orchestrator.requestShutdown();
      return failureResult('Aborted');
    });

    await orchestrator.run('/test/prd.md');

    // Should have called runGsdCommand only once (no retry because shutdown was requested)
    const discussCalls = deps.claudeService.runGsdCommand.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('discuss'),
    );
    expect(discussCalls).toHaveLength(1);

    // State should have been persisted with idle status
    const setStateCalls = deps.stateStore.setState.mock.calls;
    const idleCalls = setStateCalls.filter(
      (c: unknown[]) => (c[0] as Partial<AutopilotState>).status === 'idle',
    );
    expect(idleCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractPhasesFromContent tests
// ---------------------------------------------------------------------------

describe('extractPhasesFromContent', () => {
  it('parses phases from ROADMAP.md content', () => {
    const content = `# Roadmap

- [x] **Phase 1: Foundation**
- [ ] **Phase 2: Integration**
- [ ] **Phase 3: Orchestrator**
`;
    const phases = extractPhasesFromContent(content);

    expect(phases).toHaveLength(3);
    expect(phases[0]).toEqual({ number: 1, name: 'Foundation', completed: true, inserted: false, dependsOn: null });
    expect(phases[1]).toEqual({ number: 2, name: 'Integration', completed: false, inserted: false, dependsOn: null });
    expect(phases[2]).toEqual({ number: 3, name: 'Orchestrator', completed: false, inserted: false, dependsOn: null });
  });

  it('returns empty array for content with no phases', () => {
    const phases = extractPhasesFromContent('# Just a heading');
    expect(phases).toEqual([]);
  });

  it('parses phases from heading-format ROADMAP.md', () => {
    const content = `# ROADMAP: Hello World CLI

## Phase 1: Hello World (Core Greeting)

**Goal:** Users can run the CLI and receive a customized greeting.

## Phase 2: CLI Polish (Help & Error Handling)

**Goal:** Users have clear guidance on CLI usage.
`;
    const phases = extractPhasesFromContent(content);

    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({ number: 1, name: 'Hello World (Core Greeting)', completed: false, inserted: false, dependsOn: null });
    expect(phases[1]).toEqual({ number: 2, name: 'CLI Polish (Help & Error Handling)', completed: false, inserted: false, dependsOn: null });
  });

  it('parses decimal phases from checkbox-format ROADMAP.md', () => {
    const content = `# Roadmap

- [x] **Phase 6: Dashboard**
- [ ] **Phase 06.1: Browser Notifications**
- [ ] **Phase 7: Polish**
`;
    const phases = extractPhasesFromContent(content);

    expect(phases).toHaveLength(3);
    expect(phases[0]).toEqual({ number: 6, name: 'Dashboard', completed: true, inserted: false, dependsOn: null });
    expect(phases[1]).toEqual({ number: 6.1, name: 'Browser Notifications', completed: false, inserted: false, dependsOn: null });
    expect(phases[2]).toEqual({ number: 7, name: 'Polish', completed: false, inserted: false, dependsOn: null });
  });

  it('parses decimal phases from heading-format ROADMAP.md', () => {
    const content = `# ROADMAP

### Phase 03.1: Display Output

**Goal:** Show formatted output.

### Phase 04: Final Polish

**Goal:** Polish everything.
`;
    const phases = extractPhasesFromContent(content);

    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({ number: 3.1, name: 'Display Output', completed: false, inserted: false, dependsOn: null });
    expect(phases[1]).toEqual({ number: 4, name: 'Final Polish', completed: false, inserted: false, dependsOn: null });
  });

  // -------------------------------------------------------------------------
  // NEW TESTS - TDD RED PHASE
  // -------------------------------------------------------------------------

  it('merges checklist and heading-only phases', () => {
    const content = `# Roadmap

- [x] **Phase 1: Foundation**
- [ ] **Phase 2: Integration**
- [ ] **Phase 3: Orchestrator**

### Phase 3.1: Display Output (INSERTED)

**Goal:** Show output.

### Phase 06.1: Browser Notifications

**Goal:** Add browser notifications.

### Phase 8: Autopilot Command Integration

**Goal:** Enable autopilot via slash command.
`;
    const phases = extractPhasesFromContent(content);

    expect(phases).toHaveLength(6); // 3 checklist + 3 heading-only
    expect(phases.find(p => p.number === 3.1)).toBeDefined();
    expect(phases.find(p => p.number === 6.1)).toBeDefined();
    expect(phases.find(p => p.number === 8)).toBeDefined();

    // Heading-only phases should have completed: false
    expect(phases.find(p => p.number === 3.1)?.completed).toBe(false);
    expect(phases.find(p => p.number === 6.1)?.completed).toBe(false);
    expect(phases.find(p => p.number === 8)?.completed).toBe(false);

    // Checklist phases should retain their completion status
    expect(phases.find(p => p.number === 1)?.completed).toBe(true);
    expect(phases.find(p => p.number === 2)?.completed).toBe(false);
    expect(phases.find(p => p.number === 3)?.completed).toBe(false);
  });

  it('extracts inserted flag from (INSERTED) marker', () => {
    const content = `# Roadmap

- [ ] **Phase 3: Core**

### Phase 03.2: Add Sub phase support (INSERTED)

**Goal:** Fix extraction.

### Phase 4: Server

**Goal:** Add server.
`;
    const phases = extractPhasesFromContent(content);

    expect(phases.find(p => p.number === 3.2)?.inserted).toBe(true);
    expect(phases.find(p => p.number === 3)?.inserted).toBe(false);
    expect(phases.find(p => p.number === 4)?.inserted).toBe(false);
  });

  it('extracts dependsOn from heading section', () => {
    const content = `# Roadmap

### Phase 03.1: Display Output (INSERTED)

**Goal:** Stream output
**Depends on:** Phase 3

### Phase 06.1: Browser Notifications

**Goal:** Browser alerts
**Depends on:** Phase 6

### Phase 4: Server

**Goal:** Add server.
`;
    const phases = extractPhasesFromContent(content);

    expect(phases.find(p => p.number === 3.1)?.dependsOn).toBe('Phase 3');
    expect(phases.find(p => p.number === 6.1)?.dependsOn).toBe('Phase 6');
    expect(phases.find(p => p.number === 4)?.dependsOn).toBe(null);
  });

  it('merges heading metadata into checklist phases', () => {
    const content = `# Roadmap

- [x] **Phase 3: Core Orchestrator**

### Phase 3: Core Orchestrator (INSERTED)

**Goal:** Phase sequencing
**Depends on:** Phase 2
`;
    const phases = extractPhasesFromContent(content);

    const phase3 = phases.find(p => p.number === 3);
    expect(phase3).toBeDefined();
    expect(phase3?.completed).toBe(true); // from checklist (authoritative)
    expect(phase3?.inserted).toBe(true);  // from heading metadata
    expect(phase3?.dependsOn).toBe('Phase 2'); // from heading metadata
  });

  it('sorts phases numerically after merge', () => {
    const content = `# Roadmap

- [x] **Phase 7: Polish**
- [ ] **Phase 3: Core**
- [x] **Phase 1: Foundation**

### Phase 8: Autopilot Command

**Goal:** Enable slash command.

### Phase 3.2: Sub phase support (INSERTED)

**Goal:** Fix extraction.

### Phase 3.1: Display Output (INSERTED)

**Goal:** Stream output.

### Phase 06.1: Browser Notifications

**Goal:** Browser alerts.
`;
    const phases = extractPhasesFromContent(content);

    const numbers = phases.map(p => p.number);
    expect(numbers).toEqual([1, 3, 3.1, 3.2, 6.1, 7, 8]);
  });
});
