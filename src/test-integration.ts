/**
 * Comprehensive integration test for the Self-Learning MCP Server.
 * Tests all tool handlers directly (bypassing MCP transport).
 */

import { Database } from './db/database.js';
import { config } from './config.js';
import { createRecordHandlers } from './tools/record.js';
import { createRecallHandlers } from './tools/recall.js';
import { createCooperativeHandlers } from './tools/cooperative.js';
import { createProactiveHandlers } from './tools/proactive.js';

const TEST_DB = ':memory:';
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// Override config for in-memory testing
const testConfig = { ...config, codecFormat: 'verbose' as const };

console.log('\n═══ Self-Learning MCP — Full Integration Test ═══\n');

// Initialize with in-memory database
const db = new Database(TEST_DB);
const record = createRecordHandlers(db, testConfig);
const recall = createRecallHandlers(db, testConfig);
const coop = createCooperativeHandlers(db, testConfig);
const proactive = createProactiveHandlers(db, testConfig);

// ─── RECORD TOOLS ─────────────────────────────────────────────────

console.log('📝 Record Tools');

let traceId = '';
test('mem_start_task', () => {
  const r = record.mem_start_task({ d: 'Test building a web app', j: 'test-project' }) as any;
  assert(r.tid, 'Missing tid');
  assert(typeof r.has_insights === 'boolean', 'Missing has_insights');
  traceId = r.tid;
});

test('mem_record_step', () => {
  const r = record.mem_record_step({
    tid: traceId,
    action: 'Created index.html',
    tool: 'write_to_file',
    result: 'File created',
    ok: true,
  }) as any;
  assert(r.id, 'Missing step id');
  assert(r.ok === true, 'Step not ok');
});

test('mem_record_step (failure)', () => {
  const r = record.mem_record_step({
    tid: traceId,
    action: 'Tried to deploy',
    tool: 'run_command',
    result: 'Permission denied',
    ok: false,
  }) as any;
  assert(r.id, 'Missing step id');
});

test('mem_record_correction', () => {
  const r = record.mem_record_correction({
    tid: traceId,
    wrong: 'Used wrong port 3000 instead of 8080',
    fix: 'Changed to port 8080',
    cause: 'Default port was already in use',
  }) as any;
  assert(r.id, 'Missing correction id');
  assert(r.ok === true, 'Correction not ok');
});

let entityId1 = '';
let entityId2 = '';
test('mem_store_entity', () => {
  const r = record.mem_store_entity({
    t: 'C',
    nm: 'WebApp Component',
    d: 'Main web application entry point',
    j: 'test-project',
    obs: ['Uses React 18', 'TypeScript strict mode'],
  }) as any;
  assert(r.id, 'Missing entity id');
  entityId1 = r.id;
});

test('mem_store_entity (second)', () => {
  const r = record.mem_store_entity({
    t: 'S',
    nm: 'Port Configuration Fix',
    d: 'Always check port availability before binding',
    j: 'test-project',
  }) as any;
  assert(r.id, 'Missing entity id');
  entityId2 = r.id;
});

test('mem_add_relationship', () => {
  const r = record.mem_add_relationship({
    src: entityId1,
    tgt: entityId2,
    rel: 'RB',
  }) as any;
  assert(r.id, 'Missing relationship id');
});

test('mem_end_task', () => {
  const r = record.mem_end_task({
    tid: traceId,
    outcome: 'success',
    summary: 'Built and tested web app successfully',
  }) as any;
  assert(r.stored === true, 'Not stored');
  assert(typeof r.has_insights === 'boolean', 'Missing has_insights');
  assert(r.ctx, 'Missing synthesis context');
  assert(r.ctx.trace.steps.length === 2, `Expected 2 steps, got ${r.ctx.trace.steps.length}`);
  assert(r.ctx.trace.corrections.length === 1, `Expected 1 correction, got ${r.ctx.trace.corrections.length}`);
});

// ─── RECALL TOOLS ─────────────────────────────────────────────────

console.log('\n🔍 Recall Tools');

test('mem_recall', () => {
  const r = recall.mem_recall({ q: 'WebApp' }) as any;
  assert(r.n >= 1, `Expected results, got ${r.n}`);
});

test('mem_recall (no results)', () => {
  const r = recall.mem_recall({ q: 'xyznonexistent' }) as any;
  assert(r.n === 0, 'Expected 0 results');
});

test('mem_get_context', () => {
  const r = recall.mem_get_context({ topic: 'WebApp', j: 'test-project' }) as any;
  assert(r.topic === 'WebApp', 'Wrong topic');
  assert(r.ent.length >= 1, 'Missing entities');
  assert(r.cor.length >= 1, 'Missing corrections');
});

test('mem_get_entity', () => {
  const r = recall.mem_get_entity({ id: entityId1 }) as any;
  assert(r.id === entityId1, 'Wrong entity');
  assert(r.t === 'C', 'Wrong type');
  assert(r.nm === 'WebApp Component', 'Wrong name');
  assert(r.obs.length === 2, `Expected 2 observations, got ${r.obs.length}`);
  assert(r.edges.length >= 1, `Expected edges, got ${r.edges.length}`);
});

