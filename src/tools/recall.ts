import { z } from 'zod';
import type { Database } from '../db/database.js';
import { encode } from '../codec/index.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const RecallSchema = z.object({
  q: z.string().describe('Search query'),
  n: z.number().optional().default(10).describe('Max results'),
  t: z.string().optional().describe('Filter by entity type code'),
  j: z.string().optional().describe('Filter by project'),
});

const GetContextSchema = z.object({
  topic: z.string().describe('Topic to get context for'),
  j: z.string().optional().describe('Filter by project'),
});

const GetWikiSchema = z.object({
  j: z.string().optional().describe('Project filter (optional)'),
  sec: z.string().optional().describe('Section filter (optional)'),
});

const QueryGraphSchema = z.object({
  t: z.string().optional().describe('Entity type code filter'),
  rel: z.string().optional().describe('Relationship type code filter'),
  j: z.string().optional().describe('Project filter'),
  since: z.string().optional().describe('Date filter (e.g. 7d, 2w)'),
  n: z.number().optional().default(20).describe('Max results'),
});

const GetEntitySchema = z.object({
  id: z.string().describe('Entity ID'),
});

const GetBriefingSchema = z.object({
  d: z.string().describe('Task description'),
  j: z.string().optional().describe('Project'),
});

// ---------------------------------------------------------------------------
// Tool definitions for MCP registration
// ---------------------------------------------------------------------------

export const recallToolDefs = [
  {
    name: 'mem_recall',
    description:
      'Full-text search across all memory (entities, patterns, wiki, observations). Returns compact ranked results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Search query' },
        n: { type: 'number', description: 'Max results (default: 10)' },
        t: { type: 'string', description: 'Filter by type code (optional)' },
        j: { type: 'string', description: 'Filter by project (optional)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'mem_get_context',
    description:
      'Get a context packet for a topic: matching entities, patterns, and corrections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Topic to get context for' },
        j: { type: 'string', description: 'Filter by project (optional)' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'mem_get_wiki',
    description: 'Retrieve the synthesized wiki. Optionally filter by project or section.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        j: { type: 'string', description: 'Project filter (optional)' },
        sec: { type: 'string', description: 'Section filter (optional)' },
      },
    },
  },
  {
    name: 'mem_query_graph',
    description:
      'Structured graph query. Filter by entity type, relationship type, project, or date range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        t: { type: 'string', description: 'Entity type code filter' },
        rel: { type: 'string', description: 'Relationship type code filter' },
        j: { type: 'string', description: 'Project filter' },
        since: { type: 'string', description: 'Relative date filter (7d, 2w)' },
        n: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'mem_get_entity',
    description: 'Get a specific entity with its observations and edges.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Entity ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mem_get_briefing',
    description:
      'Pre-task intelligence. Given a task description, returns matching patterns, past similar tasks, applicable corrections, and active risks. Factor this into your approach.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        d: { type: 'string', description: 'Task description' },
        j: { type: 'string', description: 'Project (optional)' },
      },
      required: ['d'],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a relative time string (7d, 2w, 3h) into a Date.
 */
