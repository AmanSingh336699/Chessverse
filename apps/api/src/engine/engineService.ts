
import type {
    CandidateMove,
    Difficulty,
    EngineState,
    MoveHistoryEntry,
    PlayerColor,
} from "../contracts.js";
import {
    chooseCandidate,
    getBehaviorScale,
    getDifficultyProfile,
} from "./difficulty.js";
import { detectGamePhase } from "./phaseDetector.js";
import { updateEngineStateAfterDecision } from "./scoring.js";
import { createChess, sanFromUci, uciToMoveShape } from "../utils/chess.js";
import { BehaviorEngine } from "./behaviorEngine.js";
import type { EngineDecision } from "../types.js";
import type { AnalysisService } from "./analysisService.js";
import type { WorkerPool } from "./workerPool.js";
import type { StockfishWorker } from "./stockfishWorker.js";
import type { Logger } from "pino";
import { normalizeGambitState } from "./behavior/gambitState.js";
import type {
    OpeningBook,
    OpeningBookEntry,
} from "../openingBook/polyglotBook.js";
import { HttpError } from "../types.js";
import { buildFinalScore } from "./scoring.js";
import { computeStockfishWeight } from "./difficulty.js";


const RETRYABLE_ENGINE_MESSAGES = [
    "Timed out waiting for Stockfish worker",
    "Engine busy, retry",
] as const;

const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));


const isRetryableEngineError = (error: unknown): boolean => {
    if (error instanceof HttpError) return error.statusCode === 503;
    if (!(error instanceof Error)) return false;
    return RETRYABLE_ENGINE_MESSAGES.some((msg) => error.message.includes(msg));
};

const buildRawFallbackCandidate = (
    candidate: CandidateMove,
    stockfishWeight: number,
) =>
    buildFinalScore(
        candidate,
        stockfishWeight,
        { gambit: 0, trap: 0, sacrifice: 0, aggression: 0, psychological: 0 },
        {
            phaseTags: [],
            strategies: ["raw-stockfish-fallback"],
            continuityDelta: 0,
            tacticalThemes: [],
            opponentPressure: {
                level: "calm",
                consecutiveMistakes: 0,
                consecutiveSolidMoves: 0,
                lastObservedEvalSwing: 0,
            },
            lastDecision: {
                dominantEngine: "stockfish",
                strategy: "raw-stockfish-fallback",
                move: candidate.move,
                moveNumber: 0,
            },
        },
    );


export class EngineService {
    private readonly behaviorEngine: BehaviorEngine;
    private readonly openingBook: OpeningBook | null;

    constructor(
        private readonly pool: WorkerPool,
        private readonly analysisService: AnalysisService,
        private readonly logger: Logger,
        behaviorEngine?: BehaviorEngine,
        openingBook?: OpeningBook | null,
    ) {
        this.behaviorEngine = behaviorEngine ?? new BehaviorEngine();
        this.openingBook = openingBook ?? null;
    }


