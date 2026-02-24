import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Zero-pads a phase number, handling decimals correctly.
 *
 * Pads only the integer part to at least 2 digits.
 * Examples: 3 → "03", 3.1 → "03.1", 12 → "12", 12.1 → "12.1"
 */
export function padPhaseNumber(num: number): string {
  const str = String(num);
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) return str.padStart(2, '0');
  const intPart = str.slice(0, dotIndex).padStart(2, '0');
  return intPart + str.slice(dotIndex);
}

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
  const padded = padPhaseNumber(phaseNumber);

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
  const padded = padPhaseNumber(phaseNumber);

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
 * - "N" -> [N]
 * - "N-M" -> [N, N+1, ..., M]
 * - "N,M,..." -> [N, M, ...]
 * - "N-M,O,P-Q" -> [N, N+1, ..., M, O, P, P+1, ..., Q]
 *
 * Returns a sorted, deduplicated array of phase numbers.
 *
 * @param range - Phase range string
 * @returns Sorted array of phase numbers
 * @throws Error on invalid format or when start > end in any range
 */
export function parsePhaseRange(range: string): number[] {
  const phases: number[] = [];
  const segments = range.split(',').map((s) => s.trim());

  for (const segment of segments) {
    // Single number: "3" or decimal "3.1"
    if (/^\d+(\.\d+)?$/.test(segment)) {
      phases.push(parseFloat(segment));
      continue;
    }

    // Range: "2-5" or "2.1-5.3"
    const rangeMatch = segment.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      const start = parseFloat(rangeMatch[1]!);
      const end = parseFloat(rangeMatch[2]!);

      if (start > end) {
        throw new Error(
          `Invalid phase range: start (${start}) > end (${end}) in segment "${segment}"`,
        );
      }

      // For integer endpoints, enumerate all integers in range
      if (Number.isInteger(start) && Number.isInteger(end)) {
        for (let i = start; i <= end; i++) {
          phases.push(i);
        }
      } else {
        // Decimal endpoints: just push start and end (can't enumerate decimals)
        phases.push(start);
        if (start !== end) phases.push(end);
      }
      continue;
    }

    // Invalid format
    throw new Error(
      `Invalid phase specifier: "${segment}". Expected format: "N", "N-M", or comma-separated (e.g., "1-3,5,7-9")`,
    );
  }

  // Sort and deduplicate
  return Array.from(new Set(phases)).sort((a, b) => a - b);
}
