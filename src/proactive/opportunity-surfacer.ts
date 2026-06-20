// ===========================================================================
// Opportunity Surfacer — identifies cross-project pattern reuse potential.
// ===========================================================================

import type Database from '../db/database.js';
import type { InsightRow, PatternRow } from '../db/database.js';

/** Minimum keyword overlap ratio to flag a cross-project opportunity. */
const CROSS_PROJECT_OVERLAP_THRESHOLD = 0.25;

/** Minimum number of patterns per project to consider it worth analysing. */
const MIN_PATTERNS_PER_PROJECT = 2;

/**
 * Surface opportunities by detecting cross-project pattern overlaps.
 *
 * Algorithm:
 *   1. Group all patterns by project.
 *   2. For each pair of projects, extract keywords from pattern descriptions.
 *   3. Compute keyword overlap.
 *   4. If overlap exceeds threshold → create an opportunity insight.
 *
 * @returns Number of insights created.
 */
export function surfaceOpportunities(db: Database): number {
  let created = 0;

  // De-dup.
  const activeInsights = db.getActiveInsights().filter(
    (i: InsightRow) => i.type === 'opportunity',
  );
  const existingContentSet = new Set(activeInsights.map((i: InsightRow) => i.content));

  // Group patterns by project.
  const allPatterns = db.db
    .prepare(`SELECT * FROM patterns WHERE project IS NOT NULL ORDER BY project`)
    .all() as PatternRow[];

  const byProject = new Map<string, PatternRow[]>();
  for (const p of allPatterns) {
    if (!p.project) continue;
    const list = byProject.get(p.project) ?? [];
    list.push(p);
    byProject.set(p.project, list);
  }

  const projectNames = [...byProject.keys()].filter(
    (name) => (byProject.get(name)?.length ?? 0) >= MIN_PATTERNS_PER_PROJECT,
  );

  // Compare each pair of projects.
  for (let i = 0; i < projectNames.length; i++) {
    for (let j = i + 1; j < projectNames.length; j++) {
      const projA = projectNames[i];
      const projB = projectNames[j];

      const kwA = extractKeywords(
        (byProject.get(projA) ?? []).map((p) => p.description).join(' '),
      );
      const kwB = extractKeywords(
        (byProject.get(projB) ?? []).map((p) => p.description).join(' '),
      );

      const overlap = keywordOverlap(kwA, kwB);
      if (overlap >= CROSS_PROJECT_OVERLAP_THRESHOLD) {
        const shared = [...kwA].filter((w) => kwB.has(w)).slice(0, 5);
        const content = `[opportunity] Projects "${projA}" and "${projB}" share ${Math.round(overlap * 100)}% pattern keyword overlap (shared: ${shared.join(', ')}) — consider cross-pollinating patterns`;

        if (!existingContentSet.has(content)) {
          db.createInsight('opportunity', 'I', content);
          existingContentSet.add(content);
          created++;
        }
      }
    }
  }

  // --- Opportunity: under-documented projects ---
  // Projects with traces but no patterns.
  const tracedProjects = db.db
    .prepare(
      `SELECT DISTINCT project FROM traces
       WHERE project IS NOT NULL AND status = 'completed'`,
    )
    .all() as Array<{ project: string }>;

  for (const { project } of tracedProjects) {
    if (byProject.has(project)) continue; // already has patterns

    const stats = db.getTraceStats(project);
    if (stats.completed >= 3) {
      const content = `[opportunity] Project "${project}" has ${stats.completed} completed traces but no patterns — synthesis could extract reusable knowledge`;

      if (!existingContentSet.has(content)) {
        db.createInsight('opportunity', 'I', content);
        existingContentSet.add(content);
        created++;
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'and', 'but', 'or', 'nor', 'not',
  'so', 'yet', 'if', 'then', 'else', 'when', 'up', 'out', 'no', 'yes',
  'it', 'its', 'this', 'that', 'these', 'those', 'null', 'true', 'false',
]);

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
