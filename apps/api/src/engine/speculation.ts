import { Chess } from "chess.js";
import type { Logger } from "pino";
import type { AnalysisService } from "./analysisService.js";
import type { WorkerPool } from "./workerPool.js";
import { getDifficultyProfile } from "./difficulty.js";
import { detectGamePhase } from "./phaseDetector.js";
import type { Difficulty, EngineState } from "../contracts.js";

export class SpeculationEngine {
  private activeJobs = new Map<string, AbortController>();

  constructor(
    private readonly pool: WorkerPool,
    private readonly analysisService: AnalysisService,
    private readonly logger: Logger,
  ) {}

  async speculate(params: {
    gameId: string;
    fen: string;
    difficulty: Difficulty;
    moveNumber: number;
    engineState: EngineState;
  }): Promise<void> {
    const { gameId, fen, difficulty, moveNumber, engineState } = params;

    // Rule: Disable speculation during active gambit in opening phase
    if (
      moveNumber < 10 &&
      engineState.gambit.active &&
      (engineState.gambit.status === "offered" || engineState.gambit.status === "accepted")
    ) {
      this.logger.debug({ gameId, moveNumber }, "Speculation disabled — gambit in progress during opening");
      return;
    }

    // Cancel any existing speculation for this game
    this.cancelForGame(gameId);

    const abort = new AbortController();
    this.activeJobs.set(gameId, abort);

    // Fire and forget — don't await, this runs in background
    void this.runSpeculation(gameId, fen, difficulty, moveNumber, abort.signal)
      .catch((error) => {
        if (!abort.signal.aborted) {
          this.logger.debug({ error, gameId }, "Speculation failed (non-critical)");
        }
      })
      .finally(() => {
        if (this.activeJobs.get(gameId) === abort) {
          this.activeJobs.delete(gameId);
        }
      });
  }

  cancelForGame(gameId: string): void {
    const existing = this.activeJobs.get(gameId);
    if (existing) {
      existing.abort();
      this.activeJobs.delete(gameId);
    }
  }

  cancelAll(): void {
    for (const [gameId, abort] of this.activeJobs) {
      abort.abort();
      this.activeJobs.delete(gameId);
    }
  }

  private async runSpeculation(
    gameId: string,
    fen: string,
    difficulty: Difficulty,
    moveNumber: number,
    signal: AbortSignal,
  ): Promise<void> {
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });

    if (legalMoves.length === 0 || signal.aborted) return;

    // Pick top 3 most likely player responses:
    // Prioritize captures, checks, and central moves
    const scored = legalMoves.map((move) => {
      let priority = 0;
      if (move.captured) priority += 3;
      if (move.san.includes("+")) priority += 4;
      if (move.san.includes("#")) priority += 5;
      if (["d4", "d5", "e4", "e5", "c4", "c5"].includes(move.to)) priority += 1;
      if (move.promotion) priority += 2;
      return { move, priority };
    });

    scored.sort((a, b) => b.priority - a.priority);
    const topResponses = scored.slice(0, 3);

    const profile = getDifficultyProfile(difficulty);
    const phase = detectGamePhase(moveNumber + 1, chess);
    const phaseMultiplier = phase === "opening" ? 0.6 : phase === "endgame" ? 0.7 : 1.0;
    const movetimeMs = Math.round(profile.movetimeMs * phaseMultiplier);

    for (const { move } of topResponses) {
      if (signal.aborted) return;

      const preview = new Chess(fen);
      try {
        preview.move(move);
      } catch {
        continue;
      }

      const resultFen = preview.fen();

      try {
        // Use low-priority worker (priority 2) — will be cancelled if real request arrives
        await this.pool.withWorker(
          gameId,
          async (worker) => {
            if (signal.aborted) return;
            await this.analysisService.getCandidatesWithMovetime(
              worker,
              resultFen,
              movetimeMs,
              profile.minDepth,
            );
            this.logger.debug(
              { gameId, speculativeMove: move.san, resultFen: resultFen.split(" ")[0] },
              "Speculative analysis cached",
            );
          },
          2, // Low priority
        );
      } catch {
        // Speculation failure is non-critical — worker was likely stolen for real request
        if (!signal.aborted) {
          this.logger.debug({ gameId, move: move.san }, "Speculative analysis skipped (worker unavailable)");
        }
        break;
      }
    }
  }
}
