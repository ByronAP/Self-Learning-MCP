// ===========================================================================
// Self-Learning MCP Server — SQLite Database Layer
// ===========================================================================

import BetterSqlite3, { type Database as SqliteDb } from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Embedded Schema (avoids needing the .sql file at runtime)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = /* sql */ `
-- Core Knowledge Graph

CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('T','P','E','S','J','C','R','X','I','W')),
  name       TEXT NOT NULL,
  metadata   TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS relationships (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel_type   TEXT NOT NULL CHECK (rel_type IN ('RB','DP','CB','IB','FB','TF','EF','UI')),
  metadata   TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Traces & Corrections

CREATE TABLE IF NOT EXISTS traces (
  id              TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  project         TEXT,
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','failed')),
  outcome         TEXT,
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at        TEXT
);

CREATE TABLE IF NOT EXISTS trace_steps (
  id         TEXT PRIMARY KEY,
  trace_id   TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  action     TEXT NOT NULL,
  tool       TEXT,
  result     TEXT,
  success    INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS corrections (
  id         TEXT PRIMARY KEY,
  trace_id   TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  wrong      TEXT NOT NULL,
  fix        TEXT NOT NULL,
  cause      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Patterns & Synthesis

CREATE TABLE IF NOT EXISTS patterns (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  confidence   INTEGER NOT NULL DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
  hit_count    INTEGER NOT NULL DEFAULT 0,
  conditions   TEXT,
  project      TEXT,
  validated_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS synthesis_runs (
  id               TEXT PRIMARY KEY,
  trace_id         TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  patterns_created INTEGER NOT NULL DEFAULT 0,
  patterns_updated INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Wiki

CREATE TABLE IF NOT EXISTS wiki_pages (
  id         TEXT PRIMARY KEY,
  section    TEXT NOT NULL,
  project    TEXT,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Insights & Watches

CREATE TABLE IF NOT EXISTS insights (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('staleness','drift','risk','opportunity')),
  severity   TEXT NOT NULL CHECK (severity IN ('I','W','E')),
  content    TEXT NOT NULL,
  entity_ids TEXT DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS insight_dismissals (
  id           TEXT PRIMARY KEY,
  insight_id   TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  reason       TEXT,
  dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id         TEXT PRIMARY KEY,
  condition  TEXT NOT NULL,
  entity_id  TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Settings

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- FTS5 Virtual Tables

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts     USING fts5(name,        content='entities',     content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(content,     content='observations', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts     USING fts5(description, content='patterns',     content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts         USING fts5(content,     content='wiki_pages',   content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts     USING fts5(content,     content='insights',     content_rowid='rowid');

-- FTS Sync Triggers — entities
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
END;
CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name) VALUES ('delete', OLD.rowid, OLD.name);
END;
CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name) VALUES ('delete', OLD.rowid, OLD.name);
  INSERT INTO entities_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
END;

-- FTS Sync Triggers — observations
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;
CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO observations_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- FTS Sync Triggers — patterns
CREATE TRIGGER IF NOT EXISTS patterns_ai AFTER INSERT ON patterns BEGIN
  INSERT INTO patterns_fts(rowid, description) VALUES (NEW.rowid, NEW.description);
END;
CREATE TRIGGER IF NOT EXISTS patterns_ad AFTER DELETE ON patterns BEGIN
  INSERT INTO patterns_fts(patterns_fts, rowid, description) VALUES ('delete', OLD.rowid, OLD.description);
END;
CREATE TRIGGER IF NOT EXISTS patterns_au AFTER UPDATE ON patterns BEGIN
  INSERT INTO patterns_fts(patterns_fts, rowid, description) VALUES ('delete', OLD.rowid, OLD.description);
  INSERT INTO patterns_fts(rowid, description) VALUES (NEW.rowid, NEW.description);
END;

-- FTS Sync Triggers — wiki_pages
CREATE TRIGGER IF NOT EXISTS wiki_pages_ai AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO wiki_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;
CREATE TRIGGER IF NOT EXISTS wiki_pages_ad AFTER DELETE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
CREATE TRIGGER IF NOT EXISTS wiki_pages_au AFTER UPDATE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO wiki_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- FTS Sync Triggers — insights
CREATE TRIGGER IF NOT EXISTS insights_ai AFTER INSERT ON insights BEGIN
  INSERT INTO insights_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;
CREATE TRIGGER IF NOT EXISTS insights_ad AFTER DELETE ON insights BEGIN
  INSERT INTO insights_fts(insights_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
CREATE TRIGGER IF NOT EXISTS insights_au AFTER UPDATE ON insights BEGIN
  INSERT INTO insights_fts(insights_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO insights_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- Indexes

CREATE INDEX IF NOT EXISTS idx_entities_type          ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name          ON entities(name);

CREATE INDEX IF NOT EXISTS idx_relationships_source   ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target   ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_relationships_rel_type ON relationships(rel_type);

CREATE INDEX IF NOT EXISTS idx_observations_entity    ON observations(entity_id);

CREATE INDEX IF NOT EXISTS idx_traces_project         ON traces(project);
CREATE INDEX IF NOT EXISTS idx_traces_status          ON traces(status);
CREATE INDEX IF NOT EXISTS idx_traces_conversation    ON traces(conversation_id);

CREATE INDEX IF NOT EXISTS idx_trace_steps_trace      ON trace_steps(trace_id);

CREATE INDEX IF NOT EXISTS idx_corrections_trace      ON corrections(trace_id);

CREATE INDEX IF NOT EXISTS idx_patterns_project       ON patterns(project);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence    ON patterns(confidence);

CREATE INDEX IF NOT EXISTS idx_synthesis_runs_trace   ON synthesis_runs(trace_id);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_section     ON wiki_pages(section);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_project     ON wiki_pages(project);

CREATE INDEX IF NOT EXISTS idx_insights_type          ON insights(type);
CREATE INDEX IF NOT EXISTS idx_insights_active        ON insights(active);

CREATE INDEX IF NOT EXISTS idx_insight_dismissals_insight ON insight_dismissals(insight_id);

CREATE INDEX IF NOT EXISTS idx_watches_active         ON watches(active);
CREATE INDEX IF NOT EXISTS idx_watches_entity         ON watches(entity_id);
`;

