// ===========================================================================
// Risk Forecaster — flags fragile areas where corrections cluster.
// ===========================================================================

import type Database from '../db/database.js';
import type { InsightRow } from '../db/database.js';

/** A project with more than this many corrections is flagged. */
const CORRECTION_CLUSTER_THRESHOLD = 3;

/** A project with a failure rate above this % is flagged. */
const FAILURE_RATE_THRESHOLD = 40;

/**
 * Forecast risks by analysing correction clusters and failure rates.
 *
 * Heuristics:
 *   1. **Correction clusters**: projects whose traces have accumulated many
 *      corrections, indicating the area is fragile / poorly understood.
 *   2. **High failure rate**: projects where trace failure rate exceeds
 *      a threshold.
 *
 * @returns Number of insights created.
 */
export function forecastRisks(db: Database): number {
  let created = 0;

  // De-dup against active risk insights.
  const activeInsights = db.getActiveInsights().filter(
    (i: InsightRow) => i.type === 'risk',
  );
  const existingContentSet = new Set(activeInsights.map((i: InsightRow) => i.content));

  // --- Heuristic 1: per-project correction clustering -----

  // Get distinct projects from traces.
  const projects = db.db
    .prepare(
      `SELECT DISTINCT project FROM traces WHERE project IS NOT NULL`,
    )
    .all() as Array<{ project: string }>;

  for (const { project } of projects) {
    // Count corrections for this project.
    const corrRow = db.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM corrections c
         JOIN traces t ON t.id = c.trace_id
         WHERE t.project = ?`,
      )
      .get(project) as { cnt: number };

    if (corrRow.cnt >= CORRECTION_CLUSTER_THRESHOLD) {
      const content = `[risk] Project "${project}" has ${corrRow.cnt} corrections — this area may be fragile`;

      if (!existingContentSet.has(content)) {
        db.createInsight('risk', 'W', content);
        existingContentSet.add(content);
        created++;
      }
    }

    // --- Heuristic 2: high failure rate -----

    const stats = db.getTraceStats(project);
    if (stats.total >= 3 && stats.successRate < (100 - FAILURE_RATE_THRESHOLD)) {
      const failureRate = 100 - stats.successRate;
      const content = `[risk] Project "${project}" has a ${failureRate}% failure rate across ${stats.total} traces`;

      if (!existingContentSet.has(content)) {
        db.createInsight('risk', 'E', content);
        existingContentSet.add(content);
        created++;
      }
    }
  }

  // --- Heuristic 3: global correction clustering by trace -----

  const globalFreq = db.getCorrectionFrequency();
  for (const entry of globalFreq.byTrace) {
    if (entry.count >= CORRECTION_CLUSTER_THRESHOLD) {
      const content = `[risk] Trace ${entry.trace_id} accumulated ${entry.count} corrections — review for systemic issues`;

      if (!existingContentSet.has(content)) {
        db.createInsight('risk', 'W', content, [entry.trace_id]);
        existingContentSet.add(content);
        created++;
      }
    }
  }

  return created;
}
