import type { Logger } from "pino";

export interface MoveMetrics {
  gameId: string;
  moveNumber: number;
  difficulty: string;
  phase: string;

  queueWaitMs: number;
  analysisTimeMs: number;
  candidateCacheHit: boolean;
  earlyExitTriggered: boolean;
  depthReached: number;

  behaviorTimes: {
    gambit: number;
    trap: number;
    sacrifice: number;
    aggressive: number;
    psychological: number;
  };

  contextReadMs: number;
  contextWriteMs: number;
  contextDegraded: boolean;

  totalE2eMs: number;

  engineMode: string;
  behaviorScore: number;
}

interface AggregatedMetrics {
  totalMoves: number;
  avgE2eMs: number;
  avgAnalysisMs: number;
  avgQueueWaitMs: number;
  candidateCacheHitRate: number;
  earlyExitRate: number;
  contextDegradedRate: number;
  modeDistribution: Record<string, number>;
  p95E2eMs: number;
}

export class MetricsCollector {
  private readonly window: MoveMetrics[] = [];
  private readonly maxWindowSize = 500;

  constructor(private readonly logger: Logger) {}

  record(metrics: MoveMetrics): void {
    this.window.push(metrics);
    if (this.window.length > this.maxWindowSize) {
      this.window.shift();
    }

    this.logger.info(
      {
        gameId: metrics.gameId,
        moveNumber: metrics.moveNumber,
        totalE2eMs: metrics.totalE2eMs,
        analysisTimeMs: metrics.analysisTimeMs,
        candidateCacheHit: metrics.candidateCacheHit,
        earlyExitTriggered: metrics.earlyExitTriggered,
        contextDegraded: metrics.contextDegraded,
        engineMode: metrics.engineMode,
        behaviorScore: metrics.behaviorScore,
      },
      "Move metrics recorded",
    );

    // Alert conditions
    this.checkAlerts();
  }

  getAggregated(): AggregatedMetrics {
    if (this.window.length === 0) {
      return {
        totalMoves: 0,
        avgE2eMs: 0,
        avgAnalysisMs: 0,
        avgQueueWaitMs: 0,
        candidateCacheHitRate: 0,
        earlyExitRate: 0,
        contextDegradedRate: 0,
        modeDistribution: {},
        p95E2eMs: 0,
      };
    }

    const n = this.window.length;
    const sumE2e = this.window.reduce((s, m) => s + m.totalE2eMs, 0);
    const sumAnalysis = this.window.reduce((s, m) => s + m.analysisTimeMs, 0);
    const sumQueue = this.window.reduce((s, m) => s + m.queueWaitMs, 0);
    const cacheHits = this.window.filter((m) => m.candidateCacheHit).length;
    const earlyExits = this.window.filter((m) => m.earlyExitTriggered).length;
    const degraded = this.window.filter((m) => m.contextDegraded).length;

    const modeDistribution: Record<string, number> = {};
    for (const m of this.window) {
      modeDistribution[m.engineMode] = (modeDistribution[m.engineMode] ?? 0) + 1;
    }

    // P95 E2E time
    const sortedE2e = this.window.map((m) => m.totalE2eMs).sort((a, b) => a - b);
    const p95Index = Math.ceil(n * 0.95) - 1;
    const p95 = sortedE2e[Math.max(0, p95Index)] ?? 0;

    return {
      totalMoves: n,
      avgE2eMs: Math.round(sumE2e / n),
      avgAnalysisMs: Math.round(sumAnalysis / n),
      avgQueueWaitMs: Math.round(sumQueue / n),
      candidateCacheHitRate: Math.round((cacheHits / n) * 100),
      earlyExitRate: Math.round((earlyExits / n) * 100),
      contextDegradedRate: Math.round((degraded / n) * 100),
      modeDistribution,
      p95E2eMs: p95,
    };
  }

  private checkAlerts(): void {
    // Only check after at least 10 moves
    if (this.window.length < 10) return;

    const recent = this.window.slice(-10);

    // Alert: avg latency > 2000ms for last 10 moves
    const avgE2e = recent.reduce((s, m) => s + m.totalE2eMs, 0) / recent.length;
    if (avgE2e > 2000) {
      this.logger.warn(
        { avgE2eMs: Math.round(avgE2e), sampleSize: recent.length },
        "ALERT: Average move latency exceeds 2000ms",
      );
    }

    // Alert: context degraded for > 3 consecutive moves
    const recentDegraded = recent.slice(-3).every((m) => m.contextDegraded);
    if (recentDegraded) {
      this.logger.warn(
        { consecutiveDegraded: 3 },
        "ALERT: Context degraded for 3+ consecutive moves \u2014 Redis may be down",
      );
    }
  }
}
