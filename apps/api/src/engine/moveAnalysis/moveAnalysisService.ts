import type {
  CandidateMove,
  Difficulty,
  MoveAnalysisResult,
  PlayerColor,
  RecommendedMove,
} from "../../contracts.js";
import type { Logger } from "pino";
import type { AnalysisService } from "../analysisService.js";
import type { WorkerPool } from "../workerPool.js";
import type { EvalCache } from "../../types.js";
import { env } from "../../config/env.js";
import { sanFromUci, normalizeEvaluation } from "../../utils/chess.js";
import { classifyByEvalLoss, type ClassificationThresholds } from "./classifyMove.js";
import { checkEdgeCases, normalizeMateEval } from "./edgeCases.js";
import { detectBrilliant } from "./brilliantDetector.js";
import { generateExplanations, type ExplainerContext } from "./explainers.js";

export interface MoveAnalysisParams {
  gameId: string;
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  moveNotation: string;
  playerColor: PlayerColor;
  difficulty: Difficulty;
  evalBeforeHint?: number | null;
  openingBookName?: string | null;
}

const DEPTH_BY_DIFFICULTY: Record<Difficulty, number> = {
  beginner: 8,
  intermediate: 10,
  advanced: 12,
  master: 14,
};



const toRecommendedMoves = (
  fen: string,
  candidates: CandidateMove[],
): RecommendedMove[] =>
  candidates.slice(0, 3).map((candidate) => {
    let notation = candidate.move;

    try {
      notation = sanFromUci(fen, candidate.move);
    } catch {
      notation = candidate.move;
    }

    return {
      move: candidate.move,
      notation,
    };
  });

export class MoveAnalysisService {
  private readonly thresholds: ClassificationThresholds;

  constructor(
    private readonly workerPool: WorkerPool,
    private readonly analysisService: AnalysisService,
    private readonly logger: Logger,
  ) {
    this.thresholds = {
      bestMax: env.CLASSIFICATION_BEST_MAX,
      excellentMax: env.CLASSIFICATION_EXCELLENT_MAX,
      goodMax: env.CLASSIFICATION_GOOD_MAX,
      inaccuracyMax: env.CLASSIFICATION_INACCURACY_MAX,
      mistakeMax: env.CLASSIFICATION_MISTAKE_MAX,
    };
  }

  async analyzePlayerMove(params: MoveAnalysisParams): Promise<MoveAnalysisResult | null> {
    const startTime = Date.now();

    try {
      return await this.runPipeline(params, startTime);
    } catch (error) {
      this.logger.warn(
        { gameId: params.gameId, moveUci: params.moveUci, error },
        "Move analysis failed — game continues without classification",
      );
      return null;
    }
  }

