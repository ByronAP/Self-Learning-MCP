// ===========================================================================
// Drift Detector — flags when agent behaviour diverges from stored patterns.
// ===========================================================================

import type Database from '../db/database.js';
import type { InsightRow, PatternRow, TraceStepRow } from '../db/database.js';

/** Minimum number of recent steps needed before we attempt drift analysis. */
const MIN_STEPS_FOR_ANALYSIS = 5;

/** Keyword-overlap threshold below which we consider a trace "drifted". */
const DRIFT_KEYWORD_THRESHOLD = 0.15;

/**
 * Detect drift between recent agent behaviour and established patterns.
 *
 * Algorithm:
 *   1. Get the most recent completed traces (last 10).
 *   2. For each trace's project, fetch stored patterns.
 *   3. Extract keywords from trace step actions.
 *   4. Compute keyword overlap between steps and pattern descriptions.
 *   5. If overlap is below threshold → create a drift insight.
 *
 * @returns Number of insights created.
 */
export function detectDrift(db: Database): number {
  let created = 0;

  // Active drift insights — deduplicate.
  const activeInsights = db.getActiveInsights().filter(
    (i: InsightRow) => i.type === 'drift',
  );
  const existingContentSet = new Set(activeInsights.map((i: InsightRow) => i.content));

  // Get recent completed traces.
  const recentTraces = db.db
    .prepare(
      `SELECT * FROM traces
       WHERE status IN ('completed', 'failed')
         AND project IS NOT NULL
       ORDER BY ended_at DESC
       LIMIT 10`,
    )
    .all() as Array<{
    id: string;
    description: string;
    project: string;
    status: string;
  }>;

  // Group by project for batch analysis.
  const byProject = new Map<string, string[]>();
  for (const t of recentTraces) {
    if (!t.project) continue;
    const list = byProject.get(t.project) ?? [];
    list.push(t.id);
    byProject.set(t.project, list);
  }

  for (const [project, traceIds] of byProject) {
    // Collect step actions for all traces in this project.
    const placeholders = traceIds.map(() => '?').join(',');
    const steps = db.db
      .prepare(
        `SELECT * FROM trace_steps WHERE trace_id IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...traceIds) as TraceStepRow[];

    if (steps.length < MIN_STEPS_FOR_ANALYSIS) continue;

    // Extract keywords from step actions + tools.
    const stepKeywords = extractKeywords(
      steps.map((s) => `${s.action} ${s.tool ?? ''}`).join(' '),
    );

    if (stepKeywords.size === 0) continue;

    // Get project patterns.
    const patterns: PatternRow[] = db.getPatternsByProject(project);
    if (patterns.length === 0) continue; // No patterns → nothing to drift from.

    // Extract keywords from all pattern descriptions.
    const patternKeywords = extractKeywords(
      patterns.map((p) => p.description).join(' '),
    );

    if (patternKeywords.size === 0) continue;

    // Compute overlap ratio.
    const overlap = keywordOverlap(stepKeywords, patternKeywords);

    if (overlap < DRIFT_KEYWORD_THRESHOLD) {
      const content = `[drift] Project "${project}": recent trace actions show ${Math.round(overlap * 100)}% keyword overlap with ${patterns.length} stored patterns (threshold: ${Math.round(DRIFT_KEYWORD_THRESHOLD * 100)}%)`;

      if (!existingContentSet.has(content)) {
        db.createInsight('drift', 'W', content);
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

/** Common stop-words to exclude from keyword extraction. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'and', 'but', 'or', 'nor', 'not',
  'so', 'yet', 'if', 'then', 'else', 'when', 'up', 'out', 'no', 'yes',
  'it', 'its', 'this', 'that', 'these', 'those', 'null', 'true', 'false',
]);

/** Extract meaningful keywords from text (lowercased, de-duped). */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/** Compute Jaccard-style overlap between two keyword sets. */
function keywordOverlap(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
