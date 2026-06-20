/**
 * Compact Wire Codec — Decoder
 *
 * Accepts BOTH compact and verbose input and normalises to full-fidelity
 * objects.  Never rejects valid intent — if a field is recognizable, accept it.
 */

import {
  CODE_TO_ENTITY_TYPE,
  CODE_TO_REL_TYPE,
  SHORT_TO_FIELD,
  ENTITY_TYPE_TO_CODE,
  REL_TYPE_TO_CODE,
  PIPE_ELIGIBLE_FIELDS,
  TIMESTAMP_FIELDS,
  PERCENT_FIELDS,
  type EntityCode,
  type RelCode,
  type VerboseEdge,
} from './types.js';

// ─── Helpers ────────────────────────────────────────────────────────

const entityCodes = new Set(Object.keys(CODE_TO_ENTITY_TYPE));
const relCodes = new Set(Object.keys(CODE_TO_REL_TYPE));
const entityFullNames = new Set(Object.keys(ENTITY_TYPE_TO_CODE));
const relFullNames = new Set(Object.keys(REL_TYPE_TO_CODE));
const shortKeys = new Set(Object.keys(SHORT_TO_FIELD));

/**
 * Parse a compact relative timestamp string back to an absolute Date.
 *
 * Accepts: "just now", "2h", "3d", "1w", "2mo", "1y", "+5m" (future).
 * Also passes through valid ISO-8601 strings as-is.
 */
