
import type {
    CandidateMove,
    Difficulty,
    EngineState,
    MoveHistoryEntry,
    MoveTelemetry,
    PlayerColor,
    StyleId,
    StyleMode,
} from "@chessverse/contracts";
import { STYLE_PROFILES } from "@chessverse/contracts";
import {
    chooseCandidate,
    getBehaviorScale,
    getDifficultyProfile,
} from "./difficulty.js";
import { detectGamePhase } from "./phaseDetector.js";
import { updateEngineStateAfterDecision } from "./scoring.js";
import { createChess, sanFromUci, uciToMoveShape } from "../utils/chess.js";
import { BehaviorEngine } from "./behaviorEngine.js";
import type { EngineDecision, EvaluatedCandidate } from "../types.js";
import type { AnalysisService } from "./analysisService.js";
import type { WorkerPool } from "./workerPool.js";
import type { StockfishWorker } from "./stockfishWorker.js";
import type { Logger } from "pino";
import {
    checkGambitRefutation,
    normalizeGambitState,
} from "./behavior/gambitState.js";
import { findRepertoireMove } from "./style/repertoire.js";
import {
    applyBudgetFilter,
    calculateCandidateStyleScore,
    isMoveSafeFromBlunder,
    resolveEngineMode,
    softmaxSelect,
} from "./style/stylePipeline.js";
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

    getUnavailableReason(): string | null {
        return this.pool.getUnavailableReason();
    }

    async getTopStockfishMove(
        fen: string,
        depth = 10,
    ): Promise<{ move: string; evaluation: number } | null> {
        try {
            return await this.pool.withWorker("fallback-stockfish", async (worker) => {
                const result = await this.analysisService.getCandidates(worker, fen, depth);
                const top = result.candidates[0];
                if (!top) return null;
                return {
                    move: top.move,
                    evaluation: top.eval,
                };
            }, 1);
        } catch {
            return null;
        }
    }

    async chooseMove(params: {
        gameId: string;
        fen: string;
        difficulty: Difficulty;
        style?: StyleId;
        moveNumber: number;
        aiColor: PlayerColor;
        engineState: EngineState;
        moveHistory: MoveHistoryEntry[];
        depthOverride?: number;
        seed?: number;
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
        style?: StyleId;
        moveNumber: number;
        aiColor: PlayerColor;
        engineState: EngineState;
        moveHistory: MoveHistoryEntry[];
        depthOverride?: number;
        seed?: number;
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

        const style: StyleId = params.style ?? engineState.style ?? "solid";
        const styleProfile = STYLE_PROFILES[style] ?? STYLE_PROFILES.solid;

        // createChess tolerates premove-tainted FENs (illegal ep squares)
        const chess = createChess(fen);
        const phase = detectGamePhase(moveNumber, chess);

        // Stage 1: Style repertoire (curated gambits/lines per color)
        if (phase === "opening") {
            const uciHistory = moveHistory.map((m) => m.moveUci);
            const repertoireMatch = findRepertoireMove(
                styleProfile.repertoireId,
                aiColor,
                uciHistory,
                0,
            );

            if (repertoireMatch) {
                const shape = uciToMoveShape(repertoireMatch.move);
                if (shape) {
                    const testChess = createChess(fen);
                    const applied = testChess.move(shape);
                    if (applied) {
                        let nextGambit = engineState.gambit;
                        if (repertoireMatch.gambit.acceptedMove) {
                            nextGambit = {
                                active: true,
                                status: "offered",
                                line: repertoireMatch.gambit.name,
                                cooldown: 0,
                                refutedCount: 0,
                                handoffMode: "none",
                                refuted: false,
                                attemptMoveNumber: moveNumber,
                            };
                        }
                        const nextMode: StyleMode =
                            nextGambit.status === "offered" ? "gambit" : "opening";
                        const telemetry: MoveTelemetry = {
                            style: styleProfile.id,
                            module: "style-repertoire",
                            cpCost: 0,
                            reason: `Played repertoire line: ${repertoireMatch.gambit.name}`,
                        };
                        const nextState: EngineState = {
                            ...engineState,
                            style: styleProfile.id,
                            mode: nextMode,
                            telemetry,
                            gambit: nextGambit,
                            lastDecision: {
                                dominantEngine: nextGambit.status === "offered" ? "gambit" : "stockfish",
                                strategy: `repertoire:${repertoireMatch.gambit.id}`,
                                move: repertoireMatch.move,
                                moveNumber,
                            },
                        };

                        return {
                            move: repertoireMatch.move,
                            moveNotation: applied.san,
                            evaluation: 0,
                            engineMode:
                                nextGambit.status === "offered"
                                    ? "gambit"
                                    : "stockfish",
                            thinkingTime: 10,
                            candidateScores: [],
                            engineState: nextState,
                        };
                    }
                }
            }
        }

        const profile = getDifficultyProfile(difficulty);
        const baseDepth = depthOverride
            ? Math.max(6, Math.min(profile.depth, depthOverride))
            : profile.depth;

        // Stage 2 & 3: Opening books (style / general)
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
            // Stage 4: Stockfish MultiPV candidates
            const analysis =
                await this.analysisService.getCandidatesWithMovetime(
                    worker,
                    fen,
                    adjustedMovetime,
                    profile.minDepth,
                );

            const rawStockfishCandidates = this.analysisService.keepTopCandidates(
                analysis.candidates,
            );

            if (rawStockfishCandidates.length === 0) {
                // Position is terminal or engine returned nothing — hard error, not retryable.
                throw new HttpError(
                    422,
                    "Stockfish returned no candidate moves for this position",
                    {
                        error: "Stockfish returned no candidate moves",
                    },
                );
            }

            const stockfishCandidates = rawStockfishCandidates.slice(
                0,
                styleProfile.multiPv,
            );

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

            // Stage 5: Drop candidates whose cpLoss exceeds style budget for the phase
            const evalBudgetCp = styleProfile.evalBudgetCp[phase];
            const budgetedCandidates = applyBudgetFilter(scored, evalBudgetCp);

            // Stage 6: Calculate centipawn score: score = -cpLoss + capped style bonuses
            const bestEval = scored[0]?.eval ?? 0;
            const scoredWithStyle = budgetedCandidates.map((c) => {
                const weights = styleProfile.bonusWeights;
                const rawBonus =
                    (c.breakdown.gambit * weights.gambit +
                        c.breakdown.trap * weights.trap +
                        c.breakdown.sacrifice * weights.sacrifice +
                        c.breakdown.aggression * weights.aggression +
                        c.breakdown.psychological * weights.psychological) /
                    100;
                const bonusCp = Math.min(200, Math.max(0, Math.round(rawBonus)));
                return calculateCandidateStyleScore({
                    candidate: c,
                    bestEval,
                    bonusCp,
                });
            });

            // Stage 7: Seeded softmax pick
            const picked = softmaxSelect(
                scoredWithStyle,
                styleProfile.temperature,
                params.seed,
            );

            // Stage 8: Blunder guard (never allow mate-in-1 against us or hang queen)
            const isSafe = isMoveSafeFromBlunder(fen, picked.move, aiColor);
            const topCandidate = scoredWithStyle[0] ?? picked;
            const selected = isSafe ? picked : topCandidate;

            const nextState = updateEngineStateAfterDecision(
                engineState,
                phase,
                selected,
            );
            nextState.gambit = checkGambitRefutation(
                normalizeGambitState(nextState.gambit),
                Math.round(selected.eval * 100),
                evalBudgetCp,
            );

            const nextMode = resolveEngineMode({
                phase,
                evalCp: Math.round(selected.eval * 100),
                profile: styleProfile,
                isGambitActive: nextState.gambit.active,
                hasAttackAdvantage: selected.eval > 1.0,
            });
            nextState.mode = nextMode;
            nextState.style = styleProfile.id;
            nextState.telemetry = {
                style: styleProfile.id,
                module: !isSafe ? "blunder-guard-override" : selected.engineMode,
                cpCost: selected.cpLoss,
                reason: !isSafe
                    ? `Blunder guard overrode unsafe move with top engine move`
                    : `Selected by ${styleProfile.name} profile`,
            };

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
                    style: styleProfile.id,
                    mode: nextMode,
                    telemetry: nextState.telemetry,
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
