-- ===========================================================================
-- Self-Learning MCP Server — SQLite Schema
-- ===========================================================================

-- ---- Core Knowledge Graph ----

CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,               -- UUID
  type       TEXT NOT NULL                    -- T(ool)/P(roject)/E(rror)/S(tack)/J(ourneyMap)/C(oncept)/R(esource)/X(external)/I(ntegration)/W(orkflow)
               CHECK (type IN ('T','P','E','S','J','C','R','X','I','W')),
  name       TEXT NOT NULL,
  metadata   TEXT DEFAULT '{}',              -- JSON blob
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS relationships (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel_type   TEXT NOT NULL                   -- RB(relies-on)/DP(depends)/CB(caused-by)/IB(inhibited-by)/FB(fixed-by)/TF(transforms)/EF(effects)/UI(used-in)
               CHECK (rel_type IN ('RB','DP','CB','IB','FB','TF','EF','UI')),
  metadata   TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---- Traces & Corrections ----

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

-- ---- Patterns & Synthesis ----

CREATE TABLE IF NOT EXISTS patterns (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  confidence   INTEGER NOT NULL DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
  hit_count    INTEGER NOT NULL DEFAULT 0,
  conditions   TEXT,                          -- JSON blob
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

-- ---- Wiki ----

CREATE TABLE IF NOT EXISTS wiki_pages (
  id         TEXT PRIMARY KEY,
  section    TEXT NOT NULL,
  project    TEXT,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---- Insights & Watches ----

CREATE TABLE IF NOT EXISTS insights (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('staleness','drift','risk','opportunity')),
  severity   TEXT NOT NULL CHECK (severity IN ('I','W','E')),
  content    TEXT NOT NULL,
  entity_ids TEXT DEFAULT '',                 -- pipe-delimited entity IDs
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

-- ---- Settings ----

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ===========================================================================
-- FTS5 Virtual Tables
-- ===========================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts     USING fts5(name,     content='entities',     content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(content,  content='observations', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts     USING fts5(description, content='patterns', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts         USING fts5(content,  content='wiki_pages',  content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts     USING fts5(content,  content='insights',    content_rowid='rowid');

-- ===========================================================================
-- Triggers to keep FTS indexes in sync
-- ===========================================================================

-- entities
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

-- observations
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

-- patterns
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

-- wiki_pages
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

-- insights
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

-- ===========================================================================
-- Indexes
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_entities_type       ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name       ON entities(name);

CREATE INDEX IF NOT EXISTS idx_relationships_source   ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target   ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_relationships_rel_type ON relationships(rel_type);

CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_id);

CREATE INDEX IF NOT EXISTS idx_traces_project      ON traces(project);
CREATE INDEX IF NOT EXISTS idx_traces_status       ON traces(status);
CREATE INDEX IF NOT EXISTS idx_traces_conversation ON traces(conversation_id);

CREATE INDEX IF NOT EXISTS idx_trace_steps_trace   ON trace_steps(trace_id);

CREATE INDEX IF NOT EXISTS idx_corrections_trace   ON corrections(trace_id);

CREATE INDEX IF NOT EXISTS idx_patterns_project    ON patterns(project);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);

CREATE INDEX IF NOT EXISTS idx_synthesis_runs_trace ON synthesis_runs(trace_id);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_section  ON wiki_pages(section);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_project  ON wiki_pages(project);

CREATE INDEX IF NOT EXISTS idx_insights_type       ON insights(type);
CREATE INDEX IF NOT EXISTS idx_insights_active     ON insights(active);

CREATE INDEX IF NOT EXISTS idx_insight_dismissals_insight ON insight_dismissals(insight_id);

CREATE INDEX IF NOT EXISTS idx_watches_active      ON watches(active);
CREATE INDEX IF NOT EXISTS idx_watches_entity      ON watches(entity_id);
