/**
 * Color palette constants and agent prefix color map for terminal output.
 *
 * Uses ansis for ANSI color support with built-in strip() for log file output.
 * ansis auto-detects color support level (no colors, 256, truecolor).
 */

import ansis from 'ansis';

/**
 * Color palette for message type formatting.
 */
export const palette = {
  text: ansis.white,
  tool: ansis.cyan,
  toolName: ansis.bold.cyan,
  system: ansis.dim,
  error: ansis.bold.red,
  warning: ansis.yellow,
  success: ansis.green,
  result: ansis.bold.green,
  dim: ansis.dim,
  banner: ansis.bold.cyan,
} as const;

/**
 * Color map for sub-agent prefixes. Each agent type gets a distinct color
 * so users can visually distinguish nested agent output.
 */
export const agentColors: Record<string, typeof ansis.cyan> = {
  researcher: ansis.magenta,
  planner: ansis.blue,
  executor: ansis.green,
  checker: ansis.yellow,
  default: ansis.dim,
};

/**
 * Returns a colored prefix string for a given agent name, e.g. "[researcher] ".
 * Returns empty string if agentName is null (no sub-agent context).
 *
 * Note: ansis.strip() is available for stripping ANSI codes from log output.
 */
export function getAgentPrefix(agentName: string | null): string {
  if (!agentName) return '';
  const color = agentColors[agentName] ?? agentColors['default']!;
  return color(`[${agentName}] `);
}
