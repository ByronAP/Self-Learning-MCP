/**
 * Compact Wire Codec — Encoder
 *
 * Converts full-fidelity internal objects into a compact, token-efficient
 * format for LLM consumption.
 */

import {
  ENTITY_TYPE_TO_CODE,
  REL_TYPE_TO_CODE,
  FIELD_TO_SHORT,
  PIPE_ELIGIBLE_FIELDS,
  TIMESTAMP_FIELDS,
  PERCENT_FIELDS,
  type EntityType,
  type RelType,
  type CompactEnvelope,
  type EdgeShorthand,
} from './types.js';

// ─── Helpers ────────────────────────────────────────────────────────

const entityTypeSet = new Set(Object.keys(ENTITY_TYPE_TO_CODE));
const relTypeSet = new Set(Object.keys(REL_TYPE_TO_CODE));
const fieldMap = FIELD_TO_SHORT as Record<string, string>;

/**
 * Convert a Date (or ISO-8601 string) to a compact relative timestamp
 * relative to `now`.
 *
 * Output examples: "2h", "3d", "1w", "2mo", "1y", "just now"
 */
export function toRelativeTimestamp(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);       // pass through unparseable
  const diffMs = now.getTime() - d.getTime();
  const absDiff = Math.abs(diffMs);
  const sign = diffMs < 0 ? '+' : '';                // future dates get "+"

  const SEC = 1_000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  if (absDiff < MIN) return 'just now';
  if (absDiff < HOUR) return `${sign}${Math.round(absDiff / MIN)}m`;
  if (absDiff < DAY) return `${sign}${Math.round(absDiff / HOUR)}h`;
  if (absDiff < WEEK) return `${sign}${Math.round(absDiff / DAY)}d`;
  if (absDiff < MONTH) return `${sign}${Math.round(absDiff / WEEK)}w`;
  if (absDiff < YEAR) return `${sign}${Math.round(absDiff / MONTH)}mo`;
  return `${sign}${Math.round(absDiff / YEAR)}y`;
}

/** Convert 0.0-1.0 float to integer percent (0-100). */
function toIntPercent(val: unknown): number | unknown {
  if (typeof val === 'number' && val >= 0 && val <= 1.0) {
    return Math.round(val * 100);
  }
  return val; // already integer or not a number
}

/**
 * Encode a single structured edge object to shorthand "E42>RB>S17".
 *
 * Uses the entity-type code prefix for source/target IDs when they look
 * like `{ id, type }` pairs.  Falls back to raw IDs.
 */
export function edgeToShorthand(edge: Record<string, unknown>): EdgeShorthand {
  const src = edge['source'] ?? edge['sr'] ?? '?';
  const tgt = edge['target'] ?? edge['tg'] ?? '?';
  const rel = edge['relation'] ?? edge['rl'] ?? '??';

  // Encode source label
  const srcType = edge['sourceType'] ?? edge['st'];
  const srcLabel = srcType && entityTypeSet.has(String(srcType))
    ? `${ENTITY_TYPE_TO_CODE[srcType as EntityType]}${src}`
    : String(src);

  // Encode target label
  const tgtType = edge['targetType'] ?? edge['tt'];
  const tgtLabel = tgtType && entityTypeSet.has(String(tgtType))
    ? `${ENTITY_TYPE_TO_CODE[tgtType as EntityType]}${tgt}`
    : String(tgt);

  // Encode relation
  const relCode = relTypeSet.has(String(rel))
    ? REL_TYPE_TO_CODE[rel as RelType]
    : String(rel);

  return `${srcLabel}>${relCode}>${tgtLabel}`;
}

// ─── Core Encoder ───────────────────────────────────────────────────

export interface EncodeOptions {
  /** Reference time for relative timestamps. Defaults to Date.now(). */
  now?: Date;
  /** If true, skip timestamp conversion (keep ISO strings). */
  keepTimestamps?: boolean;
  /** If true, skip pipe-delimiting arrays. */
  keepArrays?: boolean;
  /** If true, skip field-name shortening. */
  keepFieldNames?: boolean;
}

