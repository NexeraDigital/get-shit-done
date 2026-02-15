// Result parser for Claude Agent SDK SDKResultMessage.
// Converts raw SDK result messages into structured CommandResult objects
// for the orchestrator to consume.

import type { CommandResult } from './types.js';

// Local interface matching the SDK's SDKResultMessage shape (duck-typing).
// Avoids importing the SDK package directly, which has runtime side effects
// (spawns processes) and keeps this module lightweight and testable.
export interface SDKResultLike {
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

/**
 * Converts an SDK result message into a structured CommandResult.
 *
 * @param message - The SDK result message (or any object matching SDKResultLike)
 * @param sessionId - Session ID captured from the init system message
 * @param startTimeMs - Timestamp (ms) when command execution started (Date.now() based)
 * @returns A CommandResult with success/failure status and extracted metadata
 */
export function parseResult(
  message: SDKResultLike,
  sessionId: string,
  startTimeMs: number,
): CommandResult {
  const durationMs = Date.now() - startTimeMs;
  const costUsd = message.total_cost_usd ?? 0;
  const numTurns = message.num_turns ?? 0;

  // Success case: subtype is 'success' AND is_error is not true
  if (message.subtype === 'success' && !message.is_error) {
    return {
      success: true,
      result: message.result,
      sessionId,
      durationMs,
      costUsd,
      numTurns,
    };
  }

  // Error case: either non-success subtype or is_error=true
  // For is_error=true with success subtype, preserve the result text
  if (message.subtype === 'success' && message.is_error) {
    return {
      success: false,
      result: message.result,
      sessionId,
      durationMs,
      costUsd,
      numTurns,
    };
  }

  // Error subtypes: error_max_turns, error_during_execution,
  // error_max_budget_usd, error_max_structured_output_retries
  const errors = message.errors;
  const error = errors && errors.length > 0
    ? errors.join('; ')
    : `Command failed: ${message.subtype}`;

  return {
    success: false,
    error,
    sessionId,
    durationMs,
    costUsd,
    numTurns,
  };
}
