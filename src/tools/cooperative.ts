import crypto from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import { encode } from '../codec/index.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const CommitSynthesisSchema = z.object({
  tid: z.string().describe('Task/trace ID that was analyzed'),
  patterns: z
    .array(
      z.object({
        id: z.string().optional().describe('Existing pattern ID to reinforce'),
        d: z.string().optional().describe('New pattern description'),
        c: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Confidence (0-100)'),
        cond: z.string().optional().describe('Conditions when pattern applies'),
        j: z.string().optional().describe('Project scope'),
      }),
    )
    .optional()
    .default([])
    .describe('Extracted or reinforced patterns'),
  anti: z
    .array(
      z.object({
        d: z.string().describe('Anti-pattern description'),
        cause: z.string().optional().describe('Root cause / evidence'),
      }),
    )
    .optional()
    .default([])
    .describe('Anti-patterns to avoid'),
});

const CommitWikiSchema = z.object({
  sections: z
    .array(
      z.object({
        sec: z.string().describe('Section name (e.g. pat, err, pref)'),
        j: z.string().optional().describe('Project scope'),
        x: z.string().describe('Section content'),
      }),
    )
    .describe('Wiki sections to save'),
});

const RegenerateWikiSchema = z.object({
  j: z.string().optional().describe('Filter to a specific project'),
});

// ---------------------------------------------------------------------------
// Tool definitions for MCP registration
// ---------------------------------------------------------------------------

export const cooperativeToolDefs = [
  {
    name: 'mem_commit_synthesis',
    description:
      'Commit your analysis of a completed task. Send extracted patterns, updated confidences, and anti-patterns. The server stores them in the knowledge graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tid: { type: 'string', description: 'Task/trace ID that was analyzed' },
        patterns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing pattern ID to reinforce (optional)' },
              d: { type: 'string', description: 'New pattern description (required for new patterns)' },
              c: { type: 'number', description: 'Confidence 0-100 (optional)' },
              cond: { type: 'string', description: 'When pattern applies (optional)' },
              j: { type: 'string', description: 'Project scope (optional)' },
            },
          },
          description: 'Extracted or reinforced patterns',
        },
        anti: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              d: { type: 'string', description: 'Anti-pattern description' },
              cause: { type: 'string', description: 'Root cause (optional)' },
            },
            required: ['d'],
          },
          description: 'Anti-patterns to avoid',
        },
      },
      required: ['tid'],
    },
  },
  {
    name: 'mem_commit_wiki',
    description:
      'Save agent-synthesized wiki sections. Each section has a name (pat/err/pref), optional project scope, and content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sec: { type: 'string', description: 'Section name (pat, err, pref, etc.)' },
              j: { type: 'string', description: 'Project scope (optional)' },
              x: { type: 'string', description: 'Section content' },
            },
            required: ['sec', 'x'],
          },
          description: 'Wiki sections to save',
        },
      },
      required: ['sections'],
    },
  },
  {
    name: 'mem_regenerate_wiki',
    description:
      'Gather ALL patterns, entities, and corrections as structured context for wiki regeneration. Returns raw data — analyze it and call mem_commit_wiki with synthesized sections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        j: { type: 'string', description: 'Filter to a specific project (optional)' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function createCooperativeHandlers(db: Database, cfg: Config) {
  return {
    mem_commit_synthesis(args: unknown) {
      const input = CommitSynthesisSchema.parse(args);

      let patternsCreated = 0;
      let patternsUpdated = 0;

      for (const pat of input.patterns) {
        if (pat.id) {
          // Reinforce existing pattern — bump hit count and optionally update confidence
          const existing = db.getPattern(pat.id);
          if (existing) {
            db.updatePattern(pat.id, {
              confidence: pat.c ?? existing.confidence,
              hit_count: existing.hit_count + 1,
              validated_at: new Date().toISOString(),
            });
            patternsUpdated++;
          }
        } else if (pat.d) {
          // Create new pattern
          db.createPattern(
            pat.d,
            {
              confidence: pat.c ?? 70,
              conditions: pat.cond ? { when: pat.cond } : undefined,
              project: pat.j,
            },
          );

          patternsCreated++;
        }
      }

      // Store anti-patterns as entities of type 'E' (error) with observations
      for (const anti of input.anti) {
        db.createEntity('E', anti.d, {
          source: 'synthesis',
          trace_id: input.tid,
          cause: anti.cause,
        });
      }

      // Log the synthesis run directly (createSynthesisRun not in DB class)
      const synthId = crypto.randomUUID();
      const synthNow = new Date().toISOString();
      db.db.prepare(
        `INSERT INTO synthesis_runs (id, trace_id, patterns_created, patterns_updated, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(synthId, input.tid, patternsCreated, patternsUpdated, synthNow);

      const result = {
        ok: true,
        pat_new: patternsCreated,
        pat_upd: patternsUpdated,
        anti: input.anti.length,
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_commit_wiki(args: unknown) {
      const input = CommitWikiSchema.parse(args);

      let saved = 0;
      for (const section of input.sections) {
        db.saveWikiPage(section.sec, section.x, section.j);
        saved++;
      }

      const result = { ok: true, saved };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_regenerate_wiki(args: unknown) {
      const input = RegenerateWikiSchema.parse(args);

      // Gather all patterns — direct SQL for reliability
      // When project is specified, include both project-scoped AND unscoped patterns
      const patternSql = input.j
        ? `SELECT * FROM patterns WHERE project = ? OR project IS NULL ORDER BY confidence DESC LIMIT 200`
        : `SELECT * FROM patterns ORDER BY confidence DESC LIMIT 200`;
      const patternParams = input.j ? [input.j] : [];
      const allPatterns = db.db.prepare(patternSql).all(...patternParams) as Array<{
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

      // Gather corrections
      const corrections = input.j
        ? db.getRecentCorrections(input.j, 20)
        : [];

      // Gather entities grouped by type
      const entityCounts = db.getEntityCount();

      // Get existing wiki for reference
      const existingWiki = db.getLatestWiki(input.j);

      const result = {
        context: {
          pat: allPatterns.map((p) => ({
            id: p.id,
            d: p.description,
            c: p.confidence,
            h: p.hit_count,
            j: p.project,
          })),
          cor: corrections.map((c) => ({
            wrong: c.wrong,
            fix: c.fix,
            cause: c.cause,
          })),
          entity_counts: entityCounts,
          existing_wiki: existingWiki.map((w) => ({
            sec: w.section,
            j: w.project,
            ver: w.version,
          })),
        },
        prompt:
          'Synthesize this data into wiki sections. Group by project. Include patterns (pat), common errors (err), and preferences (pref). Call mem_commit_wiki with the result.',
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },
  };
}