    async chooseMove(params: {
        gameId: string;
        fen: string;
        difficulty: Difficulty;
        moveNumber: number;
        aiColor: PlayerColor;
        engineState: EngineState;
        moveHistory: MoveHistoryEntry[];
        depthOverride?: number;
    }): Promise<EngineDecision> {
        let attempt = 0;
        let lastError: unknown;

        while (attempt < 2) {
            try {
                return await this.chooseMoveOnce(params);
            } catch (error) {
                lastError = error;

                // Application logic errors (empty candidates, scoring failures, bad FEN)
                // are deterministic — retrying produces the same result and forces the
                // worker pool to restart a perfectly healthy worker.  Surface immediately.
                if (!isRetryableEngineError(error)) {
                    throw error;
                }

                if (attempt >= 1) {
                    throw error;
                }

                attempt += 1;
                this.logger.warn(
                    { error, gameId: params.gameId, attempt },
                    "Retrying engine decision after transient Stockfish failure",
                );
                await delay(200 * attempt);
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error("Engine decision failed");
    }


    private async chooseMoveOnce(params: {
        gameId: string;
        fen: string;
        difficulty: Difficulty;
        moveNumber: number;
        aiColor: PlayerColor;
        engineState: EngineState;
        moveHistory: MoveHistoryEntry[];
        depthOverride?: number;
    }): Promise<EngineDecision> {
        const {
            gameId,
            fen,
            difficulty,
            moveNumber,
            aiColor,
            engineState,
            moveHistory,
            depthOverride,
        } = params;

        // createChess tolerates premove-tainted FENs (illegal ep squares)
        const chess = createChess(fen);
        const phase = detectGamePhase(moveNumber, chess);
        const profile = getDifficultyProfile(difficulty);
        const baseDepth = depthOverride
            ? Math.max(6, Math.min(profile.depth, depthOverride))
            : profile.depth;

        const openingBookEntries =
            phase === "opening" && this.openingBook
                ? this.openingBook.getEntries(fen).slice(0, 3)
                : [];

        // Phase-adjusted movetime: opening 60%, middlegame 100%, endgame 70%
        const phaseMultiplier =
            phase === "opening" ? 0.6 : phase === "endgame" ? 0.7 : 1.0;
        const adjustedMovetime = Math.round(
            profile.movetimeMs * phaseMultiplier,
        );

        return this.pool.withWorker(gameId, async (worker) => {
            const analysis =
                await this.analysisService.getCandidatesWithMovetime(
                    worker,
                    fen,
                    adjustedMovetime,
                    profile.minDepth,
                );

            const stockfishCandidates = this.analysisService.keepTopCandidates(
                analysis.candidates,
            );

            if (stockfishCandidates.length === 0) {
                // Position is terminal or engine returned nothing — hard error, not retryable.
                throw new HttpError(
                    422,
                    "Stockfish returned no candidate moves for this position",
                    {
                        error: "Stockfish returned no candidate moves",
                    },
                );
            }

            const candidates = await this.buildCandidatePool({
                worker,
                fen,
                phase,
                stockfishCandidates,
                openingBookEntries,
            });

            let scored = await this.behaviorEngine.evaluateCandidates({
                gameId,
                fen,
                moveNumber,
                aiColor,
                difficulty,
                phase,
                engineState,
                candidates,
                moveHistory,
                logger: this.logger.child({ gameId }),
                evaluateFen: (evalFen, depth) =>
                    this.analysisService.evaluatePosition(
                        worker,
                        evalFen,
                        depth,
                    ),
            });

            // This can happen when buildSharedBehaviorContext filters all candidates
            // (e.g. all moves are illegal in the flipped-color analysis context).
            // Fall back to raw Stockfish ordering rather than crashing.
            if (scored.length === 0) {
                const stockfishWeight = computeStockfishWeight(
                    phase,
                    difficulty,
                    engineState,
                );
                this.logger.warn(
                    { gameId, fen, phase, candidateCount: candidates.length },
                    "Behavior pipeline returned zero scored candidates — falling back to raw Stockfish ordering",
                );
                scored = candidates.map((c) =>
                    buildRawFallbackCandidate(c, stockfishWeight),
                );
            }

            // scored.length > 0 is guaranteed by the safety net above.
            const selected = chooseCandidate(scored, difficulty, engineState);
            const nextState = updateEngineStateAfterDecision(
                engineState,
                phase,
                selected,
            );
            nextState.gambit = normalizeGambitState(nextState.gambit);

            const ranked = [...scored].sort(
                (l, r) =>
                    r.breakdown.finalScore - l.breakdown.finalScore ||
                    r.eval - l.eval ||
                    l.move.localeCompare(r.move),
            );
            const secondChoice = ranked[1] ?? null;
            const gambitScale = getBehaviorScale(
                difficulty,
                phase,
                engineState,
                "gambit",
            );
            const normalizedRawGambit =
                gambitScale > 0 ? selected.breakdown.gambit / gambitScale : 0;

            this.logger.info(
                {
                    gameId,
                    selected: {
                        move: selected.move,
                        engineMode: selected.engineMode,
                        breakdown: selected.breakdown,
                        annotation: selected.annotation,
                    },
                    secondChoice: secondChoice
                        ? {
                              move: secondChoice.move,
                              engineMode: secondChoice.engineMode,
                              breakdown: secondChoice.breakdown,
                              annotation: secondChoice.annotation,
                          }
                        : null,
                    behaviorSuccessScore: nextState.behaviorSuccessScore,
                    complexityDial: nextState.complexityDial,
                    trapSequence: nextState.trapSequence,
                    sacrificeTracking: nextState.sacrificeTracking,
                    stockfishWeight: selected.breakdown.stockfishWeight,
                    normalizedRawGambit,
                    openingBookEntryCount: openingBookEntries.length,
                    searchMovetime: adjustedMovetime,
                    baseDepth,
                },
                "Behavior pipeline selected move",
            );

            return {
                move: selected.move,
                moveNotation: sanFromUci(fen, selected.move),
                evaluation: selected.eval,
                engineMode: selected.engineMode,
                thinkingTime: analysis.thinkingTime,
                candidateScores: scored,
                engineState: nextState,
            };
        });
    }


    private async buildCandidatePool(params: {
        worker: StockfishWorker;
        fen: string;
        phase: ReturnType<typeof detectGamePhase>;
        stockfishCandidates: CandidateMove[];
        openingBookEntries: readonly OpeningBookEntry[];
    }): Promise<CandidateMove[]> {
        if (
            params.phase !== "opening" ||
            params.openingBookEntries.length === 0
        ) {
            return params.stockfishCandidates;
        }

        const merged = [...params.stockfishCandidates];
        const knownMoves = new Set(merged.map((c) => c.move));

        for (const entry of params.openingBookEntries) {
            if (knownMoves.has(entry.move)) continue;

            const verified = await this.verifyBookCandidate(
                params.worker,
                params.fen,
                entry.move,
                merged.length + 1,
            );
            if (!verified) continue;

            knownMoves.add(verified.move);
            merged.push(verified);
        }

        return merged.sort(
            (l, r) =>
                r.eval - l.eval ||
                l.multipv - r.multipv ||
                l.move.localeCompare(r.move),
        );
    }

    private async verifyBookCandidate(
        worker: StockfishWorker,
        fen: string,
        move: string,
        multipv: number,
    ): Promise<CandidateMove | null> {
        // createChess used here because fen comes from the engine pipeline
        const chess = createChess(fen);
        const movePayload = uciToMoveShape(move);
        if (!movePayload) return null;

        try {
            const applied = chess.move(movePayload);
            if (!applied) return null;
        } catch {
            return null;
        }

        const opponentPerspectiveEval =
            await this.analysisService.evaluatePosition(worker, chess.fen(), 6);

        return {
            move,
            eval: Number((-opponentPerspectiveEval).toFixed(2)),
            multipv,
            depth: 6,
            mate: null,
        };
    }
}
