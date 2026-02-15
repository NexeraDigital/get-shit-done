import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Finds the phase directory matching a given phase number.
 *
 * Reads `.planning/phases/` and finds the entry whose name starts with the
 * zero-padded phase number (e.g., phase 3 matches "03-core-orchestrator").
 *
 * @param projectDir - Root project directory (contains .planning/)
 * @param phaseNumber - Phase number to look up
 * @returns Full path to the matching phase directory
 * @throws Error if no matching directory is found
 */
export async function findPhaseDir(
  projectDir: string,
  phaseNumber: number,
): Promise<string> {
  const phasesDir = join(projectDir, '.planning', 'phases');
  const padded = String(phaseNumber).padStart(2, '0');

  const entries = await readdir(phasesDir);
  const match = entries.find((entry) => entry.startsWith(`${padded}-`));

  if (!match) {
    throw new Error(
      `No phase directory found for phase ${phaseNumber} (looking for "${padded}-*" in ${phasesDir})`,
    );
  }

  return join(phasesDir, match);
}

/**
 * Checks verification output files for gap indicators.
 *
 * Reads `{padded}-VERIFICATION.md` and `{padded}-UAT.md` from the phase
 * directory, looking for gap/failure indicators.
 *
 * Gap indicators:
 * - VERIFICATION.md: "gaps_found" or "GAPS_FOUND"
 * - UAT.md: "FAIL" or "Issue Found"
 *
 * Pass indicators:
 * - VERIFICATION.md: "passed" or "PASSED"
 *
 * If no files exist (ENOENT), assumes passed (returns false).
 *
 * @param projectDir - Root project directory
 * @param phaseNumber - Phase number to check
 * @returns true if gaps/failures found, false if passed or no files exist
 */
export async function checkForGaps(
  projectDir: string,
  phaseNumber: number,
): Promise<boolean> {
  const phaseDir = await findPhaseDir(projectDir, phaseNumber);
  const padded = String(phaseNumber).padStart(2, '0');

  // Check VERIFICATION.md
  try {
    const verificationPath = join(phaseDir, `${padded}-VERIFICATION.md`);
    const content = await readFile(verificationPath, 'utf-8');

    if (content.includes('gaps_found') || content.includes('GAPS_FOUND')) {
      return true;
    }
    if (content.includes('passed') || content.includes('PASSED')) {
      return false;
    }
  } catch (err: unknown) {
    // No verification file -- continue to check UAT
    if (!isEnoent(err)) throw err;
  }

  // Check UAT.md
  try {
    const uatPath = join(phaseDir, `${padded}-UAT.md`);
    const content = await readFile(uatPath, 'utf-8');

    if (content.includes('FAIL') || content.includes('Issue Found')) {
      return true;
    }
  } catch (err: unknown) {
    // No UAT file -- assume passed
    if (!isEnoent(err)) throw err;
  }

  return false; // Assume passed if no gap indicators found
}

/**
 * Type guard for ENOENT filesystem errors.
 */
function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}

/**
 * Parses a phase range string from the --phases CLI flag.
 *
 * Accepts:
 * - "N" -> { start: N, end: N }
 * - "N-M" -> { start: N, end: M }
 *
 * @param range - Phase range string
 * @returns Parsed range with start and end phase numbers
 * @throws Error on invalid format or when start > end
 */
export function parsePhaseRange(range: string): { start: number; end: number } {
  const match = range.match(/^(\d+)(?:-(\d+))?$/);

  if (!match) {
    throw new Error(
      `Invalid phase range: "${range}". Expected format: N or N-M (e.g., "3" or "2-5")`,
    );
  }

  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : start;

  if (start > end) {
    throw new Error(
      `Invalid phase range: start (${start}) > end (${end})`,
    );
  }

  return { start, end };
}