  private async runPipeline(
    params: MoveAnalysisParams,
    startTime: number,
  ): Promise<MoveAnalysisResult> {
    const depth = DEPTH_BY_DIFFICULTY[params.difficulty];
    let partial = false;

    /* ── Step 1: Check edge cases ── */
    const edgeOverride = checkEdgeCases({
      fenBefore: params.fenBefore,
      fenAfter: params.fenAfter,
      moveUci: params.moveUci,
      evalBefore: params.evalBeforeHint ?? 0,
    });

    if (edgeOverride) {
      const recommendedMoves = [{
        move: params.moveUci,
        notation: params.moveNotation,
      }];

      return {
        classification: edgeOverride.classification,
        displayMode: edgeOverride.displayMode ?? "badge",
        shortExplanation: edgeOverride.explanation,
        evalBefore: params.evalBeforeHint ?? 0,
        evalAfter: params.evalBeforeHint ?? 0,
        evalLoss: 0,
        bestMove: params.moveUci,
        bestMoveNotation: params.moveNotation,
        recommendedMoves,
        openingBookName: params.openingBookName ?? null,
        explanations: [
          {
            short: edgeOverride.explanation,
            detectorId: edgeOverride.detectorId,
          },
        ],
        analysisDepth: depth,
        analysisTimeMs: Date.now() - startTime,
        fromCache: false,
        partial: false,
      };
    }

    /* ── Step 2-3: Engine analysis of position before the move ── */
    let candidates: CandidateMove[] = [];
    let evalBefore = params.evalBeforeHint ?? 0;
    let bestMove = params.moveUci;
    let bestMoveNotation = params.moveNotation;
    let recommendedMoves: RecommendedMove[] = [];
    let fromCache = false;

    try {
      const result = await this.workerPool.withWorker(params.gameId, async (worker) => {
        return this.analysisService.getCandidates(worker, params.fenBefore, depth);
      });

      candidates = result.candidates;
      if (candidates.length > 0) {
        const topCandidate = candidates[0]!;
        evalBefore = normalizeMateEval(
          normalizeEvaluation(topCandidate.eval, topCandidate.mate),
          topCandidate.mate,
        );
        bestMove = topCandidate.move;
        try {
          bestMoveNotation = sanFromUci(params.fenBefore, topCandidate.move);
        } catch {
          bestMoveNotation = topCandidate.move;
        }
        recommendedMoves = toRecommendedMoves(params.fenBefore, candidates);
      }
    } catch (error) {
      this.logger.warn(
        { gameId: params.gameId, error },
        "Failed to get pre-move candidates — using hint eval",
      );
      partial = true;
    }

    /* ── Step 4: Evaluate position after the move ── */
    let evalAfter = evalBefore;
    try {
      evalAfter = await this.workerPool.withWorker(params.gameId, async (worker) => {
        return this.analysisService.evaluatePosition(worker, params.fenAfter, Math.max(6, depth - 2));
      });
    } catch (error) {
      this.logger.warn(
        { gameId: params.gameId, error },
        "Failed to evaluate post-move position — using pre-move eval",
      );
      partial = true;
    }

    /* Flip perspective: ensure both evals are from the player's perspective */
    const playerMultiplier = params.playerColor === "white" ? 1 : -1;
    const normalizedBefore = evalBefore * playerMultiplier;
    const normalizedAfter = evalAfter * playerMultiplier;

    /* ── Step 5: Evaluation loss ── */
    const evalLoss = Math.max(0, Number((normalizedBefore - normalizedAfter).toFixed(2)));

    /* ── Step 6: Classification ── */
    let classification = classifyByEvalLoss(evalLoss, this.thresholds);

    /* Conservative classification on partial data */
    if (partial) {
      if (classification === "blunder") classification = "mistake";
      if (classification === "mistake") classification = "inaccuracy";
    }

    /* ── Step 7: Brilliant check ── */
    let deepConfirmEval: number | null = null;
    if (evalLoss <= this.thresholds.excellentMax && candidates.length > 0) {
      try {
        deepConfirmEval = await this.workerPool.withWorker(params.gameId, async (worker) => {
          return this.analysisService.evaluatePosition(worker, params.fenAfter, depth + 2);
        });
      } catch {
        /* Non-critical */
      }

      const brilliantResult = detectBrilliant({
        fenBefore: params.fenBefore,
        fenAfter: params.fenAfter,
        moveUci: params.moveUci,
        playerColor: params.playerColor,
        playerEval: normalizedAfter,
        engineBestEval: normalizedBefore,
        engineBestMove: bestMove,
        candidates,
        deepConfirmEval: deepConfirmEval !== null ? deepConfirmEval * playerMultiplier : null,
      });

      if (brilliantResult.brilliant) {
        classification = "brilliant";
      }
    }

    /* ── Step 8: Explanation generation ── */
    const explainerCtx: ExplainerContext = {
      fenBefore: params.fenBefore,
      fenAfter: params.fenAfter,
      moveUci: params.moveUci,
      moveNotation: params.moveNotation,
      playerColor: params.playerColor,
      classification,
      evalBefore: normalizedBefore,
      evalAfter: normalizedAfter,
      evalLoss,
      bestMove,
      bestMoveNotation,
      candidates,
      openingBookName: params.openingBookName,
    };
    const explanations = generateExplanations(explainerCtx);

    /* If no detector fired, provide a generic explanation */
    if (explanations.length === 0) {
      const generic = classification === "best" || classification === "excellent"
        ? "You found one of the strongest moves in this position."
        : classification === "good"
          ? "A solid, reasonable move."
          : `The engine preferred ${bestMoveNotation} in this position.`;
      explanations.push({
        short: generic,
        detectorId: "generic",
      });
    }

    /* ── Step 9: Assemble result ── */
    const result: MoveAnalysisResult = {
      classification,
      displayMode: "badge",
      shortExplanation: explanations[0]?.short ?? "Move analysis is available.",
      evalBefore: Number(normalizedBefore.toFixed(2)),
      evalAfter: Number(normalizedAfter.toFixed(2)),
      evalLoss: Number(evalLoss.toFixed(2)),
      bestMove,
      bestMoveNotation,
      recommendedMoves,
      openingBookName: params.openingBookName ?? null,
      explanations,
      analysisDepth: depth,
      analysisTimeMs: Date.now() - startTime,
      fromCache,
      partial,
    };

    this.logger.info(
      {
        gameId: params.gameId,
        move: params.moveUci,
        classification: result.classification,
        evalLoss: result.evalLoss,
        analysisTimeMs: result.analysisTimeMs,
        partial: result.partial,
        detectors: result.explanations.map((e) => e.detectorId),
      },
      "Move analysis completed",
    );

    return result;
  }
}
