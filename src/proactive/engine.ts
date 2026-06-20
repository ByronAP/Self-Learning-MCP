// ===========================================================================
// Proactive Engine — orchestrates background heuristic analysis.
// ===========================================================================

import type Database from '../db/database.js';
import { config } from '../config.js';
import { detectStaleness } from './staleness-detector.js';
import { detectDrift } from './drift-detector.js';
import { forecastRisks } from './risk-forecaster.js';
import { surfaceOpportunities } from './opportunity-surfacer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunResult {
  ranAt: string;
  stalenessInsights: number;
  driftInsights: number;
  riskInsights: number;
  opportunityInsights: number;
  totalCreated: number;
  skippedReason?: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const SETTING_KEY = 'last_proactive_run';

export class ProactiveEngine {
  private db: Database;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  // -----------------------------------------------------------------------
  // Core Analysis
  // -----------------------------------------------------------------------

  /**
   * Run all analyzers sequentially. Always runs regardless of timing.
   */
  runAll(): RunResult {
    const now = new Date().toISOString();
    const stalenessInsights = detectStaleness(this.db, config.stalenessDays);
    const driftInsights = detectDrift(this.db);
    const riskInsights = forecastRisks(this.db);
    const opportunityInsights = surfaceOpportunities(this.db);

    const totalCreated =
      stalenessInsights + driftInsights + riskInsights + opportunityInsights;

    // Record the run.
    this.db.setSetting(SETTING_KEY, now);

    return {
      ranAt: now,
      stalenessInsights,
      driftInsights,
      riskInsights,
      opportunityInsights,
      totalCreated,
    };
  }

  /**
   * Run all analyzers only if enough time has elapsed since the last run.
   * Uses `config.proactiveIntervalMin` as the minimum gap in minutes.
   */
  runIfNeeded(): RunResult {
    const lastRun = this.db.getSetting(SETTING_KEY);

    if (lastRun) {
      const lastRunTime = new Date(lastRun).getTime();
      const now = Date.now();
      const elapsedMin = (now - lastRunTime) / 60_000;

      if (elapsedMin < config.proactiveIntervalMin) {
        return {
          ranAt: new Date().toISOString(),
          stalenessInsights: 0,
          driftInsights: 0,
          riskInsights: 0,
          opportunityInsights: 0,
          totalCreated: 0,
          skippedReason: `Last run was ${Math.round(elapsedMin)}m ago (interval: ${config.proactiveIntervalMin}m)`,
        };
      }
    }

    return this.runAll();
  }

  // -----------------------------------------------------------------------
  // Timer Management
  // -----------------------------------------------------------------------

  /**
   * Start the background analysis timer.
   * Runs `runIfNeeded()` at the configured interval.
   */
  start(): void {
    if (this.intervalHandle) return; // Already running.

    const intervalMs = config.proactiveIntervalMin * 60_000;

    this.intervalHandle = setInterval(() => {
      try {
        this.runIfNeeded();
      } catch (err) {
        // Swallow errors — proactive analysis should never crash the server.
        console.error('[ProactiveEngine] Error during background run:', err);
      }
    }, intervalMs);

    // Don't keep the process alive just for proactive analysis.
    if (this.intervalHandle && typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stop the background analysis timer.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