export function fromRelativeTimestamp(ts: string, now: Date = new Date()): Date {
  if (!ts || typeof ts !== 'string') return now;

  // If it's already ISO-8601, parse directly
  if (ts.includes('T') || ts.includes('-')) {
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  if (ts === 'just now') return now;

  const match = ts.match(/^([+-]?)(\d+)(m|h|d|w|mo|y)$/);
  if (!match) return now;

  const [, sign, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  const multiplier = sign === '+' ? -1 : 1; // "+" means future → subtract from now

  const SEC = 1_000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  const unitMs: Record<string, number> = {
    m: MIN,
    h: HOUR,
    d: DAY,
    w: WEEK,
    mo: MONTH,
    y: YEAR,
  };

  return new Date(now.getTime() - multiplier * num * (unitMs[unit] ?? 0));
}

/**
 * Parse an edge shorthand string "E42>RB>S17" into a structured VerboseEdge.
 */
export function parseEdgeShorthand(shorthand: string): VerboseEdge | null {
  const parts = shorthand.split('>');
  if (parts.length !== 3) return null;

  const [srcRaw, relRaw, tgtRaw] = parts;

  // Extract entity type prefix + numeric id from source
  const srcMatch = srcRaw.match(/^([A-Z])(\d+)$/);
  const source = srcMatch ? parseInt(srcMatch[2], 10) : parseIdValue(srcRaw);

  // Extract entity type prefix + numeric id from target
  const tgtMatch = tgtRaw.match(/^([A-Z])(\d+)$/);
  const target = tgtMatch ? parseInt(tgtMatch[2], 10) : parseIdValue(tgtRaw);

  // Resolve relation code
  const relation = relCodes.has(relRaw)
    ? CODE_TO_REL_TYPE[relRaw as RelCode]
    : (relFullNames.has(relRaw) ? relRaw as any : relRaw as any);

  const edge: VerboseEdge = { source, relation, target };

  // Attach decoded source/target types if prefixed
  if (srcMatch && entityCodes.has(srcMatch[1])) {
    (edge as Record<string, unknown>)['sourceType'] =
      CODE_TO_ENTITY_TYPE[srcMatch[1] as EntityCode];
  }
  if (tgtMatch && entityCodes.has(tgtMatch[1])) {
    (edge as Record<string, unknown>)['targetType'] =
      CODE_TO_REL_TYPE[tgtMatch[1] as RelCode] ??
      CODE_TO_ENTITY_TYPE[tgtMatch[1] as EntityCode];
  }

  return edge;
}

/** Parse a value that might be a numeric id or a string id. */
function parseIdValue(raw: string): number | string {
  const num = Number(raw);
  return Number.isFinite(num) && String(num) === raw ? num : raw;
}

/** Check if a string looks like a pipe-delimited list (has pipes, no JSON). */
function isPipeDelimited(val: string): boolean {
  return val.includes('|') && !val.startsWith('[') && !val.startsWith('{');
}

// ─── Core Decoder ───────────────────────────────────────────────────

export interface DecodeOptions {
  /** Reference time for relative timestamp parsing. Defaults to Date.now(). */
  now?: Date;
  /** If true, keep timestamps as relative strings instead of converting to Date. */
  keepRelativeTimestamps?: boolean;
  /** If true, keep pipe-delimited strings instead of splitting to arrays. */
  keepPipeStrings?: boolean;
  /** If true, keep short field names (don't expand). */
  keepShortKeys?: boolean;
}

/**
 * Decode a compact (or verbose, or mixed) object back to full-fidelity form.
 *
 * Gracefully handles:
 * - Short keys → expanded
 * - Type/rel codes → full names
 * - Pipe-delimited strings → arrays
 * - Relative timestamps → Dates
 * - Edge shorthand strings → VerboseEdge objects
 * - Integer percent → 0.0-1.0
 */
export function decode<T = Record<string, unknown>>(
  input: Record<string, unknown>,
  opts: DecodeOptions = {},
): T {
  const now = opts.now ?? new Date();
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;

    // 1. Expand field name
    const fullKey = opts.keepShortKeys
      ? key
      : (shortKeys.has(key) ? SHORT_TO_FIELD[key]! : key);

    // 2. Transform value

    // 2a. Type code → full name
    if ((fullKey === 'type' || key === 't') && typeof value === 'string') {
      if (entityCodes.has(value)) {
        out[fullKey] = CODE_TO_ENTITY_TYPE[value as EntityCode];
        continue;
      }
      // Already a full name? Accept it.
      if (entityFullNames.has(value)) {
        out[fullKey] = value;
        continue;
      }
    }

    // 2b. Relation code → full name
    if ((fullKey === 'relation' || key === 'rl') && typeof value === 'string') {
      if (relCodes.has(value)) {
        out[fullKey] = CODE_TO_REL_TYPE[value as RelCode];
        continue;
      }
      if (relFullNames.has(value)) {
        out[fullKey] = value;
        continue;
      }
    }

    // 2c. Timestamp fields → Date
    if (
      !opts.keepRelativeTimestamps &&
      TIMESTAMP_FIELDS.has(key) &&
      typeof value === 'string'
    ) {
      out[fullKey] = fromRelativeTimestamp(value, now);
      continue;
    }

    // 2d. Percent fields → 0.0-1.0
    if (PERCENT_FIELDS.has(key) && typeof value === 'number' && value > 1) {
      out[fullKey] = value / 100;
      continue;
    }
    // Also handle the expanded key name for percent
    if (PERCENT_FIELDS.has(fullKey) && typeof value === 'number' && value > 1) {
      out[fullKey] = value / 100;
      continue;
    }

    // 2e. Edges array — may contain shorthand strings or objects
    if ((fullKey === 'edges' || key === 'eg') && Array.isArray(value)) {
      out[fullKey] = value.map((item) => {
        if (typeof item === 'string') return parseEdgeShorthand(item) ?? item;
        if (typeof item === 'object' && item !== null) {
          return decode(item as Record<string, unknown>, opts);
        }
        return item;
      });
      continue;
    }

    // 2f. Pipe-delimited string → array
    if (
      !opts.keepPipeStrings &&
      typeof value === 'string' &&
      (PIPE_ELIGIBLE_FIELDS.has(key) || PIPE_ELIGIBLE_FIELDS.has(fullKey)) &&
      isPipeDelimited(value)
    ) {
      out[fullKey] = value.split('|');
      continue;
    }

    // 2g. Nested objects — recurse
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      out[fullKey] = decode(value as Record<string, unknown>, opts);
      continue;
    }

    // 2h. Nested arrays of objects — recurse each element
    if (Array.isArray(value)) {
      out[fullKey] = value.map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? decode(item as Record<string, unknown>, opts)
          : item,
      );
      continue;
    }

    // 2i. Default — pass through
    out[fullKey] = value;
  }

  return out as T;
}

// ─── Envelope Decoder ───────────────────────────────────────────────

/** Decoded envelope with full-name fields. */
export interface DecodedEnvelope<T = Record<string, unknown>> {
  totalResults: number;
  results: T[];
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}

/**
 * Decode a compact envelope `{ n, r, pg?, ps?, hm? }` or a verbose one.
 */
export function decodeEnvelope<T = Record<string, unknown>>(
  input: Record<string, unknown>,
  opts?: DecodeOptions,
): DecodedEnvelope<T> {
  const totalResults = (input['n'] ?? input['totalResults'] ?? 0) as number;
  const rawResults = (input['r'] ?? input['results'] ?? []) as Record<string, unknown>[];
  const results = rawResults.map((r) => decode<T>(r, opts));

  const env: DecodedEnvelope<T> = { totalResults, results };

  const page = input['pg'] ?? input['page'];
  if (page != null) env.page = page as number;

  const pageSize = input['ps'] ?? input['pageSize'];
  if (pageSize != null) env.pageSize = pageSize as number;

  const hasMore = input['hm'] ?? input['hasMore'];
  if (hasMore != null) env.hasMore = hasMore as boolean;

  return env;
}
