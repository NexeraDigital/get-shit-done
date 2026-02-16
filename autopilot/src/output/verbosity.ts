/**
 * Verbosity filtering for SDK message display.
 *
 * Determines which message categories are shown at each verbosity level:
 * - quiet:   errors only (errors and escalations always visible)
 * - default: everything except system messages
 * - verbose: everything including system init/status
 */

export type VerbosityLevel = 'default' | 'quiet' | 'verbose';

export type MessageCategory =
  | 'content'
  | 'tool'
  | 'system'
  | 'error'
  | 'result'
  | 'status';

/**
 * Returns true if a message of the given category should be displayed
 * at the specified verbosity level.
 */
export function shouldDisplay(
  verbosity: VerbosityLevel,
  category: MessageCategory,
): boolean {
  switch (verbosity) {
    case 'quiet':
      return category === 'error';
    case 'default':
      return category !== 'system';
    case 'verbose':
      return true;
  }
}

/**
 * Maps an SDK message type (and optional subtype) to a display category.
 *
 * Message type mapping derived from SDK type definitions:
 *   SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKResultMessage
 *              | SDKSystemMessage | SDKPartialAssistantMessage
 *              | SDKToolProgressMessage | SDKToolUseSummaryMessage
 *              | SDKAuthStatusMessage | SDKTaskNotificationMessage | ...
 */
export function categorizeMessage(
  messageType: string,
  subtype?: string,
): MessageCategory {
  switch (messageType) {
    case 'stream_event':
      return 'content';
    case 'assistant':
      return 'content';
    case 'tool_progress':
      return 'tool';
    case 'tool_use_summary':
      return 'tool';
    case 'result':
      return 'result';
    case 'auth_status':
      return 'system';
    case 'system':
      switch (subtype) {
        case 'init':
          return 'system';
        case 'status':
          return 'status';
        case 'task_notification':
          return 'tool';
        default:
          return 'system';
      }
    default:
      return 'content';
  }
}
