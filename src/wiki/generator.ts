import type { Database } from '../db/database.js';

/**
 * Wiki Generator — gathers data for wiki synthesis.
 *
 * The wiki uses the agent-cooperative pattern:
 * 1. Agent calls mem_regenerate_wiki → server gathers ALL data
 * 2. Agent reasons over the context
 * 3. Agent calls mem_commit_wiki with synthesized sections
 *
 * This module handles step 1: data gathering and structuring.
 */

export interface WikiContext {
  patterns: Array<{
    id: string;
    d: string;
    c: number;
    h: number;
    j: string | null;
    cond: string | null;
  }>;
  corrections: Array<{
    wrong: string;
    fix: string;
    cause: string | null;
    project: string | null;
  }>;
  entityCounts: Record<string, number>;
  projects: string[];
}

/**
 * Gather all data needed for wiki regeneration.
 */
export function gatherWikiContext(
  db: Database,
  project?: string,
): WikiContext {
  // Get all patterns (or filtered by project)
  const patterns = project
    ? db.getPatternsByProject(project)
    : getAllPatterns(db);

  // Get all corrections (grouped by project if available)
  const corrections = project
    ? db.getRecentCorrections(project, 50)
    : getAllCorrections(db);

  // Get entity counts
  const entityCounts = db.getEntityCount();

  // Get unique project list
  const projectSet = new Set<string>();
  for (const p of patterns) {
    if (p.project) projectSet.add(p.project);
  }

  return {
    patterns: patterns.map((p) => ({
      id: p.id,
      d: p.description,
      c: p.confidence,
      h: p.hit_count,
      j: p.project,
      cond: p.conditions,
    })),
    corrections: corrections.map((c) => ({
      wrong: c.wrong,
      fix: c.fix,
      cause: c.cause,
      project: null, // corrections don't have project directly
    })),
    entityCounts,
    projects: Array.from(projectSet),
  };
}

/**
 * Get all patterns across all projects.
 */
function getAllPatterns(db: Database) {
  // Use getEntitiesByType to find pattern entities, then cross-reference
  // Or use a direct query via the patterns table
  return db.db
    .prepare('SELECT * FROM patterns ORDER BY confidence DESC LIMIT 200')
    .all() as Array<{
    id: string;
    description: string;
    confidence: number;
    hit_count: number;
    conditions: string | null;
    project: string | null;
    validated_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

/**
 * Get all corrections across all projects.
 */
function getAllCorrections(db: Database) {
  return db.db
    .prepare(
      `SELECT c.* FROM corrections c
       ORDER BY c.created_at DESC
       LIMIT 100`,
    )
    .all() as Array<{
    id: string;
    trace_id: string;
    wrong: string;
    fix: string;
    cause: string | null;
    created_at: string;
  }>;
}
