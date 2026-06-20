// ===========================================================================
// Staleness Detector — flags patterns that haven't been validated recently
// or show signs of decay (high usage but low confidence).
// ===========================================================================

import type Database from '../db/database.js';
import type { PatternRow, InsightRow } from '../db/database.js';

/** Confidence threshold below which a used pattern is considered decayed. */
const DECAY_CONFIDENCE_THRESHOLD = 35;

/** Minimum hit count before we care about confidence decay. */
const DECAY_MIN_HITS = 3;

/**
 * Detect stale or decaying patterns and create insights.
 *
 * Two heuristics:
 *   1. **Unvalidated / stale**: `validated_at` is NULL or older than `stalenessDays`.
 *   2. **Decaying**: `hit_count >= DECAY_MIN_HITS` but `confidence < DECAY_CONFIDENCE_THRESHOLD`.
 *
 * @returns Number of insights created.
 */
export function detectStaleness(db: Database, stalenessDays: number): number {
  let created = 0;

  // Grab all active insights of type 'staleness' so we can de-dup.
  const activeInsights = db.getActiveInsights().filter(
    (i: InsightRow) => i.type === 'staleness',
  );
  const existingContentSet = new Set(activeInsights.map((i: InsightRow) => i.content));

  // --- Heuristic 1: patterns with stale or missing validated_at -----

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - stalenessDays);
  const cutoffIso = cutoffDate.toISOString();

  const stalePatterns = db.db
    .prepare(
      `SELECT * FROM patterns
       WHERE validated_at IS NULL
          OR validated_at < ?
       ORDER BY updated_at ASC
       LIMIT 50`,
    )
    .all(cutoffIso) as PatternRow[];

  for (const p of stalePatterns) {
    const daysSince = p.validated_at
      ? Math.floor(
          (Date.now() - new Date(p.validated_at).getTime()) / 86_400_000,
        )
      : null;

    const label = daysSince !== null
      ? `Pattern "${trunc(p.description)}" last validated ${daysSince}d ago (threshold: ${stalenessDays}d)`
      : `Pattern "${trunc(p.description)}" has never been validated`;

    const content = `[staleness] ${label} [pattern:${p.id}]`;

    if (!existingContentSet.has(content)) {
      db.createInsight('staleness', 'W', content, [p.id]);
      existingContentSet.add(content);
      created++;
    }
  }

  // --- Heuristic 2: high usage + low confidence (decay) ------

  const decayingPatterns = db.db
    .prepare(
      `SELECT * FROM patterns
       WHERE hit_count >= ?
         AND confidence < ?
       ORDER BY confidence ASC
       LIMIT 30`,
    )
    .all(DECAY_MIN_HITS, DECAY_CONFIDENCE_THRESHOLD) as PatternRow[];

  for (const p of decayingPatterns) {
    const content = `[staleness] Pattern "${trunc(p.description)}" shows decay: confidence=${p.confidence}% with ${p.hit_count} hits [pattern:${p.id}]`;

    if (!existingContentSet.has(content)) {
      db.createInsight('staleness', 'W', content, [p.id]);
      existingContentSet.add(content);
      created++;
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a string for display purposes. */
function trunc(s: string, max: number = 60): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
