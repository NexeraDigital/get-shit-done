/**
 * Output module barrel export.
 *
 * Provides the complete output infrastructure for displaying SDK messages
 * in the terminal and persisting raw messages to a log file.
 */

export { StreamRenderer } from './stream-renderer.js';
export { StreamLogger } from './stream-logger.js';
export type { VerbosityLevel, MessageCategory } from './verbosity.js';
export { shouldDisplay, categorizeMessage } from './verbosity.js';
export { palette, agentColors, getAgentPrefix } from './colors.js';
export { renderBanner, renderPhaseBanner } from './banner.js';
