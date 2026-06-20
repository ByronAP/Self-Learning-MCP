import { z } from 'zod';
import type { Database } from '../db/database.js';
import { encode } from '../codec/index.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GetInsightsSchema = z.object({
  t: z.string().optional().describe('Filter by type: staleness/drift/risk/opportunity'),
  n: z.number().optional().default(10).describe('Max results'),
});

const DismissInsightSchema = z.object({
  id: z.string().describe('Insight ID to dismiss'),
  reason: z.string().optional().describe('Reason for dismissal'),
});

const SetWatchSchema = z.object({
  condition: z.string().describe('Watch condition description'),
  entity_id: z.string().optional().describe('Entity to watch'),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const proactiveToolDefs = [
  {
    name: 'mem_get_insights',
    description:
      'Retrieve active proactive insights (staleness, drift, risk, opportunity). Called when has_insights flag is true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        t: { type: 'string', description: 'Filter by type (optional)' },
        n: { type: 'number', description: 'Max results (default: 10)' },
      },
    },
  },
  {
    name: 'mem_dismiss_insight',
    description:
      'Dismiss an insight with optional reason. Teaches the proactive engine.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Insight ID' },
        reason: { type: 'string', description: 'Reason for dismissal (optional)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mem_set_watch',
    description:
      'Set a watch condition on an entity or topic. The proactive engine will alert when relevant changes occur.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        condition: { type: 'string', description: 'Watch condition' },
        entity_id: { type: 'string', description: 'Entity to watch (optional)' },
      },
      required: ['condition'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function createProactiveHandlers(db: Database, cfg: Config) {
  return {
    mem_get_insights(args: unknown) {
      const input = GetInsightsSchema.parse(args);

      let insights = db.getActiveInsights();

      // Filter by type if specified
      if (input.t) {
        insights = insights.filter((i) => i.type === input.t);
      }

      const limited = insights.slice(0, input.n);

      const result = {
        n: limited.length,
        r: limited.map((i) => ({
          id: i.id,
          t: i.type,
          s: i.severity,
          d: i.content,
          ts: i.created_at,
        })),
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_dismiss_insight(args: unknown) {
      const input = DismissInsightSchema.parse(args);
      db.dismissInsight(input.id, input.reason);
      const result = { ok: true, id: input.id };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_set_watch(args: unknown) {
      const input = SetWatchSchema.parse(args);
      const watch = db.createWatch(input.condition, input.entity_id);
      const result = { ok: true, id: watch.id };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },
  };
}