function parseRelativeTime(rel: string): Date {
  const now = Date.now();
  const match = rel.match(/^(\d+)([hdwmMy])$/);
  if (!match) return new Date(now - 7 * 24 * 60 * 60 * 1000); // default 7d

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const ms: Record<string, number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return new Date(now - amount * (ms[unit] ?? ms['d']));
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function createRecallHandlers(db: Database, cfg: Config) {
  return {
    mem_recall(args: unknown) {
      const input = RecallSchema.parse(args);

      // Search across all FTS tables — returns { table, id, snippet, rank }
      const results = db.search(input.q);

      // For filtering by type/project, we need to look up the actual entities
      // SearchResult only has table/id/snippet/rank
      let limited = results.slice(0, input.n);

      const result = {
        n: limited.length,
        r: limited.map((r) => ({
          id: r.id,
          tbl: r.table,
          snip: r.snippet,
          rank: r.rank,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_get_context(args: unknown) {
      const input = GetContextSchema.parse(args);

      // Search entities
      const entities = db.searchEntities(input.topic);

      // Search patterns
      const patterns = db.searchPatterns(input.topic);

      // Get recent corrections if project specified
      const corrections = input.j
        ? db.getRecentCorrections(input.j, 5)
        : [];

      const result = {
        topic: input.topic,
        ent: entities.slice(0, 5).map((e) => ({
          id: e.id,
          t: e.type,
          nm: e.name,
        })),
        pat: patterns.slice(0, 5).map((p) => ({
          id: p.id,
          d: p.description,
          c: p.confidence,
          h: p.hit_count,
        })),
        cor: corrections.map((c) => ({
          wrong: c.wrong,
          fix: c.fix,
          cause: c.cause,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_get_wiki(args: unknown) {
      const input = GetWikiSchema.parse(args);

      const pages = db.getLatestWiki(input.j);

      // Filter by section if specified
      const filtered = input.sec
        ? pages.filter((p) => p.section === input.sec)
        : pages;

      const result = {
        n: filtered.length,
        pages: filtered.map((p) => ({
          sec: p.section,
          j: p.project,
          x: p.content,
          ver: p.version,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_query_graph(args: unknown) {
      const input = QueryGraphSchema.parse(args);

      let entities = input.t
        ? db.getEntitiesByType(input.t)
        : db.getAllEntities();

      // Filter by project
      if (input.j) {
        entities = entities.filter((e) => {
          try {
            const meta = JSON.parse(e.metadata || '{}');
            return meta.project === input.j;
          } catch {
            return false;
          }
        });
      }

      // Filter by date
      if (input.since) {
        const since = parseRelativeTime(input.since);
        entities = entities.filter(
          (e) => new Date(e.created_at) >= since,
        );
      }

      // If rel type specified, filter to entities that have that relationship
      if (input.rel) {
        const idsWithRel = new Set<string>();
        for (const e of entities) {
          const rels = db.getRelationships(e.id);
          if (rels.some((r) => r.rel_type === input.rel)) {
            idsWithRel.add(e.id);
          }
        }
        entities = entities.filter((e) => idsWithRel.has(e.id));
      }

      const limited = entities.slice(0, input.n);

      const result = {
        n: limited.length,
        r: limited.map((e) => ({
          id: e.id,
          t: e.type,
          nm: e.name,
          ts: e.created_at,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_get_entity(args: unknown) {
      const input = GetEntitySchema.parse(args);

      const entity = db.getEntity(input.id);
      if (!entity) {
        return { error: 'Entity not found', id: input.id };
      }

      const observations = db.getObservations(input.id);
      const relationships = db.getRelationships(input.id);

      const result = {
        id: entity.id,
        t: entity.type,
        nm: entity.name,
        meta: entity.metadata ? JSON.parse(entity.metadata) : undefined,
        ts: entity.created_at,
        obs: observations.map((o) => ({
          x: o.content,
          ts: o.observed_at,
        })),
        edges: relationships.map((r) => ({
          id: r.id,
          rel: r.rel_type,
          src: r.source_id,
          tgt: r.target_id,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_get_briefing(args: unknown) {
      const input = GetBriefingSchema.parse(args);

      // 1. Search for related patterns
      const patterns = db.searchPatterns(input.d).slice(0, 8);

      // 2. Find past similar tasks
      const similarTasks = db.searchEntities(input.d)
        .filter((e) => e.type === 'T')
        .slice(0, 5);

      // 3. Get recent corrections for the project
      const corrections = input.j
        ? db.getRecentCorrections(input.j, 5)
        : [];

      // 4. Get active insights
      const insights = db.getActiveInsights().slice(0, 5);

      // 5. Calculate historical success rate for similar tasks
      const traceStats = db.getTraceStats(input.j ?? null);

      const result = {
        task: input.d,
        pat: patterns.map((p) => ({
          id: p.id,
          d: p.description,
          c: p.confidence,
          h: p.hit_count,
        })),
        hist: {
          similar: similarTasks.length,
          rate: traceStats.successRate,
          total: traceStats.total,
        },
        cor: corrections.map((c) => ({
          wrong: c.wrong,
          fix: c.fix,
          cause: c.cause,
        })),
        insights: insights.map((i) => ({
          s: i.severity,
          t: i.type,
          d: i.content,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },
  };
}
