import { z } from 'zod';
import type { Database } from '../db/database.js';
import { encode } from '../codec/index.js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const StartTaskSchema = z.object({
  d: z.string().describe('Task description'),
  j: z.string().optional().describe('Project name'),
  conv: z.string().optional().describe('Conversation ID'),
});

const RecordStepSchema = z.object({
  tid: z.string().describe('Trace/task ID'),
  action: z.string().describe('What was done'),
  tool: z.string().optional().describe('Tool used'),
  result: z.string().optional().describe('Outcome description'),
  ok: z.boolean().optional().default(true).describe('Success?'),
});

const RecordCorrectionSchema = z.object({
  tid: z.string().describe('Trace/task ID'),
  wrong: z.string().describe('What was wrong'),
  fix: z.string().describe('How it was fixed'),
  cause: z.string().optional().describe('Root cause'),
});

const EndTaskSchema = z.object({
  tid: z.string().describe('Trace/task ID'),
  outcome: z.string().optional().default('success').describe('success|failure|partial'),
  summary: z.string().optional().describe('Brief outcome summary'),
});

const StoreEntitySchema = z.object({
  t: z.string().describe('Entity type code (T/P/E/S/J/C/R)'),
  nm: z.string().describe('Entity name'),
  d: z.string().optional().describe('Description / metadata'),
  j: z.string().optional().describe('Project'),
  obs: z.array(z.string()).optional().describe('Initial observations'),
});

const AddRelationshipSchema = z.object({
  src: z.string().describe('Source entity ID'),
  tgt: z.string().describe('Target entity ID'),
  rel: z.string().describe('Relationship type code (RB/DP/CB/IB/FB/TF/EF/UI)'),
});

// ---------------------------------------------------------------------------
// Tool definitions for MCP registration
// ---------------------------------------------------------------------------

export const recordToolDefs = [
  {
    name: 'mem_start_task',
    description:
      'Begin a task trace. Returns {tid, has_insights}. Call at the start of every task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        d: { type: 'string', description: 'Task description' },
        j: { type: 'string', description: 'Project name (optional)' },
        conv: { type: 'string', description: 'Conversation ID (optional)' },
      },
      required: ['d'],
    },
  },
  {
    name: 'mem_record_step',
    description: 'Record a step within the active task trace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tid: { type: 'string', description: 'Task/trace ID' },
        action: { type: 'string', description: 'What was done' },
        tool: { type: 'string', description: 'Tool used (optional)' },
        result: { type: 'string', description: 'Outcome description (optional)' },
        ok: { type: 'boolean', description: 'Success? (default: true)' },
      },
      required: ['tid', 'action'],
    },
  },
  {
    name: 'mem_record_correction',
    description:
      'Record when a mistake was corrected. Captures what was wrong, the fix, and root cause.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tid: { type: 'string', description: 'Task/trace ID' },
        wrong: { type: 'string', description: 'What was wrong' },
        fix: { type: 'string', description: 'How it was fixed' },
        cause: { type: 'string', description: 'Root cause (optional)' },
      },
      required: ['tid', 'wrong', 'fix'],
    },
  },
  {
    name: 'mem_end_task',
    description:
      'Close a task trace. Returns synthesis context with the trace summary, related patterns, and corrections for analysis. Check has_insights flag.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tid: { type: 'string', description: 'Task/trace ID' },
        outcome: {
          type: 'string',
          description: 'success|failure|partial (default: success)',
        },
        summary: { type: 'string', description: 'Brief outcome summary (optional)' },
      },
      required: ['tid'],
    },
  },
  {
    name: 'mem_store_entity',
    description: 'Store an entity (code component, person, project, etc.) with optional observations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        t: { type: 'string', description: 'Type code: T/P/E/S/J/C/R' },
        nm: { type: 'string', description: 'Entity name' },
        d: { type: 'string', description: 'Description (optional)' },
        j: { type: 'string', description: 'Project (optional)' },
        obs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Initial observations (optional)',
        },
      },
      required: ['t', 'nm'],
    },
  },
  {
    name: 'mem_add_relationship',
    description: 'Create a typed edge between two entities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        src: { type: 'string', description: 'Source entity ID' },
        tgt: { type: 'string', description: 'Target entity ID' },
        rel: {
          type: 'string',
          description: 'Relationship type: RB/DP/CB/IB/FB/TF/EF/UI',
        },
      },
      required: ['src', 'tgt', 'rel'],
    },
  },
];