test('mem_get_entity (not found)', () => {
  const r = recall.mem_get_entity({ id: 'nonexistent-id' }) as any;
  assert(r.error === 'Entity not found', 'Expected error');
});

test('mem_query_graph (by type)', () => {
  const r = recall.mem_query_graph({ t: 'C' }) as any;
  assert(r.n >= 1, 'Expected code entities');
});

test('mem_query_graph (by relationship)', () => {
  const r = recall.mem_query_graph({ rel: 'RB' }) as any;
  assert(r.n >= 1, 'Expected entities with RB relationships');
});

test('mem_get_briefing', () => {
  const r = recall.mem_get_briefing({ d: 'Build another web app', j: 'test-project' }) as any;
  assert(r.task === 'Build another web app', 'Wrong task');
  assert(r.hist, 'Missing historical data');
  assert(r.cor.length >= 1, 'Expected corrections in briefing');
});

test('mem_get_wiki (empty)', () => {
  const r = recall.mem_get_wiki({}) as any;
  assert(r.n === 0, 'Expected empty wiki');
});

// ─── COOPERATIVE TOOLS ────────────────────────────────────────────

console.log('\n🤝 Cooperative Tools');

test('mem_commit_synthesis', () => {
  const r = coop.mem_commit_synthesis({
    tid: traceId,
    patterns: [
      { d: 'Always check port availability before binding', c: 85, cond: 'When starting dev servers' },
      { d: 'Use TypeScript strict mode for new projects', c: 90 },
    ],
    anti: [
      { d: 'Never hardcode port numbers', cause: 'Port conflicts in multi-project environments' },
    ],
  }) as any;
  assert(r.ok === true, 'Synthesis not ok');
  assert(r.pat_new === 2, `Expected 2 new patterns, got ${r.pat_new}`);
  assert(r.anti === 1, `Expected 1 anti-pattern, got ${r.anti}`);
});

test('mem_commit_wiki', () => {
  const r = coop.mem_commit_wiki({
    sections: [
      { sec: 'pat', j: 'test-project', x: '## Patterns\n- Check port availability\n- Use TS strict mode' },
      { sec: 'err', j: 'test-project', x: '## Common Errors\n- Port conflicts: check before binding' },
    ],
  }) as any;
  assert(r.ok === true, 'Wiki commit not ok');
  assert(r.saved === 2, `Expected 2 saved, got ${r.saved}`);
});

test('mem_get_wiki (after commit)', () => {
  const r = recall.mem_get_wiki({ j: 'test-project' }) as any;
  assert(r.n === 2, `Expected 2 wiki pages, got ${r.n}`);
});

test('mem_get_wiki (section filter)', () => {
  const r = recall.mem_get_wiki({ j: 'test-project', sec: 'pat' }) as any;
  assert(r.n === 1, `Expected 1 wiki page, got ${r.n}`);
  assert(r.pages[0].sec === 'pat', 'Wrong section');
});

test('mem_regenerate_wiki', () => {
  const r = coop.mem_regenerate_wiki({ j: 'test-project' }) as any;
  assert(r.context, 'Missing context');
  assert(r.context.pat.length >= 2, 'Expected patterns in context');
  assert(r.prompt, 'Missing synthesis prompt');
});

// ─── PROACTIVE TOOLS ──────────────────────────────────────────────

console.log('\n⚡ Proactive Tools');

test('mem_get_insights (empty)', () => {
  const r = proactive.mem_get_insights({}) as any;
  assert(r.n === 0, `Expected 0 insights, got ${r.n}`);
});

test('mem_set_watch', () => {
  const r = proactive.mem_set_watch({
    condition: 'port conflict patterns increase',
    entity_id: entityId1,
  }) as any;
  assert(r.ok === true, 'Watch not ok');
  assert(r.id, 'Missing watch id');
});

// ─── RECALL AFTER FULL CYCLE ──────────────────────────────────────

console.log('\n📊 Post-Cycle Verification');

test('mem_recall finds patterns', () => {
  const r = recall.mem_recall({ q: 'port' }) as any;
  assert(r.n >= 1, `Expected port-related results, got ${r.n}`);
});

test('mem_get_briefing includes learned patterns', () => {
  const r = recall.mem_get_briefing({ d: 'Start a new dev server', j: 'test-project' }) as any;
  assert(r.pat.length >= 1, 'Expected learned patterns in briefing');
  assert(r.cor.length >= 1, 'Expected corrections in briefing');
});

test('mem_recall with special characters', () => {
  const r = recall.mem_recall({ q: 'self-learning test' }) as any;
  // Should not crash — FTS sanitization handles the hyphen
  assert(typeof r.n === 'number', 'Should return results count');
});

// ─── SUMMARY ──────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);

db.close();
process.exit(failed > 0 ? 1 : 0);
