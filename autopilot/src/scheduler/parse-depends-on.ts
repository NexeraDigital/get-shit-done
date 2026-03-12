/**
 * Parses the raw dependsOn string from ROADMAP.md into an array of phase numbers.
 *
 * Handles formats:
 *   null | "" -> []
 *   "Nothing" | "Nothing (first phase)" -> []
 *   "Phase 1" -> [1]
 *   "Phase 1, Phase 2" -> [1, 2]
 *   "Phase 1 and Phase 3" -> [1, 3]
 *   "Phases 1, 2" -> [1, 2]
 *   "Phase 2.1" -> [2.1] (decimal/inserted phases)
 */
export function parseDependsOn(raw: string | null): number[] {
  if (!raw || /^nothing/i.test(raw.trim())) return [];

  const numbers: number[] = [];
  const matches = raw.matchAll(/(\d+(?:\.\d+)?)/g);
  for (const m of matches) {
    numbers.push(parseFloat(m[1]!));
  }

  return [...new Set(numbers)];
}
