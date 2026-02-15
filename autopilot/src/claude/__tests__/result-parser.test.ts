import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseResult } from '../result-parser.js';
import type { CommandResult } from '../types.js';

// Factory helper for building minimal mock SDKResultMessage objects.
// Avoids importing the actual SDK which spawns processes.
interface MockSDKResultMessage {
  type: 'result';
  subtype: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
}

function createMockResult(overrides: Partial<MockSDKResultMessage> = {}): MockSDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Task completed successfully',
    total_cost_usd: 0.05,
    num_turns: 3,
    ...overrides,
  };
}

describe('parseResult', () => {
  let fakeNow: number;

  beforeEach(() => {
    // Fix Date.now() so durationMs is deterministic
    fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('success cases', () => {
    it('parses a successful result into CommandResult with success=true', () => {
      const message = createMockResult({
        subtype: 'success',
        is_error: false,
        result: 'All files updated successfully',
        total_cost_usd: 0.12,
        num_turns: 5,
      });

      const startTimeMs = fakeNow - 3000; // 3 seconds ago
      const result = parseResult(message, 'session-abc', startTimeMs);

      expect(result).toEqual({
        success: true,
        result: 'All files updated successfully',
        sessionId: 'session-abc',
        durationMs: 3000,
        costUsd: 0.12,
        numTurns: 5,
      });
    });

    it('captures session ID from the provided argument', () => {
      const message = createMockResult();
      const result = parseResult(message, 'my-session-id', fakeNow - 100);

      expect(result.sessionId).toBe('my-session-id');
    });

    it('calculates durationMs from startTimeMs to Date.now()', () => {
      const message = createMockResult();
      const startTimeMs = fakeNow - 7500;
      const result = parseResult(message, 'sess', startTimeMs);

      expect(result.durationMs).toBe(7500);
    });
  });

  describe('is_error=true overrides success subtype', () => {
    it('parses as failure when is_error=true even with success subtype', () => {
      const message = createMockResult({
        subtype: 'success',
        is_error: true,
        result: 'Something went wrong internally',
        total_cost_usd: 0.08,
        num_turns: 2,
      });

      const result = parseResult(message, 'sess-err', fakeNow - 1000);

      expect(result.success).toBe(false);
      expect(result.result).toBe('Something went wrong internally');
      expect(result.sessionId).toBe('sess-err');
      expect(result.durationMs).toBe(1000);
      expect(result.costUsd).toBe(0.08);
      expect(result.numTurns).toBe(2);
    });
  });

  describe('error subtypes', () => {
    it('parses error_max_turns as failure with descriptive error', () => {
      const message = createMockResult({
        subtype: 'error_max_turns',
        is_error: true,
        total_cost_usd: 0.50,
        num_turns: 100,
      });

      const result = parseResult(message, 'sess-1', fakeNow - 5000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed: error_max_turns');
      expect(result.costUsd).toBe(0.50);
      expect(result.numTurns).toBe(100);
    });

    it('parses error_max_budget_usd as failure with descriptive error', () => {
      const message = createMockResult({
        subtype: 'error_max_budget_usd',
        is_error: true,
        total_cost_usd: 10.00,
        num_turns: 50,
      });

      const result = parseResult(message, 'sess-2', fakeNow - 2000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed: error_max_budget_usd');
      expect(result.costUsd).toBe(10.00);
    });

    it('parses error_during_execution with errors array joined by semicolon', () => {
      const message = createMockResult({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['File not found: config.json', 'Permission denied: /etc/shadow'],
        total_cost_usd: 0.03,
        num_turns: 1,
      });

      const result = parseResult(message, 'sess-3', fakeNow - 800);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found: config.json; Permission denied: /etc/shadow');
      expect(result.durationMs).toBe(800);
    });

    it('falls back to Command failed message when errors array is empty', () => {
      const message = createMockResult({
        subtype: 'error_during_execution',
        is_error: true,
        errors: [],
        total_cost_usd: 0.01,
        num_turns: 1,
      });

      const result = parseResult(message, 'sess-4', fakeNow - 500);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed: error_during_execution');
    });

    it('falls back to Command failed message when errors array is undefined', () => {
      const message = createMockResult({
        subtype: 'error_during_execution',
        is_error: true,
        total_cost_usd: 0.02,
        num_turns: 2,
      });
      // Explicitly remove errors property
      delete message.errors;

      const result = parseResult(message, 'sess-5', fakeNow - 400);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed: error_during_execution');
    });
  });

  describe('default values', () => {
    it('defaults costUsd to 0 when total_cost_usd is undefined', () => {
      const message = createMockResult({
        subtype: 'success',
        is_error: false,
      });
      delete message.total_cost_usd;

      const result = parseResult(message, 'sess-def', fakeNow - 100);

      expect(result.costUsd).toBe(0);
    });

    it('defaults numTurns to 0 when num_turns is undefined', () => {
      const message = createMockResult({
        subtype: 'success',
        is_error: false,
      });
      delete message.num_turns;

      const result = parseResult(message, 'sess-def', fakeNow - 100);

      expect(result.numTurns).toBe(0);
    });

    it('defaults both costUsd and numTurns when both are undefined', () => {
      const message = createMockResult({
        subtype: 'success',
        is_error: false,
      });
      delete message.total_cost_usd;
      delete message.num_turns;

      const result = parseResult(message, 'sess-def', fakeNow - 200);

      expect(result.costUsd).toBe(0);
      expect(result.numTurns).toBe(0);
    });
  });

  describe('return type shape', () => {
    it('returns a valid CommandResult shape for success', () => {
      const message = createMockResult();
      const result = parseResult(message, 'sess-shape', fakeNow - 100);

      // success result should have result property, not error
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('costUsd');
      expect(result).toHaveProperty('numTurns');
    });

    it('returns a valid CommandResult shape for error', () => {
      const message = createMockResult({
        subtype: 'error_max_turns',
        is_error: true,
      });
      const result = parseResult(message, 'sess-shape-err', fakeNow - 100);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('costUsd');
      expect(result).toHaveProperty('numTurns');
    });
  });

  describe('edge cases', () => {
    it('handles single error in errors array', () => {
      const message = createMockResult({
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Syntax error in file.ts'],
      });

      const result = parseResult(message, 'sess-edge', fakeNow - 100);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Syntax error in file.ts');
    });

    it('handles result with zero durationMs', () => {
      const message = createMockResult();
      const result = parseResult(message, 'sess-zero', fakeNow);

      expect(result.durationMs).toBe(0);
    });

    it('handles result with zero cost', () => {
      const message = createMockResult({
        total_cost_usd: 0,
      });

      const result = parseResult(message, 'sess-free', fakeNow - 100);

      expect(result.costUsd).toBe(0);
    });
  });
});