// ---------------------------------------------------------------------------
// Row type interfaces
// ---------------------------------------------------------------------------

export interface EntityRow {
  id: string;
  type: string;
  name: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface RelationshipRow {
  id: string;
  source_id: string;
  target_id: string;
  rel_type: string;
  metadata: string;
  created_at: string;
}

export interface ObservationRow {
  id: string;
  entity_id: string;
  content: string;
  observed_at: string;
}

export interface TraceRow {
  id: string;
  description: string;
  project: string | null;
  conversation_id: string | null;
  status: string;
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface TraceStepRow {
  id: string;
  trace_id: string;
  step_index: number;
  action: string;
  tool: string | null;
  result: string | null;
  success: number;
  created_at: string;
}

export interface CorrectionRow {
  id: string;
  trace_id: string;
  wrong: string;
  fix: string;
  cause: string | null;
  created_at: string;
}

export interface PatternRow {
  id: string;
  description: string;
  confidence: number;
  hit_count: number;
  conditions: string | null;
  project: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SynthesisRunRow {
  id: string;
  trace_id: string;
  patterns_created: number;
  patterns_updated: number;
  created_at: string;
}

export interface WikiPageRow {
  id: string;
  section: string;
  project: string | null;
  content: string;
  version: number;
  created_at: string;
}

export interface InsightRow {
  id: string;
  type: string;
  severity: string;
  content: string;
  entity_ids: string;
  active: number;
  created_at: string;
}

export interface InsightDismissalRow {
  id: string;
  insight_id: string;
  reason: string | null;
  dismissed_at: string;
}

export interface WatchRow {
  id: string;
  condition: string;
  entity_id: string | null;
  active: number;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string | null;
}

/** A single FTS search hit with provenance. */
export interface SearchResult {
  table: string;
  id: string;
  snippet: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Database Class
// ---------------------------------------------------------------------------

export class Database {
  readonly db: SqliteDb;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? config.dbPath;

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });

    // Open (or create) the database
    this.db = new BetterSqlite3(resolvedPath);

    // Performance & safety pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run the embedded schema
    this.db.exec(SCHEMA_SQL);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private uuid(): string {
    return crypto.randomUUID();
  }

  private now(): string {
    return new Date().toISOString();
  }

  /** Expose close for graceful shutdown. */
  close(): void {
    this.db.close();
  }