/**
 * Encode a verbose object into compact wire format.
 *
 * Recursively processes all nested objects and arrays.
 */
export function encode<T extends Record<string, unknown>>(
  obj: T,
  opts: EncodeOptions = {},
): Record<string, unknown> {
  const now = opts.now ?? new Date();
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // 1. Strip null / undefined
    if (value === null || value === undefined) continue;

    // 2. Determine the output key
    const outKey = opts.keepFieldNames
      ? key
      : (fieldMap[key] ?? key);

    // 3. Transform the value based on field semantics

    // 3a. Type codes
    if ((key === 'type' || key === 't') && typeof value === 'string') {
      if (entityTypeSet.has(value)) {
        out[outKey] = ENTITY_TYPE_TO_CODE[value as EntityType];
        continue;
      }
    }

    // 3b. Relation codes
    if ((key === 'relation' || key === 'rl') && typeof value === 'string') {
      if (relTypeSet.has(value)) {
        out[outKey] = REL_TYPE_TO_CODE[value as RelType];
        continue;
      }
    }

    // 3c. Timestamps → relative
    if (!opts.keepTimestamps && TIMESTAMP_FIELDS.has(key)) {
      if (value instanceof Date) {
        out[outKey] = toRelativeTimestamp(value, now);
        continue;
      }
      if (typeof value === 'string' && !isNaN(Date.parse(value))) {
        out[outKey] = toRelativeTimestamp(value as string, now);
        continue;
      }
    }

    // 3d. Confidence / score → integer percent
    if (PERCENT_FIELDS.has(key)) {
      out[outKey] = toIntPercent(value);
      continue;
    }

    // 3e. Edges array → shorthand strings
    if ((key === 'edges' || key === 'eg') && Array.isArray(value)) {
      out[outKey] = value.map((e) =>
        typeof e === 'object' && e !== null
          ? edgeToShorthand(e as Record<string, unknown>)
          : e,
      );
      continue;
    }

    // 3f. Simple string arrays → pipe-delimited
    if (
      !opts.keepArrays &&
      PIPE_ELIGIBLE_FIELDS.has(key) &&
      Array.isArray(value) &&
      value.every((v) => typeof v === 'string')
    ) {
      if (value.length === 0) continue; // omit empty arrays
      out[outKey] = (value as string[]).join('|');
      continue;
    }

    // 3g. Nested objects — recurse
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      out[outKey] = encode(value as Record<string, unknown>, opts);
      continue;
    }

    // 3h. Nested arrays of objects — recurse each element
    if (Array.isArray(value)) {
      out[outKey] = value.map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? encode(item as Record<string, unknown>, opts)
          : item,
      );
      continue;
    }

    // 3i. Default — keep as-is (strings, numbers, booleans)
    out[outKey] = value;
  }

  return out;
}

// ─── Envelope Helper ────────────────────────────────────────────────

/**
 * Wrap an array of results into a compact envelope.
 *
 * ```
 * encodeEnvelope(items)        → { n: 5, r: [...] }
 * encodeEnvelope(items, 42)    → { n: 42, r: [...] }
 * encodeEnvelope(items, 42, { page: 2, pageSize: 10 })
 *   → { n: 42, r: [...], pg: 2, ps: 10, hm: true }
 * ```
 */
export function encodeEnvelope<T extends Record<string, unknown>>(
  results: T[],
  total?: number,
  pagination?: { page?: number; pageSize?: number },
  opts?: EncodeOptions,
): CompactEnvelope<Record<string, unknown>> {
  const encoded = results.map((r) => encode(r, opts));
  const n = total ?? results.length;

  const env: CompactEnvelope<Record<string, unknown>> = { n, r: encoded };

  if (pagination?.page != null) env.pg = pagination.page;
  if (pagination?.pageSize != null) {
    env.ps = pagination.pageSize;
    env.hm = (pagination.page ?? 1) * pagination.pageSize < n;
  }

  return env;
}
