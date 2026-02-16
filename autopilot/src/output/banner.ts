/**
 * Phase/step banner rendering with Unicode box-drawing characters.
 *
 * Renders boxed titles for phase transitions and step changes,
 * providing clear visual separation in terminal output.
 *
 * Falls back to ASCII box characters on terminals that don't support Unicode
 * (detected via WT_SESSION env var or TERM_PROGRAM).
 */

import { palette } from './colors.js';

/** Check if the terminal supports Unicode box-drawing characters. */
function supportsUnicode(): boolean {
  // Windows Terminal sets WT_SESSION
  if (process.env['WT_SESSION']) return true;
  // Most modern terminals on macOS/Linux support Unicode
  if (process.platform !== 'win32') return true;
  // Check for known Unicode-capable terminal programs
  const termProgram = process.env['TERM_PROGRAM'] ?? '';
  if (termProgram === 'vscode' || termProgram === 'iTerm.app') return true;
  // Default: fallback to ASCII on Windows without WT_SESSION
  return false;
}

interface BoxChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

const unicodeBox: BoxChars = {
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
};

const asciiBox: BoxChars = {
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  horizontal: '-',
  vertical: '|',
};

/**
 * Render a boxed banner with a title and optional subtitle.
 *
 * Example output (Unicode):
 * ```
 * +-----------------------------+
 * | Phase 2: Core Orchestrator  |
 * | 2026-02-16 14:30:00         |
 * +-----------------------------+
 * ```
 */
export function renderBanner(title: string, subtitle?: string): string {
  const box = supportsUnicode() ? unicodeBox : asciiBox;
  const innerWidth = Math.max(title.length, subtitle?.length ?? 0) + 2;

  const top = `${box.topLeft}${box.horizontal.repeat(innerWidth)}${box.topRight}`;
  const titleLine = `${box.vertical} ${title.padEnd(innerWidth - 1)}${box.vertical}`;
  const subtitleLine = subtitle
    ? `${box.vertical} ${subtitle.padEnd(innerWidth - 1)}${box.vertical}`
    : '';
  const bottom = `${box.bottomLeft}${box.horizontal.repeat(innerWidth)}${box.bottomRight}`;

  const lines = [top, titleLine, subtitleLine, bottom].filter(Boolean);
  return palette.banner(lines.join('\n'));
}

/**
 * Render a phase/step transition banner with timestamp.
 *
 * @param phase - Phase number or string identifier
 * @param step - Step name (e.g., "plan", "execute", "verify")
 */
export function renderPhaseBanner(
  phase: number | string,
  step: string,
): string {
  const title = `Phase ${phase}: ${step}`;
  // ISO timestamp without milliseconds
  const now = new Date();
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return renderBanner(title, timestamp);
}
