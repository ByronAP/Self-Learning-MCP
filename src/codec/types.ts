/**
 * Compact Wire Codec — Type Registries & Field Maps
 *
 * Defines all short-key ↔ full-name mappings used by the encoder/decoder.
 * Every map is a frozen `as const` object so TypeScript can narrow on values.
 */

// ─── Entity Type Codes ──────────────────────────────────────────────

/** Verbose entity type → 1-char code */
export const ENTITY_TYPE_TO_CODE = {
  task: 'T',
  pattern: 'P',
  error: 'E',
  solution: 'S',
  project: 'J',
  code: 'C',
  person: 'R',
  trace: 'X',
  insight: 'I',
  watch: 'W',
} as const;

export type EntityType = keyof typeof ENTITY_TYPE_TO_CODE;
export type EntityCode = (typeof ENTITY_TYPE_TO_CODE)[EntityType];

/** 1-char code → verbose entity type */
export const CODE_TO_ENTITY_TYPE: Readonly<Record<EntityCode, EntityType>> =
  Object.fromEntries(
    Object.entries(ENTITY_TYPE_TO_CODE).map(([k, v]) => [v, k]),
  ) as Record<EntityCode, EntityType>;

// ─── Relationship Type Codes ────────────────────────────────────────

/** Verbose relationship → 2-char code */
export const REL_TYPE_TO_CODE = {
  resolved_by: 'RB',
  depends_on: 'DP',
  caused_by: 'CB',
  improved_by: 'IB',
  followed_by: 'FB',
  transferred_from: 'TF',
  extracted_from: 'EF',
  used_in: 'UI',
} as const;

export type RelType = keyof typeof REL_TYPE_TO_CODE;
export type RelCode = (typeof REL_TYPE_TO_CODE)[RelType];

/** 2-char code → verbose relationship type */
export const CODE_TO_REL_TYPE: Readonly<Record<RelCode, RelType>> =
  Object.fromEntries(
    Object.entries(REL_TYPE_TO_CODE).map(([k, v]) => [v, k]),
  ) as Record<RelCode, RelType>;

// ─── Field Key Abbreviations ────────────────────────────────────────

/**
 * Full field name → short key (1-3 chars).
 * The decoder also understands the full names so both are valid input.
 */
export const FIELD_TO_SHORT = {
  // identity
  id: 'id',
  type: 't',
  name: 'n',

  // descriptive
  description: 'd',
  summary: 'sm',
  title: 'tl',
  content: 'ct',
  message: 'mg',
  body: 'bd',
  status: 'st',
  state: 'sa',
  category: 'ca',
  priority: 'pr',
  severity: 'sv',

  // metrics
  confidence: 'c',
  score: 'sc',
  count: 'cn',
  frequency: 'fq',
  weight: 'wt',
  impact: 'im',

  // temporal
  createdAt: 'cr',
  updatedAt: 'up',
  resolvedAt: 'ra',
  lastSeen: 'ls',
  firstSeen: 'fs',
  timestamp: 'ts',

  // relational
  source: 'sr',
  target: 'tg',
  relation: 'rl',
  edges: 'eg',
  tags: 'ta',
  labels: 'lb',
  patterns: 'pt',
  solutions: 'sl',
  errors: 'er',
  children: 'ch',
  parent: 'pa',
  parentId: 'pi',

  // context
  projectId: 'pj',
  language: 'lg',
  file: 'f',
  filepath: 'fp',
  line: 'ln',
  column: 'col',
  stackTrace: 'stk',
  context: 'cx',
  metadata: 'md',

  // envelope
  totalResults: 'n',
  results: 'r',
  page: 'pg',
  pageSize: 'ps',
  hasMore: 'hm',
} as const;

export type FullFieldName = keyof typeof FIELD_TO_SHORT;
export type ShortFieldKey = (typeof FIELD_TO_SHORT)[FullFieldName];

/** Short key → full field name */
export const SHORT_TO_FIELD: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(FIELD_TO_SHORT).map(([k, v]) => [v, k]),
  );

// ─── Sets for Quick Lookups ─────────────────────────────────────────

/** Fields whose values are simple-string arrays eligible for pipe-delimiting */
export const PIPE_ELIGIBLE_FIELDS: ReadonlySet<string> = new Set([
  'tags', 'labels', 'patterns', 'solutions', 'errors',
  'ta', 'lb', 'pt', 'sl', 'er',
]);

/** Fields that hold Date / timestamp values */
export const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  'createdAt', 'updatedAt', 'resolvedAt', 'lastSeen', 'firstSeen', 'timestamp',
  'cr', 'up', 'ra', 'ls', 'fs', 'ts',
]);

/** Fields that hold 0.0-1.0 confidence / score values */
export const PERCENT_FIELDS: ReadonlySet<string> = new Set([
  'confidence', 'score', 'weight', 'impact',
  'c', 'sc', 'wt', 'im',
]);

// ─── Compact Shape Interfaces ───────────────────────────────────────

/** A compactly-encoded entity */
export interface CompactEntity {
  id: number | string;
  t: EntityCode;
  n?: string;
  d?: string;
  c?: number;          // integer percent 0-100
  st?: string;
  cr?: string;         // relative timestamp e.g. "2h"
  up?: string;
  [key: string]: unknown;
}

/** A compactly-encoded relationship / edge */
export interface CompactEdge {
  sr: number | string;  // source id
  rl: RelCode;          // relation code
  tg: number | string;  // target id
  c?: number;           // confidence
  [key: string]: unknown;
}

/** Shorthand edge string like "E42>RB>S17" */
export type EdgeShorthand = string;

/** A compactly-encoded pattern */
export interface CompactPattern {
  id: number | string;
  t: 'P';
  n?: string;
  d?: string;
  c?: number;
  fq?: number;
  pt?: string;   // pipe-delimited tags
  [key: string]: unknown;
}

/** Compact result envelope */
export interface CompactEnvelope<T = unknown> {
  n: number;     // total count
  r: T[];        // results array
  pg?: number;   // page
  ps?: number;   // page size
  hm?: boolean;  // has more
}

/** Verbose (decoded) edge structure */
export interface VerboseEdge {
  source: number | string;
  relation: RelType;
  target: number | string;
  confidence?: number;
  [key: string]: unknown;
}
