import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const home = os.homedir();

/** Antigravity data root */
const ANTIGRAVITY_DIR = path.join(home, '.gemini', 'antigravity');

/** Default database path – lives alongside Antigravity's own data */
const DEFAULT_DB_PATH = path.join(
  ANTIGRAVITY_DIR,
  'self-learning-mcp',
  'memory.db',
);

// ---------------------------------------------------------------------------
// Configuration – all env-var driven, zero required
// ---------------------------------------------------------------------------

export interface Config {
  /** Absolute path to the SQLite database file */
  dbPath: string;

  /** Minutes between proactive analysis cycles */
  proactiveIntervalMin: number;

  /** Days before a pattern is flagged stale */
  stalenessDays: number;

  /** Wire codec format: 'compact' (default) or 'verbose' (debug) */
  codecFormat: 'compact' | 'verbose';

  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): Config {
  return {
    dbPath: process.env.SELF_LEARNING_MCP_DB ?? DEFAULT_DB_PATH,
    proactiveIntervalMin: parseInt(
      process.env.SELF_LEARNING_MCP_PROACTIVE_MIN ?? '30',
      10,
    ),
    stalenessDays: parseInt(
      process.env.SELF_LEARNING_MCP_STALENESS_DAYS ?? '30',
      10,
    ),
    codecFormat:
      (process.env.SELF_LEARNING_MCP_CODEC as Config['codecFormat']) ??
      'compact',
    logLevel:
      (process.env.SELF_LEARNING_MCP_LOG as Config['logLevel']) ?? 'info',
  };
}

export const config = loadConfig();
