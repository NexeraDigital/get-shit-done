// Summary table renderer for parallel phase execution results.
// Produces test-runner-style output (like vitest/jest) showing pass/fail/skip per phase.

export interface PhaseResult {
  phaseNumber: number;
  name: string;
  success: boolean;
  skipped: boolean;
  error?: string;
  mergeStatus?: 'clean' | 'resolved' | 'conflict' | undefined;
}

/**
 * Renders a test-runner-style summary table from phase results.
 *
 * Example output:
 *   Phase Results
 *   ────────────────────────────────────────────
 *   + Phase 1  Scheduler          [PASS]  clean
 *   x Phase 2  Execution Engine   [FAIL]  conflict  Error: build failed
 *   - Phase 3  Dashboard          [SKIP]
 *   ────────────────────────────────────────────
 */
export function renderSummary(results: PhaseResult[]): string {
  const lines: string[] = [];

  lines.push('Phase Results');
  lines.push('─'.repeat(60));

  for (const r of results) {
    const icon = r.skipped ? '-' : r.success ? '+' : 'x';
    const status = r.skipped ? 'SKIP' : r.success ? 'PASS' : 'FAIL';
    const phaseLabel = `Phase ${r.phaseNumber}`;
    const mergeCol = r.mergeStatus ? `  ${r.mergeStatus}` : '';
    const errorCol = r.error ? `  ${r.error}` : '';

    lines.push(
      `${icon} ${phaseLabel.padEnd(10)} ${r.name.padEnd(30)} [${status}]${mergeCol}${errorCol}`,
    );
  }

  lines.push('─'.repeat(60));

  return lines.join('\n');
}