  /**
   * Sanitize user input for FTS5 MATCH queries.
   * Strips special chars, quotes each word, joins with OR.
   * Returns null if no valid terms remain.
   */
  private sanitizeFts(query: string): string | null {
    const words = query
      .replace(/[^\w\s]/g, ' ')  // strip non-word chars (hyphens, etc.)
      .split(/\s+/)
      .filter((w) => w.length > 1);  // drop single chars
    if (words.length === 0) return null;
    return words.map((w) => `"${w}"`).join(' OR ');
  }

  // =======================================================================
  // Entity CRUD
  // =======================================================================

  createEntity(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {},
  ): EntityRow {
    const id = this.uuid();
    const now = this.now();
    const metaJson = JSON.stringify(metadata);
    this.db
      .prepare(
        `INSERT INTO entities (id, type, name, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, type, name, metaJson, now, now);
    return { id, type, name, metadata: metaJson, created_at: now, updated_at: now };
  }

  getEntity(id: string): EntityRow | undefined {
    return this.db
      .prepare(`SELECT * FROM entities WHERE id = ?`)
      .get(id) as EntityRow | undefined;
  }

  updateEntity(
    id: string,
    updates: { name?: string; type?: string; metadata?: Record<string, unknown> },
  ): EntityRow | undefined {
    const existing = this.getEntity(id);
    if (!existing) return undefined;

    const name = updates.name ?? existing.name;
    const type = updates.type ?? existing.type;
    const metadata = updates.metadata
      ? JSON.stringify(updates.metadata)
      : existing.metadata;
    const now = this.now();

    this.db
      .prepare(
        `UPDATE entities SET name = ?, type = ?, metadata = ?, updated_at = ? WHERE id = ?`,
      )
      .run(name, type, metadata, now, id);

    return { id, type, name, metadata, created_at: existing.created_at, updated_at: now };
  }

  deleteEntity(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  searchEntities(query: string): EntityRow[] {
    const fts = this.sanitizeFts(query);
    if (!fts) return [];
    return this.db
      .prepare(
        `SELECT e.* FROM entities e
         JOIN entities_fts f ON e.rowid = f.rowid
         WHERE entities_fts MATCH ?
         ORDER BY rank`,
      )
      .all(fts) as EntityRow[];
  }

  // =======================================================================
  // Relationship CRUD
  // =======================================================================

  createRelationship(
    sourceId: string,
    targetId: string,
    relType: string,
    metadata: Record<string, unknown> = {},
  ): RelationshipRow {
    const id = this.uuid();
    const now = this.now();
    const metaJson = JSON.stringify(metadata);
    this.db
      .prepare(
        `INSERT INTO relationships (id, source_id, target_id, rel_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sourceId, targetId, relType, metaJson, now);
    return {
      id,
      source_id: sourceId,
      target_id: targetId,
      rel_type: relType,
      metadata: metaJson,
      created_at: now,
    };
  }

  getRelationships(
    entityId: string,
    direction?: 'outgoing' | 'incoming' | 'both',
    relType?: string,
  ): RelationshipRow[] {
    const dir = direction ?? 'both';
    let sql: string;
    const params: unknown[] = [];

    if (dir === 'outgoing') {
      sql = `SELECT * FROM relationships WHERE source_id = ?`;
      params.push(entityId);
    } else if (dir === 'incoming') {
      sql = `SELECT * FROM relationships WHERE target_id = ?`;
      params.push(entityId);
    } else {
      sql = `SELECT * FROM relationships WHERE source_id = ? OR target_id = ?`;
      params.push(entityId, entityId);
    }

    if (relType) {
      sql += ` AND rel_type = ?`;
      params.push(relType);
    }

    return this.db.prepare(sql).all(...params) as RelationshipRow[];
  }

  // =======================================================================
  // Observation CRUD
  // =======================================================================

  addObservation(entityId: string, content: string): ObservationRow {
    const id = this.uuid();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO observations (id, entity_id, content, observed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, entityId, content, now);
    return { id, entity_id: entityId, content, observed_at: now };
  }

  getObservations(entityId: string): ObservationRow[] {
    return this.db
      .prepare(`SELECT * FROM observations WHERE entity_id = ? ORDER BY observed_at DESC`)
      .all(entityId) as ObservationRow[];
  }

  // =======================================================================
  // Trace Management
  // =======================================================================

  createTrace(
    description: string,
    project?: string,
    conversationId?: string,
  ): TraceRow {
    const id = this.uuid();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO traces (id, description, project, conversation_id, status, started_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(id, description, project ?? null, conversationId ?? null, now);
    return {
      id,
      description,
      project: project ?? null,
      conversation_id: conversationId ?? null,
      status: 'active',
      outcome: null,
      started_at: now,
      ended_at: null,
    };
  }

  addTraceStep(
    traceId: string,
    stepIndex: number,
    action: string,
    tool?: string,
    result?: string,
    success: boolean = true,
  ): TraceStepRow {
    const id = this.uuid();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO trace_steps (id, trace_id, step_index, action, tool, result, success, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, traceId, stepIndex, action, tool ?? null, result ?? null, success ? 1 : 0, now);
    return {
      id,
      trace_id: traceId,
      step_index: stepIndex,
      action,
      tool: tool ?? null,
      result: result ?? null,
      success: success ? 1 : 0,
      created_at: now,
    };
  }

  addCorrection(
    traceId: string,
    wrong: string,
    fix: string,
    cause?: string,
  ): CorrectionRow {
    const id = this.uuid();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO corrections (id, trace_id, wrong, fix, cause, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, traceId, wrong, fix, cause ?? null, now);
    return {
      id,
      trace_id: traceId,
      wrong,
      fix,
      cause: cause ?? null,
      created_at: now,
    };
  }

  endTrace(
    traceId: string,
    status: 'completed' | 'failed',
    outcome?: string,
  ): boolean {
    const now = this.now();
    const result = this.db
      .prepare(
        `UPDATE traces SET status = ?, outcome = ?, ended_at = ? WHERE id = ?`,
      )
      .run(status, outcome ?? null, now, traceId);
    return result.changes > 0;
  }

  getTrace(traceId: string): TraceRow | undefined {
    return this.db
      .prepare(`SELECT * FROM traces WHERE id = ?`)
      .get(traceId) as TraceRow | undefined;
  }

  getTraceSteps(traceId: string): TraceStepRow[] {
    return this.db
      .prepare(`SELECT * FROM trace_steps WHERE trace_id = ? ORDER BY step_index ASC`)
      .all(traceId) as TraceStepRow[];
  }

  getTraceCorrections(traceId: string): CorrectionRow[] {
    return this.db
      .prepare(`SELECT * FROM corrections WHERE trace_id = ? ORDER BY created_at ASC`)
      .all(traceId) as CorrectionRow[];
  }

  // =======================================================================
  // Pattern CRUD
  // =======================================================================

  createPattern(
    description: string,
    options: {
      confidence?: number;
      conditions?: Record<string, unknown>;
      project?: string;
    } = {},
  ): PatternRow {
    const id = this.uuid();
    const now = this.now();
    const confidence = options.confidence ?? 50;
    const conditions = options.conditions ? JSON.stringify(options.conditions) : null;
    const project = options.project ?? null;

    this.db
      .prepare(
        `INSERT INTO patterns (id, description, confidence, conditions, project, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, description, confidence, conditions, project, now, now);

    return {
      id,
      description,
      confidence,
      hit_count: 0,
      conditions,
      project,
      validated_at: null,
      created_at: now,
      updated_at: now,
    };
  }

  getPattern(id: string): PatternRow | undefined {
    return this.db
      .prepare(`SELECT * FROM patterns WHERE id = ?`)
      .get(id) as PatternRow | undefined;
  }

  updatePattern(
    id: string,
    updates: {
      description?: string;
      confidence?: number;
      hit_count?: number;
      conditions?: Record<string, unknown>;
      project?: string;
      validated_at?: string;
    },
  ): PatternRow | undefined {
    const existing = this.getPattern(id);
    if (!existing) return undefined;

    const description = updates.description ?? existing.description;
    const confidence = updates.confidence ?? existing.confidence;
    const hit_count = updates.hit_count ?? existing.hit_count;
    const conditions = updates.conditions
      ? JSON.stringify(updates.conditions)
      : existing.conditions;
    const project = updates.project ?? existing.project;
    const validated_at = updates.validated_at ?? existing.validated_at;
    const now = this.now();

    this.db
      .prepare(
        `UPDATE patterns
         SET description = ?, confidence = ?, hit_count = ?, conditions = ?,
             project = ?, validated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(description, confidence, hit_count, conditions, project, validated_at, now, id);

    return {
      id,
      description,
      confidence,
      hit_count,
      conditions,
      project,
      validated_at,
      created_at: existing.created_at,
      updated_at: now,
    };
  }

  searchPatterns(query: string): PatternRow[] {
    const fts = this.sanitizeFts(query);
    if (!fts) return [];
    return this.db
      .prepare(
        `SELECT p.* FROM patterns p
         JOIN patterns_fts f ON p.rowid = f.rowid
         WHERE patterns_fts MATCH ?
         ORDER BY rank`,
      )
      .all(fts) as PatternRow[];
  }

  getPatternsByProject(project: string): PatternRow[] {
    return this.db
      .prepare(`SELECT * FROM patterns WHERE project = ? ORDER BY confidence DESC`)
      .all(project) as PatternRow[];
  }

  // =======================================================================
  // Wiki
  // =======================================================================

  saveWikiPage(
    section: string,
    content: string,
    project?: string,
  ): WikiPageRow {
    const id = this.uuid();
    const now = this.now();

    // Determine version: increment latest for this section+project
    const latest = this.db
      .prepare(
        `SELECT MAX(version) as max_ver FROM wiki_pages WHERE section = ? AND (project = ? OR (project IS NULL AND ? IS NULL))`,
      )
      .get(section, project ?? null, project ?? null) as { max_ver: number | null } | undefined;

    const version = (latest?.max_ver ?? 0) + 1;

    this.db
      .prepare(
        `INSERT INTO wiki_pages (id, section, project, content, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, section, project ?? null, content, version, now);

    return {
      id,
      section,
      project: project ?? null,
      content,
      version,
      created_at: now,
    };
  }

  getWikiPage(section: string, project?: string): WikiPageRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM wiki_pages
         WHERE section = ? AND (project = ? OR (project IS NULL AND ? IS NULL))
         ORDER BY version DESC LIMIT 1`,
      )
      .get(section, project ?? null, project ?? null) as WikiPageRow | undefined;
  }

  getLatestWiki(project?: string): WikiPageRow[] {
    // Return the latest version of each section
    return this.db
      .prepare(
        `SELECT w.* FROM wiki_pages w
         INNER JOIN (
           SELECT section, MAX(version) as max_ver
           FROM wiki_pages
           WHERE project = ? OR (project IS NULL AND ? IS NULL)
           GROUP BY section
         ) latest ON w.section = latest.section AND w.version = latest.max_ver
         WHERE w.project = ? OR (w.project IS NULL AND ? IS NULL)
         ORDER BY w.section`,
      )
      .all(
        project ?? null,
        project ?? null,
        project ?? null,
        project ?? null,
      ) as WikiPageRow[];
  }

  // =======================================================================
  // Insight Management
  // =======================================================================

  createInsight(
    type: string,
    severity: string,
    content: string,
    entityIds: string[] = [],
  ): InsightRow {
    const id = this.uuid();
    const now = this.now();
    const entityIdsStr = entityIds.join('|');

    this.db
      .prepare(
        `INSERT INTO insights (id, type, severity, content, entity_ids, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, type, severity, content, entityIdsStr, now);

    return {
      id,
      type,
      severity,
      content,
      entity_ids: entityIdsStr,
      active: 1,
      created_at: now,
    };
  }

  getActiveInsights(): InsightRow[] {
    return this.db
      .prepare(`SELECT * FROM insights WHERE active = 1 ORDER BY created_at DESC`)
      .all() as InsightRow[];
  }

  dismissInsight(insightId: string, reason?: string): boolean {
    const now = this.now();
    const dismissId = this.uuid();

    const txn = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE insights SET active = 0 WHERE id = ?`)
        .run(insightId);

      this.db
        .prepare(
          `INSERT INTO insight_dismissals (id, insight_id, reason, dismissed_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(dismissId, insightId, reason ?? null, now);
    });

    txn();
    return true;
  }

  // =======================================================================
  // Watch Management
  // =======================================================================

  createWatch(condition: string, entityId?: string): WatchRow {
    const id = this.uuid();
    const now = this.now();

    this.db
      .prepare(
        `INSERT INTO watches (id, condition, entity_id, active, created_at)
         VALUES (?, ?, ?, 1, ?)`,
      )
      .run(id, condition, entityId ?? null, now);

    return {
      id,
      condition,
      entity_id: entityId ?? null,
      active: 1,
      created_at: now,
    };
  }

  getActiveWatches(): WatchRow[] {
    return this.db
      .prepare(`SELECT * FROM watches WHERE active = 1 ORDER BY created_at DESC`)
      .all() as WatchRow[];
  }

  // =======================================================================
  // Settings
  // =======================================================================

  getSetting(key: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as SettingRow | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  // =======================================================================
  // Graph Traversal
  // =======================================================================

  getNeighbors(
    entityId: string,
    depth: number = 1,
  ): { entities: EntityRow[]; relationships: RelationshipRow[] } {
    const visitedEntities = new Set<string>();
    const allRelationships: RelationshipRow[] = [];
    let frontier = [entityId];
    visitedEntities.add(entityId);

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];

      for (const eid of frontier) {
        const rels = this.getRelationships(eid, 'both');
        for (const rel of rels) {
          // Deduplicate relationships by id
          if (!allRelationships.some((r) => r.id === rel.id)) {
            allRelationships.push(rel);
          }
          const neighborId =
            rel.source_id === eid ? rel.target_id : rel.source_id;
          if (!visitedEntities.has(neighborId)) {
            visitedEntities.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }

      frontier = nextFrontier;
    }

    // Fetch full entity rows for all visited nodes
    const entities: EntityRow[] = [];
    for (const eid of visitedEntities) {
      const entity = this.getEntity(eid);
      if (entity) entities.push(entity);
    }

    return { entities, relationships: allRelationships };
  }

  // =======================================================================
  // Cross-table FTS Search
  // =======================================================================

  search(query: string): SearchResult[] {
    const fts = this.sanitizeFts(query);
    if (!fts) return [];
    const results: SearchResult[] = [];

    // Search entities
    const entityHits = this.db
      .prepare(
        `SELECT e.id, snippet(entities_fts, 0, '>>>', '<<<', '...', 32) as snip, rank
         FROM entities_fts f
         JOIN entities e ON e.rowid = f.rowid
         WHERE entities_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(fts) as Array<{ id: string; snip: string; rank: number }>;

    for (const h of entityHits) {
      results.push({ table: 'entities', id: h.id, snippet: h.snip, rank: h.rank });
    }

    // Search observations
    const obsHits = this.db
      .prepare(
        `SELECT o.id, snippet(observations_fts, 0, '>>>', '<<<', '...', 32) as snip, rank
         FROM observations_fts f
         JOIN observations o ON o.rowid = f.rowid
         WHERE observations_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(fts) as Array<{ id: string; snip: string; rank: number }>;

    for (const h of obsHits) {
      results.push({ table: 'observations', id: h.id, snippet: h.snip, rank: h.rank });
    }

    // Search patterns
    const patHits = this.db
      .prepare(
        `SELECT p.id, snippet(patterns_fts, 0, '>>>', '<<<', '...', 32) as snip, rank
         FROM patterns_fts f
         JOIN patterns p ON p.rowid = f.rowid
         WHERE patterns_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(fts) as Array<{ id: string; snip: string; rank: number }>;

    for (const h of patHits) {
      results.push({ table: 'patterns', id: h.id, snippet: h.snip, rank: h.rank });
    }

    // Search wiki
    const wikiHits = this.db
      .prepare(
        `SELECT w.id, snippet(wiki_fts, 0, '>>>', '<<<', '...', 32) as snip, rank
         FROM wiki_fts f
         JOIN wiki_pages w ON w.rowid = f.rowid
         WHERE wiki_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(fts) as Array<{ id: string; snip: string; rank: number }>;

    for (const h of wikiHits) {
      results.push({ table: 'wiki_pages', id: h.id, snippet: h.snip, rank: h.rank });
    }

    // Search insights
    const insightHits = this.db
      .prepare(
        `SELECT i.id, snippet(insights_fts, 0, '>>>', '<<<', '...', 32) as snip, rank
         FROM insights_fts f
         JOIN insights i ON i.rowid = f.rowid
         WHERE insights_fts MATCH ?
         ORDER BY rank LIMIT 20`,
      )
      .all(fts) as Array<{ id: string; snip: string; rank: number }>;

    for (const h of insightHits) {
      results.push({ table: 'insights', id: h.id, snippet: h.snip, rank: h.rank });
    }

    // Sort all results by rank (lower = better in FTS5)
    results.sort((a, b) => a.rank - b.rank);

    return results;
  }

  // =======================================================================
  // Additional Query Methods
  // =======================================================================

  /**
   * Get recent corrections, optionally filtered by project.
   */
  getRecentCorrections(project: string, limit: number = 5): CorrectionRow[] {
    return this.db
      .prepare(
        `SELECT c.* FROM corrections c
         JOIN traces t ON t.id = c.trace_id
         WHERE t.project = ?
         ORDER BY c.created_at DESC
         LIMIT ?`,
      )
      .all(project, limit) as CorrectionRow[];
  }

  /**
   * Get all entities of a given type.
   */
  getEntitiesByType(type: string): EntityRow[] {
    return this.db
      .prepare(`SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC`)
      .all(type) as EntityRow[];
  }

  /**
   * Get all entities (limited to 500 for safety).
   */
  getAllEntities(): EntityRow[] {
    return this.db
      .prepare(`SELECT * FROM entities ORDER BY updated_at DESC LIMIT 500`)
      .all() as EntityRow[];
  }

  // =======================================================================
  // Analytics
  // =======================================================================

  getEntityCount(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT type, COUNT(*) as count FROM entities GROUP BY type`)
      .all() as Array<{ type: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = row.count;
    }
    return result;
  }

  getPatternStats(): {
    total: number;
    avgConfidence: number;
    totalHits: number;
    byProject: Record<string, number>;
  } {
    const overall = this.db
      .prepare(
        `SELECT COUNT(*) as total,
                COALESCE(AVG(confidence), 0) as avg_conf,
                COALESCE(SUM(hit_count), 0) as total_hits
         FROM patterns`,
      )
      .get() as { total: number; avg_conf: number; total_hits: number };

    const byProject: Record<string, number> = {};
    const projRows = this.db
      .prepare(
        `SELECT COALESCE(project, '(none)') as proj, COUNT(*) as count
         FROM patterns GROUP BY project`,
      )
      .all() as Array<{ proj: string; count: number }>;

    for (const row of projRows) {
      byProject[row.proj] = row.count;
    }

    return {
      total: overall.total,
      avgConfidence: Math.round(overall.avg_conf * 100) / 100,
      totalHits: overall.total_hits,
      byProject,
    };
  }

  getTraceStats(project: string | null): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    successRate: number;
    avgStepsPerTrace: number;
  } {
    const whereClause = project ? `WHERE project = ?` : '';
    const params = project ? [project] : [];

    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) as failed
         FROM traces ${whereClause}`,
      )
      .get(...params) as { total: number; active: number; completed: number; failed: number };

    const stepAvg = this.db
      .prepare(
        `SELECT COALESCE(AVG(step_count), 0) as avg_steps FROM (
           SELECT COUNT(*) as step_count FROM trace_steps
           ${project ? 'WHERE trace_id IN (SELECT id FROM traces WHERE project = ?)' : ''}
           GROUP BY trace_id
         )`,
      )
      .get(...params) as { avg_steps: number };

    const successRate =
      counts.total > 0
        ? Math.round((counts.completed / counts.total) * 100)
        : 0;

    return {
      total: counts.total,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      successRate,
      avgStepsPerTrace: Math.round(stepAvg.avg_steps * 100) / 100,
    };
  }

  getCorrectionFrequency(entityId?: string): {
    total: number;
    byTrace: Array<{ trace_id: string; count: number }>;
  } {
    if (entityId) {
      // Corrections for traces that involve this entity (via trace steps mentioning it,
      // or traces whose project matches the entity name). We use a broader approach:
      // find corrections on traces that reference this entity in description.
      const rows = this.db
        .prepare(
          `SELECT c.trace_id, COUNT(*) as count
           FROM corrections c
           JOIN traces t ON t.id = c.trace_id
           WHERE t.description LIKE ? OR t.project IN (
             SELECT name FROM entities WHERE id = ?
           )
           GROUP BY c.trace_id
           ORDER BY count DESC`,
        )
        .all(`%${entityId}%`, entityId) as Array<{ trace_id: string; count: number }>;

      const total = rows.reduce((sum, r) => sum + r.count, 0);
      return { total, byTrace: rows };
    }

    const rows = this.db
      .prepare(
        `SELECT trace_id, COUNT(*) as count FROM corrections
         GROUP BY trace_id ORDER BY count DESC`,
      )
      .all() as Array<{ trace_id: string; count: number }>;

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { total, byTrace: rows };
  }
}

// ---------------------------------------------------------------------------
// Default + named exports
// ---------------------------------------------------------------------------

export default Database;