// ---------------------------------------------------------------------------
// Step counter per trace (in-memory, resets on server restart)
// ---------------------------------------------------------------------------
const traceStepCounters = new Map<string, number>();

function nextStepIndex(traceId: string): number {
  const current = traceStepCounters.get(traceId) ?? 0;
  const next = current + 1;
  traceStepCounters.set(traceId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function createRecordHandlers(db: Database, cfg: Config) {
  return {
    mem_start_task(args: unknown) {
      const input = StartTaskSchema.parse(args);
      const traceRow = db.createTrace(
        input.d,
        input.j,
        input.conv,
      );

      // Initialize step counter
      traceStepCounters.set(traceRow.id, 0);

      // Check if there are active insights to surface
      const insights = db.getActiveInsights();
      const hasInsights = insights.length > 0;

      const result = { tid: traceRow.id, has_insights: hasInsights };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_record_step(args: unknown) {
      const input = RecordStepSchema.parse(args);
      const stepRow = db.addTraceStep(
        input.tid,
        nextStepIndex(input.tid),
        input.action,
        input.tool,
        input.result,
        input.ok,
      );

      const result = { id: stepRow.id, ok: true };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_record_correction(args: unknown) {
      const input = RecordCorrectionSchema.parse(args);
      const corrRow = db.addCorrection(
        input.tid,
        input.wrong,
        input.fix,
        input.cause,
      );

      const result = { id: corrRow.id, ok: true };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_end_task(args: unknown) {
      const input = EndTaskSchema.parse(args);

      // Map outcome string to the DB's expected status type
      const status: 'completed' | 'failed' =
        input.outcome === 'failure' || input.outcome === 'failed'
          ? 'failed'
          : 'completed';

      // Close the trace
      db.endTrace(input.tid, status, input.summary);

      // Clean up step counter
      traceStepCounters.delete(input.tid);

      // Gather synthesis context
      const trace = db.getTrace(input.tid);
      const steps = db.getTraceSteps(input.tid);
      const corrections = db.getTraceCorrections(input.tid);

      // Find related patterns by searching with the task description
      const relatedPatterns = trace
        ? db.searchPatterns(trace.description).slice(0, 10)
        : [];

      // Find recent corrections in same project
      const relatedCorrections = trace?.project
        ? db.getRecentCorrections(trace.project, 5)
        : [];

      // Check for insights
      const insights = db.getActiveInsights();
      const hasInsights = insights.length > 0;

      // Check proactive analysis timing
      const lastRun = db.getSetting('last_proactive_run');
      const proactiveIntervalMs = cfg.proactiveIntervalMin * 60 * 1000;
      const needsProactive =
        !lastRun ||
        Date.now() - new Date(lastRun).getTime() > proactiveIntervalMs;

      const result = {
        stored: true,
        has_insights: hasInsights,
        ctx: {
          trace: {
            tid: input.tid,
            d: trace?.description ?? '',
            steps: steps.map((s) => ({
              a: s.action,
              tool: s.tool,
              ok: !!s.success,
            })),
            corrections: corrections.map((c) => ({
              wrong: c.wrong,
              fix: c.fix,
              cause: c.cause,
            })),
          },
          related_patterns: relatedPatterns.map((p) => ({
            id: p.id,
            d: p.description,
            c: p.confidence,
            h: p.hit_count,
          })),
          related_corrections: relatedCorrections.map((c) => ({
            d: c.wrong,
            x: c.fix,
          })),
          prompt:
            'analyze this trace against existing patterns. extract new/updated patterns. call mem_commit_synthesis.',
        },
        needs_proactive: needsProactive,
      };

      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_store_entity(args: unknown) {
      const input = StoreEntitySchema.parse(args);

      const metadata: Record<string, unknown> = {};
      if (input.d) metadata.description = input.d;
      if (input.j) metadata.project = input.j;

      const entityRow = db.createEntity(
        input.t,
        input.nm,
        metadata,
      );

      // Add initial observations
      if (input.obs) {
        for (const obs of input.obs) {
          db.addObservation(entityRow.id, obs);
        }
      }

      const result = { id: entityRow.id, ok: true };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },

    mem_add_relationship(args: unknown) {
      const input = AddRelationshipSchema.parse(args);
      const relRow = db.createRelationship(
        input.src,
        input.tgt,
        input.rel,
      );

      const result = { id: relRow.id, ok: true };
      return cfg.codecFormat === 'compact' ? encode(result) : result;
    },
  };
}
