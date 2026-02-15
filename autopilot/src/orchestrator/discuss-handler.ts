import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface PhaseInfo {
  number: number;
  name: string;
}

/**
 * Converts a phase name into a slug: lowercase, hyphens for non-alphanumeric.
 * e.g., "Core Orchestrator" -> "core-orchestrator"
 */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Zero-pads a phase number to at least 2 digits.
 * e.g., 3 -> "03", 12 -> "12"
 */
function padPhase(num: number): string {
  return String(num).padStart(2, '0');
}

/**
 * Generates a CONTEXT.md string for a phase when --skip-discuss is set.
 * All decisions are deferred to Claude's discretion per DISC-04.
 *
 * Pure function -- no I/O.
 */
export function generateSkipDiscussContext(phase: PhaseInfo): string {
  const padded = padPhase(phase.number);
  const slug = slugify(phase.name);
  const now = new Date().toISOString().split('T')[0];

  return `# Phase ${phase.number}: ${phase.name} - Context

**Gathered:** ${now}
**Status:** Ready for planning (auto-generated, --skip-discuss)

<domain>
## Phase Boundary

Phase ${phase.number} as defined in ROADMAP.md. All implementation decisions deferred to Claude's discretion.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All areas deferred to Claude's discretion via --skip-discuss flag. Claude should make reasonable implementation choices based on research findings and standard practices.

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches (auto-generated via --skip-discuss)

</specifics>

<deferred>
## Deferred Ideas

None -- discussion skipped

</deferred>

---

*Phase: ${padded}-${slug}*
*Context gathered: ${now} (auto-generated)*
`;
}

/**
 * Writes the skip-discuss CONTEXT.md file to the appropriate phase directory.
 *
 * @param projectDir - Root project directory (contains .planning/)
 * @param phase - Phase info (number + name)
 * @returns The file path that was written
 */
export async function writeSkipDiscussContext(
  projectDir: string,
  phase: PhaseInfo,
): Promise<string> {
  const padded = padPhase(phase.number);
  const slug = slugify(phase.name);
  const dirName = `${padded}-${slug}`;
  const fileName = `${padded}-CONTEXT.md`;

  const dirPath = join(projectDir, '.planning', 'phases', dirName);
  const filePath = join(dirPath, fileName);

  const content = generateSkipDiscussContext(phase);

  await mkdir(dirPath, { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  return filePath;
}
