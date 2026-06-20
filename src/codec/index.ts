/**
 * Compact Wire Codec — Public API
 *
 * Re-exports the full encode/decode surface plus all type maps.
 */

// ── Types & Registries ──────────────────────────────────────────────
export {
  ENTITY_TYPE_TO_CODE,
  CODE_TO_ENTITY_TYPE,
  REL_TYPE_TO_CODE,
  CODE_TO_REL_TYPE,
  FIELD_TO_SHORT,
  SHORT_TO_FIELD,
  PIPE_ELIGIBLE_FIELDS,
  TIMESTAMP_FIELDS,
  PERCENT_FIELDS,
  type EntityType,
  type EntityCode,
  type RelType,
  type RelCode,
  type FullFieldName,
  type ShortFieldKey,
  type CompactEntity,
  type CompactEdge,
  type CompactPattern,
  type CompactEnvelope,
  type EdgeShorthand,
  type VerboseEdge,
} from './types.js';

// ── Encoder ─────────────────────────────────────────────────────────
export {
  encode,
  encodeEnvelope,
  toRelativeTimestamp,
  edgeToShorthand,
  type EncodeOptions,
} from './encoder.js';

// ── Decoder ─────────────────────────────────────────────────────────
export {
  decode,
  decodeEnvelope,
  fromRelativeTimestamp,
  parseEdgeShorthand,
  type DecodeOptions,
  type DecodedEnvelope,
} from './decoder.js';
