// ===========================================================================
// Briefing Assembler — gathers context for a new task before the agent starts.
// ===========================================================================

import type Database from '../db/database.js';
import type {
  PatternRow,
  CorrectionRow,
  InsightRow,
  TraceRow,
} from '../db/database.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Briefing {
  /** Patterns matched via FTS against the task description. */
  relevantPatterns: PatternRow[];

  /** Past traces with similar descriptions (FTS + project filter). */
  similarTraces: Array<{
    trace: TraceRow;
    correctionCount: number;
  }>;

  /** Recent corrections from the same project. */
  recentCorrections: CorrectionRow[];

  /** Active risk & drift insights that apply. */
  activeRisks: InsightRow[];

  /** Active opportunity insights. */
  opportunities: InsightRow[];

  /** Quick stats for the project (if known). */
  projectStats: {
    total: number;
    successRate: number;
    avgStepsPerTrace: number;
  } | null;
}

/**
 * Assemble a briefing for a task.
 *
 * This gathers all deterministically-available context so the agent can
 * start a task with situational awareness. The returned data is raw — the
 * tools layer is responsible for encoding it via the codec.
 *
 * @param db              Database handle
 * @param taskDescription Free-text description of the upcoming task
 * @param project         Optional project name for scoping
 */
export function assembleBriefing(
  db: Database,
  taskDescription: string,
  project?: string,
): Briefing {
  // --- 1. Relevant patterns via FTS ---
  const relevantPatterns = safeSearchPatterns(db, taskDescription);

  // If a project is specified, also pull project-specific patterns.
  if (project) {
    const projectPatterns = db.getPatternsByProject(project);
    // Merge without duplicates.
    const seenIds = new Set(relevantPatterns.map((p) => p.id));
    for (const pp of projectPatterns) {
      if (!seenIds.has(pp.id)) {
        relevantPatterns.push(pp);
        seenIds.add(pp.id);
      }
    }
  }

  // Cap at 15 most relevant.
  relevantPatterns.splice(15);

  // --- 2. Similar past traces ---
  const similarTraces = findSimilarTraces(db, taskDescription, project);

  // --- 3. Recent corrections ---
  const recentCorrections: CorrectionRow[] = project
    ? db.getRecentCorrections(project, 10)
    : [];

  // --- 4. Active risk / drift insights ---
  const allActive = db.getActiveInsights();
  const activeRisks = allActive.filter(
    (i) => i.type === 'risk' || i.type === 'drift',
  );
  const opportunities = allActive.filter(
    (i) => i.type === 'opportunity',
  );

  // Filter to project-relevant insights if project is known.
  const filteredRisks = project
    ? activeRisks.filter((i) =>
        i.content.toLowerCase().includes(project.toLowerCase()),
      )
    : activeRisks;

  // --- 5. Project stats ---
  let projectStats: Briefing['projectStats'] = null;
  if (project) {
    const stats = db.getTraceStats(project);
    projectStats = {
      total: stats.total,
      successRate: stats.successRate,
      avgStepsPerTrace: stats.avgStepsPerTrace,
    };
  }

  return {
    relevantPatterns,
    similarTraces,
    recentCorrections,
    activeRisks: filteredRisks,
    opportunities,
    projectStats,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safe FTS pattern search — wraps words in quotes to avoid FTS5 syntax errors
 * from user-provided text.
 */
function safeSearchPatterns(db: Database, text: string): PatternRow[] {
  // Extract significant words, quote each for FTS safety.
  const words = text
    .replace(/[^a-zA-Z0-9_ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  // Try the full query first, fall back to individual words.
  const ftsQuery = words.map((w) => `"${w}"`).join(' OR ');
  try {
    return db.searchPatterns(ftsQuery);
  } catch {
    // If FTS fails, return empty — don't crash the briefing.
    return [];
  }
}

/**
 * Find traces with similar descriptions.
 */
function findSimilarTraces(
  db: Database,
  taskDescription: string,
  project?: string,
): Briefing['similarTraces'] {
  // Strategy: keyword match on trace description.
  const keywords = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9_ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (keywords.length === 0) return [];

  // Build a LIKE-based query (FTS is only on entities/patterns/wiki/insights,
  // not on traces).
  let sql = `SELECT * FROM traces WHERE status IN ('completed', 'failed')`;
  const params: unknown[] = [];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }

  // Match traces whose descriptions contain at least one keyword.
  const likeClauses = keywords.slice(0, 5).map((kw) => {
    params.push(`%${kw}%`);
    return `description LIKE ?`;
  });
  sql += ` AND (${likeClauses.join(' OR ')})`;
  sql += ` ORDER BY ended_at DESC LIMIT 10`;

  const traces = db.db.prepare(sql).all(...params) as TraceRow[];

  return traces.map((trace) => {
    const corrCount = db.db
      .prepare(`SELECT COUNT(*) as cnt FROM corrections WHERE trace_id = ?`)
      .get(trace.id) as { cnt: number };

    return {
      trace,
      correctionCount: corrCount.cnt,
    };
  });
}
