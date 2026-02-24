import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MilestoneResponse, MilestoneInfo } from './types.js';

/**
 * Parse milestone data from GSD planning files
 * @param planningDir - Path to .planning directory
 * @returns MilestoneResponse with current and shipped milestones
 */
export function parseMilestoneData(planningDir: string): MilestoneResponse {
  // Read all three source files
  const projectMd = readFile(join(planningDir, 'PROJECT.md'));
  const milestonesMd = readFile(join(planningDir, 'MILESTONES.md'));
  const roadmapMd = readFile(join(planningDir, 'ROADMAP.md'));

  // Extract current milestone identity from PROJECT.md
  const currentMilestoneHeader = extractCurrentMilestone(projectMd);

  // Extract shipped milestone entries from MILESTONES.md
  const shippedEntries = extractShippedMilestones(milestonesMd);

  // Parse ROADMAP.md for phase/plan counts
  const roadmapStats = parseRoadmapStats(roadmapMd);

  // Cross-reference to determine current milestone status
  let current: MilestoneInfo | null = null;
  if (currentMilestoneHeader) {
    const { version, name } = currentMilestoneHeader;
    const shippedEntry = shippedEntries.find(e => e.version === version);

    if (shippedEntry) {
      // Milestone was shipped
      current = {
        version,
        name,
        status: 'shipped',
        shippedDate: shippedEntry.shippedDate,
        phaseCount: shippedEntry.phaseCount,
        planCount: shippedEntry.planCount,
        phasesCompleted: shippedEntry.phasesCompleted,
        accomplishments: shippedEntry.accomplishments,
      };
    } else {
      // Milestone is active
      current = {
        version,
        name,
        status: 'active',
        phaseCount: roadmapStats.phaseCount,
        planCount: roadmapStats.planCount,
        phasesCompleted: roadmapStats.phasesCompleted,
        accomplishments: [],
      };
    }
  }

  return {
    current,
    shipped: shippedEntries.map(e => ({
      version: e.version,
      name: e.name,
      status: 'shipped' as const,
      shippedDate: e.shippedDate,
      phaseCount: e.phaseCount,
      planCount: e.planCount,
      phasesCompleted: e.phasesCompleted,
      accomplishments: e.accomplishments,
    })),
  };
}

/**
 * Read file with ENOENT handling
 */
function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}

/**
 * Extract current milestone header from PROJECT.md
 */
function extractCurrentMilestone(projectMd: string): { version: string; name: string } | null {
  const match = projectMd.match(/##\s+Current Milestone:\s+(v[\d.]+)\s+(.+)/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    version: match[1].trim(),
    name: match[2].trim(),
  };
}

interface ShippedEntry {
  version: string;
  name: string;
  shippedDate: string;
  phaseCount: number;
  planCount: number;
  phasesCompleted: number;
  accomplishments: string[];
}

/**
 * Extract shipped milestone entries from MILESTONES.md
 */
function extractShippedMilestones(milestonesMd: string): ShippedEntry[] {
  if (!milestonesMd) return [];

  const entries: ShippedEntry[] = [];

  // Match milestone headers and their content
  const headerPattern = /##\s+(v[\d.]+)\s+(.+?)\s+\(Shipped:\s+([\d-]+)\)/g;
  let match;

  while ((match = headerPattern.exec(milestonesMd)) !== null) {
    if (!match[1] || !match[2] || !match[3]) continue;

    const version = match[1].trim();
    const name = match[2].trim();
    const shippedDate = match[3].trim();

    // Extract content after this header until next header or end
    const startPos = match.index + match[0].length;
    const nextHeaderMatch = milestonesMd.slice(startPos).match(/\n##\s+/);
    const endPos = nextHeaderMatch && nextHeaderMatch.index !== undefined
      ? startPos + nextHeaderMatch.index
      : milestonesMd.length;
    const content = milestonesMd.slice(startPos, endPos);

    // Extract accomplishments (bullet list after "Key accomplishments:")
    const accomplishments: string[] = [];
    const accomMatch = content.match(/\*\*Key accomplishments:\*\*\s*\n((?:[-*]\s+.+\n?)+)/);
    if (accomMatch && accomMatch[1]) {
      const lines = accomMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          accomplishments.push(trimmed.slice(1).trim());
        }
      }
    }

    // Extract plan count from Stats section
    let planCount = 0;
    const statsMatch = content.match(/\*\*Stats:\*\*\s+(\d+)\s+plans/);
    if (statsMatch && statsMatch[1]) {
      planCount = parseInt(statsMatch[1], 10);
    }

    // Extract phase count from "Phases completed" section
    let phaseCount = 0;
    let phasesCompleted = 0;
    const phasesMatch = content.match(/\*\*Phases completed:\*\*\s+(.+)/);
    if (phasesMatch && phasesMatch[1]) {
      const rangeText = phasesMatch[1].trim();
      const rangeMatch = rangeText.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
      if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
        const start = parseFloat(rangeMatch[1]);
        const end = parseFloat(rangeMatch[2]);
        phaseCount = Math.floor(end - start + 1);
        phasesCompleted = phaseCount; // All completed if shipped
      }
    }

    entries.push({
      version,
      name,
      shippedDate,
      phaseCount,
      planCount,
      phasesCompleted,
      accomplishments,
    });
  }

  return entries;
}

interface RoadmapStats {
  phaseCount: number;
  planCount: number;
  phasesCompleted: number;
}

/**
 * Parse phase and plan counts from ROADMAP.md
 */
function parseRoadmapStats(roadmapMd: string): RoadmapStats {
  if (!roadmapMd) {
    return { phaseCount: 0, planCount: 0, phasesCompleted: 0 };
  }

  let phaseCount = 0;
  let planCount = 0;
  let phasesCompleted = 0;

  // Find the progress table
  const tableMatch = roadmapMd.match(/##\s+Progress[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|([\s\S]*?)(?=\n##|$)/);
  if (!tableMatch) {
    return { phaseCount: 0, planCount: 0, phasesCompleted: 0 };
  }

  if (!tableMatch[1]) {
    return { phaseCount: 0, planCount: 0, phasesCompleted: 0 };
  }

  const rows = tableMatch[1].split('\n').filter(line => line.includes('|'));

  for (const row of rows) {
    const cols = row.split('|').map(c => c.trim());
    if (cols.length < 3) continue;

    // Skip separator rows
    if (!cols[1] || cols[1].includes('---')) continue;

    // Extract phase number and plans
    const phaseCol = cols[1];
    const plansCol = cols[2];
    const statusCol = cols[3];

    if (!phaseCol) continue;

    // Parse phase number (handles "1.", "03.1.", etc.)
    const phaseMatch = phaseCol.match(/^(\d+(?:\.\d+)?)\./);
    if (phaseMatch) {
      phaseCount++;

      // Check if complete
      if (statusCol && statusCol.toLowerCase().includes('complete')) {
        phasesCompleted++;
      }

      // Parse plan count (e.g., "4/4" or "2/4")
      if (plansCol) {
        const plansMatch = plansCol.match(/(\d+)\/(\d+)/);
        if (plansMatch && plansMatch[2]) {
          planCount += parseInt(plansMatch[2], 10);
        }
      }
    }
  }

  return { phaseCount, planCount, phasesCompleted };
}
